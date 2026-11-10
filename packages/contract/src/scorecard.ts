import { z } from "zod";
import { fplDecimal, fplInt } from "./decimal.js";
import { parseAll } from "./response.js";
import { instant } from "./rows.js";

/**
 * Spec 0008: the scorecard. Raw rows from db/views/0008_scorecard.sql → ScorecardResponse.
 * Projections are scored against settled points (MAE); the Entry is judged on its exact
 * gameweek rank percentile, counting only the gameweeks the model managed (Q99, Q101).
 */

/**
 * The first gameweek the model manages the Entry: `null` until it takes over (spec 0008 Q99).
 * Changing it is a commit, so the takeover has a public, dated record. Every gameweek before
 * it is "managed by hand" and never counts towards the model's results.
 */
export const MODEL_MANAGES_FROM: { season: string; gameweek: number } | null = null;

/** count(*) and int8 arrive as strings from postgres.js; never null here. */
const count = z.union([z.string().regex(/^\d+$/), z.number().int()]).transform(Number);
const bigint = count.nullable();

export const RawScorecardGameweek = z.object({
  gameweek: z.number().int(),
  deadline_time: instant,
  capture_id: bigint,
  captured_at: instant.nullable(),
  total_players: bigint,
  live_id: bigint,
});

export const RawScorecardProjection = z.object({
  gameweek: z.number().int(),
  source: z.string(),
  deadline_time: instant,
  captured_at: instant,
  players_counted: count,
  mae: fplDecimal,
  added_after_deadline: count,
  no_projection: count,
  explain_mismatches: count,
  /** null for ep_next; absent until db/views/0009_scorecard_projections.sql is applied. */
  model_version: z.string().nullable().optional(),
});

export const RawScorecardEntry = z.object({
  gameweek: z.number().int(),
  entry_id: z.string().nullable(),
  points: fplInt,
  gw_rank: bigint,
  overall_rank: bigint,
  fpl_percentile_band: fplInt,
  total_players: bigint,
  gw_percentile: fplDecimal,
});

export interface RawScorecardRows {
  gameweeks: unknown[];
  projections: unknown[];
  entry: unknown[];
}

const projection = z.object({
  /** "fpl_ep_next", or a model in the decision log such as "last5" (spec 0009). */
  source: z.string(),
  modelVersion: z.string().nullable(),
  playersCounted: z.number().int(),
  /** null when flagged or when no player was counted. */
  mae: z.number().nullable(),
  addedAfterDeadline: z.number().int(),
  noProjection: z.number().int(),
  /** Some player's total_points is not the sum of his explain points: not scored. */
  flagged: z.boolean(),
});

const entryRow = z.object({
  points: z.number().int().nullable(),
  gwRank: z.number().int().nullable(),
  overallRank: z.number().int().nullable(),
  /** FPL's percentile_rank: rank / players rounded up to the next 5 (docs/fpl-domain.md). */
  fplPercentileBand: z.number().int().nullable(),
  /** Exact: rank / the deadline capture's total_players, one decimal; null with no capture. */
  gwPercentile: z.number().nullable(),
  managedBy: z.enum(["hand", "model"]),
});

export const ScorecardGameweek = z.object({
  gameweek: z.number().int(),
  deadlineTime: z.string(),
  /** The capture the projection was read from; null = no capture before this deadline. */
  capturedAt: z.string().nullable(),
  settled: z.boolean(),
  projections: z.array(projection),
  entry: entryRow.nullable(),
});
export type ScorecardGameweek = z.infer<typeof ScorecardGameweek>;

export const ScorecardResponse = z.object({
  meta: z.object({
    season: z.string().nullable(),
    entryId: z.number().int().nullable(),
    modelManagesFrom: z.object({ season: z.string(), gameweek: z.number().int() }).nullable(),
  }),
  gameweeks: z.array(ScorecardGameweek),
  summary: z.object({
    projections: z.array(z.object({
      source: z.string(), modelVersion: z.string().nullable(),
      gameweeks: z.number().int(), players: z.number().int(), mae: z.number().nullable(),
    })),
    entry: z.object({
      modelGameweeks: z.number().int(),
      handGameweeks: z.number().int(),
      /** Median exact gameweek percentile over the model's gameweeks; null before it has any. */
      medianGwPercentile: z.number().nullable(),
    }),
  }),
});
export type ScorecardResponse = z.infer<typeof ScorecardResponse>;

