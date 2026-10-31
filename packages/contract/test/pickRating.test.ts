import { describe, expect, it } from "vitest";
import {
  WEIGHTS, buildPlayersResponse, buildRatingContext, ordinal, pickRatingFor,
  type FixtureRow, type GameweekRow, type PickRating, type PlayerRow,
} from "../src/index.js";
import { bootstrap, player } from "./fixtures.js";

const now = Date.parse("2030-09-05T00:00:00Z");
const gw = (id: number, day: number, finished = false): GameweekRow => ({
  id, name: `Gameweek ${id}`, deadlineTime: `2030-09-${String(day).padStart(2, "0")}T10:00:00.000Z`, finished, dataChecked: finished,
});
const gameweeks = [gw(1, 1, true), gw(2, 8), gw(3, 15), gw(4, 22), gw(5, 29)];
let fid = 1;
const fx = (gameweek: number, home: number, away: number, hd: number, ad: number, finished = false): FixtureRow => ({
  id: fid++, gameweek, homeClubId: home, awayClubId: away, homeDifficulty: hd, awayDifficulty: ad,
  kickoffTime: "2030-09-10T14:00:00.000Z", provisional: false, finished,
});
// Window = GW2–4. Club 1: GW2 (d2), GW3 double (d3, d3), GW4 (d1) → ease 4+3+3+5 = 15.
// Club 2: GW2 (d4), GW3 (d3), GW4 blank → ease 2+3 = 5. Each Club finished one match (GW1).
const fixtures = [
  fx(1, 1, 2, 3, 3, true),
  fx(2, 1, 2, 2, 4),
  fx(3, 1, 2, 3, 3),
  fx(3, 3, 1, 3, 3),
  fx(4, 1, 3, 1, 5),
];

function players(raw: Parameters<typeof player>[0][]): PlayerRow[] {
  return buildPlayersResponse(bootstrap(raw.map((r) => player(r)))).players;
}
const rated = (r: PickRating) => {
  if (!r.rated) throw new Error(`expected rated, got: ${r.reason}`);
  return r;
};

describe("weights", () => {
  it("sum to 100 for every position", () => {
    for (const [pos, w] of Object.entries(WEIGHTS)) expect(Object.values(w).reduce((a, b) => a + b!, 0), pos).toBe(100);
  });
});

describe("bands within a position", () => {
  // 20 keepers at one Club: keeper i is strictly worse than keeper i-1 on both stats, so the
  // score order is 1..20 and the bands follow the rounded-up cutoffs: 1 / 2 / 2 / 3 / 12.
  const keepers = players(Array.from({ length: 20 }, (_, k) => ({
    id: k + 1, web_name: `Keeper ${k + 1}`, element_type: 1, team: 1, minutes: 900, starts: 1,
    expected_goals_conceded_per_90: 0.5 + k * 0.1, saves_per_90: 5 - k * 0.1,
  })));
  const ctx = buildRatingContext(keepers, buildPlayersResponse(bootstrap()).positions, fixtures, gameweeks, now);
  const band = (id: number) => rated(pickRatingFor(keepers[id - 1]!, ctx)).band;

  it("assigns Best 1, Great 2, Good 2, OK 3, Below OK the rest", () => {
    expect(keepers.map((p) => band(p.id))).toEqual([
      "best", "great", "great", "good", "good", "ok", "ok", "ok", ...Array(12).fill("below"),
    ]);
  });
  it("shows each input's rank and weight in the breakdown", () => {
    const r = rated(pickRatingFor(keepers[2]!, ctx));
    expect(r).toMatchObject({ rank: 3, of: 20, positionShort: "GKP" });
    expect(r.inputs.map((i) => [i.label, i.weight, i.rank])).toEqual([
      ["xGC/90", 35, 3], ["Saves/90", 15, 3], ["Fixtures", 25, 1], ["Nailed", 25, 1],
    ]);
    expect(r.inputs[0]!.display).toBe("0.70");
  });
});

