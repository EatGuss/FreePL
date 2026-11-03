import { createContext, useCallback, useEffect, useMemo, useState } from "react";
import type { GameweekRow } from "@freepl/contract";
import type { Filters } from "./filters.js";

/**
 * Spec 0006 part 1: the Shortlist. The URL carries it (`sl`, `s`); browser storage mirrors it.
 * FPL reuses element ids every season, so both carry the season and a mismatch is dropped,
 * never remapped (Q85). A link that disagrees with this device changes nothing until the
 * owner chooses (Q87).
 */

/** The season a Shortlist belongs to: the UTC year of GW1's deadline (2026 for 2026/27). */
export function seasonOf(gameweeks: GameweekRow[]): number | null {
  const first = gameweeks.reduce<GameweekRow | null>((a, g) => (a === null || g.id < a.id ? g : a), null);
  return first ? new Date(first.deadlineTime).getUTCFullYear() : null;
}

/** "2025/26". */
export const seasonLabel = (s: number) => `${s}/${String((s + 1) % 100).padStart(2, "0")}`;

export interface SavedShortlist { season: number | null; ids: number[] }

export interface Resolution {
  /** What the app shows now. */
  ids: number[];
  /** A link's Shortlist that differs from this device's, waiting for "Use link's shortlist". */
  offer: number[] | null;
  notices: string[];
  /** The stored Shortlist is from another season and must be cleared. */
  clearStored: boolean;
}

const sameSet = (a: number[], b: number[]) => a.length === b.length && b.every((x) => a.includes(x));

/** Decides what a page load shows from the link and this device's storage (Q85, Q87). */
export function resolveShortlist(link: SavedShortlist | null, stored: SavedShortlist | null, season: number): Resolution {
  const notices: string[] = [];
  const linkOk = !!link && link.ids.length > 0 && link.season === season;
  const storedOk = !!stored && stored.ids.length > 0 && stored.season === season;
  if (link && link.ids.length > 0 && !linkOk) {
    notices.push(link.season === null
      ? "This link's shortlist doesn't say which season it's from, so its players can't be matched. It was not loaded."
      : `This link's shortlist is from the ${seasonLabel(link.season)} season, so its players can't be matched. It was not loaded.`);
  }
  const clearStored = !!stored && stored.ids.length > 0 && !storedOk;
  if (clearStored) {
    notices.push(stored!.season === null
      ? "Your saved shortlist didn't say which season it was from, so it was cleared."
      : `Your saved shortlist was from the ${seasonLabel(stored!.season)} season, so it was cleared.`);
  }
  if (linkOk && storedOk) {
    return { ids: stored!.ids, offer: sameSet(link!.ids, stored!.ids) ? null : link!.ids, notices, clearStored };
  }
  if (linkOk) return { ids: link!.ids, offer: null, notices, clearStored };
  if (storedOk) return { ids: stored!.ids, offer: null, notices, clearStored };
  return { ids: [], offer: null, notices, clearStored };
}

const STORAGE_KEY = "freepl.shortlist";

/** Every read and write is wrapped: with storage blocked, the URL alone still works. */
export function readStoredShortlist(): SavedShortlist | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { s?: unknown; ids?: unknown };
    const ids = Array.isArray(v.ids) ? v.ids.filter((x): x is number => Number.isInteger(x) && (x as number) > 0) : [];
    return { season: Number.isInteger(v.s) ? (v.s as number) : null, ids };
  } catch {
    return null;
  }
}

function writeStoredShortlist(saved: SavedShortlist | null) {
  try {
    if (saved && saved.ids.length) window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ s: saved.season, ids: saved.ids }));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch { /* private mode: the URL still carries it */ }
}

export interface ShortlistState {
  ids: number[];
  has: (id: number) => boolean;
  toggle: (id: number) => void;
  offer: number[] | null;
  useLinks: () => void;
  keepMine: () => void;
  notices: string[];
  dismiss: (i: number) => void;
}

/** null until the season is known (players data loaded). */
export const ShortlistContext = createContext<ShortlistState | null>(null);

export function useShortlist(filters: Filters, update: (p: Partial<Filters>) => void, season: number | null): ShortlistState | null {
  const [ready, setReady] = useState(false);
  const [offer, setOffer] = useState<number[] | null>(null);
  const [notices, setNotices] = useState<string[]>([]);

  // Once per page load, as soon as the season is known.
  useEffect(() => {
    if (ready || season === null) return;
    const link = filters.sl.length ? { season: filters.season, ids: filters.sl } : null;
    const r = resolveShortlist(link, readStoredShortlist(), season);
    if (r.clearStored) writeStoredShortlist(null);
    setOffer(r.offer);
    setNotices(r.notices);
    update({ sl: r.ids, season: r.ids.length ? season : null });
    setReady(true);
    // filters is read once here on purpose; later changes are mirrored below.
  }, [ready, season, update]);

  // Mirror every change (stars, "Use link's shortlist", back/forward) into storage.
  useEffect(() => {
    if (ready && season !== null) writeStoredShortlist({ season, ids: filters.sl });
  }, [ready, season, filters.sl]);

  const ids = filters.sl;
  const toggle = useCallback((id: number) => {
    if (season === null) return;
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    update({ sl: next, season: next.length ? season : null });
  }, [ids, season, update]);

  return useMemo(() => (!ready ? null : {
    ids,
    has: (id: number) => ids.includes(id),
    toggle,
    offer,
    useLinks: () => { if (offer && season !== null) update({ sl: offer, season }); setOffer(null); },
    keepMine: () => setOffer(null),
    notices,
    dismiss: (i: number) => setNotices((n) => n.filter((_, k) => k !== i)),
  }), [ready, ids, toggle, offer, notices, season, update]);
}
