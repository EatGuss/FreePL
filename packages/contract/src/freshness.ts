/**
 * Freshness thresholds derive from spec 0001's routine capture interval per source:
 * amber above interval + 2h, red above 2 × interval. Pulling spec 0001's storage lever
 * (bootstrap routine 11h → 23h) is a one-constant change here.
 */
export const ROUTINE_INTERVAL_HOURS = { bootstrap: 11, fixtures: 23 } as const;
export type Source = keyof typeof ROUTINE_INTERVAL_HOURS;
export type FreshnessLevel = "fresh" | "amber" | "red";

export function thresholdsFor(source: Source): { amberAfter: number; redAfter: number } {
  const h = ROUTINE_INTERVAL_HOURS[source];
  return { amberAfter: h + 2, redAfter: 2 * h };
}

/** Age is two instants subtracted — no timezone handling involved. */
export function ageHours(capturedAtIso: string, nowMs: number = Date.now()): number {
  const t = Date.parse(capturedAtIso);
  if (Number.isNaN(t)) throw new Error(`invalid capturedAt: ${capturedAtIso}`);
  return Math.max(0, (nowMs - t) / 3_600_000);
}

export function freshnessLevel(source: Source, hours: number): FreshnessLevel {
  const { amberAfter, redAfter } = thresholdsFor(source);
  if (hours > redAfter) return "red";
  if (hours > amberAfter) return "amber";
  return "fresh";
}
