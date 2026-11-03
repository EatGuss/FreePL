import { useCallback, useEffect, useMemo, useState } from "react";
import {
  legalFormation, planTransfer, startPlan,
  type EntryView, type GameweekRow, type Plan, type PlannedTransfer, type PlayerRow, type PositionRow,
} from "@freepl/contract";
import type { Filters } from "./filters.js";
import { resolveSaved } from "./shortlist.js";

/**
 * Spec 0006 part 2: the saved Plan. The URL carries it (pe, pgw, plan, xi, bench, c, v, and the
 * shared season s); browser storage mirrors it. A Plan belongs to one Entry and one gameweek
 * (Q86, Q93), saves on every change (Q88), and Clear plan can be undone once (Q92).
 */
export interface SavedPlan {
  /** The Entry it was made for (`pe`), which stays put while other teams are viewed. */
  entry: number;
  /** The upcoming gameweek it is for (`pgw`); it ends at that gameweek's deadline. */
  gameweek: number;
  transfers: PlannedTransfer[];
  /** Planned XI then bench, in slot order (slots 1–11 and 12–15). */
  xi: number[];
  bench: number[];
  captain: number | null;
  vice: number | null;
}

const XI = 11;

export function planToSaved(plan: Plan, entry: number, gameweek: number): SavedPlan {
  const bySlot = [...plan.lineup].sort(([a], [b]) => a - b).map(([, id]) => id);
  return {
    entry, gameweek, transfers: plan.transfers, xi: bySlot.slice(0, XI), bench: bySlot.slice(XI),
    captain: plan.captainId, vice: plan.viceId,
  };
}

function savedLineup(saved: SavedPlan): Map<number, number> {
  return new Map([...saved.xi, ...saved.bench].map((id, i) => [i + 1, id]));
}

/** Nothing planned: no transfers, and the lineup and armbands as at the last deadline. */
export function isBasePlan(plan: Plan, view: EntryView): boolean {
  const base = startPlan(view);
  return plan.transfers.length === 0 && plan.captainId === base.captainId && plan.viceId === base.viceId &&
    [...base.lineup].every(([slot, id]) => plan.lineup.get(slot) === id);
}

export const samePlan = (a: SavedPlan, b: SavedPlan) => JSON.stringify(a) === JSON.stringify(b);

export type Restored =
  | { status: "none" }
  | { status: "applied"; plan: Plan; notice: string | null }
  /** Made for another Entry: not applied here, and waiting on its own (Q93). */
  | { status: "other-entry"; entry: number }
  | { status: "expired"; gameweek: number }
  /** Names a player no longer in the Squad: a real transfer happened since. */
  | { status: "stale"; gameweek: number };

/** Checks a saved Plan against the Entry on screen and turns it back into a Plan. */
export function restorePlan(
  saved: SavedPlan | null, view: EntryView, players: PlayerRow[], positions: PositionRow[], gameweeks: GameweekRow[], now: number,
): Restored {
  if (!saved) return { status: "none" };
  if (saved.entry !== view.entry.id) return { status: "other-entry", entry: saved.entry };
  const gw = gameweeks.find((g) => g.id === saved.gameweek);
  if (!gw || Date.parse(gw.deadlineTime) <= now || (view.gameweek !== null && view.gameweek >= saved.gameweek)) {
    return { status: "expired", gameweek: saved.gameweek };
  }

  const byId = new Map(players.map((p) => [p.id, p]));
  const posById = new Map(positions.map((p) => [p.id, p]));
  const positionOf = (id: number) => { const p = byId.get(id); return p ? posById.get(p.positionId) : undefined; };
  const squad = new Set(view.squad.map((s) => s.playerId));
  const outs = saved.transfers.map((t) => t.outId);
  const ins = saved.transfers.map((t) => t.inId);
  const distinct = (xs: number[]) => new Set(xs).size === xs.length;
  const expected = new Set([...[...squad].filter((id) => !outs.includes(id)), ...ins]);
  const lineupIds = [...saved.xi, ...saved.bench];
  const matches = distinct(outs) && distinct(ins) && distinct(lineupIds) &&
    outs.every((id) => squad.has(id)) && ins.every((id) => !squad.has(id) && byId.has(id)) &&
    saved.transfers.every((t) => byId.get(t.inId)?.positionId === byId.get(t.outId)?.positionId) &&
    lineupIds.length === expected.size && lineupIds.every((id) => expected.has(id));
  if (!matches) return { status: "stale", gameweek: saved.gameweek };

  const starter = (lineup: Map<number, number>, id: number | null) =>
    id !== null && [...lineup].some(([slot, x]) => x === id && slot <= XI);
  const lineup = savedLineup(saved);
  const legal = legalFormation(lineup, positions, positionOf) && positionOf(saved.bench[0]!)?.maxPlay === 1;
  if (legal) {
    return {
      status: "applied", notice: null,
      plan: {
        transfers: saved.transfers, lineup,
        captainId: starter(lineup, saved.captain) ? saved.captain : null,
        viceId: starter(lineup, saved.vice) ? saved.vice : null,
      },
    };
  }
  // The saved lineup breaks the formation rules: keep the transfers, start from the last XI.
  const fallback = saved.transfers.reduce((p, t) => planTransfer(p, t.outId, t.inId), startPlan(view));
  return {
    status: "applied",
    notice: `The saved lineup broke the formation rules, so it starts from your GW${view.gameweek} XI again. Transfers are kept.`,
    plan: {
      ...fallback,
      captainId: starter(fallback.lineup, saved.captain) ? saved.captain : fallback.captainId,
      viceId: starter(fallback.lineup, saved.vice) ? saved.vice : fallback.viceId,
    },
  };
}

