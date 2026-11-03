import { describe, expect, it } from "vitest";
import type { GameweekRow } from "@freepl/contract";
import { DEFAULT_FILTERS, filtersFromSearch, filtersToSearch } from "../src/filters.js";
import { resolveShortlist, seasonLabel, seasonOf } from "../src/shortlist.js";

const gw = (id: number, iso: string): GameweekRow => ({ id, name: `Gameweek ${id}`, deadlineTime: iso, finished: false, dataChecked: false });

describe("season (spec 0006 Q85)", () => {
  it("is the UTC year of GW1's deadline, whatever order the gameweeks come in", () => {
    expect(seasonOf([gw(20, "2027-01-02T11:00:00Z"), gw(1, "2026-08-14T17:30:00Z")])).toBe(2026);
    expect(seasonOf([])).toBeNull();
  });
  it("labels a season", () => {
    expect(seasonLabel(2025)).toBe("2025/26");
    expect(seasonLabel(2099)).toBe("2099/00");
  });
});

describe("resolveShortlist", () => {
  const now = 2026;
  it("loads a link when this device has nothing", () => {
    expect(resolveShortlist({ season: now, ids: [1, 2] }, null, now)).toEqual({ ids: [1, 2], offer: null, notices: [], clearStored: false });
  });
  it("restores this device's shortlist when the link has none", () => {
    expect(resolveShortlist(null, { season: now, ids: [3] }, now).ids).toEqual([3]);
  });
  it("keeps this device's shortlist and offers the link's when they differ (Q87)", () => {
    const r = resolveShortlist({ season: now, ids: [1, 2] }, { season: now, ids: [3] }, now);
    expect(r).toMatchObject({ ids: [3], offer: [1, 2], notices: [] });
  });
  it("asks nothing when they hold the same players in another order", () => {
    expect(resolveShortlist({ season: now, ids: [2, 1] }, { season: now, ids: [1, 2] }, now).offer).toBeNull();
  });
  it("drops a last-season link even though its ids exist this season", () => {
    const r = resolveShortlist({ season: 2025, ids: [1, 2] }, null, now);
    expect(r.ids).toEqual([]);
    expect(r.notices).toEqual(["This link's shortlist is from the 2025/26 season, so its players can't be matched. It was not loaded."]);
  });
  it("drops a link with no season", () => {
    expect(resolveShortlist({ season: null, ids: [1] }, null, now).ids).toEqual([]);
  });
  it("clears a last-season stored shortlist, and a valid link then loads without asking", () => {
    const r = resolveShortlist({ season: now, ids: [1] }, { season: 2025, ids: [3] }, now);
    expect(r).toMatchObject({ ids: [1], offer: null, clearStored: true });
    expect(r.notices).toEqual(["Your saved shortlist was from the 2025/26 season, so it was cleared."]);
  });
});

describe("shortlist in the URL", () => {
  it("round-trips ids and season, dropping bad and repeated ids", () => {
    const f = filtersFromSearch("?sl=12,345,12,x,0&s=2026");
    expect(f).toMatchObject({ sl: [12, 345], season: 2026 });
    expect(filtersToSearch(f)).toBe("?sl=12%2C345&s=2026");
  });
  it("leaves both out when the shortlist is empty", () => {
    expect(filtersToSearch({ ...DEFAULT_FILTERS, season: 2026 })).toBe("");
  });
  it("has a Shortlist tab", () => {
    expect(filtersFromSearch("?tab=shortlist").tab).toBe("shortlist");
  });
});
