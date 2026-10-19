import { Fragment, memo, useCallback, useMemo, useState } from "react";
import {
  createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type SortingState,
} from "@tanstack/react-table";
import type { ClubRow, PlayerRow, PlayersResponse, PositionRow } from "@freepl/contract";
import { FIXED_COLUMNS, GROUPS, type StatColumn } from "./columns.js";
import { applyFilters, filtersToSearch, GROUP_KEYS, makeLookups, type Filters } from "./filters.js";
import { Flag } from "./Flag.js";
import { ago, formatPrice } from "./format.js";
import { ageHours } from "@freepl/contract";

const helper = createColumnHelper<PlayerRow>();
const PRICE_STEP = 5; // £0.5m
/** Rows drawn per step. Sorting and filtering always cover every player; only drawing is capped. */
const ROW_STEP = 100;

export function PlayersTab({ data, filters, update, now }: {
  data: PlayersResponse; filters: Filters; update: (p: Partial<Filters>) => void; now: number;
}) {
  const lookups = useMemo(() => makeLookups(data.clubs, data.positions), [data]);
  const [openNews, setOpenNews] = useState<number | null>(null);

  const priceBounds = useMemo(() => {
    const costs = data.players.map((p) => p.nowCost);
    const lo = Math.floor(Math.min(...costs) / PRICE_STEP) * PRICE_STEP;
    const hi = Math.ceil(Math.max(...costs) / PRICE_STEP) * PRICE_STEP;
    return { lo, hi };
  }, [data]);

  const shown = filters;
  // Any filter or sort change starts again from the top ROW_STEP rows.
  const viewKey = filtersToSearch(filters);
  const [drawn, setDrawn] = useState({ viewKey, n: ROW_STEP });
  const limit = drawn.viewKey === viewKey ? drawn.n : ROW_STEP;
  const { rows, hiddenOut } = useMemo(() => applyFilters(data.players, shown, lookups), [data, shown, lookups]);

  const statColumns: StatColumn[] = useMemo(() => [...FIXED_COLUMNS, ...GROUPS[shown.group]], [shown.group]);
  const toggleNews = useCallback((id: number) => setOpenNews((cur) => (cur === id ? null : id)), []);

  const columns = useMemo(
    () => [
      helper.display({ id: "player", header: "Player" }),
      ...statColumns.map((c) =>
        // undefined (not null) so sortUndefined: "last" keeps blanks at the bottom both ways.
        helper.accessor((p) => c.value(p) ?? undefined, {
          id: c.id,
          header: c.label,
          sortUndefined: "last",
          sortDescFirst: true,
          cell: (info) => c.format(info.getValue() ?? null),
          meta: c,
        }),
      ),
    ],
    [statColumns],
  );

  const sortId = statColumns.some((c) => c.id === shown.sort) ? shown.sort : "epNext";
  const sorting: SortingState = [{ id: sortId, desc: shown.desc }];

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const s = next[0];
      // Tapping a header sorts it; tapping again reverses. Never falls back to unsorted.
      if (!s) update({ desc: !filters.desc });
      else update({ sort: s.id, desc: s.desc });
    },
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const atMax = filters.maxPrice === null || filters.maxPrice >= priceBounds.hi;
  const atMin = filters.minPrice === null || filters.minPrice <= priceBounds.lo;

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Position">
        <button className="chip" aria-pressed={filters.pos === null} onClick={() => update({ pos: null })}>All</button>
        {data.positions.map((pos) => (
          <button key={pos.id} className="chip" aria-pressed={filters.pos === pos.short} onClick={() => update({ pos: pos.short })}>
            {pos.short}
          </button>
        ))}
      </div>

      <div className="price-row">
        <label htmlFor="maxPrice">Max price</label>
        <input
          id="maxPrice" type="range" min={priceBounds.lo} max={priceBounds.hi} step={PRICE_STEP}
          value={atMax ? priceBounds.hi : filters.maxPrice!}
          onChange={(e) => { const v = Number(e.target.value); update({ maxPrice: v >= priceBounds.hi ? null : v }); }}
        />
        <output htmlFor="maxPrice">{atMax ? "Any" : formatPrice(filters.maxPrice!)}</output>
      </div>

      <div className="subrow">
        <input className="search" type="search" placeholder="Search name" aria-label="Search name"
          value={filters.q} onChange={(e) => update({ q: e.target.value })} />
        <button className="linkish" onClick={() => update({ showOut: !filters.showOut })}>
          {filters.showOut ? "Hide unavailable" : hiddenOut ? `Show ${hiddenOut} unavailable` : "No unavailable players hidden"}
        </button>
      </div>

      <details className="more">
        <summary>More filters{filters.clubs.length || filters.minMinutes || !atMin ? " (on)" : ""}</summary>
        <div className="flex flex-col gap-2.5 pt-2.5">
          <div className="price-row">
            <label htmlFor="minPrice">Min price</label>
            <input
              id="minPrice" type="range" min={priceBounds.lo} max={priceBounds.hi} step={PRICE_STEP}
              value={atMin ? priceBounds.lo : filters.minPrice!}
              onChange={(e) => { const v = Number(e.target.value); update({ minPrice: v <= priceBounds.lo ? null : v }); }}
            />
            <output htmlFor="minPrice">{atMin ? "Any" : formatPrice(filters.minPrice!)}</output>
          </div>
          <div className="price-row">
            <label htmlFor="mins">Min minutes</label>
            <input id="mins" className="numin" type="number" min={0} step={90} inputMode="numeric"
              value={filters.minMinutes || ""} placeholder="0"
              onChange={(e) => update({ minMinutes: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Club">
            {[...data.clubs].sort((a, b) => a.short.localeCompare(b.short)).map((c) => {
              const on = filters.clubs.includes(c.short);
              return (
                <button key={c.id} className="chip small" aria-pressed={on} title={c.name}
                  onClick={() => update({ clubs: on ? filters.clubs.filter((s) => s !== c.short) : [...filters.clubs, c.short] })}>
                  {c.short}
                </button>
              );
            })}
            {filters.clubs.length > 0 && <button className="linkish" onClick={() => update({ clubs: [] })}>Clear clubs</button>}
          </div>
        </div>
      </details>

      <div className="groups" role="group" aria-label="Column group">
        {GROUP_KEYS.map((g) => (
          <button key={g} aria-pressed={filters.group === g}
            onClick={() => update(GROUPS[g].some((c) => c.id === filters.sort) || FIXED_COLUMNS.some((c) => c.id === filters.sort)
              ? { group: g } : { group: g, sort: "epNext", desc: true })}>
            {g}
          </button>
        ))}
      </div>

      <div className="table-box">
        <table>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const sortable = h.column.getCanSort() && h.column.id !== "player";
                  const dir = h.column.getIsSorted();
                  return (
                    <th key={h.id} scope="col"
                      aria-sort={!sortable ? undefined : dir === "desc" ? "descending" : dir === "asc" ? "ascending" : "none"}
                      tabIndex={sortable ? 0 : undefined}
                      onClick={sortable ? h.column.getToggleSortingHandler() : undefined}
                      onKeyDown={sortable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); h.column.toggleSorting(); } } : undefined}>
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td className="news-row" colSpan={statColumns.length + 1}>No players match these filters.</td></tr>
            )}
            {table.getRowModel().rows.slice(0, limit).map(({ original: p }) => (
              <Row key={p.id} player={p} columns={statColumns} club={lookups.clubById.get(p.clubId)}
                position={lookups.positionById.get(p.positionId)} newsOpen={openNews === p.id}
                onToggleNews={toggleNews} now={now} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="subrow">
        <span>
          {rows.length > limit ? `Top ${limit} of ${rows.length} players · ` : `${rows.length} players`}
          {rows.length > limit && (
            <>
              <button className="linkish" onClick={() => setDrawn({ viewKey, n: limit + ROW_STEP })}>
                Show {Math.min(ROW_STEP, rows.length - limit)} more
              </button>
              {" · "}
              <button className="linkish" onClick={() => setDrawn({ viewKey, n: rows.length })}>Show all</button>
            </>
          )}
        </span>
        <span>Tap a column header to sort</span>
      </div>
    </section>
  );
}

/** One table row. Memoised so a filter change only builds the rows that are new. */
const Row = memo(function Row({ player: p, columns, club, position, newsOpen, onToggleNews, now }: {
  player: PlayerRow; columns: StatColumn[]; club: ClubRow | undefined; position: PositionRow | undefined;
  newsOpen: boolean; onToggleNews: (id: number) => void; now: number;
}) {
  return (
    <Fragment>
      <tr>
        <td>
          <div className="pname">
            <span className="nm">{p.webName}</span>
            <Flag player={p} onClick={() => onToggleNews(p.id)} />
          </div>
          <div className="pmeta">{club?.short} · {position?.short} · <b>{formatPrice(p.nowCost)}</b></div>
        </td>
        {columns.map((c) => {
          const v = c.value(p);
          return <td key={c.id} className={[c.strong ? "num-strong" : "", v === null ? "null" : ""].join(" ").trim() || undefined}>{c.format(v)}</td>;
        })}
      </tr>
      {newsOpen && (
        <tr>
          <td className="news-row" colSpan={columns.length + 1}>
            {p.news || "No news text."}
            {p.newsAdded && <span className="pmeta"> · {ago(ageHours(p.newsAdded, now))}</span>}
          </td>
        </tr>
      )}
    </Fragment>
  );
});
