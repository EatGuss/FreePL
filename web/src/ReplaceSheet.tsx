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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ranked = useMemo(() => {
    const score = (p: PlayerRow) => { const r = ratings ? pickRatingFor(p, ratings) : null; return r?.rated ? r.score : -1; };
    return [...candidates].sort((a, b) => score(b) - score(a) || (b.epNext ?? -1) - (a.epNext ?? -1));
  }, [candidates, ratings]);
  const shown = (q ? ranked.filter((p) => fold(`${p.webName} ${p.firstName} ${p.secondName}`).includes(fold(q))) : ranked).slice(0, SHOWN);
  const canPrice = bank !== null && sellPrice !== null;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`Replace ${out.webName}`} onClick={(e) => e.stopPropagation()}>
        <h2>Replace {out.webName}</h2>
        <div className="sub">
          {canPrice ? <>Sells for <b>{formatPrice(sellPrice!)}</b> · bank now {money(bank!)}</> : "Sell price unknown, so the bank after each swap can't be shown."}
        </div>
        <input className="search" type="search" placeholder="Search name" aria-label="Search name" value={q} onChange={(e) => setQ(e.target.value)} />
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
