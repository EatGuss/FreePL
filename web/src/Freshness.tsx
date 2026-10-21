import { ageHours, freshnessLevel, type FreshnessLevel, type Source } from "@freepl/contract";
import { localDateTime } from "./format.js";

const RANK: Record<FreshnessLevel, number> = { fresh: 0, amber: 1, red: 2 };
const LABEL: Record<Source, string> = { bootstrap: "Data", fixtures: "Fixtures" };

/**
 * The page's share of the dead-man's switch: stale data is amber/red, never hidden. With
 * several sources it shows the one in the worst state against its own thresholds (spec
 * 0003), the oldest on a tie.
 */
export function Freshness({ sources, now }: { sources: Partial<Record<Source, string>>; now: number }) {
  const shown = (Object.entries(sources) as [Source, string][])
    .map(([source, capturedAt]) => {
      const hours = ageHours(capturedAt, now);
      return { source, capturedAt, hours, level: freshnessLevel(source, hours) };
    })
    .sort((a, b) => RANK[b.level] - RANK[a.level] || b.hours - a.hours)[0];
  if (!shown) return null;
  const { source, capturedAt, hours, level } = shown;
  const n = Math.floor(hours);
  return (
    <div className={`fresh ${level === "fresh" ? "" : level}`} role="status">
      <span className="dot" aria-hidden="true" />
      <span>
        {LABEL[source]} as of {localDateTime(capturedAt)}, <b>{n === 1 ? "1 hour" : `${n} hours`} ago</b>
        {level === "red" ? " · snapshot job may be down" : level === "amber" ? " · older than usual" : ""}
      </span>
    </div>
  );
}
