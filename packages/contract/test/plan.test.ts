import { describe, expect, it } from "vitest";
import {
  buildEntryView, buildPlayersResponse, canSwap, evaluatePlan, legalFormation, planTransfer, setArmband,
  startPlan, swapPlayers, undoTransfer, type GameweekRow,
} from "../src/index.js";
import { bootstrap, player } from "./fixtures.js";

// Squad 1–15: GK 1–2, DEF 3–7, MID 8–12, FWD 13–15, alternating Clubs 1/2.
// Market: 16 (MID, club 1, 70), 17 (MID, club 1, 45), 18 (FWD, club 2, 50).
const type = (id: number) => (id <= 2 ? 1 : id <= 7 ? 2 : id <= 12 ? 3 : 4);
const data = buildPlayersResponse(bootstrap([
  ...Array.from({ length: 15 }, (_, k) => player({ id: k + 1, element_type: type(k + 1), team: (k % 2) + 1, now_cost: 50, cost_change_start: 0 })),
  player({ id: 16, element_type: 3, team: 1, now_cost: 70 }),
  player({ id: 17, element_type: 3, team: 1, now_cost: 45 }),
  player({ id: 18, element_type: 4, team: 2, now_cost: 50 }),
]));
const { players, positions } = data;
const posById = new Map(positions.map((p) => [p.id, p]));
const positionOf = (id: number) => posById.get(players.find((p) => p.id === id)!.positionId);
const gws: GameweekRow[] = Array.from({ length: 38 }, (_, k) => ({ id: k + 1, name: `GW${k + 1}`, deadlineTime: new Date(Date.UTC(2030, 7, 15 + 7 * k)).toISOString(), finished: false, dataChecked: false }));
// XI 4-4-2: GK1; DEF 3,4,5,6; MID 8,9,10,11; FWD 13,14. Bench: GK2, then 7, 12, 15.
const xi = [1, 3, 4, 5, 6, 8, 9, 10, 11, 13, 14, 2, 7, 12, 15];
const view = buildEntryView({
  summary: { id: 1, name: "T", player_first_name: "A", player_last_name: "B" },
  history: { current: [1, 2, 3, 4].map((event) => ({ event, points: 50, total_points: 200, overall_rank: 1, bank: 5, value: 1000, event_transfers: event >= 3 ? 1 : 0, event_transfers_cost: 0 })), chips: [] },
  transfers: [],
  picks: { active_chip: null, picks: xi.map((element, i) => ({ element, position: i + 1, is_captain: element === 8, is_vice_captain: element === 13 })) },
  gameweek: 4, players, gameweeks: gws,
});

describe("transfer what-if accounting", () => {
  it("prices a planned transfer: bank + sell(out) − now_cost(in), and the new player keeps the slot and armband", () => {
    const plan = planTransfer(startPlan(view), 8, 17);
    const r = evaluatePlan(view, plan, players, positions);
    expect(r.bank).toBe(5 + 50 - 45);
    expect(r.squad.find((s) => s.slot === 6)).toMatchObject({ playerId: 17, planned: true, isCaptain: true, sellPrice: 45 });
    expect(r.sellingValue).toBe(14 * 50 + 45 + 10);
    expect(r.freeTransfersLeft).toBe(1);
    expect(r.hitPoints).toBe(0);
  });
  it("allows a negative bank and a 4th player from a Club, and warns on both", () => {
    // Club 1 already has 8 of 15 (odd ids); the test targets the warning, not FPL legality.
    const r = evaluatePlan(view, planTransfer(startPlan(view), 9, 16), players, positions);
    expect(r.bank).toBe(5 + 50 - 70);
    expect(r.overBudgetBy).toBe(15);
    expect(r.clubsOver).toContain(1);
  });
  it("charges −4 for each transfer beyond the free transfers left", () => {
    let plan = startPlan(view);
    plan = planTransfer(plan, 8, 17);
    plan = planTransfer(plan, 9, 16);
    plan = planTransfer(plan, 13, 18);
    const r = evaluatePlan(view, plan, players, positions);
    expect(view.state.freeTransfers).toBe(2);
    expect([r.freeTransfersLeft, r.hitPoints]).toEqual([0, 4]);
  });
  it("undoes one planned transfer, restoring the player and armband", () => {
    const plan = undoTransfer(planTransfer(startPlan(view), 8, 17), 17);
    expect(plan.transfers).toEqual([]);
    expect(plan.lineup.get(6)).toBe(8);
    expect(plan.captainId).toBe(8);
  });
});

describe("planned lineup rules", () => {
  const plan = startPlan(view);
  const swap = (a: number, b: number) => canSwap(plan, a, b, positions, positionOf);

  it("reads formation limits from element_types and starts legal", () => {
    expect(positions.map((p) => [p.short, p.minPlay, p.maxPlay])).toEqual([["GKP", 1, 1], ["DEF", 3, 5], ["MID", 2, 5], ["FWD", 1, 3]]);
    expect(legalFormation(plan.lineup, positions, positionOf)).toBe(true);
    expect(evaluatePlan(view, plan, players, positions).formation).toBe("4-4-2");
  });
  it("offers only legal swaps", () => {
    expect(swap(3, 4)).toBe(false); // two starters
    expect(swap(1, 2)).toBe(true); // keeper for keeper
    expect(swap(2, 7)).toBe(false); // bench GK with an outfield sub
    expect(swap(1, 7)).toBe(false); // would leave no keeper
    expect(swap(7, 12)).toBe(true); // reorder outfield subs
    expect(swap(3, 15)).toBe(true); // DEF out, FWD in → 3-4-3
    expect(swap(13, 7)).toBe(true); // FWD out, DEF in → 5-4-1
    const p541 = swapPlayers(plan, 13, 7, positions, positionOf);
    expect(canSwap(p541, 14, 12, positions, positionOf)).toBe(false); // would leave no forward
  });
  it("clears an armband moved to the bench, and never gives one to a bench player", () => {
    const benched = swapPlayers(plan, 8, 12, positions, positionOf);
    expect(benched.captainId).toBeNull();
    expect(evaluatePlan(view, benched, players, positions).noCaptain).toBe(true);
    expect(setArmband(plan, 7, "captain")).toBe(plan);
  });
  it("swaps captain and vice when the vice is made captain", () => {
    const p = setArmband(plan, 13, "captain");
    expect([p.captainId, p.viceId]).toEqual([13, 8]);
  });
});
