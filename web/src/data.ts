import { useQuery } from "@tanstack/react-query";
import type { EntryView, FixturesResponse, PlayersResponse } from "@freepl/contract";
import { useEffect, useState } from "react";

/** The browser's HTTP cache sends If-None-Match, so a repeat load is a 304. */
export function usePlayers() {
  return useQuery({
    queryKey: ["players"],
    queryFn: async () => {
      const res = await fetch("/api/players");
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      // The server parsed and validated this against the contract; re-parsing ~700 rows
      // here would only cost load time.
      return (await res.json()) as PlayersResponse;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** Fixtures for the Fixtures tab (spec 0003); fetched only once that tab is opened. */
export function useFixtures(enabled: boolean) {
  return useQuery({
    queryKey: ["fixtures"],
    queryFn: async () => {
      const res = await fetch("/api/fixtures");
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      return (await res.json()) as FixturesResponse;
    },
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

export interface EntryResponse {
  meta: { sources: { bootstrap: { capturedAt: string }; entry: { fetchedAt: string; stale: boolean } } };
  view: EntryView;
}

/** A typed message for the page: "No FPL team with ID …", "FPL is not answering …". */
export class EntryLoadError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "EntryLoadError"; }
}

/** Spec 0004: an Entry read live from FPL by the API (null id = the server's default team). */
export function useEntry(id: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ["entry", id],
    queryFn: async () => {
      const res = await fetch(id === null ? "/api/entry" : `/api/entry/${id}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new EntryLoadError(body?.error ?? `API returned ${res.status}`, res.status);
      }
      return (await res.json()) as EntryResponse;
    },
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    // A missing team or a bad id won't fix itself by retrying.
    retry: (count, err) => !(err instanceof EntryLoadError && err.status < 500) && count < 2,
  });
}

/** Re-render on a timer so "n hours ago" and the upcoming deadline stay current. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
