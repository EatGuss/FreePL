import { useCallback, useEffect, useState } from "react";
import { filtersFromSearch, filtersToSearch, type Filters } from "./filters.js";

export function useFilters(): [Filters, (patch: Partial<Filters>) => void] {
  const [filters, setFilters] = useState(() => filtersFromSearch(window.location.search));

  useEffect(() => {
    const onPop = () => setFilters(filtersFromSearch(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const update = useCallback((patch: Partial<Filters>) => {
    setFilters((prev) => {
      const next = { ...prev, ...patch };
      const url = `${window.location.pathname}${filtersToSearch(next)}`;
      // A tab switch is a history entry; filter tweaks replace it.
      if (patch.tab && patch.tab !== prev.tab) window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
      return next;
    });
  }, []);

  return [filters, update];
}
