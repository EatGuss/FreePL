import { z } from "zod";
import { ContractError, type GameweekRow, type PlayerRow } from "./response.js";

/**
 * Spec 0004: the Entry view, rebuilt from FPL's public entry endpoints (ADR 0003 — read
 * live, never stored). Money is integer tenths throughout. Rules: docs/fpl-domain.md.
 */

// ---------- raw FPL shapes (validated before use; unknown keys ignored) ----------

const int = z.number().int();

export const RawEntrySummary = z.object({
  id: int,
  name: z.string(),
  player_first_name: z.string(),
  player_last_name: z.string(),
});
export type RawEntrySummary = z.input<typeof RawEntrySummary>;

export const RawHistory = z.object({
  current: z.array(z.object({
    event: int,
    points: int,
    total_points: int,
    overall_rank: int.nullable(),
    bank: int,
    value: int,
    event_transfers: int,
    event_transfers_cost: int,
  })),
  chips: z.array(z.object({ name: z.string(), event: int })),
});
export type RawHistory = z.input<typeof RawHistory>;

export const RawTransfer = z.object({
  element_in: int,
  element_in_cost: int,
  element_out: int,
  element_out_cost: int,
  event: int,
  time: z.string(),
});
export type RawTransfer = z.input<typeof RawTransfer>;
export const RawTransfers = z.array(RawTransfer);

export const RawPicks = z.object({
  active_chip: z.string().nullable(),
  picks: z.array(z.object({
    element: int,
    position: int,
    is_captain: z.boolean(),
    is_vice_captain: z.boolean(),
  })),
});
export type RawPicks = z.input<typeof RawPicks>;

// ---------- pure rules ----------

/** fpl-domain "Money": half the rise, rounded down; losses taken in full. */
export function sellPrice(purchase: number, now: number): number {
  return now > purchase ? purchase + Math.floor((now - purchase) / 2) : now;
}

export const CHIPS = ["wildcard", "freehit", "bboost", "3xc"] as const;
export type Chip = (typeof CHIPS)[number];
export const CHIP_LABEL: Record<Chip, string> = { wildcard: "Wildcard", freehit: "Free Hit", bboost: "Bench Boost", "3xc": "Triple Captain" };
const FT_CAP = 5;
const SET1_LAST_GW = 19;

/**
 * Free transfers available for gameweek `target` (fpl-domain "Transfers" and "Chips"):
 * GW2 starts with 1; after a Wildcard or Free Hit gameweek the count is unchanged; otherwise
 * min(5, max(ft − transfers made, 0) + 1). `event_transfers` already excludes chip
 * transfers. null before GW2, when transfers are unlimited.
 */
export function freeTransfersFor(target: number, history: z.output<typeof RawHistory>): number | null {
  if (target < 2) return null;
  const made = new Map(history.current.map((h) => [h.event, h.event_transfers]));
  const chipIn = new Map(history.chips.map((c) => [c.event, c.name]));
  let ft = 1; // available for GW2
  for (let gw = 2; gw < target; gw++) {
    const chip = chipIn.get(gw);
    if (chip === "wildcard" || chip === "freehit") continue;
    ft = Math.min(FT_CAP, Math.max(ft - (made.get(gw) ?? 0), 0) + 1);
  }
  return ft;
}

// ---------- the view ----------

export interface SquadSlot {
  playerId: number;
  /** 1–11 starting XI, 12–15 bench in order, from the latest started gameweek's picks. */
  slot: number;
  isCaptain: boolean;
  isVice: boolean;
  /** Bought for the upcoming gameweek; replaced the player who held this slot. */
  pendingIn: boolean;
  purchasePrice: number | null;
  purchaseSource: "transfer" | "launch" | null;
  /** null for every player when any purchase price is unknown (all or nothing). */
  sellPrice: number | null;
}

export interface ChipStatus { chip: Chip; set: 1 | 2; usedIn: number | null }

export interface EntryView {
  entry: { id: number; name: string; manager: string };
  /** The gameweek whose deadline passed most recently; null before the GW1 deadline. */
  gameweek: number | null;
  squad: SquadSlot[];
  state: {
    bank: number | null;
    sellingValue: number | null;
    /** FPL's own figure for `gameweek` (`history.value`): frozen at that gameweek. */
    squadValue: number | null;
    /**
     * Live squad value: current prices of the 15 held now (pending transfers included), bank
     * excluded — what the FPL site labels "Squad value" (verified 2026-10-27, fpl-domain.md
     * "Money"). Display only; budgets use the selling value.
     */
    squadValueLive: number | null;
    freeTransfers: number | null;
    pendingTransfers: number;
    gwPoints: number | null;
    totalPoints: number | null;
    overallRank: number | null;
    chips: ChipStatus[];
    set1ExpiresAt: string | null;
  };
}

export interface EntryInput {
  summary: unknown;
  history: unknown;
  transfers: unknown;
  /** picks for `gameweek`, and for `gameweek − 1` when a Free Hit was played in it. */
  picks: unknown | null;
  picksBeforeFreeHit?: unknown | null;
  gameweek: number | null;
  players: PlayerRow[];
  gameweeks: GameweekRow[];
}

