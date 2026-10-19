/**
 * Real-payload check (spec 0002 "Testing"): parse the latest capture through the reader
 * role and print counts only. Writes nothing; never prints rows or the connection string.
 */
import { gzipSync } from "node:zlib";
import { ContractError, buildPlayersResponse } from "@freepl/contract";
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
