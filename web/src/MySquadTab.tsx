import { useCallback, useMemo, useState, type FormEvent } from "react";
import {
  BAND_LABEL, CHIPS, CHIP_LABEL, FIXTURE_GAMEWEEKS, availabilityFor, buildTicker, canSwap, evaluatePlan, formatPrice,
  pickRatingFor, planTransfer, setArmband, startPlan, swapPlayers, tickerWindow, undoTransfer,
  type EntryView, type FixturesResponse, type Plan, type PlanSlot, type PlayerRow, type PlayersResponse, type RatingContext,
  type TickerCell,
} from "@freepl/contract";
import { ReplaceSheet } from "./ReplaceSheet.js";
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

interface Row { slot: PlanSlot; player: PlayerRow; cells: TickerCell[] }

/**
 * Spec 0004: the Entry's Squad, money and transfer state, read live and never stored, plus the
 * what-if (planned transfers and lineup) — client side only, lost on refresh, never sent to FPL.
 */
export function MySquadTab({ players, fixtures, ratings, filters, update, now, onOpenRating }: {
  players: PlayersResponse; fixtures: FixturesResponse | undefined; ratings: RatingContext | null;
  filters: Filters; update: (p: Partial<Filters>) => void; now: number; onOpenRating: (id: number) => void;
}) {
  const [remembered] = useState(readRemembered);
  const id = filters.entry ?? remembered;
  // No default team (owner's choice, 2026-10-27): nothing is fetched until a team id is given.
  const entry = useEntry(id, id !== null);
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
  // The plan belongs to the view it was made on; a new team (or new data) starts afresh.
  const [planState, setPlanState] = useState<{ view: EntryView; plan: Plan } | null>(null);
  const basePlan = useMemo(() => (view && view.squad.length ? startPlan(view) : null), [view]);
  const plan = planState && planState.view === view ? planState.plan : basePlan;
  const setPlan = useCallback((p: Plan) => { if (view) setPlanState({ view, plan: p }); }, [view]);
  const result = useMemo(
    () => (view && plan ? evaluatePlan(view, plan, players.players, players.positions) : null),
    [view, plan, players],
  );
  const positionOf = useCallback((pid: number) => { const p = byId.get(pid); return p ? posById.get(p.positionId) : undefined; }, [byId, posById]);
  const [moving, setMoving] = useState<number | null>(null);
  const [replaceFor, setReplaceFor] = useState<number | null>(null);

  const rows: Row[] = useMemo(() => (result?.squad ?? []).flatMap((slot) => {
    const player = byId.get(slot.playerId);
    return player ? [{ slot, player, cells: cellsByClub.get(player.clubId) ?? [] }] : [];
  }), [result, byId, cellsByClub]);

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
      {editing || id === null || (entry.isError && entry.error instanceof EntryLoadError && entry.error.status === 404) ? (
        <form onSubmit={submit}>
          <label htmlFor="teamid">Team ID</label>
          <input id="teamid" className="numin" inputMode="numeric" pattern="[0-9]*" placeholder="e.g. 1234567"
            value={draft} onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))} autoFocus />
          <button className="chip small" type="submit" disabled={entryParam(draft) === null}>Show</button>
          {editing && id !== null && <button className="linkish" type="button" onClick={() => setEditing(false)}>Cancel</button>}
          <span className="pmeta">Find it in the address of your Points page: …/entry/<b>1234567</b>/event/…</span>
        </form>
      ) : (
        <>
          <span>
            {view ? <>Showing: <b>{view.entry.name}</b> ({view.entry.manager})</> : "Loading team…"}
          </span>
          <button className="linkish" onClick={() => { setDraft(id ? String(id) : ""); setEditing(true); }}>Change team</button>
        </>
      )}
    </div>
  );

  if (id === null) {
    return (
      <section className="flex flex-col gap-2.5">
        <p className="notice">Enter your FPL team ID to see your squad, selling prices, free transfers and chips.
          It's remembered on this device only. The data comes live from FPL's public pages and isn't saved.</p>
        {teamBar}
      </section>
    );
  }
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
  const r0 = result!;
  const p0 = plan!;
  const noCaptain = r0.noCaptain;
  const s = v.state;
  const upcoming = v.gameweek + 1;
  const set = upcoming <= 19 ? 1 : 2;
  const planned = p0.transfers.length;
  const ftNote = s.freeTransfers === null ? "unlimited"
    : r0.hitPoints ? `−${r0.hitPoints} pts hit`
    : planned ? `after ${planned} planned` : s.pendingTransfers ? `${s.pendingTransfers} pending` : "available";
  const sheetRow = rows.find((r) => r.player.id === sheetFor);
  const replaceRow = rows.find((r) => r.player.id === replaceFor);
  const inSquad = new Set(rows.map((r) => r.player.id));
  const tapPlayer = (pid: number) => {
    if (moving === null) { setSheetFor(pid); return; }
    if (pid !== moving && canSwap(p0, moving, pid, players.positions, positionOf)) setPlan(swapPlayers(p0, moving, pid, players.positions, positionOf));
    setMoving(null);
  };
  const movingName = moving === null ? null : byId.get(moving)?.webName;

  const card = (r: Row) => {
    const rating = ratings ? pickRatingFor(r.player, ratings) : null;
    const band = rating?.rated ? rating.band : "unrated";
    const isGk = posById.get(r.player.positionId)?.short === "GKP";
    return (
      <button key={r.player.id} type="button" onClick={() => tapPlayer(r.player.id)}
        className={`pcard ${moving === null ? "" : moving === r.player.id ? "moving" : canSwap(p0, moving, r.player.id, players.positions, positionOf) ? "target" : "dim"}`}
        aria-label={`${r.player.webName}${r.slot.isCaptain ? ", captain" : r.slot.isVice ? ", vice-captain" : ""}`}>
        <span className="fl"><Flag player={r.player} /></span>
        {r.slot.planned || r.slot.pendingIn ? <span className="badge new">NEW</span> : r.slot.isCaptain ? <span className="badge">C</span> : r.slot.isVice ? <span className="badge">V</span> : null}
        <Shirt keeper={isGk} />
        <span className="box">
          <span className={`strip ${band}`} />
          <span className="nm">{r.player.webName}</span>
          <span className="bw">{rating?.rated ? BAND_LABEL[rating.band] : "Not rated"}</span>
          <span className="fx1"><FixtureCell fixtures={r.cells[0]?.fixtures ?? []} clubById={clubById} /></span>
          <span className="pr" title="Sell price">{r.slot.sellPrice !== null ? formatPrice(r.slot.sellPrice) : "—"}</span>
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

      <div className="lineup-note">
        <span>Planned lineup <b>{r0.formation}</b> · starts from your GW{v.gameweek} XI. A what-if only: set your real XI, bench and
          captain on the FPL site.</span>
        {r0.noCaptain && <span className="warn">No captain: tick one in a starter's sheet.</span>}
        {r0.noVice && <span className="warn">No vice-captain.</span>}
      </div>

      {planned > 0 && (
        <div className="plan">
          <div className="row"><b>Planned transfers</b><button className="linkish" onClick={() => setPlan(startPlan(v))}>Clear plan</button></div>
          {p0.transfers.map((t) => {
            const out = byId.get(t.outId), inn = byId.get(t.inId);
            const sell = v.squad.find((x) => x.playerId === t.outId)?.sellPrice;
            return (
              <div className="row" key={t.inId}>
                <span>{out?.webName} ({sell != null ? formatPrice(sell) : "?"}) → <b>{inn?.webName}</b> ({inn ? formatPrice(inn.nowCost) : "?"})</span>
                <button className="linkish" onClick={() => setPlan(undoTransfer(p0, t.inId))}>Undo</button>
              </div>
            );
          })}
          {r0.overBudgetBy > 0 && <div className="warn">Over budget by {formatPrice(r0.overBudgetBy)}. Sell more or pick cheaper to make this plan valid.</div>}
          {r0.clubsOver.length > 0 && <div className="warn">More than 3 from {r0.clubsOver.map((c) => clubById.get(c)?.short).join(", ")}. FPL won't allow this.</div>}
          {r0.hitPoints > 0 && <div className="warn">{r0.hitPoints / 4} extra transfer{r0.hitPoints > 4 ? "s" : ""}: −{r0.hitPoints} points</div>}
          <div className="pmeta">Incoming players are valued at today's price, which can change overnight.</div>
        </div>
      )}

      <div className={`squadview ${filters.squadView === "pitch" ? "attached" : ""}`}>
        <div className="viewseg" role="group" aria-label="Squad view">
          <button className="chip" aria-pressed={filters.squadView === "pitch"} onClick={() => update({ squadView: "pitch" })}>Pitch</button>
          <button className="chip" aria-pressed={filters.squadView === "list"} onClick={() => update({ squadView: "list" })}>List</button>
        </div>
        <div className="dash">
          <div className="m"><span className="k">Bank</span><span className={`v ${r0.bank !== null && r0.bank < 0 ? "bad" : ""}`}>{r0.bank === null ? "—" : money(r0.bank)}</span><span className="n">{planned ? "after plan" : "now"}</span></div>
          <div className="m"><span className="k">Free transfers</span><span className={`v ${r0.hitPoints ? "bad" : ""}`}>{r0.freeTransfersLeft ?? "∞"}</span><span className="n">{ftNote}</span></div>
          <div className="m"><span className="k">Selling value</span><span className="v">{r0.sellingValue === null ? "—" : money(r0.sellingValue)}</span><span className="n">{r0.sellingValue === null ? "buy price unknown" : "live"}</span></div>
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
              {movingName && <div className="movebar"><span>Tap a highlighted player to swap with {movingName}</span><button onClick={() => setMoving(null)}>Cancel</button></div>}
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
                  <th scope="col">Sell</th>
                  <th scope="col">xP next</th>
                </tr>
              </thead>
              <tbody>
                {[...xi, ...bench].map((r) => {
                  const rating = ratings ? pickRatingFor(r.player, ratings) : null;
                  const band = rating?.rated ? rating.band : null;
                  const cls = band && band !== "below" ? `row-${band}` : "";
                  return (
                    <tr key={r.player.id} className={`${cls} tap`} tabIndex={0} onClick={() => tapPlayer(r.player.id)}
                      style={moving !== null && moving !== r.player.id && !canSwap(p0, moving, r.player.id, players.positions, positionOf) ? { opacity: 0.35 } : undefined}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tapPlayer(r.player.id); } }}>
                      <td>
                        <div className="pname">
                          <span className="nm">{r.player.webName}</span><Flag player={r.player} />
                          {r.slot.isCaptain && <span className="tag">C</span>}
                          {r.slot.isVice && <span className="tag">V</span>}
                          {r.slot.slot > 11 && <span className="tag">Bench {r.slot.slot - 11}</span>}
                          {r.slot.pendingIn && <span className="tag new">New</span>}
                          {r.slot.planned && <span className="tag new">Planned</span>}
                        </div>
                        <div className="pmeta">
                          <span className="bandword">{rating?.rated ? BAND_LABEL[rating.band] : "Not rated"}</span> · {clubById.get(r.player.clubId)?.short}
                        </div>
                      </td>
                      {r.cells.map((c) => <td key={c.gameweek} className="fx"><FixtureCell fixtures={c.fixtures} clubById={clubById} /></td>)}
                      <td className="num-strong">{r.slot.sellPrice !== null ? formatPrice(r.slot.sellPrice) : "—"}</td>
                      <td>{f1(r.player.epNext)}</td>
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
          starter={sheetRow.slot.slot <= 11}
          onCaptain={() => setPlan(setArmband(p0, sheetRow.player.id, "captain"))}
          onVice={() => setPlan(setArmband(p0, sheetRow.player.id, "vice"))}
          onMove={() => { setMoving(sheetRow.player.id); setSheetFor(null); }}
          onReplace={() => { setReplaceFor(sheetRow.player.id); setSheetFor(null); }}
          onWhy={() => { const pid = sheetRow.player.id; setSheetFor(null); onOpenRating(pid); }} onClose={() => setSheetFor(null)} />
      )}
      {replaceRow && (
        <ReplaceSheet out={replaceRow.player} sellPrice={replaceRow.slot.sellPrice} bank={r0.bank} ratings={ratings} clubById={clubById}
          candidates={players.players.filter((p) => p.positionId === replaceRow.player.positionId && !inSquad.has(p.id))}
          onPick={(inId) => { setPlan(planTransfer(p0, replaceRow.player.id, inId)); setReplaceFor(null); }}
          onClose={() => setReplaceFor(null)} />
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

