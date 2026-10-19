import { Hono } from "hono";
import { ageHours, buildPlayersResponse } from "@freepl/contract";
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

/**
 * The Hono app, platform-agnostic: api/index.ts mounts it on Vercel, src/dev.ts locally.
 * Caching per ADR 0002: the key is latest_bootstrap.captured_at; the parsed, serialised
 * body is memoised per key (best effort on serverless — ETag/304 and the edge do the rest).
 */
export function createApp(repo: Repo, log: Log = defaultLog) {
  let cache: { key: string; body: string } | null = null;
  let building: Promise<{ key: string; body: string }> | null = null;

  async function build(): Promise<{ key: string; body: string }> {
    const response = buildPlayersResponse(await repo.bootstrapRows());
    return { key: response.meta.sources.bootstrap.capturedAt, body: JSON.stringify(response) };
  }

  const app = new Hono().basePath("/api");

  app.get("/players", async (c) => {
    const latest = await repo.latestCapturedAt();
    if (latest === null) return c.json({ error: "No data yet" }, 503);
    const key = toIso(latest);
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
