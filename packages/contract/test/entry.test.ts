import { describe, expect, it } from "vitest";
import {
  ContractError, buildEntryView, buildPlayersResponse, freeTransfersFor, lastStartedGameweek, sellPrice,
  RawHistory, type GameweekRow, type RawPicks, type RawTransfer,
} from "../src/index.js";
import { bootstrap, player } from "./fixtures.js";

describe("sellPrice (fpl-domain worked examples)", () => {
  it.each([
    [70, 75, 72], [70, 71, 70], [70, 66, 66],
    [50, 51, 50], [50, 52, 51], [50, 53, 51], [60, 59, 59],
    [155, 156, 155], [55, 59, 57],
  ])("bought %i, now %i → sells %i", (buy, now, sell) => expect(sellPrice(buy, now)).toBe(sell));
});

const hist = (rows: [number, number][], chips: [string, number][] = []) => RawHistory.parse({
  current: rows.map(([event, event_transfers]) => ({
    event, points: 50, total_points: 50 * event, overall_rank: 100000, bank: 5, value: 1000, event_transfers, event_transfers_cost: 0,
  })),
  chips: chips.map(([name, event]) => ({ name, event })),
});

describe("freeTransfersFor", () => {
  it("matches the verified real Entry: BB GW1, 0 in GW2, WC GW3, 2 in GW4, 0 in GW5–6 → 3 for GW7", () => {
    const h = hist([[1, 0], [2, 0], [3, 0], [4, 2], [5, 0], [6, 0]], [["bboost", 1], ["wildcard", 3]]);
    expect([2, 3, 4, 5, 6, 7].map((gw) => freeTransfersFor(gw, h))).toEqual([1, 2, 2, 1, 2, 3]);
  });
  it("caps at 5, gives 1 after a hit (6 used of 5),  keeps the count over a Free Hit, is unlimited before GW2", () => {
    const h = hist([[1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 6], [8, 0]], [["freehit", 8]]);
    expect(freeTransfersFor(7, h)).toBe(5);
    expect(freeTransfersFor(8, h)).toBe(1);
    expect(freeTransfersFor(9, h)).toBe(1);
    expect(freeTransfersFor(1, h)).toBeNull();
  });
});

// Squad: ids 1–15 (GK 1–2, DEF 3–7, MID 8–12, FWD 13–15). Player 16 is a MID on the market.
const elementType = (id: number) => (id <= 2 ? 1 : id <= 7 ? 2 : id <= 12 ? 3 : 4);
const players = buildPlayersResponse(bootstrap([
  ...Array.from({ length: 16 }, (_, k) => player({
    id: k + 1, element_type: elementType(k + 1 === 16 ? 9 : k + 1), team: (k % 2) + 1,
    now_cost: 50, cost_change_start: 0,
  })),
])).players;
const withPrice = (id: number, now: number, change: number) =>
  players.map((p) => (p.id === id ? { ...p, nowCost: now, costChangeStart: change } : p));

const gws: GameweekRow[] = Array.from({ length: 38 }, (_, k) => ({
  id: k + 1, name: `Gameweek ${k + 1}`, deadlineTime: new Date(Date.UTC(2030, 7, 15 + 7 * k, 17, 30)).toISOString(), finished: false, dataChecked: false,
}));
const picks = (ids: number[], chip: string | null = null, captain = 8, vice = 13): RawPicks => ({
  active_chip: chip,
  picks: ids.map((element, i) => ({ element, position: i + 1, is_captain: element === captain, is_vice_captain: element === vice })),
});
const xi = [1, 3, 4, 5, 6, 8, 9, 10, 11, 13, 14, 2, 7, 12, 15];
const summary = { id: 42, name: "Test XI", player_first_name: "Test", player_last_name: "Manager" };
const tr = (event: number, out: number, outCost: number, inn: number, inCost: number, time: string): RawTransfer =>
  ({ element_out: out, element_out_cost: outCost, element_in: inn, element_in_cost: inCost, event, time });
const history = hist([[1, 0], [2, 0], [3, 1], [4, 0]]);

