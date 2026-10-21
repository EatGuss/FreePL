import { useQuery } from "@tanstack/react-query";
import type { FixturesResponse, PlayersResponse } from "@freepl/contract";
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

/** Re-render on a timer so "n hours ago" and the upcoming deadline stay current. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
