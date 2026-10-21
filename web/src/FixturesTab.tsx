import { useMemo } from "react";
import {
  WINDOW_MAX, WINDOW_MIN, buildTicker, sortTicker, tickerWindow,
  type FixturesResponse, type TickerSort,
} from "@freepl/contract";
import { FixtureCell } from "./FixtureChip.js";
import type { Filters } from "./filters.js";

const SORTS: { key: TickerSort; label: string }[] = [
  { key: "mean", label: "Easiest avg" },
  { key: "sum", label: "Easiest total" },
  { key: "count", label: "Most fixtures" },
];

const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });
/** "Sat 25", local time, in that order whatever the locale's default (docs/design.md). */
const deadlineDay = (iso: string) => { const d = new Date(iso); return `${weekday.format(d)} ${d.getDate()}`; };

/** Spec 0003: Clubs × the next N gameweeks, computed in the browser from /api/fixtures. */
export function FixturesTab({ data, filters, update, now }: {
  data: FixturesResponse; filters: Filters; update: (p: Partial<Filters>) => void; now: number;
}) {
  const clubById = useMemo(() => new Map(data.clubs.map((c) => [c.id, c])), [data]);
  // The window only moves when a deadline passes, so a per-minute `now` is enough.
  const window = useMemo(() => tickerWindow(data.gameweeks, filters.window, now), [data, filters.window, now]);
  const ticker = useMemo(() => buildTicker(data.clubs, data.fixtures, window), [data, window]);
  const rows = useMemo(() => sortTicker(ticker.rows, filters.tickerSort), [ticker, filters.tickerSort]);

  if (!window.length) return <p className="notice">No gameweeks left this season.</p>;

  return (
    <section className="flex flex-col gap-2.5">
      <div className="price-row">
        <label htmlFor="gws">Gameweeks</label>
        <input id="gws" type="range" min={WINDOW_MIN} max={WINDOW_MAX} step={1} value={filters.window}
          onChange={(e) => update({ window: Number(e.target.value) })} />
        <output htmlFor="gws">{window.length}</output>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sort Clubs by">
        {SORTS.map((s) => (
          <button key={s.key} className="chip small" aria-pressed={filters.tickerSort === s.key}
            onClick={() => update({ tickerSort: s.key })}>{s.label}</button>
        ))}
      </div>

      <div className="legend">
        <span>Difficulty, easy to hard:</span>
        {[1, 2, 3, 4, 5].map((d) => <span key={d} className={`fxc d${d}`}>{d}</span>)}
        <span>· H home, A away · dotted = kick-off TBC</span>
      </div>

      {ticker.unscheduled > 0 && (
        <p className="notice">
          {ticker.unscheduled === 1 ? "1 fixture is" : `${ticker.unscheduled} fixtures are`} not yet scheduled and not shown.
        </p>
      )}

      <div className="table-box ticker">
        <table>
          <thead>
            <tr>
              <th scope="col">Club</th>
              <th scope="col" title="Average difficulty over the fixtures shown; fewer fixtures means a blank">Avg</th>
              {window.map((g) => (
                <th key={g.id} scope="col" style={{ textAlign: "center" }}>
                  GW{g.id}<span className="gwday">{deadlineDay(g.deadlineTime)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.club.id}>
                <th scope="row" title={r.club.name}>{r.club.short}</th>
                <td className="avg">
                  {r.difficultyMean === null ? "—" : r.difficultyMean.toFixed(1)}
                  <small>{r.fixtureCount} fx{filters.tickerSort === "sum" && r.fixtureCount ? ` · Σ${r.difficultySum}` : ""}</small>
                </td>
                {r.cells.map((c) => (
                  <td key={c.gameweek} className="fx"><FixtureCell fixtures={c.fixtures} clubById={clubById} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="subrow">
        <span>Difficulty is FPL's own 1–5 rating, from each Club's side.</span>
      </div>
    </section>
  );
}
