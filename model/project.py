"""Projection job: log projections for the upcoming gameweek before its deadline.

Spec: docs/specs/0009-projection-model.md (part 1); ADR 0004. Run by snapshot.yml after every
snapshot run. Outside a deadline window it does nothing. Inside one it reads the latest capture
before the deadline and the settled gameweeks known by then, and writes one run of the last-5
baseline to `projections` in a single transaction. The database refuses rows written at or
after the deadline (ADR 0004 point 3), so a late run fails loudly instead of being logged.

Reads only api_snapshots; writes only projections, and only INSERTs.
"""

import os
import sys
from datetime import datetime, timedelta, timezone

import psycopg
from dotenv import load_dotenv

DEADLINE_WINDOW = timedelta(hours=3)  # the same window as scripts/snapshot.py
LAST5 = ("last5", "1")  # (model, model_version): spec 0009 Q112
LOOKBACK = 5

LATEST_BOOTSTRAP_SQL = """
select season, payload -> 'events'
from api_snapshots
where endpoint = 'bootstrap-static' and capture_reason <> 'backfill'
order by captured_at desc limit 1
"""

# The latest capture strictly before the deadline: what was known at the deadline.
INPUT_CAPTURE_SQL = """
select id, captured_at
from api_snapshots
where endpoint = 'bootstrap-static' and capture_reason <> 'backfill'
  and season = %s and captured_at < %s
order by captured_at desc limit 1
"""

ELEMENT_IDS_SQL = """
select (e ->> 'id')::int
from api_snapshots s, jsonb_array_elements(s.payload -> 'elements') e
where s.id = %s
"""

# Points per player in the last LOOKBACK settled gameweeks whose live capture landed before the
# deadline (point-in-time: data-integrity rules), one capture per gameweek.
RECENT_POINTS_SQL = """
with g as (
  select distinct on (gameweek) gameweek, payload
  from api_snapshots
  where endpoint like 'event/%%/live' and capture_reason = 'post_gw'
    and season = %s and captured_at < %s
  order by gameweek desc, captured_at desc
  limit %s
)
select g.gameweek, (e ->> 'id')::int, (e -> 'stats' ->> 'total_points')::int
from g, jsonb_array_elements(g.payload -> 'elements') e
"""

INSERT_SQL = """
insert into projections
  (season, gameweek, deadline_time, model, model_version, element_id, expected_points, input_capture_id)
values (%s, %s, %s, %s, %s, %s, %s, %s)
"""


def next_deadline(events, now: datetime):
    """(gameweek, deadline) of the earliest deadline after now, or None after the last one."""
    upcoming = [
        (ev["id"], datetime.fromisoformat(ev["deadline_time"]))
        for ev in events
        if ev.get("deadline_time") and datetime.fromisoformat(ev["deadline_time"]) > now
    ]
    return min(upcoming, key=lambda x: x[1]) if upcoming else None


def last5(element_ids, points_by_gw) -> dict:
    """Each player's average points over the last 5 settled gameweeks given (spec 0009 Q112).

    points_by_gw: {gameweek: {element_id: total_points}}, only gameweeks known before the
    deadline. A gameweek the player is absent from (added to FPL later) is skipped for him; a
    blank or a match he missed counts, as the 0 it was. No history at all → 0.
    """
    gws = sorted(points_by_gw)[-LOOKBACK:]
    out = {}
    for pid in element_ids:
        seen = [points_by_gw[gw][pid] for gw in gws if pid in points_by_gw[gw]]
        out[pid] = round(sum(seen) / len(seen), 3) if seen else 0.0
    return out


def main() -> int:
    load_dotenv()
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        print("config error: missing required env DATABASE_URL")
        return 2
    now = datetime.now(timezone.utc)

    with psycopg.connect(database_url) as conn:
        latest = conn.execute(LATEST_BOOTSTRAP_SQL).fetchone()
        if latest is None:
            print("no bootstrap capture yet; nothing to do")
            return 0
        season, events = latest
        target = next_deadline(events, now)
        if target is None or not (target[1] - DEADLINE_WINDOW <= now < target[1]):
            print("outside a deadline window; nothing to do")
            return 0
        gameweek, deadline = target

        capture = conn.execute(INPUT_CAPTURE_SQL, (season, deadline)).fetchone()
        if capture is None:
            print(f"FAILED: no capture before the GW{gameweek} deadline {deadline:%Y-%m-%dT%H:%MZ}")
            return 1
        capture_id, captured_at = capture
        element_ids = [r[0] for r in conn.execute(ELEMENT_IDS_SQL, (capture_id,))]
        points_by_gw: dict = {}
        for gw, pid, pts in conn.execute(RECENT_POINTS_SQL, (season, deadline, LOOKBACK)):
            points_by_gw.setdefault(gw, {})[pid] = pts
        conn.commit()  # end the reading transaction: created_at is the insert's own start

        projected = last5(element_ids, points_by_gw)
        model, version = LAST5
        with conn.transaction(), conn.cursor() as cur:
            cur.executemany(INSERT_SQL, [
                (season, gameweek, deadline, model, version, pid, ep, capture_id)
                for pid, ep in projected.items()
            ])

    print(
        f"season={season} GW{gameweek} deadline={deadline:%Y-%m-%dT%H:%MZ} "
        f"input_capture={capture_id} ({captured_at:%Y-%m-%dT%H:%MZ}) "
        f"{model}@{version}: {len(projected)} players from GWs {sorted(points_by_gw)} logged"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
