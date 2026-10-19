import { hiddenByDefault, type ClubRow, type PlayerRow, type PositionRow } from "@freepl/contract";

/** Players-tab state. Lives in the URL query string so a filtered view can be shared. */
export interface Filters {
  tab: "players" | "injury";
  pos: string | null; // position short name from element_types, e.g. "MID"
  clubs: string[]; // Club short names
  minPrice: number | null; // tenths
  maxPrice: number | null; // tenths
  minMinutes: number;
  q: string;
  showOut: boolean;
  group: GroupKey;
  sort: string;
  desc: boolean;
}

export const GROUP_KEYS = ["Overview", "Attack", "Defence", "Expected", "Value"] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];

export const DEFAULT_FILTERS: Filters = {
  tab: "players", pos: null, clubs: [], minPrice: null, maxPrice: null, minMinutes: 0, q: "",
  showOut: false, group: "Overview", sort: "epNext", desc: true,
};

const intParam = (s: string | null): number | null => (s !== null && /^\d+$/.test(s) ? Number(s) : null);

export function filtersFromSearch(search: string): Filters {
  const p = new URLSearchParams(search);
  const group = p.get("group");
  return {
    tab: p.get("tab") === "injury" ? "injury" : "players",
    pos: p.get("pos") || null,
    clubs: (p.get("club") ?? "").split(",").filter(Boolean),
    minPrice: intParam(p.get("minp")),
    maxPrice: intParam(p.get("maxp")),
    minMinutes: intParam(p.get("mins")) ?? 0,
    q: p.get("q") ?? "",
    showOut: p.get("out") === "1",
    group: (GROUP_KEYS as readonly string[]).includes(group ?? "") ? (group as GroupKey) : "Overview",
    sort: p.get("sort") || DEFAULT_FILTERS.sort,
    desc: p.get("dir") !== "asc",
  };
}

/** Only non-default values go in the URL, so the bare URL is the landing view. */
export function filtersToSearch(f: Filters): string {
  const p = new URLSearchParams();
  if (f.tab !== "players") p.set("tab", f.tab);
  if (f.pos) p.set("pos", f.pos);
  if (f.clubs.length) p.set("club", f.clubs.join(","));
  if (f.minPrice !== null) p.set("minp", String(f.minPrice));
  if (f.maxPrice !== null) p.set("maxp", String(f.maxPrice));
  if (f.minMinutes) p.set("mins", String(f.minMinutes));
  if (f.q) p.set("q", f.q);
  if (f.showOut) p.set("out", "1");
  if (f.group !== "Overview") p.set("group", f.group);
  if (f.sort !== DEFAULT_FILTERS.sort) p.set("sort", f.sort);
  if (!f.desc) p.set("dir", "asc");
  const s = p.toString();
  return s ? `?${s}` : "";
}

export interface Lookups {
  clubById: Map<number, ClubRow>;
  positionById: Map<number, PositionRow>;
}

export function makeLookups(clubs: ClubRow[], positions: PositionRow[]): Lookups {
  return {
    clubById: new Map(clubs.map((c) => [c.id, c])),
    positionById: new Map(positions.map((p) => [p.id, p])),
  };
}

/** Accent- and case-insensitive name match on web, first and second names. */
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Everything but "show unavailable"; returns the shown rows and how many that toggle hides. */
export function applyFilters(players: PlayerRow[], f: Filters, l: Lookups): { rows: PlayerRow[]; hiddenOut: number } {
  const q = fold(f.q.trim());
  const clubs = new Set(f.clubs);
  const base = players.filter((p) => {
    if (f.pos && l.positionById.get(p.positionId)?.short !== f.pos) return false;
    if (clubs.size && !clubs.has(l.clubById.get(p.clubId)?.short ?? "")) return false;
    if (f.minPrice !== null && p.nowCost < f.minPrice) return false;
    if (f.maxPrice !== null && p.nowCost > f.maxPrice) return false;
    if (f.minMinutes && (p.minutes ?? 0) < f.minMinutes) return false;
    if (q && !fold(`${p.webName} ${p.firstName} ${p.secondName}`).includes(q)) return false;
    return true;
  });
  const out = base.filter((p) => hiddenByDefault(p.status));
  return { rows: f.showOut ? base : base.filter((p) => !hiddenByDefault(p.status)), hiddenOut: f.showOut ? 0 : out.length };
}

/** Injury watch: every status other than a, newest news first; undated news last. */
export function injuryWatch(players: PlayerRow[]): PlayerRow[] {
  return players
    .filter((p) => p.status !== "a")
    .sort((a, b) => (b.newsAdded ? Date.parse(b.newsAdded) : -Infinity) - (a.newsAdded ? Date.parse(a.newsAdded) : -Infinity) || a.id - b.id);
}
