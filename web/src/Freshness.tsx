import { ageHours, freshnessLevel } from "@freepl/contract";
import { localDateTime } from "./format.js";

/** The stats table's share of the dead-man's switch: stale data is amber/red, never hidden. */
export function Freshness({ capturedAt, now }: { capturedAt: string; now: number }) {
  const hours = ageHours(capturedAt, now);
  const level = freshnessLevel("bootstrap", hours);
  const n = Math.floor(hours);
  return (
    <div className={`fresh ${level === "fresh" ? "" : level}`} role="status">
      <span className="dot" aria-hidden="true" />
      <span>
        Data as of {localDateTime(capturedAt)}, <b>{n === 1 ? "1 hour" : `${n} hours`} ago</b>
        {level === "red" ? " · snapshot job may be down" : level === "amber" ? " · older than usual" : ""}
      </span>
    </div>
  );
}
