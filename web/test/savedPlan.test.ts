import { describe, expect, it } from "vitest";
import {
  buildPlayersResponse, planTransfer, startPlan, swapPlayers,
  type EntryView, type GameweekRow,
} from "@freepl/contract";
import { bootstrap, player } from "@freepl/contract/test-fixtures";
import { DEFAULT_FILTERS, filtersFromSearch, filtersToSearch } from "../src/filters.js";
import { isBasePlan, planToSaved, restorePlan, samePlan, type SavedPlan } from "../src/savedPlan.js";
import { resolveSaved } from "../src/shortlist.js";

// Squad: ids 1–15 (GK 1–2, DEF 3–7, MID 8–12, FWD 13–15); 16 and 18 are MIDs, 17 a DEF, on the market.
const pos = (id: number) => (id === 16 || id === 18 ? 3 : id === 17 ? 2 : id <= 2 ? 1 : id <= 7 ? 2 : id <= 12 ? 3 : 4);
const data = buildPlayersResponse(bootstrap(Array.from({ length: 18 }, (_, k) => player({ id: k + 1, element_type: pos(k + 1), now_cost: 50 }))));
const { players, positions } = data;
const xiIds = [1, 3, 4, 5, 6, 8, 9, 10, 11, 13, 14];
const benchIds = [2, 7, 12, 15];
const view: EntryView = {
  entry: { id: 42, name: "Test XI", manager: "Test Manager" },
  gameweek: 4,
  squad: [...xiIds, ...benchIds].map((playerId, i) => ({
    playerId, slot: i + 1, isCaptain: playerId === 8, isVice: playerId === 13, pendingIn: false,
    purchasePrice: 50, purchaseSource: "launch" as const, sellPrice: 50,
  })),
  state: {
    bank: 10, sellingValue: 760, squadValue: 1000, squadValueLive: 750, freeTransfers: 1, pendingTransfers: 0,
    gwPoints: 50, totalPoints: 200, overallRank: 1, chips: [], set1ExpiresAt: null,
  },
};
const now = Date.parse("2030-09-10T00:00:00Z");
const gameweeks: GameweekRow[] = [4, 5].map((id) => ({
  id, name: `Gameweek ${id}`, deadlineTime: id === 4 ? "2030-09-05T17:30:00Z" : "2030-09-12T17:30:00Z", finished: false, dataChecked: false,
}));
const posById = new Map(positions.map((p) => [p.id, p]));
const positionOf = (id: number) => posById.get(pos(id));
const restore = (s: SavedPlan | null, at = now) => restorePlan(s, view, players, positions, gameweeks, at);