describe("ruled-out players", () => {
  // Keeper 1 is the best on xGC and saves but injured: he takes no place among the 20
  // available keepers and gets no credit for fixtures. Every keeper is at Club 1 (fixtures 15,
  // nailed 100%), so the available ones score 0.5 on both; keeper 1 scores 35 + 15 + 0 + 12.5
  // = 0.625, between the 5th (0.645, last Good) and 6th (0.618) available → OK, 6th.
  const keepers = players(Array.from({ length: 21 }, (_, k) => ({
    id: k + 1, element_type: 1, team: 1, minutes: 900, starts: 1, status: k === 0 ? "i" : "a",
    expected_goals_conceded_per_90: 0.4 + k * 0.1, saves_per_90: 5.1 - k * 0.1,
  })));
  const ctx = buildRatingContext(keepers, buildPlayersResponse(bootstrap()).positions, fixtures, gameweeks, now);
  const r = (id: number) => rated(pickRatingFor(keepers[id - 1]!, ctx));

  it("leaves the available players' bands and ranks unchanged", () => {
    expect(keepers.slice(1).map((p) => r(p.id).band)).toEqual([
      "best", "great", "great", "good", "good", "ok", "ok", "ok", ...Array(12).fill("below"),
    ]);
    expect(r(2)).toMatchObject({ rank: 1, of: 20, ruledOut: false });
  });
  it("places the ruled-out player against them with no credit for fixtures", () => {
    expect(r(1)).toMatchObject({ band: "ok", rank: 6, of: 20, ruledOut: true });
    expect(r(1).inputs[0]).toMatchObject({ rank: 1, percentile: 1 });
    expect(r(1).inputs.find((i) => i.key === "fixtures")).toMatchObject({ value: 0, display: "0 (ruled out)", percentile: 0 });
  });
  it("gives a ruled-out twin of the last Best player the same score and band", () => {
    // With only this fixture list, Club 2 has a finished match but nothing in the window, so fixtures are 0 for everyone
    // and the twin differs from keeper 1 only in being injured.
    const quiet = [fx(1, 2, 1, 3, 3, true)];
    const twin = players([...Array.from({ length: 20 }, (_, k) => ({
      id: k + 1, element_type: 1, team: 2, minutes: 900, starts: 1,
      expected_goals_conceded_per_90: 0.5 + k * 0.1, saves_per_90: 5 - k * 0.1,
    })), { id: 99, element_type: 1, team: 2, minutes: 900, starts: 1, status: "i", expected_goals_conceded_per_90: 0.5, saves_per_90: 5 }]);
    const c = buildRatingContext(twin, buildPlayersResponse(bootstrap()).positions, quiet, gameweeks, now);
    const best = rated(pickRatingFor(twin[0]!, c));
    expect(best.band).toBe("best");
    expect(rated(pickRatingFor(twin[20]!, c))).toMatchObject({ band: "best", score: best.score, rank: 1 });
  });
});

describe("eligibility", () => {
  const group = players([
    { id: 1, element_type: 3, team: 1, minutes: 270 },
    { id: 2, element_type: 3, team: 1, minutes: 269 },
    { id: 3, element_type: 3, team: 1, minutes: 900, status: "d", chance_of_playing_next_round: 50 },
    { id: 4, element_type: 3, team: 1, minutes: 900, status: "s" },
    { id: 5, element_type: 1, team: 1, minutes: 900 },
    { id: 6, element_type: 3, team: 1, minutes: 900, status: "u" },
  ]);
  const ctx = buildRatingContext(group, buildPlayersResponse(bootstrap()).positions, fixtures, gameweeks, now);

  it("rates exactly 270 minutes and doubtful players; not 269 minutes", () => {
    expect(pickRatingFor(group[0]!, ctx).rated).toBe(true);
    expect(pickRatingFor(group[1]!, ctx)).toEqual({ rated: false, reason: "Under 270 minutes this season (269 so far)" });
    expect(rated(pickRatingFor(group[2]!, ctx)).ruledOut).toBe(false);
  });
  it("rates a suspended player with the minutes, marked ruled out, outside the ranked pool", () => {
    expect(rated(pickRatingFor(group[3]!, ctx))).toMatchObject({ ruledOut: true, of: 2 });
  });
  it("does not rate an Unavailable player, whatever his minutes", () => {
    expect(pickRatingFor(group[5]!, ctx)).toEqual({ rated: false, reason: "Unavailable" });
  });
  it("never compares across positions", () => {
    expect(rated(pickRatingFor(group[4]!, ctx))).toMatchObject({ positionShort: "GKP", of: 1, rank: 1, band: "best" });
    expect(rated(pickRatingFor(group[0]!, ctx))).toMatchObject({ positionShort: "MID", of: 2 });
  });
});

describe("fixtures input", () => {
  const two = players([
    { id: 1, element_type: 4, team: 1, minutes: 900 },
    { id: 2, element_type: 4, team: 2, minutes: 900 },
  ]);
  const ctx = buildRatingContext(two, buildPlayersResponse(bootstrap()).positions, fixtures, gameweeks, now);
  const ease = (i: number) => rated(pickRatingFor(two[i]!, ctx)).inputs.find((x) => x.key === "fixtures")!.value;

  it("counts both games of a double and nothing for a blank", () => {
    expect(ease(0)).toBe(15);
    expect(ease(1)).toBe(5);
  });
  it("puts nailedness as starts over the Club's finished matches, capped at 1", () => {
    const nailed = rated(pickRatingFor(two[0]!, ctx)).inputs.find((x) => x.key === "nailed")!;
    expect(nailed.value).toBe(1);
    expect(nailed.display).toBe("100%");
  });
});

describe("ordinal", () => {
  it("formats ranks", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal)).toEqual(
      ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st"],
    );
  });
});
