import { describe, expect, it } from "vitest";
import { buildPlayersResponse } from "@freepl/contract";
import { bootstrap, player } from "@freepl/contract/test-fixtures";
import { DEFAULT_FILTERS, applyFilters, filtersFromSearch, filtersToSearch, injuryWatch, makeLookups } from "../src/filters.js";

const data = buildPlayersResponse(
  bootstrap([
    player({ id: 1, web_name: "Test Keeper", element_type: 1, team: 1, now_cost: 45, minutes: 900 }),
    player({ id: 2, web_name: "Défenseur", element_type: 2, team: 2, now_cost: 55, minutes: 300 }),
    player({ id: 3, web_name: "Mid Doubt", element_type: 3, team: 1, now_cost: 80, status: "d", chance_of_playing_next_round: 75, news: "Knock", news_added: "2030-08-19T10:00:00Z" }),
    player({ id: 4, web_name: "Fwd Out", element_type: 4, team: 2, now_cost: 100, status: "i", chance_of_playing_next_round: 0, news: "Hamstring", news_added: "2030-08-20T08:00:00Z" }),
    player({ id: 5, web_name: "Mid Banned", element_type: 3, team: 2, now_cost: 60, status: "s", news: "Suspended", news_added: null }),
  ]),
);
const l = makeLookups(data.clubs, data.positions);
const ids = (f: Partial<typeof DEFAULT_FILTERS>) => applyFilters(data.players, { ...DEFAULT_FILTERS, ...f }, l).rows.map((p) => p.id);

describe("applyFilters", () => {
  it("hides i/s/u/n by default and counts them; d stays", () => {
    const r = applyFilters(data.players, DEFAULT_FILTERS, l);
    expect(r.rows.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(r.hiddenOut).toBe(2);
    expect(ids({ showOut: true })).toEqual([1, 2, 3, 4, 5]);
  });
  it("filters by position short name from element_types", () => {
    expect(ids({ pos: "MID", showOut: true })).toEqual([3, 5]);
  });
  it("filters by clubs, price range and minutes", () => {
    expect(ids({ clubs: ["BBB"], showOut: true })).toEqual([2, 4, 5]);
    expect(ids({ minPrice: 50, maxPrice: 80 })).toEqual([2, 3]);
    expect(ids({ minMinutes: 450 })).toEqual([1, 3]);
  });
  it("searches names ignoring case and accents", () => {
    expect(ids({ q: "defens" })).toEqual([2]);
    expect(ids({ q: "KEEPER" })).toEqual([1, 2, 3]);
  });
});

describe("URL state", () => {
  it("round-trips non-default filters and leaves the landing URL bare", () => {
    expect(filtersToSearch(DEFAULT_FILTERS)).toBe("");
    const f = { ...DEFAULT_FILTERS, tab: "injury" as const, pos: "DEF", clubs: ["AAA", "BBB"], maxPrice: 80, minMinutes: 270, q: "x", showOut: true, group: "Attack" as const, sort: "xG", desc: false };
    expect(filtersFromSearch(filtersToSearch(f))).toEqual(f);
  });
  it("keeps the Fixtures tab's window and sort in the URL, clamped to 3–10", () => {
    const f = { ...DEFAULT_FILTERS, tab: "fixtures" as const, window: 8, tickerSort: "count" as const };
    expect(filtersToSearch(f)).toBe("?tab=fixtures&gws=8&fsort=count");
    expect(filtersToSearch({ ...DEFAULT_FILTERS, tab: "players" })).toBe("?tab=players");
    expect(filtersToSearch({ ...DEFAULT_FILTERS, tab: "picks" })).toBe("?tab=picks");
    expect(filtersFromSearch("?entry=1234567&sview=list")).toMatchObject({ tab: "squad", entry: 1234567, squadView: "list" });
    expect(filtersFromSearch("?entry=12ab").entry).toBeNull();
    expect(filtersFromSearch("?budget=65").budget).toBe(65);
    expect(filtersFromSearch(filtersToSearch(f))).toEqual(f);
    expect(filtersFromSearch("?gws=40").window).toBe(10);
    expect(filtersFromSearch("?gws=1").window).toBe(3);
    expect(filtersFromSearch("?fsort=nope&tab=nope")).toEqual(DEFAULT_FILTERS);
  });
  it("ignores junk values", () => {
    expect(filtersFromSearch("?maxp=abc&group=Nope&mins=-5")).toEqual(DEFAULT_FILTERS);
  });
});

describe("injuryWatch", () => {
  it("lists every non-a status, newest news first, undated last", () => {
    expect(injuryWatch(data.players).map((p) => p.id)).toEqual([4, 3, 5]);
  });
});
