import { useMemo, useState, type FormEvent } from "react";
import {
  BAND_LABEL, CHIPS, CHIP_LABEL, FIXTURE_GAMEWEEKS, availabilityFor, buildTicker, formatPrice, pickRatingFor, tickerWindow,
  type FixturesResponse, type PlayerRow, type PlayersResponse, type RatingContext, type SquadSlot, type TickerCell,
} from "@freepl/contract";
import { FixtureCell } from "./FixtureChip.js";
import { Flag } from "./Flag.js";
import { PlayerSheet } from "./PlayerSheet.js";
import { EntryLoadError, useEntry } from "./data.js";
import { entryParam, type Filters } from "./filters.js";
import { ago, f1, localDateTime } from "./format.js";
import { ageHours } from "@freepl/contract";

const REMEMBER_KEY = "freepl.entry";
const readRemembered = (): number | null => {
  try { return entryParam(window.localStorage.getItem(REMEMBER_KEY)); } catch { return null; }
};
const remember = (id: number) => { try { window.localStorage.setItem(REMEMBER_KEY, String(id)); } catch { /* private mode */ } };

/** Signed money in tenths: a planned or reported negative bank is shown, never hidden. */
const money = (t: number) => (t < 0 ? `−${formatPrice(-t)}` : formatPrice(t));

interface Row { slot: SquadSlot; player: PlayerRow; cells: TickerCell[] }

