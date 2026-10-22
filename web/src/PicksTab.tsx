import { memo, useMemo, useState } from "react";
import {
  BAND_LABEL, FIXTURE_GAMEWEEKS, buildTicker, pickRatingFor, tickerWindow,
  type Band, type FixturesResponse, type PickRating, type PlayerRow, type PlayersResponse, type RatingContext, type TickerCell,
} from "@freepl/contract";
import { FixtureCell } from "./FixtureChip.js";
import { Flag } from "./Flag.js";
import type { Filters } from "./filters.js";
import { formatPrice } from "./format.js";

const PRICE_STEP = 5;
const SHOWN: Band[] = ["best", "great", "good"];

type Rated = { player: PlayerRow; rating: Extract<PickRating, { rated: true }> };

/**
 * Spec 0005 Picks: one table per position of rated players (OK or better) ordered by score,
 * rows tinted by band with the band word on the second line, next 3 fixtures, then that
 * position's other rating inputs as raw values. Tapping a row opens the breakdown.
 */
export function PicksTab({ players, fixtures, ratings, filters, update, now, onOpen }: {
  players: PlayersResponse; fixtures: FixturesResponse; ratings: RatingContext; filters: Filters;
  update: (p: Partial<Filters>) => void; now: number; onOpen: (playerId: number) => void;
}) {
  const [openOk, setOpenOk] = useState<Record<number, boolean>>({});
  const clubById = useMemo(() => new Map(fixtures.clubs.map((c) => [c.id, c])), [fixtures]);
  const nextGws = useMemo(() => tickerWindow(fixtures.gameweeks, FIXTURE_GAMEWEEKS, now), [fixtures, now]);
  const cellsByClub = useMemo(() => {
    const t = buildTicker(fixtures.clubs, fixtures.fixtures, nextGws);
    return new Map(t.rows.map((r) => [r.club.id, r.cells]));
  }, [fixtures, nextGws]);

  const hi = useMemo(() => Math.ceil(Math.max(...players.players.map((p) => p.nowCost)) / PRICE_STEP) * PRICE_STEP, [players]);
  const lo = useMemo(() => Math.floor(Math.min(...players.players.map((p) => p.nowCost)) / PRICE_STEP) * PRICE_STEP, [players]);
  const atMax = filters.budget === null || filters.budget >= hi;

  const byPosition = useMemo(() => {
    const out = new Map<number, Rated[]>();
    for (const p of players.players) {
      const r = pickRatingFor(p, ratings);
      if (!r.rated || r.band === "below") continue;
      const list = out.get(p.positionId) ?? [];
      list.push({ player: p, rating: r });
      out.set(p.positionId, list);
    }
    for (const list of out.values()) list.sort((a, b) => b.rating.score - a.rating.score);
    return out;
  }, [players, ratings]);

  return (
    <section className="flex flex-col gap-2.5">
      <div className="price-row">
        <label htmlFor="budget">Budget</label>
        <input id="budget" type="range" min={lo} max={hi} step={PRICE_STEP} value={atMax ? hi : filters.budget!}
          onChange={(e) => { const v = Number(e.target.value); update({ budget: v >= hi ? null : v }); }} />
        <output htmlFor="budget">{atMax ? "Any" : formatPrice(filters.budget!)}</output>
      </div>
      <div className="legend">
        <span>Row colour:</span>
        {(["best", "great", "good", "ok"] as Band[]).map((b) => <span key={b} className={`band ${b}`}>{BAND_LABEL[b]}</span>)}
        <span>· tap a player to see why</span>
      </div>
      <div className="legend">
        <span>Fixtures, easy to hard:</span>
        {[1, 2, 3, 4, 5].map((d) => <span key={d} className={`fxc d${d}`}>{d}</span>)}
        <span>· H home, A away</span>
      </div>

      <div className="picks">
        {players.positions.map((pos) => {
          const all = (byPosition.get(pos.id) ?? []).filter((r) => atMax || r.player.nowCost <= filters.budget!);
          const top = all.filter((r) => SHOWN.includes(r.rating.band));
          const ok = all.filter((r) => r.rating.band === "ok");
          const rows = openOk[pos.id] ? all : top;
          const inputs = all[0]?.rating.inputs.filter((i) => i.key !== "fixtures") ?? [];
          return (
            <div className="pos-block" key={pos.id}>
              <h2>{pos.plural} <span>{top.length} rated{ok.length ? `, ${ok.length} OK` : ""}</span></h2>
              {all.length === 0 ? (
                <div className="empty">No rated {pos.plural.toLowerCase()} within this budget.</div>
              ) : (
                <div className="table-box">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Player</th>
                        {nextGws.map((g) => <th key={g.id} scope="col" style={{ textAlign: "center" }}>GW{g.id}</th>)}
                        {inputs.map((i) => <th key={i.key} scope="col">{i.label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <PickRow key={r.player.id} item={r} clubShort={clubById.get(r.player.clubId)?.short ?? "?"}
                          cells={cellsByClub.get(r.player.clubId) ?? []} clubById={clubById} onOpen={onOpen} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {ok.length > 0 && (
                <button className="linkish" style={{ alignSelf: "flex-start" }}
                  onClick={() => setOpenOk((o) => ({ ...o, [pos.id]: !o[pos.id] }))}>
                  {openOk[pos.id] ? "Hide OK" : `Show ${ok.length} OK`}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="subrow">
        <span>Ratings rank players within their position on underlying stats, fixtures and nailedness. Not a points projection.</span>
      </div>
    </section>
  );
}

const PickRow = memo(function PickRow({ item, clubShort, cells, clubById, onOpen }: {
  item: Rated; clubShort: string; cells: TickerCell[]; clubById: Map<number, import("@freepl/contract").ClubRow>; onOpen: (id: number) => void;
}) {
  const { player: p, rating } = item;
  return (
    <tr className={`row-${rating.band} tap`} tabIndex={0} onClick={() => onOpen(p.id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(p.id); } }}>
      <td>
        <div className="pname"><span className="nm">{p.webName}</span><Flag player={p} /></div>
        <div className="pmeta"><span className="bandword">{BAND_LABEL[rating.band]}</span> · {clubShort} · <b>{formatPrice(p.nowCost)}</b></div>
      </td>
      {cells.map((c) => <td key={c.gameweek} className="fx"><FixtureCell fixtures={c.fixtures} clubById={clubById} /></td>)}
      {rating.inputs.filter((i) => i.key !== "fixtures").map((i) => <td key={i.key}>{i.display}</td>)}
    </tr>
  );
});
