import { availabilityFor, type PlayerRow } from "@freepl/contract";

/** Availability badge: amber "75%" for doubtful, red short label for out. Never colour alone. */
export function Flag({ player, long = false, onClick }: { player: PlayerRow; long?: boolean; onClick?: () => void }) {
  const a = availabilityFor(player.status, player.chanceNextRound);
  if (a.level === "available") return null;
  const text = a.level === "doubtful" ? (a.chance === null ? "?" : `${a.chance}%`) : long ? a.label : a.label.slice(0, 3).toUpperCase();
  const title = `${a.label}${player.news ? `: ${player.news}` : ""}`;
  const cls = `flag ${a.level === "doubtful" ? "d" : "x"}`;
  return onClick ? (
    <button type="button" className={cls} title={title} aria-label={title} onClick={onClick}>{text}</button>
  ) : (
    <span className={cls} title={title}>{text}</span>
  );
}
