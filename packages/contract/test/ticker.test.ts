import { describe, expect, it } from "vitest";
import {
  ContractError, buildFixturesResponse, buildTicker, difficultyFor, sortTicker, tickerWindow,
  type ClubRow, type FixtureRow, type GameweekRow,
} from "../src/index.js";
import { bootstrap, rawFixture } from "./fixtures.js";

const clubs: ClubRow[] = [
  { id: 1, code: 901, name: "Test AAA", short: "AAA" },
  { id: 2, code: 902, name: "Test BBB", short: "BBB" },
  { id: 3, code: 903, name: "Test CCC", short: "CCC" },
];
const gw = (id: number, day: number): GameweekRow => ({
  id, name: `Gameweek ${id}`, deadlineTime: `2030-09-${String(day).padStart(2, "0")}T10:00:00.000Z`, finished: false, dataChecked: false,
});
const gameweeks = [gw(1, 1), gw(2, 8), gw(3, 15), gw(4, 22), gw(5, 29)];
let nextId = 1;
const fx = (gameweek: number | null, home: number, away: number, hd: number, ad: number, provisional = false): FixtureRow => ({
  id: nextId++, gameweek, homeClubId: home, awayClubId: away, homeDifficulty: hd, awayDifficulty: ad,
  kickoffTime: provisional ? null : "2030-09-10T14:00:00.000Z", provisional, finished: false,
});
// GW2: AAA v BBB (CCC blank). GW3: AAA plays twice (v CCC, at BBB) — a double.
// GW4: BBB v AAA with a TBC kick-off (CCC blank). Plus one unscheduled fixture.
const fixtures: FixtureRow[] = [];
fixtures.push(
  fx(2, 1, 2, 2, 4), // GW2 AAA (H, 2) v BBB (A, 4)
  fx(3, 1, 3, 1, 5), // GW3 AAA (H, 1) v CCC (A, 5)
  fx(3, 2, 1, 3, 3), // GW3 BBB (H, 3) v AAA (A, 3)  → AAA double
  fx(4, 2, 1, 2, 5, true), // GW4 BBB (H, 2) v AAA (A, 5), TBC → CCC blank
  fx(null, 3, 2, 3, 3), // unscheduled
);

describe("difficultyFor", () => {
  it("reads the side the Club plays on", () => {
    const f = fixtures[0]!;
    expect(difficultyFor(f, 1)).toBe(2);
    expect(difficultyFor(f, 2)).toBe(4);
    expect(() => difficultyFor(f, 3)).toThrow();
  });
});

describe("tickerWindow", () => {
  it("starts at the first deadline after now and clamps to 3–10", () => {
    const now = Date.parse("2030-09-05T00:00:00Z"); // after GW1's deadline
    expect(tickerWindow(gameweeks, 3, now).map((g) => g.id)).toEqual([2, 3, 4]);
    expect(tickerWindow(gameweeks, 1, now).map((g) => g.id)).toEqual([2, 3, 4]);
    expect(tickerWindow(gameweeks, 99, now).map((g) => g.id)).toEqual([2, 3, 4, 5]);
    expect(tickerWindow(gameweeks, 6, Date.parse("2031-01-01T00:00:00Z"))).toEqual([]);
  });
});

describe("buildTicker", () => {
  const window = gameweeks.slice(1, 4); // GW2–4
  const t = buildTicker(clubs, fixtures, window);
  const row = (short: string) => t.rows.find((r) => r.club.short === short)!;

  it("puts a double in one cell and leaves a blank as an empty list", () => {
    expect(row("AAA").cells.map((c) => c.fixtures.length)).toEqual([1, 2, 1]);
    expect(row("CCC").cells.map((c) => c.fixtures.length)).toEqual([0, 1, 0]);
    expect(row("AAA").cells[1]!.fixtures.map((f) => [f.opponentClubId, f.isHome, f.difficulty])).toEqual([[3, true, 1], [2, false, 3]]);
  });
  it("divides the mean by the real fixture count", () => {
    expect(row("AAA")).toMatchObject({ fixtureCount: 4, difficultySum: 2 + 1 + 3 + 5, difficultyMean: 11 / 4 });
    expect(row("CCC")).toMatchObject({ fixtureCount: 1, difficultySum: 5, difficultyMean: 5 });
  });
  it("marks provisional fixtures and counts unscheduled ones outside every column", () => {
    expect(row("AAA").cells[2]!.fixtures[0]!.provisional).toBe(true);
    expect(t.unscheduled).toBe(1);
    expect(t.rows.flatMap((r) => r.cells.flatMap((c) => c.fixtures)).length).toBe(8);
  });
  it("gives a Club with no fixture in the window a null mean, sorted last", () => {
    const empty = buildTicker(clubs, fixtures, [gameweeks[4]!]);
    expect(empty.rows.every((r) => r.difficultyMean === null)).toBe(true);
  });

  it("sorts by mean, sum and count into different, correct orders", () => {
    // AAA mean 2.75 sum 11 n4 · BBB: 4,3,2 → mean 3, sum 9, n3 · CCC mean 5 sum 5 n1
    expect(sortTicker(t.rows, "mean").map((r) => r.club.short)).toEqual(["AAA", "BBB", "CCC"]);
    expect(sortTicker(t.rows, "sum").map((r) => r.club.short)).toEqual(["CCC", "BBB", "AAA"]);
    expect(sortTicker(t.rows, "count").map((r) => r.club.short)).toEqual(["AAA", "BBB", "CCC"]);
  });
  it("breaks ties by more fixtures, then name, and puts no-fixture Clubs last", () => {
    const tie = buildTicker(clubs, [fx(2, 1, 2, 3, 3), fx(3, 1, 3, 3, 3)], window);
    expect(sortTicker(tie.rows, "mean").map((r) => r.club.short)).toEqual(["AAA", "BBB", "CCC"]);
  });
});

describe("buildFixturesResponse", () => {
  const raw = (fixtures: unknown[]) => ({ bootstrap: bootstrap(), fixturesCapturedAt: new Date("2030-08-20T08:00:00Z"), fixtures });

  it("normalises fixtures and carries both capture times", () => {
    const res = buildFixturesResponse(raw([rawFixture(), rawFixture({ id: 2, event: null, kickoff_time: null })]));
    expect(res.meta.sources).toEqual({
      bootstrap: { capturedAt: "2030-08-20T09:00:00.000Z" },
      fixtures: { capturedAt: "2030-08-20T08:00:00.000Z" },
    });
    expect(res.fixtures[0]).toMatchObject({ id: 1, gameweek: 2, homeClubId: 1, homeDifficulty: 2, provisional: false });
    expect(res.fixtures[1]).toMatchObject({ id: 2, gameweek: null, provisional: true });
  });
  it("treats provisional_start_time as provisional even with a kickoff time", () => {
    expect(buildFixturesResponse(raw([rawFixture({ provisional_start_time: true })])).fixtures[0]!.provisional).toBe(true);
  });
  it("fails loudly on an unknown Club or an out-of-range difficulty", () => {
    expect(() => buildFixturesResponse(raw([rawFixture({ team_a: 9 })]))).toThrow(ContractError);
    expect(() => buildFixturesResponse(raw([rawFixture({ team_h_difficulty: 6 })]))).toThrow(/team_h_difficulty/);
  });
});