/** Spec 0004 part 1: the Entry's Squad, money and transfer state, read live and never stored. */
export function MySquadTab({ players, fixtures, ratings, filters, update, now, onOpenRating }: {
  players: PlayersResponse; fixtures: FixturesResponse | undefined; ratings: RatingContext | null;
  filters: Filters; update: (p: Partial<Filters>) => void; now: number; onOpenRating: (id: number) => void;
}) {
  const [remembered] = useState(readRemembered);
  const id = filters.entry ?? remembered;
  const entry = useEntry(id, true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [sheetFor, setSheetFor] = useState<number | null>(null);

  const byId = useMemo(() => new Map(players.players.map((p) => [p.id, p])), [players]);
  const clubById = useMemo(() => new Map(players.clubs.map((c) => [c.id, c])), [players]);
  const posById = useMemo(() => new Map(players.positions.map((p) => [p.id, p])), [players]);
  const nextGws = useMemo(() => (fixtures ? tickerWindow(fixtures.gameweeks, FIXTURE_GAMEWEEKS, now) : []), [fixtures, now]);
  const cellsByClub = useMemo(() => {
    if (!fixtures) return new Map<number, TickerCell[]>();
    return new Map(buildTicker(fixtures.clubs, fixtures.fixtures, nextGws).rows.map((r) => [r.club.id, r.cells]));
  }, [fixtures, nextGws]);

  const view = entry.data?.view;
  const rows: Row[] = useMemo(() => (view?.squad ?? []).flatMap((slot) => {
    const player = byId.get(slot.playerId);
    return player ? [{ slot, player, cells: cellsByClub.get(player.clubId) ?? [] }] : [];
  }), [view, byId, cellsByClub]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = entryParam(draft.trim());
    if (n === null) return;
    remember(n);
    update({ entry: n });
    setEditing(false);
  };

  const teamBar = (
    <div className="teambar">
      {editing || (entry.isError && entry.error instanceof EntryLoadError && entry.error.status === 404) ? (
        <form onSubmit={submit}>
          <label htmlFor="teamid">Team ID</label>
          <input id="teamid" className="numin" inputMode="numeric" pattern="[0-9]*" placeholder="e.g. 1234567"
            value={draft} onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))} autoFocus />
          <button className="chip small" type="submit" disabled={entryParam(draft) === null}>Show</button>
          {editing && <button className="linkish" type="button" onClick={() => setEditing(false)}>Cancel</button>}
          <span className="pmeta">Find it in the address of your Points page: …/entry/<b>1234567</b>/event/…</span>
        </form>
      ) : (
        <>
          <span>
            {view ? <>Showing: <b>{view.entry.name}</b> ({view.entry.manager})</> : "Loading team…"}
            {id === null && view && <span className="pmeta"> · enter your team ID to see yours</span>}
          </span>
          <button className="linkish" onClick={() => { setDraft(id ? String(id) : ""); setEditing(true); }}>Change team</button>
        </>
      )}
    </div>
  );

  if (entry.isPending) return <section className="flex flex-col gap-2.5">{teamBar}<p className="notice">Loading the team from FPL…</p></section>;
  if (entry.isError) {
    const e = entry.error;
    return (
      <section className="flex flex-col gap-2.5">
        {teamBar}
        <p className="notice bad">{e instanceof EntryLoadError ? e.message : "Couldn't load the team."}{" "}
          <button className="linkish" onClick={() => entry.refetch()}>Try again</button></p>
      </section>
    );
  }
  const { meta } = entry.data;
  const v = entry.data.view;

  if (v.gameweek === null || v.squad.length === 0) {
    return (
      <section className="flex flex-col gap-2.5">
        {teamBar}
        <p className="notice">This team has no gameweek picks yet. Its Squad appears here from its first deadline.</p>
      </section>
    );
  }

  const xi = rows.filter((r) => r.slot.slot <= 11);
  const bench = rows.filter((r) => r.slot.slot > 11).sort((a, b) => a.slot.slot - b.slot.slot);
  const flagged = rows.filter((r) => r.player.status !== "a");
  const blanks = nextGws.map((g, i) => ({ gw: g.id, n: xi.filter((r) => r.cells[i]?.fixtures.length === 0).length })).filter((b) => b.n > 0);
  const noCaptain = !xi.some((r) => r.slot.isCaptain);
  const s = v.state;
  const upcoming = v.gameweek + 1;
  const set = upcoming <= 19 ? 1 : 2;
  const ftNote = s.freeTransfers === null ? "unlimited" : s.pendingTransfers ? `${s.pendingTransfers} pending` : "available";
  const sheetRow = rows.find((r) => r.player.id === sheetFor);

  const card = (r: Row) => {
    const rating = ratings ? pickRatingFor(r.player, ratings) : null;
    const band = rating?.rated ? rating.band : "unrated";
    const isGk = posById.get(r.player.positionId)?.short === "GKP";
    return (
      <button key={r.player.id} type="button" className="pcard" onClick={() => setSheetFor(r.player.id)}
        aria-label={`${r.player.webName}${r.slot.isCaptain ? ", captain" : r.slot.isVice ? ", vice-captain" : ""}`}>
        <span className="fl"><Flag player={r.player} /></span>
        {r.slot.pendingIn ? <span className="badge new">NEW</span> : r.slot.isCaptain ? <span className="badge">C</span> : r.slot.isVice ? <span className="badge">V</span> : null}
        <Shirt keeper={isGk} />
        <span className="box">
          <span className={`strip ${band}`} />
          <span className="nm">{r.player.webName}</span>
          <span className="bw">{rating?.rated ? BAND_LABEL[rating.band] : "Not rated"}</span>
          <span className="fx1"><FixtureCell fixtures={r.cells[0]?.fixtures ?? []} clubById={clubById} /></span>
          <span className="pr">{r.slot.sellPrice !== null ? formatPrice(r.slot.sellPrice) : formatPrice(r.player.nowCost)}</span>
        </span>
      </button>
    );
  };

  return (
    <section className="flex flex-col gap-2.5">
      {teamBar}
      {meta.sources.entry.stale && (
        <p className="notice bad">FPL isn't answering. Showing this team as it was {ago(ageHours(meta.sources.entry.fetchedAt, now))}.</p>
      )}

      <div className="attention">
        <span className="k">Needs attention:</span>
        {flagged.map((r) => {
          const a = availabilityFor(r.player.status, r.player.chanceNextRound);
          return (
            <button key={r.player.id} className={`att ${a.level === "doubtful" ? "warn" : "bad"}`} onClick={() => setSheetFor(r.player.id)}>
              {r.player.webName} {a.level === "doubtful" ? (a.chance === null ? "?" : `${a.chance}%`) : a.level === "out" ? a.label.slice(0, 3).toUpperCase() : ""}
            </button>
          );
        })}
        {blanks.map((b) => <span key={b.gw} className="att warn">GW{b.gw}: {b.n} starter{b.n > 1 ? "s" : ""} blank</span>)}
        {noCaptain && <span className="att warn">No captain set</span>}
        {!flagged.length && !blanks.length && !noCaptain && <span className="ok">Nothing needs attention</span>}
      </div>

      <div className={`squadview ${filters.squadView === "pitch" ? "attached" : ""}`}>
        <div className="viewseg" role="group" aria-label="Squad view">
          <button className="chip" aria-pressed={filters.squadView === "pitch"} onClick={() => update({ squadView: "pitch" })}>Pitch</button>
          <button className="chip" aria-pressed={filters.squadView === "list"} onClick={() => update({ squadView: "list" })}>List</button>
        </div>
        <div className="dash">
          <div className="m"><span className="k">Bank</span><span className={`v ${s.bank !== null && s.bank < 0 ? "bad" : ""}`}>{s.bank === null ? "—" : money(s.bank)}</span><span className="n">now</span></div>
          <div className="m"><span className="k">Free transfers</span><span className="v">{s.freeTransfers ?? "∞"}</span><span className="n">{ftNote}</span></div>
          <div className="m"><span className="k">Selling value</span><span className="v">{s.sellingValue === null ? "—" : money(s.sellingValue)}</span><span className="n">{s.sellingValue === null ? "buy price unknown" : "live"}</span></div>
          <div className="m"><span className="k">Squad value</span><span className="v">{s.squadValueLive === null ? "—" : money(s.squadValueLive)}</span>
            <span className="n" title="FPL's own figure, frozen at that gameweek">{s.squadValue === null ? "live" : `live · GW${v.gameweek} ${formatPrice(s.squadValue)}`}</span></div>
          <div className="row2">
            <span className="chipset">
              {CHIPS.map((c) => {
                const used = s.chips.find((x) => x.chip === c && x.set === set)?.usedIn ?? null;
                return <span key={c} className={used !== null ? "used" : ""} title={used !== null ? `Used in GW${used}` : "Available"}>{CHIP_LABEL[c]}</span>;
              })}
            </span>
            <span>{set === 1 && s.set1ExpiresAt ? `Set 1 ends ${localDateTime(s.set1ExpiresAt)}` : `Set ${set}`}</span>
            <span>GW{v.gameweek}: {s.gwPoints ?? "—"} pts{s.overallRank ? ` · rank ${s.overallRank.toLocaleString()}` : ""}</span>
          </div>
        </div>
        {filters.squadView === "pitch" ? (
          <>
            <div className="pitch">
              <div className="turf" aria-hidden="true" /><div className="goalarea" aria-hidden="true" /><div className="goalframe" aria-hidden="true" />
              {players.positions.map((pos) => {
                const line = xi.filter((r) => r.player.positionId === pos.id);
                return line.length ? <div className="prow" key={pos.id}>{line.map(card)}</div> : null;
              })}
            </div>
            <div className="benchrow">
              <span className="k">Bench · in order</span>
              <div className="prow">{bench.map(card)}</div>
            </div>
          </>
        ) : (
          <div className="table-box" style={{ marginTop: 8 }}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  {nextGws.map((g) => <th key={g.id} scope="col" style={{ textAlign: "center" }}>GW{g.id}</th>)}
                  <th scope="col">xP next</th>
                </tr>
              </thead>
              <tbody>
                {[...xi, ...bench].map((r) => {
                  const rating = ratings ? pickRatingFor(r.player, ratings) : null;
                  const band = rating?.rated ? rating.band : null;
                  const cls = band && band !== "below" ? `row-${band}` : "";
                  return (
                    <tr key={r.player.id} className={`${cls} tap`} tabIndex={0} onClick={() => setSheetFor(r.player.id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSheetFor(r.player.id); } }}>
                      <td>
                        <div className="pname">
                          <span className="nm">{r.player.webName}</span><Flag player={r.player} />
                          {r.slot.isCaptain && <span className="tag">C</span>}
                          {r.slot.isVice && <span className="tag">V</span>}
                          {r.slot.slot > 11 && <span className="tag">Bench {r.slot.slot - 11}</span>}
                          {r.slot.pendingIn && <span className="tag new">New</span>}
                        </div>
                        <div className="pmeta">
                          <span className="bandword">{rating?.rated ? BAND_LABEL[rating.band] : "Not rated"}</span> · {clubById.get(r.player.clubId)?.short} ·{" "}
                          <b>{r.slot.sellPrice !== null ? `sells ${formatPrice(r.slot.sellPrice)}` : formatPrice(r.player.nowCost)}</b>
                        </div>
                      </td>
                      {r.cells.map((c) => <td key={c.gameweek} className="fx"><FixtureCell fixtures={c.fixtures} clubById={clubById} /></td>)}
                      <td className="num-strong">{f1(r.player.epNext)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="subrow">
        <span>Live from FPL's public data for team {v.entry.id}, updated {ago(ageHours(meta.sources.entry.fetchedAt, now))}. Not saved anywhere.</span>
      </div>

      {sheetRow && (
        <PlayerSheet player={sheetRow.player} slot={sheetRow.slot} club={clubById.get(sheetRow.player.clubId)}
          position={posById.get(sheetRow.player.positionId)} cells={sheetRow.cells} gwIds={nextGws.map((g) => g.id)}
          clubById={clubById} rating={ratings ? pickRatingFor(sheetRow.player, ratings) : null}
          onWhy={() => { const pid = sheetRow.player.id; setSheetFor(null); onOpenRating(pid); }} onClose={() => setSheetFor(null)} />
      )}
    </section>
  );
}

/** Club shirt (docs/design.md). Club colours need a colour table not built yet, so every
 *  Club is the neutral kit the design allows; keepers get their own kit. */
function Shirt({ keeper }: { keeper: boolean }) {
  const body = keeper ? "#e2b53a" : "#c9d1cd";
  const trim = keeper ? "#6b5310" : "#59645f";
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M11 3 L5 6 L1 12 L5.5 15 L8 12.5 L8 29 L24 29 L24 12.5 L26.5 15 L31 12 L27 6 L21 3 C20 6.5 12 6.5 11 3 Z" fill={body} stroke="rgb(0 0 0 / .35)" strokeWidth=".8" />
      <path d="M11 3 C12 6.5 20 6.5 21 3 L19.5 2.6 C18.5 5 13.5 5 12.5 2.6 Z" fill={trim} />
      <path d="M1 12 L5.5 15 L6.2 14.3 L1.8 11.2 Z M31 12 L26.5 15 L25.8 14.3 L30.2 11.2 Z" fill={trim} />
    </svg>
  );
}

