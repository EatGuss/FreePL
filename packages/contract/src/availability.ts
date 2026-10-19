/** Status codes and their meaning come from docs/fpl-domain.md ("Player status"). */
export const STATUS_LABEL = {
  a: "Available",
  d: "Doubtful",
  i: "Injured",
  s: "Suspended",
  u: "Unavailable",
  n: "Not eligible",
} as const;

export type StatusCode = keyof typeof STATUS_LABEL;

export type Availability =
  | { level: "available" }
  | { level: "doubtful"; chance: number | null; label: string }
  | { level: "out"; label: string };

export function isStatusCode(s: string): s is StatusCode {
  return s in STATUS_LABEL;
}

/** Spec 0002: d shows with a warning; i/s/u/n are hidden by default. */
export function availabilityFor(status: StatusCode, chanceNextRound: number | null): Availability {
  if (status === "a") return { level: "available" };
  if (status === "d") return { level: "doubtful", chance: chanceNextRound, label: STATUS_LABEL.d };
  return { level: "out", label: STATUS_LABEL[status] };
}

export function hiddenByDefault(status: StatusCode): boolean {
  return availabilityFor(status, null).level === "out";
}
