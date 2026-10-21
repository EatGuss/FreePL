import { z } from "zod";
import { fplInt } from "./decimal.js";
import { ClubRow, ContractError, GameweekRow, buildPlayersResponse, type RawBootstrapRows } from "./response.js";
import { instant } from "./rows.js";

/** Raw rows from current_fixtures (db/views/0003_fixtures.sql). */
export const RawFixture = z.object({
  id: z.number().int(),
  event: fplInt, // null = unscheduled
  team_h: z.number().int(),
  team_a: z.number().int(),
  team_h_difficulty: z.number().int().min(1).max(5),
  team_a_difficulty: z.number().int().min(1).max(5),
  kickoff_time: instant.nullable(),
  provisional_start_time: z.boolean().nullable(),
  finished: z.boolean().nullable(),
});
export type RawFixture = z.input<typeof RawFixture>;

/**
 * A fixture as the API sends it. The two difficulty fields are FPL's own and are read only
 * through difficultyFor — no component touches them (spec 0003 "Difficulty source").
 */
export const FixtureRow = z.object({
  id: z.number().int(),
  gameweek: z.number().int().nullable(),
  homeClubId: z.number().int(),
  awayClubId: z.number().int(),
  homeDifficulty: z.number().int(),
  awayDifficulty: z.number().int(),
  kickoffTime: z.string().nullable(),
  provisional: z.boolean(),
  finished: z.boolean(),
});
export type FixtureRow = z.infer<typeof FixtureRow>;

export const FixturesResponse = z.object({
  meta: z.object({
    sources: z.object({
      bootstrap: z.object({ capturedAt: z.string() }),
      fixtures: z.object({ capturedAt: z.string() }),
    }),
  }),
  clubs: z.array(ClubRow),
  gameweeks: z.array(GameweekRow),
  fixtures: z.array(FixtureRow),
});
export type FixturesResponse = z.infer<typeof FixturesResponse>;

export interface RawFixturesRows {
  bootstrap: RawBootstrapRows;
  fixturesCapturedAt: unknown;
  fixtures: unknown[];
}

/**
 * Raw rows → FixturesResponse. Clubs and gameweeks come from the bootstrap capture, parsed
 * exactly as for /api/players; a fixture naming a Club that capture lacks fails loudly.
 */
export function buildFixturesResponse(raw: RawFixturesRows): FixturesResponse {
  const { meta, clubs, gameweeks } = buildPlayersResponse({ ...raw.bootstrap, players: [] });
  const fixturesCapturedAt = instant.parse(raw.fixturesCapturedAt);
  const clubIds = new Set(clubs.map((c) => c.id));
  const issues: string[] = [];
  const fixtures: FixtureRow[] = [];
  raw.fixtures.forEach((row, i) => {
    const r = RawFixture.safeParse(row);
    if (!r.success) {
      const id = (row as { id?: unknown } | null)?.id;
      for (const issue of r.error.issues) issues.push(`fixture id=${String(id ?? `#${i}`)} ${issue.path.join(".")}: ${issue.message}`);
      return;
    }
    const f = r.data;
    for (const club of [f.team_h, f.team_a]) if (!clubIds.has(club)) issues.push(`fixture id=${f.id} Club ${club} not in bootstrap`);
    fixtures.push({
      id: f.id,
      gameweek: f.event,
      homeClubId: f.team_h,
      awayClubId: f.team_a,
      homeDifficulty: f.team_h_difficulty,
      awayDifficulty: f.team_a_difficulty,
      kickoffTime: f.kickoff_time,
      // A ticker that presents a TBC fixture as confirmed is worse than one that omits it.
      provisional: f.kickoff_time === null || f.provisional_start_time === true,
      finished: f.finished === true,
    });
  });
  if (issues.length) throw new ContractError(`${issues.length} fixture problem(s)`, issues);
  fixtures.sort((a, b) => (a.gameweek ?? Infinity) - (b.gameweek ?? Infinity) || (a.kickoffTime ?? "").localeCompare(b.kickoffTime ?? "") || a.id - b.id);
  return {
    meta: { sources: { bootstrap: meta.sources.bootstrap, fixtures: { capturedAt: fixturesCapturedAt } } },
    clubs,
    gameweeks,
    fixtures,
  };
}

/**
 * The one place difficulty is read (spec 0003). Today FPL's 1–5 rating from this Club's
 * side; replacing it with a model's number is a change here and to the colour scale only.
 */
export function difficultyFor(fixture: FixtureRow, clubId: number): number {
  if (fixture.homeClubId === clubId) return fixture.homeDifficulty;
  if (fixture.awayClubId === clubId) return fixture.awayDifficulty;
  throw new Error(`Club ${clubId} does not play in fixture ${fixture.id}`);
}
