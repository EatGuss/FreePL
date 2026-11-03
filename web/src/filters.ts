import type { SavedPlan } from "./savedPlan.js";
import {
  WINDOW_DEFAULT, WINDOW_MAX, WINDOW_MIN, hiddenByDefault,
  type ClubRow, type PlayerRow, type PositionRow, type TickerSort,
} from "@freepl/contract";

/** App state. Lives in the URL query string so a filtered view can be shared. */
export interface Filters {
  tab: Tab;
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
  /** Fixtures tab (spec 0003): gameweeks shown, and the row order. */
  window: number;
  tickerSort: TickerSort;
  /** Picks tab (spec 0005): max price in tenths, null = any. */
  budget: number | null;
  /** My squad (spec 0004): the team id shown (null = the server's default) and the view. */
  entry: number | null;
  squadView: "pitch" | "list";
  /** Shortlist (spec 0006): element ids, and the season they and the Plan belong to (Q85). */
  sl: number[];
  season: number | null;
  /** Saved Plan (spec 0006 part 2): pe, pgw, plan, xi, bench, c, v; null when none. */
  plan: SavedPlan | null;
}

/** My squad is the landing tab (spec 0004 Q82); Shortlist sits after it (spec 0006 Q91). */
export const TABS = ["squad", "shortlist", "picks", "players", "fixtures", "injury"] as const;
export type Tab = (typeof TABS)[number];
const TICKER_SORTS: readonly TickerSort[] = ["mean", "sum", "count"];

export const GROUP_KEYS = ["Overview", "Attack", "Defence", "Expected", "Value"] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];

export const DEFAULT_FILTERS: Filters = {
  tab: "squad", pos: null, clubs: [], minPrice: null, maxPrice: null, minMinutes: 0, q: "",
  showOut: false, group: "Overview", sort: "epNext", desc: true, window: WINDOW_DEFAULT, tickerSort: "mean",
  budget: null, entry: null, squadView: "pitch", sl: [], season: null, plan: null,
};

const intParam = (s: string | null): number | null => (s !== null && /^\d+$/.test(s) ? Number(s) : null);
/** A team id: a plain positive whole number, as the API accepts. */
export const entryParam = (s: string | null): number | null => (s !== null && /^[1-9]\d{0,9}$/.test(s) ? Number(s) : null);
const ELEMENT_ID = /^[1-9]\d{0,5}$/;
/** Element ids, comma-separated: positive whole numbers, duplicates dropped, order kept. */
const idsParam = (s: string | null): number[] =>
  [...new Set((s ?? "").split(",").filter((x) => ELEMENT_ID.test(x)).map(Number))];
const idParam = (s: string | null): number | null => (s !== null && ELEMENT_ID.test(s) ? Number(s) : null);

/** A Plan from the link, or null unless every required part is there and well formed. */
function planParam(p: URLSearchParams): SavedPlan | null {
  const entry = entryParam(p.get("pe"));
  const gameweek = intParam(p.get("pgw"));
  const raw = p.get("plan");
  const xi = idsParam(p.get("xi"));
  const bench = idsParam(p.get("bench"));
  if (entry === null || gameweek === null || raw === null || xi.length !== 11 || bench.length !== 4) return null;
  const pairs = raw === "" ? [] : raw.split(",").map((t) => t.split(":"));
  if (!pairs.every((x) => x.length === 2 && ELEMENT_ID.test(x[0]!) && ELEMENT_ID.test(x[1]!))) return null;
  return {
    entry, gameweek, xi, bench,
    transfers: pairs.map(([o, i]) => ({ outId: Number(o), inId: Number(i) })),
    captain: idParam(p.get("c")), vice: idParam(p.get("v")),
  };
}

export function filtersFromSearch(search: string): Filters {
  const p = new URLSearchParams(search);
  const group = p.get("group");
  return {
    tab: (TABS as readonly string[]).includes(p.get("tab") ?? "") ? (p.get("tab") as Tab) : "squad",
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
    window: Math.min(WINDOW_MAX, Math.max(WINDOW_MIN, intParam(p.get("gws")) ?? WINDOW_DEFAULT)),
    tickerSort: TICKER_SORTS.includes(p.get("fsort") as TickerSort) ? (p.get("fsort") as TickerSort) : "mean",
    budget: intParam(p.get("budget")),
    entry: entryParam(p.get("entry")),
    squadView: p.get("sview") === "list" ? "list" : "pitch",
    sl: idsParam(p.get("sl")),
    season: intParam(p.get("s")),
    plan: planParam(p),
  };
}

/** Only non-default values go in the URL, so the bare URL is the landing view. */
export function filtersToSearch(f: Filters): string {
  const p = new URLSearchParams();
  if (f.tab !== "squad") p.set("tab", f.tab);
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
  if (f.window !== WINDOW_DEFAULT) p.set("gws", String(f.window));
  if (f.tickerSort !== "mean") p.set("fsort", f.tickerSort);
  if (f.budget !== null) p.set("budget", String(f.budget));
  if (f.entry !== null) p.set("entry", String(f.entry));
  if (f.squadView !== "pitch") p.set("sview", f.squadView);
  if (f.sl.length) p.set("sl", f.sl.join(","));
  if (f.plan) {
    p.set("pe", String(f.plan.entry));
    p.set("pgw", String(f.plan.gameweek));
    p.set("plan", f.plan.transfers.map((t) => `${t.outId}:${t.inId}`).join(","));
    p.set("xi", f.plan.xi.join(","));
    p.set("bench", f.plan.bench.join(","));
    if (f.plan.captain !== null) p.set("c", String(f.plan.captain));
    if (f.plan.vice !== null) p.set("v", String(f.plan.vice));
  }
  // One season tag covers both (Q85).
  if ((f.sl.length || f.plan) && f.season !== null) p.set("s", String(f.season));
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
