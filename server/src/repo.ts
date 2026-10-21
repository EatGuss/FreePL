import postgres from "postgres";
import type { RawBootstrapRows, RawFixturesRows } from "@freepl/contract";

/** Everything the API reads. Implemented over the views; faked in tests. */
export interface Repo {
  /** captured_at of latest_bootstrap, or null if there is no capture yet. */
  latestCapturedAt(): Promise<Date | string | null>;
  /** All four views, read in one snapshot so the rows and capturedAt agree. */
  bootstrapRows(): Promise<RawBootstrapRows>;
  /** captured_at of latest_fixtures, or null if there is no fixtures capture yet. */
  latestFixturesCapturedAt(): Promise<Date | string | null>;
  /** Fixtures plus the bootstrap Clubs and gameweeks they refer to, in one snapshot. */
  fixturesRows(): Promise<RawFixturesRows>;
}

/**
 * DATABASE_URL is the freepl_reader pooled string. prepare: false because Neon's pooler
 * (PgBouncer, transaction mode) does not keep prepared statements across transactions.
 */
export function createPgRepo(databaseUrl: string): Repo & { end(): Promise<void> } {
  const sql = postgres(databaseUrl, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10 });
  return {
    async latestCapturedAt() {
      const rows = await sql<{ captured_at: Date }[]>`select captured_at from latest_bootstrap`;
      return rows[0]?.captured_at ?? null;
    },
    async bootstrapRows() {
      return sql.begin("isolation level repeatable read read only", async (tx) => {
        const latest = await tx<{ captured_at: Date }[]>`select captured_at from latest_bootstrap`;
        const [players, clubs, gameweeks, positions] = await Promise.all([
          tx`select * from current_players`,
          tx`select * from current_clubs`,
          tx`select * from current_gameweeks`,
          tx`select * from current_positions`,
        ]);
        return {
          capturedAt: latest[0]?.captured_at ?? null,
          players: [...players],
          clubs: [...clubs],
          gameweeks: [...gameweeks],
          positions: [...positions],
        };
      });
    },
    async latestFixturesCapturedAt() {
      const rows = await sql<{ captured_at: Date }[]>`select captured_at from latest_fixtures`;
      return rows[0]?.captured_at ?? null;
    },
    async fixturesRows() {
      return sql.begin("isolation level repeatable read read only", async (tx) => {
        const [bLatest, fLatest, clubs, gameweeks, positions, fixtures] = await Promise.all([
          tx<{ captured_at: Date }[]>`select captured_at from latest_bootstrap`,
          tx<{ captured_at: Date }[]>`select captured_at from latest_fixtures`,
          tx`select * from current_clubs`,
          tx`select * from current_gameweeks`,
          tx`select * from current_positions`,
          tx`select * from current_fixtures`,
        ]);
        return {
          bootstrap: {
            capturedAt: bLatest[0]?.captured_at ?? null,
            players: [],
            clubs: [...clubs],
            gameweeks: [...gameweeks],
            positions: [...positions],
          },
          fixturesCapturedAt: fLatest[0]?.captured_at ?? null,
          fixtures: [...fixtures],
        };
      });
    },
    end: () => sql.end({ timeout: 5 }),
  };
}

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (freepl_reader pooled string)");
  return url;
}
