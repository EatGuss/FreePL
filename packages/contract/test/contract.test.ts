import { describe, expect, it } from "vitest";
import {
  ContractError, ageHours, availabilityFor, buildPlayersResponse, fplDecimal, formatPrice,
  freshnessLevel, hiddenByDefault, thresholdsFor, upcomingGameweek,
} from "../src/index.js";
import { bootstrap, player } from "./fixtures.js";

describe("fplDecimal", () => {
  it("parses decimal strings and JSON numbers", () => {
    expect(fplDecimal.parse("4.65")).toBe(4.65);
    expect(fplDecimal.parse("-1")).toBe(-1);
    expect(fplDecimal.parse(0.78)).toBe(0.78);
    expect(fplDecimal.parse("0")).toBe(0);
  });
  it("keeps null as null, never 0", () => {
    expect(fplDecimal.parse(null)).toBeNull();
  });
  it("fails loudly on anything else", () => {
    for (const bad of ["", "abc", "1,5", "1.", ".5", "1e3", Number.NaN, Number.POSITIVE_INFINITY, undefined, true]) {
      expect(fplDecimal.safeParse(bad).success, String(bad)).toBe(false);
    }
  });
});

describe("formatPrice", () => {
  it("renders integer tenths without float division", () => {
    expect(formatPrice(75)).toBe("£7.5m");
    expect(formatPrice(40)).toBe("£4.0m");
    expect(formatPrice(145)).toBe("£14.5m");
    expect(formatPrice(0)).toBe("£0.0m");
  });
  it("rejects non-integers and negatives", () => {
    expect(() => formatPrice(7.5)).toThrow();
    expect(() => formatPrice(-5)).toThrow();
  });
});

describe("availability", () => {
  it("maps statuses per spec 0002", () => {
    expect(availabilityFor("a", null)).toEqual({ level: "available" });
    expect(availabilityFor("d", 75)).toEqual({ level: "doubtful", chance: 75, label: "Doubtful" });
    expect(availabilityFor("s", 0)).toEqual({ level: "out", label: "Suspended" });
    expect(["a", "d", "i", "s", "u", "n"].filter((s) => hiddenByDefault(s as "a"))).toEqual(["i", "s", "u", "n"]);
  });
});

describe("freshness", () => {
  it("derives thresholds from the routine interval", () => {
    expect(thresholdsFor("bootstrap")).toEqual({ amberAfter: 13, redAfter: 22 });
    expect(thresholdsFor("fixtures")).toEqual({ amberAfter: 25, redAfter: 46 });
  });
  it("levels by age", () => {
    expect(freshnessLevel("bootstrap", 13)).toBe("fresh");
    expect(freshnessLevel("bootstrap", 13.01)).toBe("amber");
    expect(freshnessLevel("bootstrap", 22.01)).toBe("red");
  });
  it("computes age from two instants", () => {
    const now = Date.parse("2030-08-20T12:00:00Z");
    expect(ageHours("2030-08-20T09:00:00Z", now)).toBe(3);
    expect(ageHours("2030-08-20T10:00:00+01:00", now)).toBe(3);
    expect(() => ageHours("nope", now)).toThrow();
  });
});

describe("buildPlayersResponse", () => {
  it("parses synthetic rows into the response shape", () => {
    const res = buildPlayersResponse(bootstrap());
    expect(res.meta.sources.bootstrap.capturedAt).toBe("2030-08-20T09:00:00.000Z");
    expect(res.positions.map((p) => p.short)).toEqual(["GKP", "DEF", "MID", "FWD"]);
    expect(res.gameweeks.map((g) => g.id)).toEqual([1, 2]);
    expect(res.gameweeks[0]?.deadlineTime).toBe("2030-08-15T17:30:00.000Z");
    const p = res.players[0]!;
    expect(p.nowCost).toBe(45);
    expect(p.code).toBe(100001);
    expect(p.epNext).toBeNull();
    expect(p.epThis).toBe(3);
    expect(p.xGCPer90).toBe(1.22);
    expect(p.clubId).toBe(1);
    expect(p.positionId).toBe(1);
  });
  it("leaves no float price anywhere", () => {
    const res = buildPlayersResponse(bootstrap([player({ now_cost: 75 })]));
    expect(Number.isInteger(res.players[0]!.nowCost)).toBe(true);
  });
  it("fails loudly on an element_type with no position", () => {
    expect(() => buildPlayersResponse(bootstrap([player({ element_type: 9 })]))).toThrow(ContractError);
  });
  it("fails loudly on a team with no club", () => {
    expect(() => buildPlayersResponse(bootstrap([player({ team: 7 })]))).toThrow(/no club/);
  });
  it("fails loudly on an unparseable numeric instead of zero-filling", () => {
    expect(() => buildPlayersResponse(bootstrap([player({ form: "" })]))).toThrow(/form/);
  });
  it("fails loudly on a missing column", () => {
    const { ep_next: _drop, ...rest } = player();
    expect(() => buildPlayersResponse(bootstrap([rest as never]))).toThrow(/ep_next/);
  });
  it("fails loudly on an unknown status", () => {
    expect(() => buildPlayersResponse(bootstrap([player({ status: "x" })]))).toThrow(/status/);
  });
  it("rejects a float now_cost", () => {
    expect(() => buildPlayersResponse(bootstrap([player({ now_cost: 7.5 })]))).toThrow(/now_cost/);
  });
});

describe("upcomingGameweek", () => {
  it("is the first deadline after now", () => {
    const { gameweeks } = buildPlayersResponse(bootstrap());
    expect(upcomingGameweek(gameweeks, Date.parse("2030-08-16T00:00:00Z"))?.id).toBe(2);
    expect(upcomingGameweek(gameweeks, Date.parse("2030-08-01T00:00:00Z"))?.id).toBe(1);
    expect(upcomingGameweek(gameweeks, Date.parse("2031-01-01T00:00:00Z"))).toBeNull();
  });
});

import { CLUB_COLOURS, KEEPER_SHIRT, NEUTRAL_SHIRT, shirtFor } from "../src/index.js";
describe("shirtFor", () => {
  it("uses the Club's colours, the keeper kit for keepers, and the neutral kit for an unknown Club", () => {
    expect(shirtFor("ARS", false)).toEqual(CLUB_COLOURS.ARS);
    expect(shirtFor("ARS", true)).toBe(KEEPER_SHIRT);
    expect(shirtFor("XYZ", false)).toBe(NEUTRAL_SHIRT);
    expect(Object.keys(CLUB_COLOURS)).toHaveLength(20);
  });
});
