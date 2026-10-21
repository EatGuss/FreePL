import type { ClubRow, TickerFixture } from "@freepl/contract";

/**
 * Fixture cell (docs/design.md): opponent short name + H/A on the --fdr fill, so it never
 * relies on colour; a provisional kick-off gets a dotted border and "TBC". A blank is an
 * explicit dashed "Blank" chip, never an empty cell. Shared with spec 0005's Picks.
 */
export function FixtureCell({ fixtures, clubById }: { fixtures: TickerFixture[]; clubById: Map<number, ClubRow> }) {
  if (!fixtures.length) return <div className="fxs"><span className="fxc blank">Blank</span></div>;
  return (
    <div className="fxs">
      {fixtures.map((f, i) => {
        const opp = clubById.get(f.opponentClubId)?.short ?? "?";
        const where = f.isHome ? "H" : "A";
        const title = `${f.isHome ? "Home v" : "Away at"} ${opp}, difficulty ${f.difficulty}${f.provisional ? ", kick-off TBC" : ""}`;
        return (
          <span key={i} className={`fxc d${f.difficulty}${f.provisional ? " tbc" : ""}`} title={title} aria-label={title}>
            {opp}<small> {where}</small>
            {f.provisional && <span className="tbc-mark">TBC</span>}
          </span>
        );
      })}
    </div>
  );
}
