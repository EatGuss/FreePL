import { describe, expect, it } from "vitest";
import { ContractError, MODEL_MANAGES_FROM, ScorecardResponse, buildScorecardResponse, median, seasonFromGw1Deadline } from "../src/index.js";

// Rows as postgres.js returns the 0008 views: int8, count(*) and numeric as strings, timestamptz as
// Date. The numbers are the owner's GW1–9 of 2026/27 as the views returned them on 2026-11-07.
const at = (iso: string) => new Date(iso);
const deadlines = ["2026-08-14T17:30Z", "2026-08-22T10:00Z", "2026-08-29T10:00Z", "2026-09-12T10:00Z", "2026-09-19T10:00Z",
  "2026-09-26T10:00Z", "2026-10-17T10:00Z", "2026-10-23T17:30Z", "2026-10-31T11:00Z", "2026-11-06T18:30Z"];
const captures: Record<number, [string, string]> = {
  7: ["2026-10-17T09:15:48Z", "11104892"], 8: ["2026-10-23T17:07:15Z", "11155804"], 9: ["2026-10-31T10:07:19Z", "11207332"],
  10: ["2026-11-06T18:07:17Z", "11249056"],
};
const gameweeks = deadlines.map((d, i) => {
  const gw = i + 1;
  const c = captures[gw];
  return {
    gameweek: gw, deadline_time: at(d), capture_id: c ? String(100 + gw) : null, captured_at: c ? at(c[0]) : null,
    total_players: c ? c[1] : null, live_id: gw <= 9 ? String(200 + gw) : null,
  };
});
const proj = (gameweek: number, players: string, mae: string, mismatches = "0") => ({
  gameweek, source: "fpl_ep_next", deadline_time: at(deadlines[gameweek - 1]!), captured_at: at(captures[gameweek]![0]),
  players_counted: players, mae, added_after_deadline: "1", no_projection: "0", explain_mismatches: mismatches,
});
const projections = [proj(7, "375", "2.282"), proj(8, "361", "2.398"), proj(9, "373", "1.818")];
const entryRows: [number, number, string, string, number, string | null][] = [
  [1, 72, "398657", "398656", 5, null], [2, 122, "107082", "26228", 5, null], [3, 45, "7512509", "97993", 75, null],
  [4, 86, "1437717", "109108", 15, null], [5, 43, "6966832", "218731", 65, null], [6, 81, "518589", "104878", 5, null],
  [7, 73, "1574502", "98607", 15, "14.2"], [8, 46, "5376992", "121621", 50, "48.2"], [9, 64, "1125317", "104118", 15, "10.0"],
];
const entry = entryRows.map(([gameweek, points, gw_rank, overall_rank, band, pct]) => ({
  gameweek, entry_id: "436573", points, gw_rank, overall_rank, fpl_percentile_band: band,
  total_players: captures[gameweek]?.[1] ?? null, gw_percentile: pct,
}));
const raw = { gameweeks, projections, entry };

describe("buildScorecardResponse", () => {
  const r = buildScorecardResponse(raw, null);

  it("validates against its own schema", () => {
    expect(ScorecardResponse.parse(r)).toEqual(r);
  });
  it("names the season from GW1's deadline, and the Entry", () => {
    expect(r.meta).toEqual({ season: "2026-27", entryId: 436573, modelManagesFrom: null });
    expect(seasonFromGw1Deadline("2030-08-16T17:30:00Z")).toBe("2030-31");
  });
  it("shows settled gameweeks and the Entry's history only: GW1–9, not GW10", () => {
    expect(r.gameweeks.map((g) => g.gameweek)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it("shows no capture and no percentile for GW1–6, FPL's band still beside it", () => {
    const g3 = r.gameweeks[2]!;
    expect(g3).toMatchObject({ capturedAt: null, settled: true, projections: [] });
    expect(g3.entry).toMatchObject({ gwRank: 7512509, gwPercentile: null, fplPercentileBand: 75 });
  });
  it("reads each scored gameweek's capture time and projection", () => {
    expect(r.gameweeks[8]).toMatchObject({
      capturedAt: "2026-10-31T10:07:19.000Z",
      projections: [{ source: "fpl_ep_next", playersCounted: 373, mae: 1.818, addedAfterDeadline: 1, noProjection: 0, flagged: false }],
      entry: { points: 64, gwPercentile: 10, fplPercentileBand: 15, managedBy: "hand" },
    });
  });
  it("pools cumulative MAE over every counted player-gameweek", () => {
    // (2.282·375 + 2.398·361 + 1.818·373) / 1109 = 2.1637…
    expect(r.summary.projections).toEqual([{ source: "fpl_ep_next", modelVersion: null, gameweeks: 3, players: 1109, mae: 2.164 }]);
  });
  it("adds the decision log's sources beside ep_next, each scored only on its own gameweeks (spec 0009)", () => {
    // The 0009 view: model_version as a last column; last5 logged for GW9 only (synthetic numbers).
    const withVersion = projections.map((p) => ({ ...p, model_version: null }));
    const last5 = { ...proj(9, "380", "1.950"), source: "last5", model_version: "1" };
    const m = buildScorecardResponse({ ...raw, projections: [last5, ...withVersion] }, null);
    expect(m.summary.projections.map((p) => [p.source, p.modelVersion, p.gameweeks, p.mae])).toEqual([
      ["fpl_ep_next", null, 3, 2.164], ["last5", "1", 1, 1.95],
    ]);
    expect(m.gameweeks[8]!.projections.map((p) => [p.source, p.modelVersion, p.playersCounted])).toEqual([
      ["last5", "1", 380], ["fpl_ep_next", null, 373],
    ]);
    expect(m.gameweeks[7]!.projections.map((p) => p.source)).toEqual(["fpl_ep_next"]);
  });
  it("counts every gameweek as managed by hand while MODEL_MANAGES_FROM is null (Q99)", () => {
    expect(MODEL_MANAGES_FROM).toBeNull();
    expect(r.summary.entry).toEqual({ modelGameweeks: 0, handGameweeks: 9, medianGwPercentile: null });
  });
  it("takes the median over the model's gameweeks only", () => {
    const m = buildScorecardResponse(raw, { season: "2026-27", gameweek: 8 });
    expect(m.gameweeks.map((g) => g.entry!.managedBy)).toEqual(["hand", "hand", "hand", "hand", "hand", "hand", "hand", "model", "model"]);
    expect(m.summary.entry).toEqual({ modelGameweeks: 2, handGameweeks: 7, medianGwPercentile: 29.1 });
    // A takeover in an earlier season makes every gameweek of this one the model's.
    expect(buildScorecardResponse(raw, { season: "2025-26", gameweek: 30 }).summary.entry.handGameweeks).toBe(0);
  });
  it("does not score a gameweek whose points disagree with their breakdown", () => {
    const f = buildScorecardResponse({ ...raw, projections: [proj(7, "375", "2.282"), proj(8, "361", "2.398", "2"), proj(9, "373", "1.818")] }, null);
    expect(f.gameweeks[7]!.projections[0]).toMatchObject({ flagged: true, mae: null });
    expect(f.summary.projections[0]).toMatchObject({ gameweeks: 2, players: 748 });
  });
  it("fails loudly on a malformed row", () => {
    expect(() => buildScorecardResponse({ ...raw, projections: [{ ...projections[0], mae: "n/a" }] }, null)).toThrow(ContractError);
  });
});

describe("median", () => {
  it("handles odd, even and empty", () => {
    expect([median([3, 1, 2]), median([4, 1, 3, 2]), median([])]).toEqual([2, 2.5, null]);
  });
});
