import { useEffect, useMemo, useState } from "react";
import {
  BAND_LABEL, formatPrice, pickRatingFor, type ClubRow, type PlayerRow, type RatingContext,
} from "@freepl/contract";
import { Flag } from "./Flag.js";

const SHOWN = 40;
const money = (t: number) => (t < 0 ? `−${formatPrice(-t)}` : formatPrice(t));
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * Same-position replacements for a Squad player (spec 0004 "Transfer what-if"), ordered by
 * pick rating, each with the bank after the swap. Over-budget choices are allowed and
 * marked: a plan is a draft.
 */
export function ReplaceSheet({ out, sellPrice, bank, candidates, ratings, clubById, onPick, onClose }: {
  out: PlayerRow; sellPrice: number | null; bank: number | null; candidates: PlayerRow[];
  ratings: RatingContext | null; clubById: Map<number, ClubRow>; onPick: (inId: number) => void; onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [club, setClub] = useState<number | null>(null);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [affordable, setAffordable] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ranked = useMemo(() => {
    const score = (p: PlayerRow) => { const r = ratings ? pickRatingFor(p, ratings) : null; return r?.rated ? r.score : -1; };
    return [...candidates].sort((a, b) => score(b) - score(a) || (b.epNext ?? -1) - (a.epNext ?? -1));
  }, [candidates, ratings]);
  const canPrice = bank !== null && sellPrice !== null;
  const budget = canPrice ? bank! + sellPrice! : null;
  const prices = candidates.map((p) => p.nowCost);
  const lo = Math.floor(Math.min(...prices, 40) / 5) * 5;
  const hi = Math.ceil(Math.max(...prices, 40) / 5) * 5;
  const clubs = [...new Set(candidates.map((p) => p.clubId))].map((id) => clubById.get(id)).filter((c): c is ClubRow => !!c)
    .sort((a, b) => a.short.localeCompare(b.short));
  const filtered = ranked.filter((p) =>
    (!q || fold(`${p.webName} ${p.firstName} ${p.secondName}`).includes(fold(q))) &&
    (club === null || p.clubId === club) &&
    (maxPrice === null || p.nowCost <= maxPrice) &&
    (!affordable || budget === null || p.nowCost <= budget));
  const shown = filtered.slice(0, SHOWN);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`Replace ${out.webName}`} onClick={(e) => e.stopPropagation()}>
        <h2>Replace {out.webName}</h2>
        <div className="sub">
          {canPrice ? <>Sells for <b>{formatPrice(sellPrice!)}</b> · bank now {money(bank!)}</> : "Sell price unknown, so the bank after each swap can't be shown."}
        </div>
        <input className="search" type="search" placeholder="Search name" aria-label="Search name" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <select className="numin" style={{ width: "auto" }} aria-label="Club" value={club ?? ""}
            onChange={(e) => setClub(e.target.value === "" ? null : Number(e.target.value))}>
            <option value="">All Clubs</option>
            {clubs.map((c) => <option key={c.id} value={c.id}>{c.short} · {c.name}</option>)}
          </select>
          {budget !== null && (
            <button type="button" className="chip small" aria-pressed={affordable} onClick={() => setAffordable((a) => !a)}>
              Affordable only (≤ {formatPrice(budget)})
            </button>
          )}
        </div>
        <div className="price-row">
          <label htmlFor="rmax">Max price</label>
          <input id="rmax" type="range" min={lo} max={hi} step={5} value={maxPrice ?? hi}
            onChange={(e) => { const v = Number(e.target.value); setMaxPrice(v >= hi ? null : v); }} />
          <output htmlFor="rmax">{maxPrice === null ? "Any" : formatPrice(maxPrice)}</output>
        </div>
        <div className="sub">{filtered.length} player{filtered.length === 1 ? "" : "s"}{filtered.length > SHOWN ? `, top ${SHOWN} shown` : ""}</div>
        <div className="cands">
          {shown.map((p) => {
            const r = ratings ? pickRatingFor(p, ratings) : null;
            const after = canPrice ? bank! + sellPrice! - p.nowCost : null;
            return (
              <button key={p.id} type="button" className="cand" onClick={() => onPick(p.id)}>
                <span>
                  <b>{p.webName}</b> <Flag player={p} /> · {r?.rated ? BAND_LABEL[r.band] : "Not rated"} · {clubById.get(p.clubId)?.short} · {formatPrice(p.nowCost)}
                </span>
                <span className="after" style={after !== null && after < 0 ? { color: "var(--bad)" } : undefined}>
                  {after === null ? "" : money(after)}
                </span>
                <span className="why">{after !== null && after < 0 ? `Over budget by ${formatPrice(-after)}` : "Bank after this swap"}</span>
              </button>
            );
          })}
          {shown.length === 0 && <div className="sub">No one matches.</div>}
        </div>
        <button type="button" className="chip close" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