/** The gameweek whose deadline passed most recently (picks are public from then). */
export function lastStartedGameweek(gameweeks: GameweekRow[], nowMs: number = Date.now()): number | null {
  let n: number | null = null;
  for (const g of gameweeks) if (Date.parse(g.deadlineTime) <= nowMs) n = g.id;
  return n;
}

function parse<S extends z.ZodTypeAny>(schema: S, value: unknown, what: string): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new ContractError(`unexpected ${what} shape`, r.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`));
  return r.data;
}

export function buildEntryView(input: EntryInput): EntryView {
  const summary = parse(RawEntrySummary, input.summary, "entry");
  const history = parse(RawHistory, input.history, "history");
  const transfers = parse(RawTransfers, input.transfers, "transfers");
  const n = input.gameweek;
  const set1Deadline = input.gameweeks.find((g) => g.id === SET1_LAST_GW)?.deadlineTime ?? null;
  const chips: ChipStatus[] = ([1, 2] as const).flatMap((set) =>
    CHIPS.map((chip) => {
      const used = history.chips.find((c) => c.name === chip && (set === 1 ? c.event <= SET1_LAST_GW : c.event > SET1_LAST_GW));
      return { chip, set, usedIn: used?.event ?? null };
    }));
  const entry = { id: summary.id, name: summary.name, manager: `${summary.player_first_name} ${summary.player_last_name}`.trim() };

  if (n === null || input.picks === null) {
    return {
      entry, gameweek: n, squad: [],
      state: {
        bank: null, sellingValue: null, squadValue: null, squadValueLive: null, freeTransfers: null, pendingTransfers: 0,
        gwPoints: null, totalPoints: null, overallRank: null, chips, set1ExpiresAt: set1Deadline,
      },
    };
  }

  const picksN = parse(RawPicks, input.picks, "picks");
  // Free Hit in n: picks(n) is the temporary Squad; the real one is picks(n − 1).
  const base = picksN.active_chip === "freehit"
    ? parse(RawPicks, input.picksBeforeFreeHit, "picks before the Free Hit")
    : picksN;

  // Pending = transfers for the upcoming gameweek, applied in time order (a Wildcard can
  // buy and sell the same player in two batches).
  const pending = transfers.filter((t) => t.event === n + 1).sort((a, b) => a.time.localeCompare(b.time));
  const slots = base.picks
    .map((p) => ({ playerId: p.element, slot: p.position, isCaptain: p.is_captain, isVice: p.is_vice_captain, pendingIn: false }))
    .sort((a, b) => a.slot - b.slot);
  for (const t of pending) {
    const s = slots.find((x) => x.playerId === t.element_out);
    if (!s) throw new ContractError(`pending transfer sells ${t.element_out}, who is not in the Squad`);
    // The armband belongs to the player, not the slot; the real upcoming captain is private.
    Object.assign(s, { playerId: t.element_in, pendingIn: true, isCaptain: false, isVice: false });
  }
  if (slots.length !== 15) throw new ContractError(`Squad has ${slots.length} players, expected 15`);

  const byId = new Map(input.players.map((p) => [p.id, p]));
  // Purchase price: the latest transfer that brought the player in, else the launch price.
  const latestIn = new Map<number, RawTransfer>();
  for (const t of transfers) {
    const prev = latestIn.get(t.element_in);
    if (!prev || prev.time < t.time) latestIn.set(t.element_in, t);
  }
  const priced = slots.map((s) => {
    const t = latestIn.get(s.playerId);
    if (t) return { ...s, purchasePrice: t.element_in_cost, purchaseSource: "transfer" as const };
    const p = byId.get(s.playerId);
    if (p && p.costChangeStart !== null) return { ...s, purchasePrice: p.nowCost - p.costChangeStart, purchaseSource: "launch" as const };
    return { ...s, purchasePrice: null, purchaseSource: null };
  });
  const allKnown = priced.every((s) => s.purchasePrice !== null && byId.has(s.playerId));
  const squad: SquadSlot[] = priced.map((s) => ({
    ...s,
    sellPrice: allKnown ? sellPrice(s.purchasePrice!, byId.get(s.playerId)!.nowCost) : null,
  }));

  const row = history.current.find((h) => h.event === n) ?? null;
  const bank = row === null ? null : row.bank + pending.reduce((sum, t) => sum + t.element_out_cost - t.element_in_cost, 0);
  const sellingValue = allKnown && bank !== null ? squad.reduce((sum, s) => sum + s.sellPrice!, 0) + bank : null;
  const allPriced = squad.every((s) => byId.has(s.playerId));
  const squadValueLive = allPriced ? squad.reduce((sum, s) => sum + byId.get(s.playerId)!.nowCost, 0) : null;

  return {
    entry,
    gameweek: n,
    squad,
    state: {
      bank,
      sellingValue,
      squadValue: row?.value ?? null,
      squadValueLive,
      freeTransfers: freeTransfersFor(n + 1, history),
      pendingTransfers: pending.length,
      gwPoints: row?.points ?? null,
      totalPoints: row?.total_points ?? null,
      overallRank: row?.overall_rank ?? null,
      chips,
      set1ExpiresAt: set1Deadline,
    },
  };
}
