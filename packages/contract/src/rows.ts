import { z } from "zod";
import { fplDecimal, fplInt } from "./decimal.js";
import { STATUS_LABEL, type StatusCode } from "./availability.js";

/**
 * Raw rows as the views (db/views/0002_current.sql) return them through postgres.js:
 * snake_case, ints as numbers, FPL string numerics as text, timestamptz as Date.
 * Every view column is listed; a missing key fails loudly, a null passes through.
 */

/** timestamptz arrives as a Date from postgres.js, or an ISO string from a fixture. */
export const instant = z.union([z.date(), z.string()]).transform((value, ctx) => {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (Number.isNaN(ms)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `invalid instant: ${String(value)}` });
    return z.NEVER;
  }
  return new Date(ms).toISOString();
});

/** int8 arrives as a string from postgres.js. */
const bigintId = z.union([z.string().regex(/^\d+$/), z.number().int()]).transform(Number);

const statusCode = z
  .string()
  .refine((s): s is StatusCode => s in STATUS_LABEL, { message: "unknown player status" })
  .transform((s) => s as StatusCode);

export const RawPlayer = z.object({
  id: z.number().int(),
  code: bigintId,
  web_name: z.string(),
  first_name: z.string(),
  second_name: z.string(),
  team: z.number().int(),
  element_type: z.number().int(),
  now_cost: z.number().int(),
  cost_change_start: fplInt,
  cost_change_event: fplInt,
  status: statusCode,
  news: z.string().nullable(),
  news_added: instant.nullable(),
  chance_of_playing_this_round: fplInt,
  chance_of_playing_next_round: fplInt,
  total_points: fplInt,
  points_per_game: fplDecimal,
  form: fplDecimal,
  minutes: fplInt,
  starts: fplInt,
  goals_scored: fplInt,
  assists: fplInt,
  clean_sheets: fplInt,
  goals_conceded: fplInt,
  saves: fplInt,
  bonus: fplInt,
  bps: fplInt,
  yellow_cards: fplInt,
  red_cards: fplInt,
  expected_goals: fplDecimal,
  expected_assists: fplDecimal,
  expected_goal_involvements: fplDecimal,
  expected_goals_conceded: fplDecimal,
  expected_goals_per_90: fplDecimal,
  expected_assists_per_90: fplDecimal,
  expected_goal_involvements_per_90: fplDecimal,
  expected_goals_conceded_per_90: fplDecimal,
  goals_conceded_per_90: fplDecimal,
  saves_per_90: fplDecimal,
  starts_per_90: fplDecimal,
  clean_sheets_per_90: fplDecimal,
  clearances_blocks_interceptions: fplInt,
  tackles: fplInt,
  recoveries: fplInt,
  defensive_contribution: fplInt,
  defensive_contribution_per_90: fplDecimal,
  penalties_order: fplInt,
  corners_and_indirect_freekicks_order: fplInt,
  direct_freekicks_order: fplInt,
  influence: fplDecimal,
  creativity: fplDecimal,
  threat: fplDecimal,
  ict_index: fplDecimal,
  ep_this: fplDecimal,
  ep_next: fplDecimal,
  selected_by_percent: fplDecimal,
  transfers_in_event: fplInt,
  transfers_out_event: fplInt,
  value_form: fplDecimal,
  value_season: fplDecimal,
});
export type RawPlayer = z.input<typeof RawPlayer>;

export const RawClub = z.object({
  id: z.number().int(),
  code: z.number().int(),
  name: z.string(),
  short_name: z.string(),
  strength: fplInt,
  strength_overall_home: fplInt,
  strength_overall_away: fplInt,
  strength_attack_home: fplInt,
  strength_attack_away: fplInt,
  strength_defence_home: fplInt,
  strength_defence_away: fplInt,
});
export type RawClub = z.input<typeof RawClub>;

export const RawGameweek = z.object({
  id: z.number().int(),
  name: z.string(),
  deadline_time: instant,
  finished: z.boolean(),
  data_checked: z.boolean(),
  is_current: z.boolean(),
  is_next: z.boolean(),
});
export type RawGameweek = z.input<typeof RawGameweek>;

export const RawPosition = z.object({
  id: z.number().int(),
  singular_name: z.string(),
  singular_name_short: z.string(),
  plural_name: z.string(),
  plural_name_short: z.string(),
  squad_select: fplInt,
  squad_min_play: fplInt,
  squad_max_play: fplInt,
});
export type RawPosition = z.input<typeof RawPosition>;
