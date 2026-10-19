import type { PlayerRow } from "@freepl/contract";
import { f1, f2, formatPrice, int, kfmt } from "./format.js";
import type { GroupKey } from "./filters.js";

export interface StatColumn {
  id: string;
  label: string;
  value: (p: PlayerRow) => number | null;
  format: (v: number | null) => string;
  strong?: boolean;
}

const col = (id: string, label: string, value: StatColumn["value"], format: StatColumn["format"], strong = false): StatColumn =>
  ({ id, label, value, format, strong });

/** After the pinned player cell, always: xP next, then price (spec 0002 "Table"). */
export const FIXED_COLUMNS: StatColumn[] = [
  col("epNext", "xP next", (p) => p.epNext, f1, true),
  col("nowCost", "Price", (p) => p.nowCost, (v) => (v === null ? "—" : formatPrice(v))),
];

export const GROUPS: Record<GroupKey, StatColumn[]> = {
  Overview: [
    col("totalPoints", "Pts", (p) => p.totalPoints, int),
    col("form", "Form", (p) => p.form, f1),
    col("pointsPerGame", "PPG", (p) => p.pointsPerGame, f1),
    col("minutes", "Mins", (p) => p.minutes, int),
    col("starts", "Starts", (p) => p.starts, int),
  ],
  Attack: [
    col("goals", "G", (p) => p.goals, int),
    col("assists", "A", (p) => p.assists, int),
    col("xG", "xG", (p) => p.xG, f2),
    col("xA", "xA", (p) => p.xA, f2),
    col("xGPer90", "xG/90", (p) => p.xGPer90, f2),
    col("xAPer90", "xA/90", (p) => p.xAPer90, f2),
  ],
  Defence: [
    col("cleanSheets", "CS", (p) => p.cleanSheets, int),
    col("goalsConceded", "GC", (p) => p.goalsConceded, int),
    col("xGCPer90", "xGC/90", (p) => p.xGCPer90, f2),
    col("saves", "Saves", (p) => p.saves, int),
    col("defensiveContributionPer90", "DefCon/90", (p) => p.defensiveContributionPer90, f1),
  ],
  Expected: [
    col("epNextX", "xP next", (p) => p.epNext, f1),
    col("epThis", "xP this", (p) => p.epThis, f1),
    col("formX", "Form", (p) => p.form, f1),
  ],
  Value: [
    col("selectedByPercent", "Sel %", (p) => p.selectedByPercent, f1),
    col("transfersInEvent", "In", (p) => p.transfersInEvent, kfmt),
    col("transfersOutEvent", "Out", (p) => p.transfersOutEvent, kfmt),
    col("bonus", "Bonus", (p) => p.bonus, int),
  ],
};
