import { upcomingGameweek } from "@freepl/contract";
import { Freshness } from "./Freshness.js";
import { InjuryTab } from "./InjuryTab.js";
import { PlayersTab } from "./PlayersTab.js";
import { useNow, usePlayers } from "./data.js";
import { localDateTime } from "./format.js";
import { useFilters } from "./useFilters.js";

export function App() {
  const query = usePlayers();
  const [filters, update] = useFilters();
  const now = useNow();
  const data = query.data;
  const next = data ? upcomingGameweek(data.gameweeks, now) : null;
  const flaggedCount = data ? data.players.filter((p) => p.status !== "a").length : 0;

  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1>FreePL <span>{filters.tab === "injury" ? "Injury watch" : "Players"}</span></h1>
        {next && <div className="deadline">GW{next.id} deadline <b>{localDateTime(next.deadlineTime)}</b></div>}
      </header>

      {data && <Freshness capturedAt={data.meta.sources.bootstrap.capturedAt} now={now} />}

      <nav className="views" role="tablist">
        <button role="tab" aria-selected={filters.tab === "players"} onClick={() => update({ tab: "players" })}>Players</button>
        <button role="tab" aria-selected={filters.tab === "injury"} onClick={() => update({ tab: "injury" })}>
          Injury watch{data && <span className="count">{flaggedCount}</span>}
        </button>
      </nav>

      {query.isPending && <p className="notice">Loading players…</p>}
      {query.isError && (
        <p className="notice bad">
          Couldn't load player data. <button className="linkish" onClick={() => query.refetch()}>Try again</button>
        </p>
      )}
      {data && (filters.tab === "injury"
        ? <InjuryTab data={data} now={now} />
        : <PlayersTab data={data} filters={filters} update={update} now={now} />)}
    </main>
  );
}
