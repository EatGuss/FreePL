import { useContext, useMemo, useState } from "react";
import {
  BAND_LABEL, FIXTURE_GAMEWEEKS, buildTicker, evaluatePlan, formatPrice, pickRatingFor, startPlan, tickerWindow,
  type FixturesResponse, type PlayerRow, type PlayersResponse, type RatingContext,
} from "@freepl/contract";
import { FixtureCell } from "./FixtureChip.js";
import { readRememberedEntry, useEntry } from "./data.js";
import { Flag } from "./Flag.js";
import type { Filters } from "./filters.js";
import { ShortlistContext } from "./shortlist.js";
import { Star } from "./Star.js";

const money = (t: number) => (t < 0 ? `−${formatPrice(-t)}` : formatPrice(t));

/**
 * Spec 0006 Shortlist tab: starred players per position, like Picks but every band shown
 * (Below OK and Not rated too, since you chose them). Works with no Entry; with one loaded,
 * "Affordable if I sell…" shows the bank after each swap, worked out as the Replace sheet
 * does from the bank after the Plan (Q89).
 */
export function ShortlistTab({ players, fixtures, ratings, filters, now, onOpen }: {
  players: PlayersResponse; fixtures: FixturesResponse; ratings: RatingContext | null; filters: Filters;
  now: number; onOpen: (playerId: number) => void;
}) {
  const sl = useContext(ShortlistContext);
  const [remembered] = useState(readRememberedEntry);
  const entryId = filters.entry ?? remembered;
  const entry = useEntry(entryId, entryId !== null);
  const view = entry.data?.view ?? null;
  const [sellId, setSellId] = useState<number | null>(null);

  const byId = useMemo(() => new Map(players.players.map((p) => [p.id, p])), [players]);
  const clubById = useMemo(() => new Map(fixtures.clubs.map((c) => [c.id, c])), [fixtures]);
  const nextGws = useMemo(() => tickerWindow(fixtures.gameweeks, FIXTURE_GAMEWEEKS, now), [fixtures, now]);
  const cellsByClub = useMemo(() => {
    const t = buildTicker(fixtures.clubs, fixtures.fixtures, nextGws);
    return new Map(t.rows.map((r) => [r.club.id, r.cells]));
  }, [fixtures, nextGws]);

  // Part 1 has no saved Plan yet, so the bank after the Plan is the bank after an empty one.
  const bank = useMemo(
    () => (view ? evaluatePlan(view, startPlan(view), players.players, players.positions).bank : null),
    [view, players],
  );
  const owned = useMemo(() => new Set(view?.squad.map((s) => s.playerId) ?? []), [view]);
  const sellSlot = view?.squad.find((s) => s.playerId === sellId) ?? null;
  const sellPlayer = sellSlot ? byId.get(sellSlot.playerId) : undefined;

  const ids = sl?.ids ?? [];
  const shortlisted = ids.map((id) => byId.get(id)).filter((p): p is PlayerRow => !!p);
  const score = (p: PlayerRow) => { const r = ratings ? pickRatingFor(p, ratings) : null; return r?.rated ? r.score : -1; };

  if (!shortlisted.length) {
    return <p className="notice">No players shortlisted yet. Tap ☆ beside a player in Picks, Players or the Replace sheet.</p>;
  }

  return (
    <section className="flex flex-col gap-2.5">
      {view ? (
        <div className="price-row">
          <label htmlFor="sell">Affordable if I sell</label>
          <select id="sell" className="numin" style={{ width: "auto", flex: 1, minWidth: 0 }} value={sellId ?? ""}
            onChange={(e) => setSellId(e.target.value === "" ? null : Number(e.target.value))}>
            <option value="">Choose a Squad player</option>
            {players.positions.map((pos) => (
              <optgroup key={pos.id} label={pos.plural}>
                {view.squad.map((s) => byId.get(s.playerId)).filter((p): p is PlayerRow => p?.positionId === pos.id).map((p) => {
                  const sp = view.squad.find((s) => s.playerId === p.id)!.sellPrice;
                  return <option key={p.id} value={p.id}>{p.webName}{sp !== null ? ` · sells ${formatPrice(sp)}` : ""}</option>;
                })}
              </optgroup>
            ))}
          </select>
        </div>
      ) : (
        <div className="subrow"><span>Load your team in My squad to see what you could afford by selling a player.</span></div>
      )}
      {sellPlayer && (
        <div className="subrow">
          <span>
            {sellSlot!.sellPrice !== null && bank !== null
              ? <>{sellPlayer.webName} sells for <b>{formatPrice(sellSlot!.sellPrice)}</b> · bank now {money(bank)}</>
              : "Sell price unknown, so the bank after each swap can't be shown."}
          </span>
        </div>
      )}

      <div className="picks">
        {players.positions.map((pos) => {
          const rows = shortlisted.filter((p) => p.positionId === pos.id)
            .sort((a, b) => score(b) - score(a) || a.webName.localeCompare(b.webName));
          if (!rows.length) return null;
          const swapping = sellPlayer?.positionId === pos.id && sellSlot!.sellPrice !== null && bank !== null;
          return (
            <div className="pos-block" key={pos.id}>
              <h2>{pos.plural} <span>{rows.length} shortlisted</span></h2>
              <div className="table-box">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Player</th>
                      {swapping && <th scope="col">Bank after</th>}
                      {nextGws.map((g) => <th key={g.id} scope="col" style={{ textAlign: "center" }}>GW{g.id}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => {
                      const r = ratings ? pickRatingFor(p, ratings) : null;
                      const band = r?.rated ? r.band : null;
                      const after = swapping ? bank! + sellSlot!.sellPrice! - p.nowCost : null;
                      const open = () => { if (ratings) onOpen(p.id); };
                      return (
                        <tr key={p.id} className={band && band !== "below" ? `row-${band} tap` : "tap"} tabIndex={0} onClick={open}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}>
                          <td>
                            <div className="pname">
                              <Star player={p} /><span className="nm">{p.webName}</span><Flag player={p} />
                              {owned.has(p.id) && <span className="tag">In squad</span>}
                            </div>
                            <div className="pmeta">
                              <span className="bandword">{r === null ? "" : r.rated ? BAND_LABEL[r.band] : "Not rated"}</span>
                              {r !== null && " · "}{clubById.get(p.clubId)?.short ?? "?"} · <b>{formatPrice(p.nowCost)}</b>
                            </div>
                          </td>
                          {swapping && (
                            <td className="num-strong" style={after! < 0 ? { color: "var(--bad)" } : undefined}>{money(after!)}</td>
                          )}
                          {(cellsByClub.get(p.clubId) ?? []).map((c) => (
                            <td key={c.gameweek} className="fx"><FixtureCell fixtures={c.fixtures} clubById={clubById} /></td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
