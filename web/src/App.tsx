import { upcomingGameweek } from "@freepl/contract";
import { FixturesTab } from "./FixturesTab.js";
import { Freshness } from "./Freshness.js";
import { InjuryTab } from "./InjuryTab.js";
import { PlayersTab } from "./PlayersTab.js";
import { useFixtures, useNow, usePlayers } from "./data.js";
import type { Tab } from "./filters.js";
import { localDateTime } from "./format.js";
import { useFilters } from "./useFilters.js";

const TITLES: Record<Tab, string> = { players: "Players", fixtures: "Fixtures", injury: "Injury watch" };

export function App() {
  const [filters, update] = useFilters();
  const players = usePlayers();
  const fixtures = useFixtures(filters.tab === "fixtures");
  const now = useNow();
  const data = players.data;
  const next = data ? upcomingGameweek(data.gameweeks, now) : null;
  const flaggedCount = data ? data.players.filter((p) => p.status !== "a").length : 0;
  const onFixtures = filters.tab === "fixtures";
  const active = onFixtures ? fixtures : players;

  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1>FreePL <span>{TITLES[filters.tab]}</span></h1>
        {next && <div className="deadline">GW{next.id} deadline <b>{localDateTime(next.deadlineTime)}</b></div>}
      </header>

      {onFixtures
        ? fixtures.data && (
          <Freshness now={now} sources={{
            bootstrap: fixtures.data.meta.sources.bootstrap.capturedAt,
            fixtures: fixtures.data.meta.sources.fixtures.capturedAt,
          }} />
        )
        : data && <Freshness sources={{ bootstrap: data.meta.sources.bootstrap.capturedAt }} now={now} />}

      <nav className="views" role="tablist">
        <button role="tab" aria-selected={filters.tab === "players"} onClick={() => update({ tab: "players" })}>Players</button>
        <button role="tab" aria-selected={onFixtures} onClick={() => update({ tab: "fixtures" })}>Fixtures</button>
        <button role="tab" aria-selected={filters.tab === "injury"} onClick={() => update({ tab: "injury" })}>
          Injury watch{data && <span className="count">{flaggedCount}</span>}
        </button>
      </nav>

      {active.isPending && <p className="notice">Loading {onFixtures ? "fixtures" : "players"}…</p>}
      {active.isError && (
        <p className="notice bad">
          Couldn't load {onFixtures ? "fixture" : "player"} data.{" "}
          <button className="linkish" onClick={() => active.refetch()}>Try again</button>
        </p>
      )}
      {onFixtures
        ? fixtures.data && <FixturesTab data={fixtures.data} filters={filters} update={update} now={now} />
        : data && (filters.tab === "injury"
          ? <InjuryTab data={data} now={now} />
          : <PlayersTab data={data} filters={filters} update={update} now={now} />)}
    </main>
  );
}
