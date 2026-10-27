import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrap, player } from "@freepl/contract/test-fixtures";
import { createApp } from "../src/app.js";
import { EntryCache } from "../src/entryCache.js";
import { FplNotFound, FplUnavailable, createFplClient, type FplClient } from "../src/fpl.js";
import type { Repo } from "../src/repo.js";

// A synthetic Squad of ids 1–15 and gameweeks whose deadlines are all in the past except 38.
const elementType = (id: number) => (id <= 2 ? 1 : id <= 7 ? 2 : id <= 12 ? 3 : 4);
const rows = {
  ...bootstrap(Array.from({ length: 15 }, (_, k) => player({ id: k + 1, element_type: elementType(k + 1), team: (k % 2) + 1, now_cost: 50, cost_change_start: 0 }))),
  gameweeks: Array.from({ length: 38 }, (_, k) => ({
    id: k + 1, name: `Gameweek ${k + 1}`, deadline_time: new Date(Date.UTC(2020, 7, 1 + 7 * k)).toISOString(),
    finished: k < 37, data_checked: k < 37, is_current: false, is_next: false,
  })).map((g) => (g.id === 38 ? { ...g, deadline_time: "2099-05-01T10:00:00Z" } : g)),
};
const repo: Repo = {
  latestCapturedAt: async () => rows.capturedAt as Date,
  bootstrapRows: async () => rows,
  latestFixturesCapturedAt: async () => null,
  fixturesRows: async () => { throw new Error("unused"); },
};
const entryData = (id: number) => ({
  [`entry/${id}`]: { id, name: "Test XI", player_first_name: "Test", player_last_name: "Manager" },
  [`entry/${id}/history`]: { current: [{ event: 37, points: 60, total_points: 2000, overall_rank: 12345, bank: 7, value: 1003, event_transfers: 0, event_transfers_cost: 0 }], chips: [] },
  [`entry/${id}/transfers`]: [],
  [`entry/${id}/event/37/picks`]: { active_chip: null, picks: Array.from({ length: 15 }, (_, k) => ({ element: k + 1, position: k + 1, is_captain: k === 6, is_vice_captain: k === 7 })) },
});

function fakeFpl(data: Record<string, unknown>) {
  const calls: string[] = [];
  let down = false;
  const fpl: FplClient = {
    async get(path) {
      calls.push(path);
      if (down) throw new FplUnavailable("down");
      if (!(path in data)) throw new FplNotFound(path);
      return data[path];
    },
  };
  return { fpl, calls, setDown: (v: boolean) => (down = v) };
}
const silent = () => {};

afterEach(() => vi.useRealTimers());