/** "2026-27" from GW1's deadline year, as spec 0001 labels a season. */
export function seasonFromGw1Deadline(gw1DeadlineIso: string): string {
  const y = new Date(gw1DeadlineIso).getUTCFullYear();
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Raw view rows → ScorecardResponse. Shows every gameweek that has settled or that the Entry's
 * history holds. Cumulative MAE pools every counted player-gameweek across unflagged gameweeks.
 */
export function buildScorecardResponse(
  raw: RawScorecardRows, modelManagesFrom: { season: string; gameweek: number } | null = MODEL_MANAGES_FROM,
): ScorecardResponse {
  const gws = parseAll(RawScorecardGameweek, raw.gameweeks, "scorecard gameweek");
  const projections = parseAll(RawScorecardProjection, raw.projections, "scorecard projection");
  const entries = parseAll(RawScorecardEntry, raw.entry, "scorecard entry");

  const gw1 = gws.find((g) => g.gameweek === 1);
  const season = gw1 ? seasonFromGw1Deadline(gw1.deadline_time) : null;
  const byModel = (gw: number) =>
    !!modelManagesFrom && season !== null &&
    (season > modelManagesFrom.season || (season === modelManagesFrom.season && gw >= modelManagesFrom.gameweek));
  const entryByGw = new Map(entries.map((e) => [e.gameweek, e]));

  const gameweeks: ScorecardGameweek[] = gws
    .filter((g) => g.live_id !== null || entryByGw.has(g.gameweek))
    .sort((a, b) => a.gameweek - b.gameweek)
    .map((g) => {
      const e = entryByGw.get(g.gameweek);
      return {
        gameweek: g.gameweek,
        deadlineTime: g.deadline_time,
        capturedAt: g.captured_at,
        settled: g.live_id !== null,
        projections: projections.filter((p) => p.gameweek === g.gameweek).map((p) => ({
          source: p.source,
          modelVersion: p.model_version ?? null,
          playersCounted: p.players_counted,
          mae: p.explain_mismatches > 0 ? null : p.mae,
          addedAfterDeadline: p.added_after_deadline,
          noProjection: p.no_projection,
          flagged: p.explain_mismatches > 0,
        })),
        entry: e ? {
          points: e.points, gwRank: e.gw_rank, overallRank: e.overall_rank, fplPercentileBand: e.fpl_percentile_band,
          gwPercentile: e.gw_percentile, managedBy: byModel(g.gameweek) ? "model" : "hand",
        } : null,
      };
    });

  // One summary per source and version (spec 0009 Q115): a version is scored only on its own
  // gameweeks. ep_next first, then the decision log's sources in name order.
  const keyOf = (p: { source: string; modelVersion: string | null }) => `${p.source}@${p.modelVersion ?? ""}`;
  const keys = new Map<string, { source: string; modelVersion: string | null }>();
  for (const p of projections) keys.set(keyOf({ source: p.source, modelVersion: p.model_version ?? null }), { source: p.source, modelVersion: p.model_version ?? null });
  const ordered = [...keys.values()].sort((a, b) =>
    Number(b.source === "fpl_ep_next") - Number(a.source === "fpl_ep_next") || keyOf(a).localeCompare(keyOf(b)));
  const summaryProjections = ordered.map((s) => {
    const scored = gameweeks.flatMap((g) => g.projections.filter((p) => keyOf(p) === keyOf(s) && p.mae !== null && p.playersCounted > 0));
    const players = scored.reduce((n, p) => n + p.playersCounted, 0);
    const mae = players ? Math.round((scored.reduce((t, p) => t + p.mae! * p.playersCounted, 0) / players) * 1000) / 1000 : null;
    return { ...s, gameweeks: scored.length, players, mae };
  });
  const withEntry = gameweeks.filter((g) => g.entry);
  const modelPercentiles = withEntry
    .filter((g) => g.entry!.managedBy === "model" && g.entry!.gwPercentile !== null)
    .map((g) => g.entry!.gwPercentile!);
  const entryId = entries.find((e) => e.entry_id !== null)?.entry_id;

  return {
    meta: { season, entryId: entryId ? Number(entryId) : null, modelManagesFrom },
    gameweeks,
    summary: {
      projections: summaryProjections,
      entry: {
        modelGameweeks: withEntry.filter((g) => g.entry!.managedBy === "model").length,
        handGameweeks: withEntry.filter((g) => g.entry!.managedBy === "hand").length,
        medianGwPercentile: median(modelPercentiles),
      },
    },
  };
}
