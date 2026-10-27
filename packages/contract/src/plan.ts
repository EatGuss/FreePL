import type { EntryView, SquadSlot } from "./entry.js";
import type { PlayerRow, PositionRow } from "./response.js";

/**
 * Spec 0004 transfer what-if and planned lineup: pure functions over the Entry view, client
 * side only, never sent to FPL. Shared with the backtest simulator later, so all the
 * accounting lives here. Rules: docs/fpl-domain.md ("Squad", "Transfers", "Captaincy").
 */

export const HIT_POINTS = 4;
const XI = 11;
const BENCH_GK_SLOT = 12;
const MAX_PER_CLUB = 3;

export interface PlannedTransfer { outId: number; inId: number }

export interface Plan {
  transfers: PlannedTransfer[];
  /** slot (1–15) → player, after moves; starts from the Entry's GW n lineup. */
  lineup: Map<number, number>;
  captainId: number | null;
  viceId: number | null;
}

export interface PlanSlot extends SquadSlot {
  /** Bought in this plan (not on FPL). */
  planned: boolean;
}

export interface PlanResult {
  squad: PlanSlot[];
  bank: number | null;
  sellingValue: number | null;
  /** Free transfers left after pending and planned transfers; null = unlimited. */
  freeTransfersLeft: number | null;
  hitPoints: number;
  overBudgetBy: number;
  /** Clubs with more than 3 players in the planned Squad. */
  clubsOver: number[];
  noCaptain: boolean;
  noVice: boolean;
  formation: string;
}

export function startPlan(view: EntryView): Plan {
  return {
    transfers: [],
    lineup: new Map(view.squad.map((s) => [s.slot, s.playerId])),
    captainId: view.squad.find((s) => s.isCaptain)?.playerId ?? null,
    viceId: view.squad.find((s) => s.isVice)?.playerId ?? null,
  };
}

/** Planned transfer: the new player takes the slot, role and armband of the one sold. */
export function planTransfer(plan: Plan, outId: number, inId: number): Plan {
  const lineup = new Map(plan.lineup);
  const slot = [...lineup].find(([, id]) => id === outId)?.[0];
  if (slot === undefined) throw new Error(`${outId} is not in the planned Squad`);
  lineup.set(slot, inId);
  return {
    transfers: [...plan.transfers, { outId, inId }],
    lineup,
    captainId: plan.captainId === outId ? inId : plan.captainId,
    viceId: plan.viceId === outId ? inId : plan.viceId,
  };
}

/** Undo one planned transfer: the original player returns to the slot (and armband). */
export function undoTransfer(plan: Plan, inId: number): Plan {
  const t = plan.transfers.find((x) => x.inId === inId);
  if (!t) return plan;
  const lineup = new Map(plan.lineup);
  const slot = [...lineup].find(([, id]) => id === inId)?.[0];
  if (slot !== undefined) lineup.set(slot, t.outId);
  return {
    transfers: plan.transfers.filter((x) => x !== t),
    lineup,
    captainId: plan.captainId === inId ? t.outId : plan.captainId,
    viceId: plan.viceId === inId ? t.outId : plan.viceId,
  };
}

type PositionOf = (playerId: number) => PositionRow | undefined;

function xiCounts(lineup: Map<number, number>, positionOf: PositionOf): Map<number, number> {
  const counts = new Map<number, number>();
  for (const [slot, id] of lineup) {
    if (slot > XI) continue;
    const pos = positionOf(id);
    if (pos) counts.set(pos.id, (counts.get(pos.id) ?? 0) + 1);
  }
  return counts;
}

/** XI within every position's element_types min/max starters. */
export function legalFormation(lineup: Map<number, number>, positions: PositionRow[], positionOf: PositionOf): boolean {
  const counts = xiCounts(lineup, positionOf);
  return positions.every((p) => {
    const n = counts.get(p.id) ?? 0;
    return (p.minPlay === null || n >= p.minPlay) && (p.maxPlay === null || n <= p.maxPlay);
  });
}

/** "4-4-2": starters per outfield position, keepers left out. */
export function formationLabel(lineup: Map<number, number>, positions: PositionRow[], positionOf: PositionOf): string {
  const counts = xiCounts(lineup, positionOf);
  return positions.filter((p) => p.maxPlay !== 1).map((p) => counts.get(p.id) ?? 0).join("-");
}

/**
 * Can these two swap? Two starters never (nothing changes). Bench GK (slot 12) only with
 * another keeper. Bench outfield players reorder freely. Starter ↔ bench only if the XI
 * stays legal.
 */