describe("GET /api/entry", () => {
  it("shows the default team, rebuilt from live reads, with an edge-cacheable header", async () => {
    const f = fakeFpl(entryData(42));
    const res = await createApp(repo, silent, { fpl: f.fpl, defaultEntryId: 42 }).request("/api/entry");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60, s-maxage=300");
    const body = await res.json() as { view: { entry: unknown; gameweek: number; squad: unknown[]; state: { bank: number } }; meta: { sources: { entry: { stale: boolean } } } };
    expect(body.view.entry).toEqual({ id: 42, name: "Test XI", manager: "Test Manager" });
    expect(body.view.gameweek).toBe(37);
    expect(body.view.squad).toHaveLength(15);
    expect(body.view.state.bank).toBe(7);
    expect(body.meta.sources.entry.stale).toBe(false);
    expect(f.calls).toEqual(["entry/42", "entry/42/history", "entry/42/transfers", "entry/42/event/37/picks"]);
  });

  it("accepts only plain positive whole numbers as a team id", async () => {
    const app = createApp(repo, silent, { fpl: fakeFpl({}).fpl });
    for (const bad of ["abc", "0", "12a", "1.5", "-3", "12345678901"]) {
      expect((await app.request(`/api/entry/${bad}`)).status, bad).toBe(400);
    }
  });

  it("says plainly when a team id doesn't exist", async () => {
    const res = await createApp(repo, silent, { fpl: fakeFpl({}).fpl }).request("/api/entry/999");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "No FPL team with ID 999" });
  });

  it("serves a repeat within 5 minutes from cache, then refetches", async () => {
    vi.useFakeTimers({ now: new Date("2030-01-01T12:00:00Z"), toFake: ["Date"] });
    const f = fakeFpl(entryData(7));
    const app = createApp(repo, silent, { fpl: f.fpl });
    await app.request("/api/entry/7");
    await app.request("/api/entry/7");
    expect(f.calls).toHaveLength(4);
    vi.setSystemTime(new Date("2030-01-01T12:06:00Z"));
    await app.request("/api/entry/7");
    expect(f.calls).toHaveLength(8);
  });

  it("falls back to the last good copy, marked stale, when FPL is down; 502 with no copy", async () => {
    vi.useFakeTimers({ now: new Date("2030-01-01T12:00:00Z"), toFake: ["Date"] });
    const f = fakeFpl(entryData(7));
    const app = createApp(repo, silent, { fpl: f.fpl });
    await app.request("/api/entry/7");
    vi.setSystemTime(new Date("2030-01-01T12:10:00Z"));
    f.setDown(true);
    const stale = await app.request("/api/entry/7");
    expect(stale.status).toBe(200);
    expect(stale.headers.get("Cache-Control")).toBe("no-store");
    expect(((await stale.json()) as { meta: { sources: { entry: { stale: boolean; fetchedAt: string } } } }).meta.sources.entry)
      .toEqual({ stale: true, fetchedAt: "2030-01-01T12:00:00.000Z" });
    const none = await app.request("/api/entry/8");
    expect(none.status).toBe(502);
    expect(await none.text()).not.toMatch(/down/);
  });

  it("is 404 without a default team and 503 without live reads configured", async () => {
    expect((await createApp(repo, silent, { fpl: fakeFpl({}).fpl }).request("/api/entry")).status).toBe(404);
    expect((await createApp(repo, silent).request("/api/entry/5")).status).toBe(503);
  });
});

describe("EntryCache", () => {
  it("evicts the least recently used Entry beyond its bound", () => {
    const c = new EntryCache<string>(2);
    c.set(1, "a"); c.set(2, "b");
    c.get(1);
    c.set(3, "c");
    expect([c.get(1)?.hit.value, c.get(2), c.get(3)?.hit.value]).toEqual(["a", null, "c"]);
    expect(c.size).toBe(2);
  });
});

describe("createFplClient (spec 0001 Fetching)", () => {
  const reply = (status: number, body: string) => new Response(body, { status, headers: { "Content-Type": "application/json" } });

  it("sends the descriptive User-Agent and returns parsed JSON", async () => {
    const seen: RequestInit[] = [];
    const client = createFplClient("me@example.com", async (_url, init) => { seen.push(init!); return reply(200, '{"ok":1}'); });
    expect(await client.get("entry/1/history")).toEqual({ ok: 1 });
    expect((seen[0]!.headers as Record<string, string>)["User-Agent"]).toBe("FreePL-api/0.1 (+contact: me@example.com)");
  });
  it("maps 404 to FplNotFound and a text body to FplUnavailable, without retrying", async () => {
    let n = 0;
    const c404 = createFplClient(undefined, async () => { n++; return reply(404, "nope"); });
    await expect(c404.get("entry/1")).rejects.toBeInstanceOf(FplNotFound);
    const cText = createFplClient(undefined, async () => { n++; return reply(200, "The game is being updated."); });
    await expect(cText.get("entry/1")).rejects.toThrow(/non-JSON/);
    expect(n).toBe(2);
  });
  it("retries a 503 with backoff, then succeeds", async () => {
    vi.useFakeTimers();
    let n = 0;
    const client = createFplClient(undefined, async () => (++n < 3 ? reply(503, "busy") : reply(200, "[]")));
    const p = client.get("entry/1/transfers");
    await vi.runAllTimersAsync();
    expect(await p).toEqual([]);
    expect(n).toBe(3);
  });
});
