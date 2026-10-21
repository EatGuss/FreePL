import { Hono } from "hono";
import { ageHours, buildFixturesResponse, buildPlayersResponse } from "@freepl/contract";
import type { Repo } from "./repo.js";

type Log = (message: string, err?: unknown) => void;
const defaultLog: Log = (message, err) => console.error(message, err);

const CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=600";

const toIso = (v: Date | string) => (v instanceof Date ? v : new Date(v)).toISOString();

/**
 * If-None-Match uses weak comparison (RFC 9110 §13.1.2): a list of tags, any may carry W/.
 * The edge may weaken our ETag when it compresses, so the browser can send W/"…" back.
 */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const bare = etag.replace(/^W\//, "");
  return header.split(",").some((t) => {
    const tag = t.trim();
    return tag === "*" || tag.replace(/^W\//, "") === bare;
  });
}

interface Cached {
  key: string;
  body: string;
}

/**
 * The Hono app, platform-agnostic: api/index.js mounts it on Vercel, src/dev.ts locally.
 * Caching per ADR 0002: each route's key is the captured_at of the capture(s) it serves; the
 * parsed, serialised body is memoised per key (best effort on serverless — ETag/304 and the
 * edge do the rest).
 */
export function createApp(repo: Repo, log: Log = defaultLog) {
  const app = new Hono().basePath("/api");

  /** A JSON route served from memory while its key is unchanged, with ETag and 304. */
  function cachedJson(path: string, currentKey: () => Promise<string | null>, build: () => Promise<Cached>) {
    let cache: Cached | null = null;
    let building: Promise<Cached> | null = null;
    app.get(path, async (c) => {
      const key = await currentKey();
      if (key === null) return c.json({ error: "No data yet" }, 503);
      const etag = `"${key}"`;
      if (etagMatches(c.req.header("If-None-Match"), etag)) {
        return c.body(null, 304, { ETag: etag, "Cache-Control": CACHE_CONTROL });
      }
      if (cache?.key !== key) {
        building ??= build().finally(() => (building = null));
        cache = await building;
      }
      return c.body(cache.body, 200, {
        "Content-Type": "application/json; charset=utf-8",
        ETag: `"${cache.key}"`,
        "Cache-Control": CACHE_CONTROL,
      });
    });
  }

  cachedJson(
    "/players",
    async () => {
      const latest = await repo.latestCapturedAt();
      return latest === null ? null : toIso(latest);
    },
    async () => {
      const response = buildPlayersResponse(await repo.bootstrapRows());
      return { key: response.meta.sources.bootstrap.capturedAt, body: JSON.stringify(response) };
    },
  );

  // Keyed on both captures: a new bootstrap (Clubs, deadlines) or a new fixture list refreshes it.
  const fixturesKey = (bootstrapAt: string, fixturesAt: string) => `${bootstrapAt}|${fixturesAt}`;
  cachedJson(
    "/fixtures",
    async () => {
      const [b, f] = await Promise.all([repo.latestCapturedAt(), repo.latestFixturesCapturedAt()]);
      return b === null || f === null ? null : fixturesKey(toIso(b), toIso(f));
    },
    async () => {
      const response = buildFixturesResponse(await repo.fixturesRows());
      const { bootstrap, fixtures } = response.meta.sources;
      return { key: fixturesKey(bootstrap.capturedAt, fixtures.capturedAt), body: JSON.stringify(response) };
    },
  );

  app.get("/health", async (c) => {
    c.header("Cache-Control", "no-store");
    const latest = await repo.latestCapturedAt();
    if (latest === null) return c.json({ ok: false, latestSnapshotAt: null, dataAgeHours: null }, 503);
    const latestSnapshotAt = toIso(latest);
    return c.json({ ok: true, latestSnapshotAt, dataAgeHours: Math.round(ageHours(latestSnapshotAt) * 10) / 10 });
  });

  app.notFound((c) => c.json({ error: "Not found" }, 404));

  // Generic message only; connection strings, SQL and stacks go to the log.
  app.onError((err, c) => {
    log(`${c.req.method} ${c.req.path} failed`, err);
    c.header("Cache-Control", "no-store");
    return c.json({ error: "Something went wrong" }, 500);
  });

  return app;
}
