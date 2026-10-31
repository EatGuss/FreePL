import { STATUS_LABEL, hiddenByDefault } from "./availability.js";
import { difficultyFor, type FixtureRow } from "./fixtures.js";
import type { GameweekRow, PlayerRow, PositionRow } from "./response.js";
import { tickerWindow } from "./ticker.js";

/**
 * Spec 0005 pick rating: a browsing aid, never a projection. Never import this into the
 * decision log, the projection model or a backtest. All band reads go through pickRatingFor;
 * the weights and cutoffs below are the only place they are defined.
 */

export type Band = "best" | "great" | "good" | "ok" | "below";
export const BAND_LABEL: Record<Band, string> = { best: "Best", great: "Great", good: "Good", ok: "OK", below: "Below OK" };

/** Share of eligible players (by score) inside each band; each cutoff rounds up (Q74). */
const BAND_CUTOFFS: [Band, number][] = [["best", 0.05], ["great", 0.15], ["good", 0.25], ["ok", 0.4]];

export const MIN_MINUTES = 270;
export const FIXTURE_GAMEWEEKS = 3;

export type InputKey = "xgc90" | "saves90" | "xg90" | "xa90" | "xgi90" | "defcon90" | "ga90" | "fixtures" | "nailed";

interface InputDef {
  label: string;
  lowerIsBetter?: boolean;
  /** null = no value; the player is then not rated, with the reason. */
  value: (p: PlayerRow, ctx: InputContext) => number | null;
  format: (v: number) => string;
}
interface InputContext {
  fixtureEase: Map<number, number>;
  clubFinished: Map<number, number>;
}

const per90 = (n: number | null, minutes: number | null) => (n === null || !minutes ? null : (n / minutes) * 90);
const f2 = (v: number) => v.toFixed(2);

export const INPUTS: Record<InputKey, InputDef> = {
  xgc90: { label: "xGC/90", lowerIsBetter: true, value: (p) => p.xGCPer90, format: f2 },
  saves90: { label: "Saves/90", value: (p) => p.savesPer90, format: (v) => v.toFixed(1) },
  xg90: { label: "xG/90", value: (p) => p.xGPer90, format: f2 },
  xa90: { label: "xA/90", value: (p) => p.xAPer90, format: f2 },
  xgi90: { label: "xG+xA/90", value: (p) => p.xGIPer90, format: f2 },
  // FPL's defensive_contribution is CBIT for defenders and CBIRT for others (fpl-domain.md).
  defcon90: { label: "DefCon/90", value: (p) => p.defensiveContributionPer90, format: (v) => v.toFixed(1) },
  ga90: {
    label: "G+A/90",
    value: (p) => (p.goals === null || p.assists === null ? null : per90(p.goals + p.assists, p.minutes)),
    format: f2,
  },
  fixtures: { label: "Fixtures", value: (p, ctx) => ctx.fixtureEase.get(p.clubId) ?? 0, format: (v) => String(v) },
  nailed: {
    label: "Nailed",
    value: (p, ctx) => {
      const played = ctx.clubFinished.get(p.clubId) ?? 0;
      return played === 0 || p.starts === null ? null : Math.min(1, p.starts / played);
    },
    format: (v) => `${Math.round(v * 100)}%`,
  },
};

/** Weights per position, each summing to 100 (spec 0005, set 2026-10-22; DEF and MID revised the same day). */
export const WEIGHTS: Record<string, Partial<Record<InputKey, number>>> = {
  GKP: { xgc90: 35, saves90: 15, fixtures: 25, nailed: 25 },
  DEF: { xgc90: 20, xgi90: 25, ga90: 5, defcon90: 10, fixtures: 20, nailed: 20 },
  MID: { xg90: 20, xa90: 15, defcon90: 15, ga90: 10, fixtures: 20, nailed: 20 },
  FWD: { xg90: 35, xa90: 15, ga90: 5, fixtures: 25, nailed: 20 },
};