describe("saving and restoring a Plan", () => {
  const plan = swapPlayers(planTransfer(startPlan(view), 9, 16), 6, 7, positions, positionOf);
  const saved = planToSaved(plan, 42, 5);

  it("keeps the transfers, the slot order, captain and vice", () => {
    expect(saved).toEqual({
      entry: 42, gameweek: 5, transfers: [{ outId: 9, inId: 16 }],
      xi: [1, 3, 4, 5, 7, 8, 16, 10, 11, 13, 14], bench: [2, 6, 12, 15], captain: 8, vice: 13,
    });
    const r = restore(saved);
    expect(r.status).toBe("applied");
    if (r.status === "applied") expect(planToSaved(r.plan, 42, 5)).toEqual(saved);
  });
  it("is not applied to another Entry (Q93)", () => {
    expect(restore({ ...saved, entry: 7 })).toEqual({ status: "other-entry", entry: 7 });
  });
  it("ends at its gameweek's deadline (Q86)", () => {
    expect(restore(saved, Date.parse("2030-09-12T17:30:00Z"))).toEqual({ status: "expired", gameweek: 5 });
    expect(restore({ ...saved, gameweek: 4 })).toEqual({ status: "expired", gameweek: 4 });
  });
  it("is stale when it sells a player no longer in the Squad", () => {
    expect(restore({ ...saved, transfers: [{ outId: 99, inId: 16 }] }).status).toBe("stale");
  });
  it("is stale when a transfer swaps positions", () => {
    const bad = { ...saved, transfers: [{ outId: 9, inId: 17 }], xi: saved.xi.map((x) => (x === 16 ? 17 : x)) };
    expect(restore(bad).status).toBe("stale");
  });
  it("falls back to the last XI, transfers kept, when the lineup breaks the rules", () => {
    // Two keepers in the XI, an outfield player first on the bench.
    const broken = { ...saved, xi: [1, 2, 4, 5, 7, 8, 16, 10, 11, 13, 14], bench: [3, 6, 12, 15] };
    const r = restore(broken);
    expect(r.status).toBe("applied");
    if (r.status !== "applied") return;
    expect(r.notice).toMatch(/starts from your GW4 XI again/);
    expect(r.plan.transfers).toEqual([{ outId: 9, inId: 16 }]);
    expect([...r.plan.lineup.values()].slice(0, 11)).toEqual([1, 3, 4, 5, 6, 8, 16, 10, 11, 13, 14]);
  });
  it("repairs a link that sold a player it bought, saved before 2026-11-05", () => {
    // Sell 9 for 16, then replace 16 with 18: one transfer, 9 → 18.
    const chained = { ...saved, transfers: [{ outId: 9, inId: 16 }, { outId: 16, inId: 18 }], xi: saved.xi.map((x) => (x === 16 ? 18 : x)) };
    const r = restore(chained);
    expect(r.status).toBe("applied");
    if (r.status === "applied") expect(r.plan.transfers).toEqual([{ outId: 9, inId: 18 }]);
  });
  it("saves a replaced newcomer as one transfer", () => {
    const p = planTransfer(planTransfer(startPlan(view), 9, 16), 16, 18);
    expect(planToSaved(p, 42, 5).transfers).toEqual([{ outId: 9, inId: 18 }]);
  });
  it("drops an armband that sits on the bench", () => {
    const r = restore({ ...saved, captain: 6 });
    expect(r.status === "applied" && r.plan.captainId).toBeNull();
  });
  it("knows an untouched plan", () => {
    expect(isBasePlan(startPlan(view), view)).toBe(true);
    expect(isBasePlan(plan, view)).toBe(false);
  });
});

describe("a Plan in the URL", () => {
  const saved: SavedPlan = { entry: 42, gameweek: 5, transfers: [{ outId: 9, inId: 16 }], xi: [1, 3, 4, 5, 7, 8, 16, 10, 11, 13, 14], bench: [2, 6, 12, 15], captain: 8, vice: null };
  it("round-trips, with the shared season tag", () => {
    const q = filtersToSearch({ ...DEFAULT_FILTERS, plan: saved, season: 2030 });
    expect(q).toContain("pe=42&pgw=5&plan=9%3A16&xi=");
    expect(q).toContain("&s=2030");
    expect(q).not.toContain("&v=");
    expect(filtersFromSearch(q)).toMatchObject({ plan: saved, season: 2030 });
  });
  it("keeps a lineup-only plan (no transfers)", () => {
    const q = filtersToSearch({ ...DEFAULT_FILTERS, plan: { ...saved, transfers: [] }, season: 2030 });
    expect(filtersFromSearch(q).plan?.transfers).toEqual([]);
  });
  it("ignores an incomplete plan", () => {
    expect(filtersFromSearch("?pe=42&pgw=5&plan=&xi=1,2,3&bench=4,5,6,7").plan).toBeNull();
    expect(filtersFromSearch("?pe=42&pgw=5&plan=9-16&xi=1,3,4,5,7,8,16,10,11,13,14&bench=2,6,12,15").plan).toBeNull();
  });
  it("keeps the season tag when the Shortlist empties but a Plan remains", () => {
    expect(filtersToSearch({ ...DEFAULT_FILTERS, sl: [], plan: saved, season: 2030 })).toContain("s=2030");
  });
  it("offers a link's different plan instead of replacing this device's (Q87)", () => {
    const r = resolveSaved("plan", { season: 2030, value: { ...saved, captain: 10 } }, { season: 2030, value: saved }, 2030, samePlan);
    expect(r).toMatchObject({ value: saved, offer: { captain: 10 } });
    expect(resolveSaved("plan", { season: 2029, value: saved }, null, 2030, samePlan).notices[0]).toMatch(/link's plan is from the 2029\/30 season/);
  });
});
