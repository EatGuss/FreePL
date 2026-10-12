"""Snapshot job: capture raw FPL API payloads into Neon and a gzipped file archive.

Spec: docs/specs/0001-snapshot-job.md. Run hourly. Every "is it due" decision reads
from api_snapshots, so a missed run self-heals and a repeated run is safe.

Read-only against the FPL API. api_snapshots is append-only: this script only INSERTs.
"""

import gzip
import json
import os
import random
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import psycopg
from dotenv import load_dotenv

BASE_URL = "https://fantasy.premierleague.com/api/"
SEASON = "2026-27"
DEADLINE_WINDOW = timedelta(hours=2)
ROUTINE_MAX_AGE = {
    "bootstrap-static": timedelta(hours=11),
    "fixtures": timedelta(hours=23),
    "team/set-piece-notes": timedelta(days=6),
}
POST_GW_CAP = 3  # settled GWs backfilled per run
TIMEOUT_S = 30
ATTEMPTS = 3
BACKOFF_S = 2  # ≈2s, 4s, 8s, plus jitter
MIN_REQUEST_GAP_S = 1.0

INSERT_SQL = """
insert into api_snapshots
  (endpoint, resource_id, gameweek, captured_at, capture_reason, deadline_time, payload)
values (%s, %s, %s, %s, %s, %s, %s::jsonb)
"""


class FetchError(Exception):
    pass


def is_valid_shape(endpoint: str, data) -> bool:
    if endpoint == "bootstrap-static":
        return isinstance(data, dict) and {"events", "elements", "teams"} <= data.keys()
    if endpoint == "fixtures":
        return isinstance(data, list) and len(data) > 0
    if endpoint.startswith("event/") and endpoint.endswith("/live"):
        return isinstance(data, dict) and "elements" in data
    if endpoint.startswith("entry/") and endpoint.endswith("/history"):
        return isinstance(data, dict) and "current" in data
    if endpoint.startswith("entry/") and endpoint.endswith("/picks"):
        return isinstance(data, dict) and "picks" in data
    # team/set-piece-notes: shape unknown; valid JSON is enough for now.
    return True


