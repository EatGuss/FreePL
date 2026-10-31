import { useEffect } from "react";
import { BAND_LABEL, MIN_MINUTES, ordinal, type PickRating, type PlayerRow, type PositionRow } from "@freepl/contract";

/**
 * The band word for cards and rows. Unrated is almost always low minutes (an injured player
 * with the minutes is still rated; an Unavailable one is not), so the minutes are what it shows.
 */
export function bandWord(player: PlayerRow, rating: PickRating | null): string {
  if (!rating) return "";
  if (rating.rated) return BAND_LABEL[rating.band];
  return player.minutes !== null && player.minutes < MIN_MINUTES ? `Not rated · ${player.minutes} min` : "Not rated";
}

/** Band chip for the Players table; the word always shows (never colour alone). */
export function RatingChip({ rating, onOpen }: { rating: PickRating; onOpen: () => void }) {
  if (!rating.rated) {
    return <button type="button" className="band none" title={rating.reason} onClick={onOpen}>—</button>;
  }
  return <button type="button" className={`band ${rating.band}`} onClick={onOpen}>{BAND_LABEL[rating.band]}</button>;
}

/**
 * Bottom sheet showing how a rating was reached (spec 0005): each input's rank among rated
 * players in the position, a bar, its weight, and the overall rank. Escape or tapping
 * outside closes it.
 */
export function RatingSheet({ player, rating, position, onClose }: {
  player: PlayerRow; rating: PickRating; position: PositionRow | undefined; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`Why ${player.webName} is rated this way`}
        onClick={(e) => e.stopPropagation()}>
        <h2>{player.webName}</h2>
        {rating.rated ? (
          <>
            <div className="sub">
              <b>{BAND_LABEL[rating.band]}</b> · {rating.ruledOut ? "would be " : ""}{ordinal(rating.rank)} of {rating.of} rated {position?.plural ?? rating.positionShort}
            </div>
            {rating.ruledOut && (
              <div className="sub">Ruled out, so rated against the {rating.of} available without taking a place among them, with no credit for fixtures, and left out of Picks.</div>
            )}
            <div className="bars">
              {rating.inputs.map((i) => (
                <div className="bar" key={i.key}>
                  <span>{i.label} <span className="w">×{i.weight}</span></span>
                  <span className="track"><span className="fill" style={{ width: `${Math.round(i.percentile * 100)}%` }} /></span>
                  <span className="pct">{ordinal(i.rank)}</span>
                </div>
              ))}
            </div>
            <div className="sub">
              {rating.inputs.map((i) => `${i.label} ${i.display}`).join(" · ")}. Longer bar = better within the
              position. A browsing aid, not a points projection.
            </div>
          </>
        ) : (
          <div className="sub">Not rated: {rating.reason}.</div>
        )}
        <button type="button" className="chip close" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
