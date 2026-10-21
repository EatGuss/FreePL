/** Synthetic rows only — invented players and Clubs. Never paste a real FPL payload here. */
import type { RawBootstrapRows, RawClub, RawGameweek, RawPlayer, RawPosition } from "../src/index.js";

export const positions: RawPosition[] = [
  { id: 1, singular_name: "Goalkeeper", singular_name_short: "GKP", plural_name: "Goalkeepers", plural_name_short: "GKP", squad_select: 2, squad_min_play: 1, squad_max_play: 1 },
  { id: 2, singular_name: "Defender", singular_name_short: "DEF", plural_name: "Defenders", plural_name_short: "DEF", squad_select: 5, squad_min_play: 3, squad_max_play: 5 },
  { id: 3, singular_name: "Midfielder", singular_name_short: "MID", plural_name: "Midfielders", plural_name_short: "MID", squad_select: 5, squad_min_play: 2, squad_max_play: 5 },
  { id: 4, singular_name: "Forward", singular_name_short: "FWD", plural_name: "Forwards", plural_name_short: "FWD", squad_select: 3, squad_min_play: 1, squad_max_play: 3 },
];

const club = (id: number, short: string): RawClub => ({
  id, code: 900 + id, name: `Test ${short}`, short_name: short, strength: 3,
  strength_overall_home: 1100, strength_overall_away: 1100, strength_attack_home: 1100,
  strength_attack_away: 1100, strength_defence_home: 1100, strength_defence_away: 1100,
});
export const clubs: RawClub[] = [club(1, "AAA"), club(2, "BBB")];

export const gameweeks: RawGameweek[] = [
  { id: 2, name: "Gameweek 2", deadline_time: "2030-08-22T17:30:00Z", finished: false, data_checked: false, is_current: false, is_next: true },
  { id: 1, name: "Gameweek 1", deadline_time: new Date("2030-08-15T17:30:00Z"), finished: true, data_checked: true, is_current: true, is_next: false },
];

export function player(overrides: Partial<RawPlayer> = {}): RawPlayer {
  return {
    id: 1, code: "100001", web_name: "Test Keeper", first_name: "Test", second_name: "Keeper",
    team: 1, element_type: 1, now_cost: 45, cost_change_start: 0, cost_change_event: 0,
    status: "a", news: "", news_added: null,
    chance_of_playing_this_round: null, chance_of_playing_next_round: null,
    total_points: 20, points_per_game: "4.0", form: "3.5", minutes: 450, starts: 5,
    goals_scored: 0, assists: 0, clean_sheets: 2, goals_conceded: 5, saves: 14, bonus: 2,
    bps: 120, yellow_cards: 0, red_cards: 0,
    expected_goals: "0.00", expected_assists: "0.05", expected_goal_involvements: "0.05",
    expected_goals_conceded: "6.10",
    expected_goals_per_90: 0, expected_assists_per_90: 0.01, expected_goal_involvements_per_90: 0.01,
    expected_goals_conceded_per_90: 1.22, goals_conceded_per_90: 1.0, saves_per_90: 2.8,
    starts_per_90: 1, clean_sheets_per_90: 0.4,
    clearances_blocks_interceptions: 3, tackles: 0, recoveries: 20, defensive_contribution: 0,
    defensive_contribution_per_90: 0,
    penalties_order: null, corners_and_indirect_freekicks_order: null, direct_freekicks_order: null,
    influence: "110.2", creativity: "0.0", threat: "0.0", ict_index: "11.0",
    ep_this: "3.0", ep_next: null,
    selected_by_percent: "12.3", transfers_in_event: 100, transfers_out_event: 50,
    value_form: "0.8", value_season: "4.4",
    ...overrides,
  };
}

export function bootstrap(players: RawPlayer[] = [player()]): RawBootstrapRows {
  return { capturedAt: new Date("2030-08-20T09:00:00Z"), players, clubs, gameweeks, positions };
}

export function rawFixture(overrides: Partial<import("../src/index.js").RawFixture> = {}): import("../src/index.js").RawFixture {
  return {
    id: 1, event: 2, team_h: 1, team_a: 2, team_h_difficulty: 2, team_a_difficulty: 4,
    kickoff_time: "2030-08-23T14:00:00Z", provisional_start_time: false, finished: false,
    ...overrides,
  };
}
