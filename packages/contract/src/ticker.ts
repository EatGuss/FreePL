import { difficultyFor, type FixtureRow } from "./fixtures.js";
import type { ClubRow, GameweekRow } from "./response.js";

/** Spec 0003 "Cell model": a cell is a list — 0 = blank, 1 = normal, 2+ = double. */
export interface TickerFixture {
  opponentClubId: number;
  isHome: boolean;
  difficulty: number;
  kickoffTime: string | null;
  provisional: boolean;
}
export interface TickerCell {
  gameweek: number;
  fixtures: TickerFixture[];
}
export interface TickerRow {
  club: ClubRow;
  cells: TickerCell[];
  fixtureCount: number;
  difficultySum: number;
  /** null when the Club has no fixture in the window. No blank penalty, no imputation. */
  difficultyMean: number | null;
}
export interface Ticker {
  gameweeks: GameweekRow[];
  rows: TickerRow[];
  /** Fixtures with no gameweek yet: counted, never placed in a column. */
  unscheduled: number;
}

export const WINDOW_MIN = 3;
export const WINDOW_MAX = 10;
export const WINDOW_DEFAULT = 6;
export type TickerSort = "mean" | "sum" | "count";

/** The window starts at the upcoming gameweek: the first deadline after now. */
export function tickerWindow(gameweeks: GameweekRow[], size: number, nowMs: number = Date.now()): GameweekRow[] {
  const n = Math.min(WINDOW_MAX, Math.max(WINDOW_MIN, Math.round(size)));
  const start = gameweeks.findIndex((g) => Date.parse(g.deadlineTime) > nowMs);
  return start === -1 ? [] : gameweeks.slice(start, start + n);
}

export function buildTicker(clubs: ClubRow[], fixtures: FixtureRow[], window: GameweekRow[]): Ticker {
  const inWindow = new Set(window.map((g) => g.id));
  const rows = clubs.map((club): TickerRow => {
    const cells = window.map((g): TickerCell => ({ gameweek: g.id, fixtures: [] }));
    const byGw = new Map(cells.map((c) => [c.gameweek, c]));
    for (const f of fixtures) {
      if (f.gameweek === null || !inWindow.has(f.gameweek)) continue;
      if (f.homeClubId !== club.id && f.awayClubId !== club.id) continue;
      const isHome = f.homeClubId === club.id;
      byGw.get(f.gameweek)!.fixtures.push({
        opponentClubId: isHome ? f.awayClubId : f.homeClubId,
        isHome,
        difficulty: difficultyFor(f, club.id),
        kickoffTime: f.kickoffTime,
        provisional: f.provisional,
      });
    }
    const all = cells.flatMap((c) => c.fixtures);
    const difficultySum = all.reduce((s, f) => s + f.difficulty, 0);
    return {
      club,
      cells,
      fixtureCount: all.length,
      difficultySum,
      difficultyMean: all.length ? difficultySum / all.length : null,
    };
  });
  return { gameweeks: window, rows, unscheduled: fixtures.filter((f) => f.gameweek === null).length };
}

/**
 * mean ↑ (default), sum ↑, count ↓. Ties: more fixtures first, then Club name. A Club with
 * no fixture in the window has no mean and no meaningful sum, so it sorts last.
 */
export function sortTicker(rows: TickerRow[], by: TickerSort): TickerRow[] {
  const key = (r: TickerRow): number | null =>
    by === "mean" ? r.difficultyMean : by === "sum" ? (r.fixtureCount ? r.difficultySum : null) : -r.fixtureCount;
  return [...rows].sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (ka === null || kb === null) {
      if (ka !== kb) return ka === null ? 1 : -1;
    } else if (ka !== kb) return ka - kb;
    return b.fixtureCount - a.fixtureCount || a.club.name.localeCompare(b.club.name);
  });
}
