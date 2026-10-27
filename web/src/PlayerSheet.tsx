import { useEffect } from "react";
import {
  BAND_LABEL, formatPrice, type ClubRow, type PickRating, type PlayerRow, type PositionRow, type SquadSlot, type TickerCell,
} from "@freepl/contract";
import { FixtureCell } from "./FixtureChip.js";
import { Flag } from "./Flag.js";
import { f1, f2, int } from "./format.js";

/**
 * Player sheet (docs/design.md): eight stat tiles, the next 3 fixtures and the rating, for a
 * Squad player. Move and Replace arrive with the what-if (spec 0004 part 2).
 */
export function PlayerSheet({ player, slot, club, position, cells, gwIds, clubById, rating, onWhy, onClose }: {
  player: PlayerRow; slot: SquadSlot | undefined; club: ClubRow | undefined; position: PositionRow | undefined;
  cells: TickerCell[]; gwIds: number[]; clubById: Map<number, ClubRow>; rating: PickRating | null;
  onWhy: () => void; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const money = [
    slot?.sellPrice != null ? `Sells ${formatPrice(slot.sellPrice)}` : null,
    slot?.purchasePrice != null ? `bought ${formatPrice(slot.purchasePrice)}${slot.purchaseSource === "launch" ? " (launch)" : ""}` : null,
    `now ${formatPrice(player.nowCost)}`,
  ].filter(Boolean).join(" · ");
  const tiles: [string, string][] = [
    ["Pts", int(player.totalPoints)], ["Form", f1(player.form)], ["xP next", f1(player.epNext)], ["Mins", int(player.minutes)],
    ["xG/90", f2(player.xGPer90)], ["xA/90", f2(player.xAPer90)], ["DefCon/90", f1(player.defensiveContributionPer90)], ["Sel %", f1(player.selectedByPercent)],
  ];

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={player.webName} onClick={(e) => e.stopPropagation()}>
        <h2 className="flex items-center gap-2">{player.webName} <Flag player={player} long /></h2>
        <div className="sub">{club?.name} · {position?.short} · {money}</div>
        {player.news && <div className="sub">{player.news}</div>}
        <div className="pstats">{tiles.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div>
        <div className="pfx">
          {cells.map((c, i) => (
            <div key={c.gameweek}>GW{gwIds[i]}<FixtureCell fixtures={c.fixtures} clubById={clubById} /></div>
          ))}
        </div>
        <div className="sub">
          {rating?.rated
            ? <>Pick rating: <b>{BAND_LABEL[rating.band]}</b> · </>
            : <>Pick rating: not rated · </>}
          <button className="linkish" onClick={onWhy}>Why?</button>
        </div>
        <button type="button" className="chip close" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
