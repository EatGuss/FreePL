import type { ScorecardGameweek, ScorecardResponse } from "@freepl/contract";
import { localDateTime } from "./format.js";

const SOURCE_LABEL: Record<string, string> = { fpl_ep_next: "FPL's ep_next", last5: "Last-5 average" };
type SourceKey = { source: string; modelVersion: string | null };
const sameSource = (a: SourceKey, b: SourceKey) => a.source === b.source && a.modelVersion === b.modelVersion;
const sourceLabel = (s: SourceKey) => `${SOURCE_LABEL[s.source] ?? s.source}${s.modelVersion ? ` (v${s.modelVersion})` : ""}`;
/** Short column heading: "ep_next", "Last-5 v1". */
const sourceShort = (s: SourceKey) =>
  s.source === "fpl_ep_next" ? "ep_next" : `${s.source === "last5" ? "Last-5" : s.source}${s.modelVersion ? ` v${s.modelVersion}` : ""}`;
const TARGET_PERCENTILE = 40;

const rank = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-GB"));
const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`);

/** "45 min before" / "3h 12m before": how long before its deadline the projection was captured. */
function lead(capturedAt: string, deadline: string): string {
  const min = Math.round((Date.parse(deadline) - Date.parse(capturedAt)) / 60_000);
  return min < 60 ? `${min} min before` : `${Math.floor(min / 60)}h ${min % 60}m before`;
}

/**
 * Spec 0008: the scorecard. Unlisted (Q100): opened by ?tab=scorecard, in no tab bar. Every
 * figure comes from captures taken before each deadline and settled points after it; gameweeks
 * managed by hand are shown but never count towards the model's median (Q99). Spec 0009 adds the
 * decision log's projections beside ep_next, one MAE column each, all over the same players (Q113).
 */
export function ScorecardTab({ data }: { data: ScorecardResponse }) {
  const { summary, meta } = data;
  const median = summary.entry.medianGwPercentile;
  const sources: SourceKey[] = summary.projections;
  return (
    <section className="flex flex-col gap-2.5">
      <p className="notice">
        <b>Not public yet.</b> This page is unlisted until there is a full season of the model's results; only its
        link opens it. Every gameweek so far was <b>managed by hand</b> by the account's owner.
      </p>

      <div className="score-cards">
        {summary.projections.map((p) => (
          <div className="card" key={`${p.source}@${p.modelVersion ?? ""}`}>
            <span className="k">{sourceLabel(p)} · MAE</span>
            <span className="v">{p.mae === null ? "—" : p.mae.toFixed(2)}</span>
            <span className="n">points off per player · {p.gameweeks} GW{p.gameweeks === 1 ? "" : "s"}, {rank(p.players)} player-weeks</span>
          </div>
        ))}
        <div className="card">
          <span className="k">Model · MAE</span>
          <span className="v">—</span>
          <span className="n">no projections yet</span>
        </div>
        <div className="card">
          <span className="k">Median GW percentile</span>
          <span className="v">{median === null ? "—" : pct(median)}</span>
          <span className="n">
            {summary.entry.modelGameweeks
              ? `over ${summary.entry.modelGameweeks} model gameweeks · target under ${TARGET_PERCENTILE}%`
              : `no model gameweeks yet · target under ${TARGET_PERCENTILE}%`}
          </span>
        </div>
      </div>

      <div className="table-box score">
        <table>
          <thead>
            <tr>
              <th scope="col">GW</th>
              <th scope="col">GW rank</th>
              {sources.map((s) => <th scope="col" key={`${s.source}@${s.modelVersion ?? ""}`}>{sourceShort(s)} MAE</th>)}
              <th scope="col">Points</th>
              <th scope="col">Managed</th>
              <th scope="col">Overall</th>
              <th scope="col">Projection read from</th>
            </tr>
          </thead>
          <tbody>
            {data.gameweeks.map((g) => <Row key={g.gameweek} g={g} sources={sources} />)}
          </tbody>
        </table>
      </div>

      <div className="notice">
        <b>Judged on</b> (written into the README before any results existed):
        <ul className="criteria">
          <li>Beat FPL's own <code>ep_next</code> on MAE across the season's gameweeks.</li>
          <li>Median gameweek rank percentile under {TARGET_PERCENTILE}%, over the gameweeks the model managed.</li>
        </ul>
      </div>
      <div className="subrow">
        <span>
          MAE counts every player any projection put above zero, plus anyone who scored, the same players for every
          projection; a player added to FPL after a deadline is not scored that week. The last-5 average is each
          player's mean points over his last 5 settled gameweeks, logged before the deadline. Each projection is read from the last capture before its deadline. GW rank
          percentile = rank ÷ players at that deadline; FPL's own rounded-up band in brackets. GW1–6 have no capture.
          {meta.season ? ` Season ${meta.season.replace("-", "/")}.` : ""}
        </span>
      </div>
    </section>
  );
}

function Row({ g, sources }: { g: ScorecardGameweek; sources: SourceKey[] }) {
  const e = g.entry;
  return (
    <tr>
      <td className="num-strong">{g.gameweek}</td>
      <td>
        {e ? <>{pct(e.gwPercentile)} <span className="pmeta">({e.fplPercentileBand === null ? "—" : `top ${e.fplPercentileBand}%`})</span>
          <div className="pmeta">{rank(e.gwRank)}</div></> : "—"}
      </td>
      {sources.map((s) => {
        const p = g.projections.find((x) => sameSource(x, s));
        return (
          <td key={`${s.source}@${s.modelVersion ?? ""}`}>
            {g.capturedAt === null ? <span className="pmeta">no capture</span>
              : !g.settled ? <span className="pmeta">not settled</span>
              : !p ? <span className="pmeta">not logged</span>
              : p.flagged ? <span style={{ color: "var(--bad)" }}>flagged: points ≠ breakdown</span>
              : <>{p.mae === null ? "—" : p.mae.toFixed(2)}<div className="pmeta">{p.playersCounted} players{p.addedAfterDeadline ? ` · ${p.addedAfterDeadline} added late` : ""}</div></>}
          </td>
        );
      })}
      <td>{e?.points ?? "—"}</td>
      <td>{e ? (e.managedBy === "model" ? "Model" : "By hand") : "—"}</td>
      <td>{rank(e?.overallRank ?? null)}</td>
      <td>
        {g.capturedAt === null ? <span className="pmeta">—</span>
          : <>{localDateTime(g.capturedAt)}<div className="pmeta">{lead(g.capturedAt, g.deadlineTime)}</div></>}
      </td>
    </tr>
  );
}
