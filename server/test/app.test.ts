import { describe, expect, it, vi } from "vitest";
import { PlayersResponse, type RawBootstrapRows } from "@freepl/contract";
import { createApp } from "../src/app.js";
import type { Repo } from "../src/repo.js";
import { bootstrap, player } from "@freepl/contract/test-fixtures";

function fakeRepo(rows: RawBootstrapRows = bootstrap()) {
  const state = { rows, reads: 0 };
  const repo: Repo = {
    latestCapturedAt: async () => state.rows.capturedAt as Date,
    bootstrapRows: async () => {
      state.reads++;
      return state.rows;
    },
  };
  return { repo, state };
}

const silent = () => {};

describe("GET /api/players", () => {
  it("returns the parsed response with ETag and Cache-Control", async () => {
    const app = createApp(fakeRepo().repo, silent);
    const res = await app.request("/api/players");
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBe('"2030-08-20T09:00:00.000Z"');
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60, stale-while-revalidate=600");
    const body = PlayersResponse.parse(await res.json());
    expect(body.players[0]?.nowCost).toBe(45);
    expect(body.players[0]?.epNext).toBeNull();
    expect(body.meta.sources.bootstrap.capturedAt).toBe("2030-08-20T09:00:00.000Z");
  });

  it("answers a matching If-None-Match with 304 and no body", async () => {
    const { repo, state } = fakeRepo();
    const app = createApp(repo, silent);
    const res = await app.request("/api/players", { headers: { "If-None-Match": '"2030-08-20T09:00:00.000Z"' } });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
    expect(state.reads).toBe(0);
  });

  it("parses once per capture and rebuilds when a new capture lands", async () => {
    const { repo, state } = fakeRepo();
    const app = createApp(repo, silent);
    await app.request("/api/players");
    await app.request("/api/players");
    expect(state.reads).toBe(1);
    state.rows = { ...bootstrap([player({ now_cost: 50 })]), capturedAt: new Date("2030-08-20T20:00:00Z") };
    const res = await app.request("/api/players");
    expect(state.reads).toBe(2);
    expect(res.headers.get("ETag")).toBe('"2030-08-20T20:00:00.000Z"');
    expect(PlayersResponse.parse(await res.json()).players[0]?.nowCost).toBe(50);
  });

  it("returns a generic 500 and logs the detail when parsing fails", async () => {
    const log = vi.fn();
    const app = createApp(fakeRepo(bootstrap([player({ form: "oops" })])).repo, log);
    const res = await app.request("/api/players");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Something went wrong" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(log).toHaveBeenCalledOnce();
  });

  it("never leaks a database error message", async () => {
    const repo: Repo = {
      latestCapturedAt: async () => {
        throw new Error("connect to postgres://reader:secret@ep-test.neon.tech failed");
      },
      bootstrapRows: async () => bootstrap(),
    };
    const res = await createApp(repo, silent).request("/api/players");
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/secret|neon|postgres/);
  });

  it("returns 503 when there is no capture yet", async () => {
    const repo: Repo = { latestCapturedAt: async () => null, bootstrapRows: async () => bootstrap() };
    expect((await createApp(repo, silent).request("/api/players")).status).toBe(503);
  });
});

describe("GET /api/health", () => {
  it("reports the latest capture and is never cached", async () => {
    vi.useFakeTimers({ now: new Date("2030-08-20T12:30:00Z") });
    const res = await createApp(fakeRepo().repo, silent).request("/api/health");
    vi.useRealTimers();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, latestSnapshotAt: "2030-08-20T09:00:00.000Z", dataAgeHours: 3.5 });
  });
});
