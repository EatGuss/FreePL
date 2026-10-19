import { ageHours, formatPrice, type PlayersResponse } from "@freepl/contract";
import { useMemo } from "react";
import { Flag } from "./Flag.js";
import { injuryWatch, makeLookups } from "./filters.js";
import { ago } from "./format.js";

export function InjuryTab({ data, now }: { data: PlayersResponse; now: number }) {
  const lookups = useMemo(() => makeLookups(data.clubs, data.positions), [data]);
  const flagged = useMemo(() => injuryWatch(data.players), [data]);
  if (!flagged.length) return <p className="notice">No flagged players.</p>;
  return (
    <section className="injury-list">
      {flagged.map((p) => (
        <div className="inj" key={p.id}>
          <div className="who">{p.webName} <Flag player={p} long /></div>
          <div className="when">{p.newsAdded ? ago(ageHours(p.newsAdded, now)) : ""}</div>
          <div className="news">{p.news || "No news text."}</div>
          <div className="meta">
            {lookups.clubById.get(p.clubId)?.short} · {lookups.positionById.get(p.positionId)?.short} · {formatPrice(p.nowCost)}
            {" · "}chance next round: {p.chanceNextRound === null ? "—" : `${p.chanceNextRound}%`}
          </div>
        </div>
      ))}
    </section>
  );
}
