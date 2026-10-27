import { z } from "zod";
import { RawClub, RawGameweek, RawPlayer, RawPosition, instant } from "./rows.js";

/** What the API sends and the browser reads: camelCase, numbers parsed, prices int tenths. */

export const PositionRow = z.object({
  id: z.number().int(),
  short: z.string(),
  plural: z.string(),
  /** Starters allowed in this position (element_types squad_min_play / squad_max_play). */
  minPlay: z.number().int().nullable(),
  maxPlay: z.number().int().nullable(),
});
export type PositionRow = z.infer<typeof PositionRow>;

export const ClubRow = z.object({
  id: z.number().int(),
  code: z.number().int(),
  name: z.string(),
  short: z.string(),
});
export type ClubRow = z.infer<typeof ClubRow>;

export const GameweekRow = z.object({
  id: z.number().int(),
  name: z.string(),
  deadlineTime: z.string(),
  finished: z.boolean(),
  dataChecked: z.boolean(),
});
export type GameweekRow = z.infer<typeof GameweekRow>;

const num = z.number().nullable();
const int = z.number().int().nullable();

export const PlayerRow = z.object({
  id: z.number().int(),
  code: z.number().int(),
  webName: z.string(),
  firstName: z.string(),
  secondName: z.string(),
  clubId: z.number().int(),
  positionId: z.number().int(),
  nowCost: z.number().int(),
  costChangeStart: int,
  costChangeEvent: int,
  status: z.enum(["a", "d", "i", "s", "u", "n"]),
  news: z.string().nullable(),
  newsAdded: z.string().nullable(),
  chanceThisRound: int,
  chanceNextRound: int,
  totalPoints: int,
  pointsPerGame: num,
  form: num,
  minutes: int,
  starts: int,
  goals: int,
  assists: int,
  cleanSheets: int,
  goalsConceded: int,
  saves: int,
  bonus: int,
  bps: int,
  yellowCards: int,
  redCards: int,
  xG: num,
  xA: num,
  xGI: num,
  xGC: num,
  xGPer90: num,
  xAPer90: num,
  xGIPer90: num,
  xGCPer90: num,
  goalsConcededPer90: num,
  savesPer90: num,
  startsPer90: num,
  cleanSheetsPer90: num,
  cbi: int,
  tackles: int,
  recoveries: int,
  defensiveContribution: int,
  defensiveContributionPer90: num,
  penaltiesOrder: int,
  cornersOrder: int,
  freekicksOrder: int,
  influence: num,
  creativity: num,
  threat: num,
  ictIndex: num,
  epThis: num,
  epNext: num,
  selectedByPercent: num,
  transfersInEvent: int,
  transfersOutEvent: int,
  valueForm: num,
  valueSeason: num,
});
export type PlayerRow = z.infer<typeof PlayerRow>;

/** Specs 0003/0004 add source keys (fixtures, entry). */
export const MetaBlock = z.object({
  sources: z.object({ bootstrap: z.object({ capturedAt: z.string() }) }),
});
export type MetaBlock = z.infer<typeof MetaBlock>;

export const PlayersResponse = z.object({
  meta: MetaBlock,
  clubs: z.array(ClubRow),
  positions: z.array(PositionRow),
  gameweeks: z.array(GameweekRow),
  players: z.array(PlayerRow),
});
export type PlayersResponse = z.infer<typeof PlayersResponse>;

export interface RawBootstrapRows {
  capturedAt: unknown;
  players: unknown[];
  clubs: unknown[];
  gameweeks: unknown[];
  positions: unknown[];
}

export class ContractError extends Error {
  constructor(message: string, readonly issues: string[] = []) {
    super(issues.length ? `${message}: ${issues.slice(0, 5).join("; ")}` : message);
    this.name = "ContractError";
  }
}

