/**
 * Real-payload check (spec 0002 and 0003 "Testing"): parse the latest captures through the
 * reader role and print counts only, plus which gameweeks have doubles or blanks so they
 * can be compared with the official schedule. Writes nothing; never prints rows or the
 * connection string.
 */
import { gzipSync } from "node:zlib";
import { ContractError, buildFixturesResponse, buildPlayersResponse, buildTicker } from "@freepl/contract";
import { createPgRepo, requireDatabaseUrl } from "../src/repo.js";

const repo = createPgRepo(requireDatabaseUrl());
try {
  const raw = await repo.bootstrapRows();
  const res = buildPlayersResponse(raw);
  const nullEpNext = res.players.filter((p) => p.epNext === null).length;
  const body = JSON.stringify(res);
  const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
  console.log(
    `capturedAt ${res.meta.sources.bootstrap.capturedAt}: ${res.players.length} players, ` +
      `${res.clubs.length} clubs, ${res.positions.length} positions, ${res.gameweeks.length} gameweeks, ` +
      `0 parse failures (${nullEpNext} with ep_next null); body ${kb(body.length)}, ` +
      `${kb(gzipSync(body).length)} gzipped (spec: under 100 KB)`,
  );

  const fx = buildFixturesResponse(await repo.fixturesRows());
  const fxBody = JSON.stringify(fx);
  const ticker = buildTicker(fx.clubs, fx.fixtures, fx.gameweeks);
  const odd = fx.gameweeks
    .map((g, i) => {
      const counts = ticker.rows.map((r) => r.cells[i]!.fixtures.length);
      const doubles = counts.filter((n) => n >= 2).length;
      const blanks = counts.filter((n) => n === 0).length;
      return doubles || blanks ? `GW${g.id}: ${doubles} double, ${blanks} blank` : null;
    })
    .filter(Boolean);
  console.log(
    `fixtures capturedAt ${fx.meta.sources.fixtures.capturedAt}: ${fx.fixtures.length} fixtures, ` +
      `${ticker.unscheduled} unscheduled, ${fx.fixtures.filter((f) => f.provisional).length} provisional, ` +
      `0 parse failures; body ${kb(fxBody.length)}, ${kb(gzipSync(fxBody).length)} gzipped`,
  );
  console.log(odd.length ? `doubles/blanks: ${odd.join("; ")}` : "doubles/blanks: none in the published schedule");
} catch (err) {
  if (err instanceof ContractError) {
    console.error(err.message);
    for (const issue of err.issues.slice(0, 20)) console.error(`  ${issue}`);
  } else {
    console.error("check failed:", err instanceof Error ? err.message : err);
  }
  process.exitCode = 1;
} finally {
  await repo.end();
}
