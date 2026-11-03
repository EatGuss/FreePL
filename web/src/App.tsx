import { useCallback, useMemo, useState } from "react";
import { buildRatingContext, pickRatingFor, upcomingGameweek } from "@freepl/contract";
import { FixturesTab } from "./FixturesTab.js";
import { Freshness } from "./Freshness.js";
import { InjuryTab } from "./InjuryTab.js";
import { MySquadTab } from "./MySquadTab.js";
import { PicksTab } from "./PicksTab.js";
import { PlayersTab } from "./PlayersTab.js";
import { RatingSheet } from "./Rating.js";
import { ShortlistContext, seasonOf, useShortlist } from "./shortlist.js";
import { ShortlistTab } from "./ShortlistTab.js";
import { useFixtures, useNow, usePlayers } from "./data.js";
import type { Tab } from "./filters.js";
import { localDateTime } from "./format.js";
import { useFilters } from "./useFilters.js";

const TITLES: Record<Tab, string> = { squad: "My squad", shortlist: "Shortlist", picks: "Picks", players: "Players", fixtures: "Fixtures", injury: "Injury watch" };

export function App() {
  const [filters, update] = useFilters();
  const players = usePlayers();
  // Picks and the Players rating column need fixtures too; Injury watch does not.
  const fixtures = useFixtures(filters.tab !== "injury");
  const now = useNow();
  const data = players.data;
  const next = data ? upcomingGameweek(data.gameweeks, now) : null;
  const flaggedCount = data ? data.players.filter((p) => p.status !== "a").length : 0;
  const season = data ? seasonOf(data.gameweeks) : null;
  const shortlist = useShortlist(filters, update, season);

  // Built once per data load (and when a deadline passes, which moves the fixture window),
  // never per tap.
  const nextGwId = next?.id ?? null;
  const ratings = useMemo(
    () => (data && fixtures.data
      ? buildRatingContext(data.players, data.positions, fixtures.data.fixtures, fixtures.data.gameweeks)
      : null),
    // nextGwId stands in for "now": the rating only changes when the upcoming gameweek does.
    [data, fixtures.data, nextGwId],
  );
  const [sheetFor, setSheetFor] = useState<number | null>(null);
  const openSheet = useCallback((id: number) => setSheetFor(id), []);
  const closeSheet = useCallback(() => setSheetFor(null), []);
  const sheetPlayer = sheetFor === null ? undefined : data?.players.find((p) => p.id === sheetFor);

  const needsFixtures = filters.tab === "squad" || filters.tab === "shortlist" || filters.tab === "picks" || filters.tab === "fixtures";
  const pending = players.isPending || (needsFixtures && fixtures.isPending);
  const failed = players.isError || (needsFixtures && fixtures.isError);
  const retry = () => { void players.refetch(); void fixtures.refetch(); };

  return (
    <ShortlistContext.Provider value={shortlist}>
    <main className="mx-auto flex max-w-[720px] flex-col gap-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1>FreePL <span>{TITLES[filters.tab]}</span></h1>
        {next && <div className="deadline">GW{next.id} deadline <b>{localDateTime(next.deadlineTime)}</b></div>}
      </header>

      {needsFixtures
        ? fixtures.data && (
          <Freshness now={now} sources={{
            bootstrap: fixtures.data.meta.sources.bootstrap.capturedAt,
            fixtures: fixtures.data.meta.sources.fixtures.capturedAt,
          }} />
        )
        : data && <Freshness sources={{ bootstrap: data.meta.sources.bootstrap.capturedAt }} now={now} />}

      <nav className="views" role="tablist">
        <button role="tab" aria-selected={filters.tab === "squad"} onClick={() => update({ tab: "squad" })}>{TITLES.squad}</button>
        <button role="tab" aria-selected={filters.tab === "shortlist"} onClick={() => update({ tab: "shortlist" })}>
          Shortlist{shortlist && shortlist.ids.length > 0 && <span className="count plain">{shortlist.ids.length}</span>}
        </button>
        {(["picks", "players", "fixtures"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={filters.tab === t} onClick={() => update({ tab: t })}>{TITLES[t]}</button>
        ))}
        <button role="tab" aria-selected={filters.tab === "injury"} onClick={() => update({ tab: "injury" })}>
          Injury watch{data && <span className="count">{flaggedCount}</span>}
        </button>
      </nav>

      {pending && <p className="notice">Loading…</p>}
      {failed && (
        <p className="notice bad">
          Couldn't load the data. <button className="linkish" onClick={retry}>Try again</button>
        </p>
      )}
      {shortlist?.notices.map((n, i) => (
        <p className="notice" key={n}>{n} <button className="linkish" onClick={() => shortlist.dismiss(i)}>Dismiss</button></p>
      ))}
      {shortlist?.offer && (
        <p className="notice">
          This link has a different shortlist ({shortlist.offer.length} player{shortlist.offer.length === 1 ? "" : "s"}) ·{" "}
          <button className="linkish" onClick={shortlist.useLinks}>Use link's shortlist</button> ·{" "}
          <button className="linkish" onClick={shortlist.keepMine}>Keep mine</button>
        </p>
      )}
      {filters.tab === "squad" && data && (
        <MySquadTab players={data} fixtures={fixtures.data} ratings={ratings} filters={filters} update={update} now={now} onOpenRating={openSheet} />
      )}
      {filters.tab === "shortlist" && data && fixtures.data && (
        <ShortlistTab players={data} fixtures={fixtures.data} ratings={ratings} filters={filters} now={now} onOpen={openSheet} />
      )}
      {filters.tab === "picks" && data && fixtures.data && ratings && (
        <PicksTab players={data} fixtures={fixtures.data} ratings={ratings} filters={filters} update={update} now={now} onOpen={openSheet} />
      )}
      {filters.tab === "players" && data && (
        <PlayersTab data={data} filters={filters} update={update} now={now} ratings={ratings} onOpenRating={openSheet} />
      )}
      {filters.tab === "fixtures" && fixtures.data && (
        <FixturesTab data={fixtures.data} filters={filters} update={update} now={now} />
      )}
      {filters.tab === "injury" && data && <InjuryTab data={data} now={now} />}

      {sheetPlayer && ratings && (
        <RatingSheet player={sheetPlayer} rating={pickRatingFor(sheetPlayer, ratings)}
          position={data?.positions.find((p) => p.id === sheetPlayer.positionId)} onClose={closeSheet} />
      )}
    </main>
    </ShortlistContext.Provider>
  );
}
