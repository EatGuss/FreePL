import { useContext } from "react";
import type { PlayerRow } from "@freepl/contract";
import { ShortlistContext } from "./shortlist.js";

/** Shortlist toggle (spec 0006). Never opens the row it sits in. */
export function Star({ player }: { player: PlayerRow }) {
  const sl = useContext(ShortlistContext);
  if (!sl) return null;
  const on = sl.has(player.id);
  const label = on ? `Remove ${player.webName} from shortlist` : `Add ${player.webName} to shortlist`;
  return (
    <button type="button" className={on ? "star on" : "star"} aria-pressed={on} aria-label={label} title={label}
      onClick={(e) => { e.stopPropagation(); sl.toggle(player.id); }}
      onKeyDown={(e) => e.stopPropagation()}>
      {on ? "★" : "☆"}
    </button>
  );
}