function parseAll<S extends z.ZodTypeAny>(schema: S, rows: unknown[], what: string): z.output<S>[] {
  const out: z.output<S>[] = [];
  const issues: string[] = [];
  rows.forEach((row, i) => {
    const r = schema.safeParse(row);
    if (r.success) out.push(r.data);
    else {
      const id = (row as { id?: unknown } | null)?.id;
      for (const issue of r.error.issues) issues.push(`${what} id=${String(id ?? `#${i}`)} ${issue.path.join(".")}: ${issue.message}`);
    }
  });
  if (issues.length) throw new ContractError(`${issues.length} ${what} parse failure(s)`, issues);
  return out;
}

/**
 * Raw view rows → PlayersResponse. Throws ContractError on any bad row, an element_type
 * with no position, or a team with no club — never drops or zero-fills a row.
 */
export function buildPlayersResponse(raw: RawBootstrapRows): PlayersResponse {
  const capturedAt = instant.parse(raw.capturedAt);
  const positions = parseAll(RawPosition, raw.positions, "position").map((p) => ({
    id: p.id,
    short: p.singular_name_short,
    plural: p.plural_name,
    minPlay: p.squad_min_play,
    maxPlay: p.squad_max_play,
  }));
  const clubs = parseAll(RawClub, raw.clubs, "club").map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    short: c.short_name,
  }));
  const gameweeks = parseAll(RawGameweek, raw.gameweeks, "gameweek")
    .map((g) => ({
      id: g.id,
      name: g.name,
      deadlineTime: g.deadline_time,
      finished: g.finished,
      dataChecked: g.data_checked,
    }))
    .sort((a, b) => a.id - b.id);

  const positionIds = new Set(positions.map((p) => p.id));
  const clubIds = new Set(clubs.map((c) => c.id));
  const orphans: string[] = [];

  const players = parseAll(RawPlayer, raw.players, "player").map((p) => {
    if (!positionIds.has(p.element_type)) orphans.push(`player id=${p.id} element_type=${p.element_type} has no position`);
    if (!clubIds.has(p.team)) orphans.push(`player id=${p.id} team=${p.team} has no club`);
    return {
      id: p.id,
      code: p.code,
      webName: p.web_name,
      firstName: p.first_name,
      secondName: p.second_name,
      clubId: p.team,
      positionId: p.element_type,
      nowCost: p.now_cost,
      costChangeStart: p.cost_change_start,
      costChangeEvent: p.cost_change_event,
      status: p.status,
      news: p.news,
      newsAdded: p.news_added,
      chanceThisRound: p.chance_of_playing_this_round,
      chanceNextRound: p.chance_of_playing_next_round,
      totalPoints: p.total_points,
      pointsPerGame: p.points_per_game,
      form: p.form,
      minutes: p.minutes,
      starts: p.starts,
      goals: p.goals_scored,
      assists: p.assists,
      cleanSheets: p.clean_sheets,
      goalsConceded: p.goals_conceded,
      saves: p.saves,
      bonus: p.bonus,
      bps: p.bps,
      yellowCards: p.yellow_cards,
      redCards: p.red_cards,
      xG: p.expected_goals,
      xA: p.expected_assists,
      xGI: p.expected_goal_involvements,
      xGC: p.expected_goals_conceded,
      xGPer90: p.expected_goals_per_90,
      xAPer90: p.expected_assists_per_90,
      xGIPer90: p.expected_goal_involvements_per_90,
      xGCPer90: p.expected_goals_conceded_per_90,
      goalsConcededPer90: p.goals_conceded_per_90,
      savesPer90: p.saves_per_90,
      startsPer90: p.starts_per_90,
      cleanSheetsPer90: p.clean_sheets_per_90,
      cbi: p.clearances_blocks_interceptions,
      tackles: p.tackles,
      recoveries: p.recoveries,
      defensiveContribution: p.defensive_contribution,
      defensiveContributionPer90: p.defensive_contribution_per_90,
      penaltiesOrder: p.penalties_order,
      cornersOrder: p.corners_and_indirect_freekicks_order,
      freekicksOrder: p.direct_freekicks_order,
      influence: p.influence,
      creativity: p.creativity,
      threat: p.threat,
      ictIndex: p.ict_index,
      epThis: p.ep_this,
      epNext: p.ep_next,
      selectedByPercent: p.selected_by_percent,
      transfersInEvent: p.transfers_in_event,
      transfersOutEvent: p.transfers_out_event,
      valueForm: p.value_form,
      valueSeason: p.value_season,
    } satisfies PlayerRow;
  });
  if (orphans.length) throw new ContractError(`${orphans.length} unmapped player(s)`, orphans);

  return { meta: { sources: { bootstrap: { capturedAt } } }, clubs, positions, gameweeks, players };
}

/** The upcoming gameweek: first deadline after now. Computed in the browser, never cached. */
export function upcomingGameweek(gameweeks: GameweekRow[], nowMs: number = Date.now()): GameweekRow | null {
  return gameweeks.find((g) => Date.parse(g.deadlineTime) > nowMs) ?? null;
}