def main() -> int:
    load_dotenv()
    database_url = os.environ.get("DATABASE_URL", "").strip()
    entry_id = os.environ.get("FPL_ENTRY_ID", "").strip()
    contact = os.environ.get("FPL_CONTACT", "").strip()
    archive_dir = Path(os.environ.get("ARCHIVE_DIR") or "./_archive")
    healthcheck_url = os.environ.get("HEALTHCHECK_URL", "").strip().rstrip("/")
    force = os.environ.get("FORCE", "").strip() == "1"

    def ping(ok: bool) -> None:
        if not healthcheck_url:
            return
        url = healthcheck_url if ok else f"{healthcheck_url}/fail"
        try:
            httpx.get(url, timeout=10)
        except httpx.HTTPError as e:
            # A failed ping must not change the run's outcome; the missing ping is the alarm.
            print(f"healthcheck ping failed: {type(e).__name__}")

    missing = [
        name
        for name, value in (
            ("DATABASE_URL", database_url),
            ("FPL_ENTRY_ID", entry_id),
            ("FPL_CONTACT", contact),
        )
        if not value
    ]
    if missing:
        print(f"config error: missing required env {', '.join(missing)}")
        ping(False)
        return 2

    failed = False
    client = httpx.Client(
        base_url=BASE_URL,
        headers={"User-Agent": f"FreePL-snapshot/0.1 (+contact: {contact})"},
        timeout=TIMEOUT_S,
    )
    last_request_end = 0.0

    def fetch(endpoint: str):
        """Return (body_bytes, parsed_json, captured_at). Raises FetchError."""
        nonlocal last_request_end
        last_error = "no attempt made"
        for attempt in range(ATTEMPTS):
            if attempt:
                time.sleep(BACKOFF_S * 2 ** (attempt - 1) + random.uniform(0, 1))
            gap = MIN_REQUEST_GAP_S - (time.monotonic() - last_request_end)
            if gap > 0:
                time.sleep(gap)
            try:
                resp = client.get(f"{endpoint}/")
            except httpx.TransportError as e:
                last_error = f"{type(e).__name__}"
                continue
            finally:
                last_request_end = time.monotonic()
            captured_at = datetime.now(timezone.utc)
            if resp.status_code == 429 or resp.status_code >= 500:
                last_error = f"HTTP {resp.status_code}"
                continue
            if resp.status_code != 200:
                raise FetchError(f"HTTP {resp.status_code}")
            body = resp.content
            try:
                data = json.loads(body)
            except ValueError:
                raise FetchError(f"non-JSON body ({len(body)} bytes)")
            if not is_valid_shape(endpoint, data):
                raise FetchError(f"unexpected shape ({len(body)} bytes)")
            return body, data, captured_at
        raise FetchError(f"gave up after {ATTEMPTS} attempts: {last_error}")

    # DB connection. If it fails we still fetch and archive, and the run goes red.
    conn = None
    try:
        conn = psycopg.connect(
            database_url, autocommit=True, connect_timeout=15, prepare_threshold=None
        )
    except Exception as e:
        failed = True
        msg = str(e).replace(database_url, "<DATABASE_URL>").splitlines()[0] if str(e) else ""
        print(f"db connect failed: {type(e).__name__}: {msg}")

    # 1. bootstrap-static, always.
    now = datetime.now(timezone.utc)
    try:
        boot_body, boot, boot_captured_at = fetch("bootstrap-static")
    except FetchError as e:
        print(f"bootstrap-static decision=fetch outcome=FAIL ({e}); cannot evaluate anything else")
        ping(False)
        return 1

    deadlines = {
        ev["id"]: datetime.fromisoformat(ev["deadline_time"])
        for ev in boot["events"]
        if ev.get("deadline_time")
    }
    upcoming = sorted((d, gw) for gw, d in deadlines.items() if d > now)
    if upcoming:
        next_deadline, next_gw = upcoming[0]
    else:
        next_deadline, next_gw = None, None  # season over
    in_window = next_deadline is not None and next_deadline - DEADLINE_WINDOW <= now < next_deadline

    def age_of_latest(endpoint: str):
        """Age of the newest row for endpoint; None if no row. Raises on DB error."""
        with conn.cursor() as cur:
            cur.execute(
                "select max(captured_at) from api_snapshots where endpoint = %s", (endpoint,)
            )
            latest = cur.fetchone()[0]
        return None if latest is None else now - latest

    # 2. Decide. Each plan item: endpoint, resource_id, gameweek, deadline_time, reason.
    plan = []
    for endpoint in ("bootstrap-static", "fixtures", "team/set-piece-notes"):
        if endpoint == "bootstrap-static" and in_window:
            # Deadline captures win over FORCE: a 'manual' label would hide them from
            # every deadline query.
            reason, why = "deadline", f"inside window for GW{next_gw} deadline {next_deadline:%Y-%m-%dT%H:%MZ}"
        elif force:
            reason, why = "manual", "FORCE=1"
        elif conn is None:
            reason, why = "routine", "db unavailable, cannot read latest row; archiving anyway"
        else:
            try:
                age = age_of_latest(endpoint)
            except psycopg.Error as e:
                failed = True
                print(f"{endpoint} decision=FAIL (db read: {type(e).__name__})")
                continue
            if age is not None and age <= ROUTINE_MAX_AGE[endpoint]:
                print(f"{endpoint} decision=skip (latest row {age.total_seconds() / 3600:.1f}h old)")
                continue
            reason = "routine"
            why = "no previous row" if age is None else f"latest row {age.total_seconds() / 3600:.1f}h old"
        plan.append((endpoint, None, next_gw, next_deadline, reason, why))

    # post_gw: every settled GW missing a post_gw row, oldest first, capped. Skipped
    # under FORCE (FORCE ignores the decision table) and when the DB is unreachable
    # (these payloads stay re-fetchable, so nothing is lost by waiting).
    if force:
        print("post_gw decision=skip (FORCE=1)")
    elif conn is None:
        print("post_gw decision=skip (db unavailable)")
    else:
        settled = sorted(
            ev["id"] for ev in boot["events"] if ev.get("finished") and ev.get("data_checked")
        )
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "select distinct endpoint, gameweek from api_snapshots"
                    " where capture_reason = 'post_gw'"
                )
                have = set(cur.fetchall())
        except psycopg.Error as e:
            failed = True
            settled = []
            print(f"post_gw decision=FAIL (db read: {type(e).__name__})")
        gws_planned = 0
        for gw in settled:
            wanted = [
                (f"event/{gw}/live", None),
                (f"entry/{entry_id}/history", entry_id),
                (f"entry/{entry_id}/event/{gw}/picks", entry_id),
            ]
            todo = [(ep, rid) for ep, rid in wanted if (ep, gw) not in have]
            if not todo:
                continue
            if gws_planned == POST_GW_CAP:
                print(f"post_gw decision=defer (GW{gw} onwards; cap {POST_GW_CAP} GWs per run)")
                break
            gws_planned += 1
            for ep, rid in todo:
                plan.append((ep, rid, gw, deadlines.get(gw), "post_gw", f"GW{gw} settled, no row"))

    # 3–4. Fetch what's due, then archive file first, DB row second. Neither sink skips the other.
    deadline_stored = False
    for endpoint, resource_id, gameweek, deadline_time, reason, why in plan:
        prefix = f"{endpoint} gw={gameweek} decision=store reason={reason} ({why})"
        if endpoint == "bootstrap-static":
            body, captured_at = boot_body, boot_captured_at
        else:
            try:
                body, _, captured_at = fetch(endpoint)
            except FetchError as e:
                failed = True
                print(f"{prefix} outcome=FAIL fetch: {e}")
                continue

        archive_ok = False
        name = f"{captured_at:%Y%m%dT%H%M%SZ}_{reason}"
        if resource_id:
            name += f"_{resource_id}"
        path = archive_dir / SEASON / endpoint.replace("/", "_") / f"{name}.json.gz"
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "xb") as f:  # never overwrite an existing archive file
                f.write(gzip.compress(body, mtime=0))
            archive_ok = True
            archive_result = "ok"
        except OSError as e:
            archive_result = f"FAIL {type(e).__name__}: {e}"

        db_ok = False
        if conn is None:
            db_result = "FAIL no connection"
        else:
            try:
                conn.execute(
                    INSERT_SQL,
                    (endpoint, resource_id, gameweek, captured_at, reason, deadline_time,
                     body.decode("utf-8")),
                )
                db_ok = True
                db_result = "ok"
            except (psycopg.Error, UnicodeDecodeError) as e:
                db_result = f"FAIL {type(e).__name__}"

        if not (archive_ok and db_ok):
            failed = True
        if reason == "deadline" and archive_ok and db_ok:
            deadline_stored = True
        outcome = "ok" if archive_ok and db_ok else "FAIL"
        print(f"{prefix} bytes={len(body)} archive={archive_result} db={db_result} outcome={outcome}")

    if in_window and not deadline_stored:
        failed = True
        print(f"DEADLINE ASSERTION FAILED: inside window for GW{next_gw}, no deadline row stored in both sinks")

    if conn is not None:
        conn.close()
    client.close()

    # 5. Dead-man's switch, then exit status.
    ping(not failed)
    print("run FAILED" if failed else "run ok")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