export interface InputScore {
  key: InputKey;
  label: string;
  weight: number;
  value: number;
  display: string;
  /** Rank among rated players in the position, 1 = best; ties share a rank. */
  rank: number;
  /** 0–1, 1 = best in position. */
  percentile: number;
}

export type PickRating =
  | {
      rated: true; band: Band; score: number; rank: number; of: number; positionShort: string; inputs: InputScore[];
      /**
       * Ruled out (i/s/n): scored against the available players without taking a place in their
       * ranking, so injured players never push fit ones down a band, and with no credit for
       * fixtures he will miss. Picks leaves them out.
       */
      ruledOut: boolean;
    }
  | { rated: false; reason: string };

export interface RatingContext {
  ratings: Map<number, PickRating>;
}

/** Ranks with ties sharing the best rank (1, 2, 2, 4) and the average rank for percentiles. */
function rankValues(values: number[], lowerIsBetter: boolean): { rank: number[]; avgRank: number[] } {
  const order = values.map((v, i) => ({ v: lowerIsBetter ? v : -v, i })).sort((a, b) => a.v - b.v);
  const rank = new Array<number>(values.length);
  const avgRank = new Array<number>(values.length);
  for (let start = 0; start < order.length; ) {
    let end = start;
    while (end + 1 < order.length && order[end + 1]!.v === order[start]!.v) end++;
    const avg = (start + end) / 2 + 1;
    for (let k = start; k <= end; k++) {
      rank[order[k]!.i] = start + 1;
      avgRank[order[k]!.i] = avg;
    }
    start = end + 1;
  }
  return { rank, avgRank };
}

/**
 * An outside value's rank (1 = best) and 0–1 percentile against a pool it is not part of. It
 * shares the average rank of the values it equals, on the pool's own scale, so equal values
 * get equal percentiles.
 */
function placeAgainst(pool: number[], v: number, lowerIsBetter: boolean): { rank: number; percentile: number } {
  const better = (a: number, b: number) => (lowerIsBetter ? a < b : a > b);
  const above = pool.filter((x) => better(x, v)).length;
  const equal = pool.filter((x) => !better(x, v) && !better(v, x)).length;
  const n = pool.length;
  const avgRank = above + (equal + 1) / 2;
  const percentile = n <= 1 ? (above === 0 ? 1 : 0) : Math.min(1, Math.max(0, (n - avgRank) / (n - 1)));
  return { rank: above + 1, percentile };
}

/**
 * Builds every player's rating once per data load. Eligible: ≥270 minutes and not
 * i/s/u/n (d stays). Percentiles are within position among eligible players. Unavailable (u)
 * players are not rated. A ruled-out i/s/n player with the minutes is placed against that
 * pool (owner decision 2026-10-28) with his fixtures counted as zero (2026-10-31): he will
 * miss them.
 */
