import { Hono } from "hono";
import {
  ageHours, buildEntryView, buildFixturesResponse, buildPlayersResponse, lastStartedGameweek,
  type EntryView, type PlayersResponse,
} from "@freepl/contract";
import { EntryCache } from "./entryCache.js";
import { FplNotFound, type FplClient } from "./fpl.js";
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
export interface AppOptions {
  /** Live entry reads (ADR 0003); without it the entry route answers 503. */
  fpl?: FplClient;
  /** The team shown when no id is given (FPL_ENTRY_ID). */
  defaultEntryId?: number;
}

export function createApp(repo: Repo, log: Log = defaultLog, options: AppOptions = {}) {
  const app = new Hono().basePath("/api");

  // The parsed players response, memoised per bootstrap capture; /players and /entry share it.
  interface ParsedPlayers { key: string; response: PlayersResponse; body: string }
  let players: ParsedPlayers | null = null;
  let loadingPlayers: Promise<ParsedPlayers> | null = null;
  async function playersFor(key: string): Promise<ParsedPlayers> {
    if (players?.key !== key) {
      loadingPlayers ??= (async () => {
        const response = buildPlayersResponse(await repo.bootstrapRows());
        return { key: response.meta.sources.bootstrap.capturedAt, response, body: JSON.stringify(response) };
      })().finally(() => (loadingPlayers = null));
      players = await loadingPlayers;
    }
    return players;
  }

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
      const latest = await repo.latestCapturedAt();
      const p = await playersFor(latest === null ? "" : toIso(latest));
      return { key: p.key, body: p.body };
    },
  );

  // Spec 0004: any Entry by numeric team id, read live from FPL and never stored (ADR 0003).
  const entries = new EntryCache<EntryView>();
  const ENTRY_CACHE_CONTROL = "public, max-age=60, s-maxage=300";
  async function fetchEntry(id: number, pl: PlayersResponse): Promise<EntryView> {
    const fpl = options.fpl!;
    const n = lastStartedGameweek(pl.gameweeks);
    const summary = await fpl.get(`entry/${id}`);
    const history = await fpl.get(`entry/${id}/history`);
    const transfers = await fpl.get(`entry/${id}/transfers`);
    let picks: unknown = null;
    let picksBeforeFreeHit: unknown = null;
    if (n !== null) {
      try {
        picks = await fpl.get(`entry/${id}/event/${n}/picks`);
      } catch (err) {
        // An Entry created after gameweek n's deadline has no picks for it yet.
        if (!(err instanceof FplNotFound)) throw err;
      }
      if ((picks as { active_chip?: unknown } | null)?.active_chip === "freehit" && n > 1) {
        picksBeforeFreeHit = await fpl.get(`entry/${id}/event/${n - 1}/picks`);
      }
    }
    return buildEntryView({
      summary, history, transfers, picks, picksBeforeFreeHit,
      gameweek: picks === null ? null : n, players: pl.players, gameweeks: pl.gameweeks,
    });
  }

  app.get("/entry/:id?", async (c) => {
    const raw = c.req.param("id");
    if (raw !== undefined && !/^[1-9]\d{0,9}$/.test(raw)) return c.json({ error: "A team ID is a whole number" }, 400);
    const id = raw === undefined ? options.defaultEntryId : Number(raw);
    if (id === undefined) return c.json({ error: "No default team configured" }, 404);
    if (!options.fpl) return c.json({ error: "Live FPL reads are not configured" }, 503);
    const latest = await repo.latestCapturedAt();
    if (latest === null) return c.json({ error: "No data yet" }, 503);
    const pl = await playersFor(toIso(latest));

    const cached = entries.get(id);
    const respond = (view: EntryView, fetchedAt: number, stale: boolean) =>
      c.json({
        meta: { sources: { bootstrap: pl.response.meta.sources.bootstrap, entry: { fetchedAt: new Date(fetchedAt).toISOString(), stale } } },
        view,
      }, 200, { "Cache-Control": stale ? "no-store" : ENTRY_CACHE_CONTROL });
    if (cached?.fresh) return respond(cached.hit.value, cached.hit.fetchedAt, false);

    try {
      const view = await fetchEntry(id, pl.response);
      entries.set(id, view);
      return respond(view, Date.now(), false);
    } catch (err) {
      if (err instanceof FplNotFound) {
        c.header("Cache-Control", "public, max-age=60, s-maxage=300");
        return c.json({ error: `No FPL team with ID ${id}` }, 404);
      }
      // FPL down or a shape we can't read: serve the last good copy, labelled stale.
      log(`GET /entry live read failed`, err instanceof Error ? err.message : err);
      if (cached) return respond(cached.hit.value, cached.hit.fetchedAt, true);
      c.header("Cache-Control", "no-store");
      return c.json({ error: "FPL is not answering right now. Try again in a few minutes." }, 502);
    }
  });

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