export function canSwap(plan: Plan, a: number, b: number, positions: PositionRow[], positionOf: PositionOf): boolean {
  if (a === b) return false;
  const slotOf = (id: number) => [...plan.lineup].find(([, x]) => x === id)?.[0];
  const sa = slotOf(a), sb = slotOf(b);
  if (sa === undefined || sb === undefined) return false;
  if (sa <= XI && sb <= XI) return false;
  const keeper = (id: number) => positionOf(id)?.maxPlay === 1;
  if ((sa === BENCH_GK_SLOT || sb === BENCH_GK_SLOT) && !(keeper(a) && keeper(b))) return false;
  if (sa > XI && sb > XI) return true;
  return legalFormation(swapped(plan.lineup, sa, sb), positions, positionOf);
}

function swapped(lineup: Map<number, number>, sa: number, sb: number) {
  const next = new Map(lineup);
  next.set(sa, lineup.get(sb)!);
  next.set(sb, lineup.get(sa)!);
  return next;
}

/** Swap two players; an armband that ends up on the bench is cleared (and warned about). */
export function swapPlayers(plan: Plan, a: number, b: number, positions: PositionRow[], positionOf: PositionOf): Plan {
  if (!canSwap(plan, a, b, positions, positionOf)) return plan;
  const slotOf = (id: number) => [...plan.lineup].find(([, x]) => x === id)![0];
  const lineup = swapped(plan.lineup, slotOf(a), slotOf(b));
  const starter = (id: number | null) => id !== null && [...lineup].some(([s, x]) => x === id && s <= XI);
  return { ...plan, lineup, captainId: starter(plan.captainId) ? plan.captainId : null, viceId: starter(plan.viceId) ? plan.viceId : null };
}

/** FPL-style ticks: starters only; ticking the current vice as captain swaps the two. */
export function setArmband(plan: Plan, playerId: number, role: "captain" | "vice"): Plan {
  const isStarter = [...plan.lineup].some(([s, x]) => x === playerId && s <= XI);
  if (!isStarter) return plan;
  if (role === "captain") {
    return { ...plan, captainId: playerId, viceId: plan.viceId === playerId ? plan.captainId : plan.viceId };
  }
  return { ...plan, viceId: playerId, captainId: plan.captainId === playerId ? plan.viceId : plan.captainId };
}

/**
 * The plan's accounting: bank after = bank + Σ sell(out) − Σ now_cost(in); incoming players
 * are valued at now_cost; hits are −4 per transfer beyond the free transfers left. Bank may
 * go negative and a Club may pass 3 — soft limits, reported as warnings.
 */
export function evaluatePlan(view: EntryView, plan: Plan, players: PlayerRow[], positions: PositionRow[]): PlanResult {
  const byId = new Map(players.map((p) => [p.id, p]));
  const posById = new Map(positions.map((p) => [p.id, p]));
  const positionOf = (id: number) => { const p = byId.get(id); return p ? posById.get(p.positionId) : undefined; };
  const original = new Map(view.squad.map((s) => [s.playerId, s]));
  const plannedIn = new Set(plan.transfers.map((t) => t.inId));

  const squad: PlanSlot[] = [...plan.lineup].sort(([a], [b]) => a - b).map(([slot, id]) => {
    const was = original.get(id);
    const now = byId.get(id)?.nowCost ?? null;
    return {
      playerId: id,
      slot,
      isCaptain: plan.captainId === id,
      isVice: plan.viceId === id,
      pendingIn: was?.pendingIn ?? false,
      planned: plannedIn.has(id),
      purchasePrice: was ? was.purchasePrice : now,
      purchaseSource: was ? was.purchaseSource : "transfer",
      sellPrice: was ? was.sellPrice : now,
    };
  });

  const sellOf = (id: number) => original.get(id)?.sellPrice ?? null;
  const priced = plan.transfers.every((t) => sellOf(t.outId) !== null && byId.has(t.inId));
  const base = view.state.bank;
  const bank = base === null || !priced
    ? null
    : plan.transfers.reduce((b, t) => b + sellOf(t.outId)! - byId.get(t.inId)!.nowCost, base);
  const sellingValue = bank !== null && squad.every((s) => s.sellPrice !== null)
    ? squad.reduce((sum, s) => sum + s.sellPrice!, 0) + bank
    : null;

  const ft = view.state.freeTransfers;
  const used = view.state.pendingTransfers + plan.transfers.length;
  const freeTransfersLeft = ft === null ? null : Math.max(0, ft - used);
  const hitPoints = ft === null ? 0 : Math.max(0, used - ft) * HIT_POINTS;

  const perClub = new Map<number, number>();
  for (const s of squad) {
    const club = byId.get(s.playerId)?.clubId;
    if (club !== undefined) perClub.set(club, (perClub.get(club) ?? 0) + 1);
  }

  return {
    squad,
    bank,
    sellingValue,
    freeTransfersLeft,
    hitPoints,
    overBudgetBy: bank !== null && bank < 0 ? -bank : 0,
    clubsOver: [...perClub].filter(([, n]) => n > MAX_PER_CLUB).map(([club]) => club),
    noCaptain: plan.captainId === null,
    noVice: plan.viceId === null,
    formation: formationLabel(plan.lineup, positions, positionOf),
  };
}