export function buildRatingContext(
  players: PlayerRow[], positions: PositionRow[], fixtures: FixtureRow[], gameweeks: GameweekRow[], nowMs: number = Date.now(),
): RatingContext {
  const window = new Set(tickerWindow(gameweeks, FIXTURE_GAMEWEEKS, nowMs).map((g) => g.id));
  const fixtureEase = new Map<number, number>();
  const clubFinished = new Map<number, number>();
  const add = (m: Map<number, number>, k: number, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const f of fixtures) {
    for (const club of [f.homeClubId, f.awayClubId]) {
      if (f.finished) add(clubFinished, club, 1);
      // A double counts twice, a blank adds nothing (spec 0005 "Fixtures input").
      if (f.gameweek !== null && window.has(f.gameweek)) add(fixtureEase, club, 6 - difficultyFor(f, club));
    }
  }
  const ctx: InputContext = { fixtureEase, clubFinished };
  const ratings = new Map<number, PickRating>();
  const positionById = new Map(positions.map((p) => [p.id, p]));

  for (const position of positions) {
    const weights = WEIGHTS[position.short];
    if (!weights) throw new Error(`no pick-rating weights for position ${position.short}`);
    const keys = Object.keys(weights) as InputKey[];
    const eligible: { p: PlayerRow; values: number[] }[] = [];
    const ruledOut: { p: PlayerRow; values: number[] }[] = [];
    for (const p of players) {
      if (p.positionId !== position.id) continue;
      if (p.status === "u") { ratings.set(p.id, { rated: false, reason: STATUS_LABEL.u }); continue; }
      const minutes = p.minutes ?? 0;
      if (minutes < MIN_MINUTES) { ratings.set(p.id, { rated: false, reason: `Under ${MIN_MINUTES} minutes this season (${minutes} so far)` }); continue; }
      const values = keys.map((k) => INPUTS[k].value(p, ctx));
      const missing = keys.filter((_, i) => values[i] === null);
      if (missing.length) { ratings.set(p.id, { rated: false, reason: `No ${missing.map((k) => INPUTS[k].label).join(", ")} yet` }); continue; }
      (hiddenByDefault(p.status) ? ruledOut : eligible).push({ p, values: values as number[] });
    }
    const n = eligible.length;
    if (!n) continue;
    const perInput = keys.map((k, j) => rankValues(eligible.map((e) => e.values[j]!), INPUTS[k].lowerIsBetter ?? false));
    const scored = eligible.map((e, i) => {
      const inputs: InputScore[] = keys.map((k, j) => ({
        key: k,
        label: INPUTS[k].label,
        weight: weights[k]!,
        value: e.values[j]!,
        display: INPUTS[k].format(e.values[j]!),
        rank: perInput[j]!.rank[i]!,
        percentile: n === 1 ? 1 : (n - perInput[j]!.avgRank[i]!) / (n - 1),
      }));
      const score = inputs.reduce((s, x) => s + x.weight * x.percentile, 0) / 100;
      return { p: e.p, inputs, score };
    });
    scored.sort((a, b) => b.score - a.score || a.p.id - b.p.id);
    const cut = BAND_CUTOFFS.map(([band, share]) => [band, Math.ceil(share * n)] as const);
    const scoreRank = rankValues(scored.map((s) => s.score), false).rank;
    const positionShort = positionById.get(position.id)!.short;
    scored.forEach((s, i) => {
      const band = cut.find(([, upTo]) => i < upTo)?.[0] ?? "below";
      ratings.set(s.p.id, { rated: true, band, score: s.score, rank: scoreRank[i]!, of: n, positionShort, inputs: s.inputs, ruledOut: false });
    });
    // A ruled-out player takes the band whose last member he matches or beats.
    const lastScore = cut.map(([band, upTo]) => [band, scored[Math.min(upTo, n) - 1]!.score] as const);
    const scores = scored.map((s) => s.score);
    for (const f of ruledOut) {
      const inputs: InputScore[] = keys.map((k, j) => {
        const missesFixtures = k === "fixtures";
        const v = missesFixtures ? 0 : f.values[j]!;
        const at = placeAgainst(eligible.map((e) => e.values[j]!), v, INPUTS[k].lowerIsBetter ?? false);
        const display = missesFixtures ? `${INPUTS[k].format(v)} (ruled out)` : INPUTS[k].format(v);
        return { key: k, label: INPUTS[k].label, weight: weights[k]!, value: v, display, ...at };
      });
      const score = inputs.reduce((s, x) => s + x.weight * x.percentile, 0) / 100;
      const band = lastScore.find(([, last]) => score >= last)?.[0] ?? "below";
      const rank = placeAgainst(scores, score, false).rank;
      ratings.set(f.p.id, { rated: true, band, score, rank, of: n, positionShort, inputs, ruledOut: true });
    }
  }
  return { ratings };
}

/** The one reader of ratings (spec 0005). The projection model may replace what it returns. */
export function pickRatingFor(player: PlayerRow, context: RatingContext): PickRating {
  return context.ratings.get(player.id) ?? { rated: false, reason: "Not rated" };
}

/** "1st", "2nd", "3rd", "11th", "22nd". */
export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}