const STORAGE_KEY = "freepl.plan";

/** Every read and write is wrapped: with storage blocked, the URL alone still works. */
function readStoredPlan(): { season: number | null; value: SavedPlan } | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { s?: unknown; plan?: SavedPlan };
    const p = v.plan;
    const ints = (xs: unknown) => Array.isArray(xs) && xs.every((x) => Number.isInteger(x) && x > 0);
    const ok = !!p && Number.isInteger(p.entry) && Number.isInteger(p.gameweek) && ints(p.xi) && p.xi.length === XI &&
      ints(p.bench) && p.bench.length === 4 && Array.isArray(p.transfers) &&
      p.transfers.every((t) => Number.isInteger(t?.outId) && Number.isInteger(t?.inId));
    return ok ? { season: Number.isInteger(v.s) ? (v.s as number) : null, value: p! } : null;
  } catch {
    return null;
  }
}

function writeStoredPlan(season: number, plan: SavedPlan | null) {
  try {
    if (plan) window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ s: season, plan }));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch { /* private mode: the URL still carries it */ }
}

export interface SavedPlanState {
  plan: SavedPlan | null;
  /** Every change saves at once (Q88); null removes the Plan. */
  set: (plan: SavedPlan | null) => void;
  clear: () => void;
  /** The Plan Clear plan removed, until the next change (Q92). */
  previous: SavedPlan | null;
  loadPrevious: () => void;
  offer: SavedPlan | null;
  useLink: () => void;
  keepMine: () => void;
  notices: string[];
  dismiss: (i: number) => void;
}

export function useSavedPlan(filters: Filters, update: (p: Partial<Filters>) => void, season: number | null): SavedPlanState | null {
  const [ready, setReady] = useState(false);
  const [offer, setOffer] = useState<SavedPlan | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [previous, setPrevious] = useState<SavedPlan | null>(null);

  // Once per page load, as soon as the season is known.
  useEffect(() => {
    if (ready || season === null) return;
    const link = filters.plan ? { season: filters.season, value: filters.plan } : null;
    const r = resolveSaved("plan", link, readStoredPlan(), season, samePlan);
    if (r.clearStored) writeStoredPlan(season, null);
    setOffer(r.offer);
    setNotices(r.notices);
    update({ plan: r.value, season });
    setReady(true);
    // filters is read once here on purpose; later changes are mirrored below.
  }, [ready, season, update]);

  useEffect(() => {
    if (ready && season !== null) writeStoredPlan(season, filters.plan);
  }, [ready, season, filters.plan]);

  const current = filters.plan;
  const set = useCallback((p: SavedPlan | null) => { setPrevious(null); update({ plan: p, season }); }, [season, update]);

  return useMemo(() => (!ready ? null : {
    plan: current,
    set,
    clear: () => { setPrevious(current); update({ plan: null }); },
    previous,
    loadPrevious: () => { if (previous) update({ plan: previous, season }); setPrevious(null); },
    offer,
    useLink: () => { if (offer) update({ plan: offer, season }); setOffer(null); },
    keepMine: () => setOffer(null),
    notices,
    dismiss: (i: number) => setNotices((n) => n.filter((_, k) => k !== i)),
  }), [ready, current, set, previous, offer, notices, season, update]);
}