describe("buildEntryView", () => {
  const base = {
    summary, history: { current: history.current, chips: history.chips }, picks: picks(xi), gameweek: 4,
    players, gameweeks: gws,
  };

  it("rebuilds the Squad from picks(n) plus pending transfers for n+1, in slot order", () => {
    const v = buildEntryView({
      ...base,
      players: withPrice(16, 60, 2).map((p) => (p.id === 8 ? { ...p, nowCost: 55 } : p)),
      transfers: [tr(3, 99, 45, 9, 48, "2030-08-28T10:00:00Z"), tr(5, 8, 52, 16, 60, "2030-09-06T10:00:00Z")],
    });
    expect(v.entry).toEqual({ id: 42, name: "Test XI", manager: "Test Manager" });
    expect(v.squad).toHaveLength(15);
    const slot6 = v.squad.find((s) => s.slot === 6)!;
    expect(slot6).toMatchObject({ playerId: 16, pendingIn: true, isCaptain: false, purchasePrice: 60, purchaseSource: "transfer" });
    expect(v.squad.find((s) => s.playerId === 9)).toMatchObject({ purchasePrice: 48, purchaseSource: "transfer", sellPrice: 49 });
    expect(v.squad.find((s) => s.playerId === 1)).toMatchObject({ purchasePrice: 50, purchaseSource: "launch", sellPrice: 50 });
    // bank 5 + 52 − 60 = −3 is possible arithmetic; FPL itself would have refused, but we report it.
    expect(v.state).toMatchObject({ bank: -3, pendingTransfers: 1, squadValue: 1000, freeTransfers: 3, gwPoints: 50 });
    expect(v.state.sellingValue).toBe(v.squad.reduce((s, x) => s + x.sellPrice!, 0) - 3);
    // Live value: current prices of the 15 now held (14 × 50, player 8 sold, player 16 at 60) + bank.
    expect(v.state.squadValueLive).toBe(14 * 50 + 60 - 3);
  });

  it("applies a two-batch Wildcard in time order, including a player bought then sold", () => {
    const v = buildEntryView({
      ...base,
      transfers: [
        tr(5, 13, 50, 16, 50, "2030-09-06T10:00:00Z"),
        tr(5, 16, 50, 13, 50, "2030-09-06T10:30:00Z"),
        tr(5, 14, 50, 16, 50, "2030-09-06T10:31:00Z"),
      ],
    });
    expect(v.squad.map((s) => s.playerId).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16]);
    expect(v.squad.find((s) => s.playerId === 13)!.isVice).toBe(false);
    expect(v.state.pendingTransfers).toBe(3);
  });

  it("uses the pre-Free-Hit Squad when a Free Hit was played in gameweek n", () => {
    const fh = [1, 3, 4, 5, 6, 8, 9, 10, 11, 13, 16, 2, 7, 12, 15];
    const v = buildEntryView({ ...base, picks: picks(fh, "freehit"), picksBeforeFreeHit: picks(xi), transfers: [] });
    expect(v.squad.map((s) => s.playerId)).toEqual(xi);
  });

  it("shows no sell price at all when any purchase price is unknown", () => {
    const v = buildEntryView({ ...base, players: players.map((p) => (p.id === 3 ? { ...p, costChangeStart: null } : p)), transfers: [] });
    expect(v.squad.every((s) => s.sellPrice === null)).toBe(true);
    expect(v.state.sellingValue).toBeNull();
    expect(v.squad.find((s) => s.playerId === 3)!.purchasePrice).toBeNull();
  });

  it("is an empty state before the GW1 deadline", () => {
    const v = buildEntryView({ ...base, gameweek: null, picks: null, transfers: [] });
    expect(v.squad).toEqual([]);
    expect(v.state.chips).toHaveLength(8);
    expect(v.state.set1ExpiresAt).toBe(gws[18]!.deadlineTime);
  });

  it("splits chips into two sets by event", () => {
    const v = buildEntryView({ ...base, history: { current: history.current, chips: [{ name: "wildcard", event: 3 }, { name: "bboost", event: 22 }] }, transfers: [] });
    const used = v.state.chips.filter((c) => c.usedIn !== null).map((c) => [c.chip, c.set, c.usedIn]);
    expect(used).toEqual([["wildcard", 1, 3], ["bboost", 2, 22]]);
  });

  it("fails loudly when a pending transfer sells someone not in the Squad, or the shape is wrong", () => {
    expect(() => buildEntryView({ ...base, transfers: [tr(5, 77, 50, 16, 50, "2030-09-06T10:00:00Z")] })).toThrow(ContractError);
    expect(() => buildEntryView({ ...base, transfers: [{ nope: 1 }] })).toThrow(/transfers/);
  });
});

describe("lastStartedGameweek", () => {
  it("is the gameweek whose deadline passed most recently", () => {
    expect(lastStartedGameweek(gws, Date.parse("2030-08-14T00:00:00Z"))).toBeNull();
    expect(lastStartedGameweek(gws, Date.parse("2030-08-16T00:00:00Z"))).toBe(1);
    expect(lastStartedGameweek(gws, Date.parse("2030-09-06T00:00:00Z"))).toBe(4);
  });
});
