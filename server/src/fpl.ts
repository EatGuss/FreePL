// Live FPL reads for entry-scoped endpoints (ADR 0003). A deliberate TypeScript copy of
// spec 0001 "Fetching" — the source of truth: descriptive User-Agent, 30 s timeout, up to
// 3 attempts on network error / 429 / 5xx with ≈2 s, 4 s backoff plus jitter, sequential
// requests paced ≥1 s apart, and a JSON body required. Do not write a second, laxer client.
// Read-only and unauthenticated: GET only, no cookies, no credentials.

const BASE_URL = "https://fantasy.premierleague.com/api";
const TIMEOUT_MS = 30_000;
const ATTEMPTS = 3;
const BACKOFF_MS = 2_000;
const MIN_GAP_MS = 1_000;

export class FplNotFound extends Error {
  constructor(path: string) { super(`FPL 404 for ${path}`); this.name = "FplNotFound"; }
}
export class FplUnavailable extends Error {
  constructor(message: string) { super(message); this.name = "FplUnavailable"; }
}

/** What the entry route needs; faked in tests. */
export interface FplClient {
  /** GET {BASE_URL}/{path}/ and return parsed JSON. Throws FplNotFound or FplUnavailable. */
  get(path: string): Promise<unknown>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createFplClient(contact: string | undefined, fetchImpl: typeof fetch = fetch): FplClient {
  const userAgent = contact ? `FreePL-api/0.1 (+contact: ${contact})` : "FreePL-api/0.1";
  let lastEnd = 0;
  // One request at a time, so the pacing holds across concurrent page loads too.
  let queue: Promise<unknown> = Promise.resolve();

  async function once(path: string): Promise<unknown> {
    let lastError = "no attempt made";
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      if (attempt) await sleep(BACKOFF_MS * 2 ** (attempt - 1) + Math.random() * 1000);
      const gap = MIN_GAP_MS - (Date.now() - lastEnd);
      if (gap > 0) await sleep(gap);
      let res: Response;
      try {
        res = await fetchImpl(`${BASE_URL}/${path}/`, {
          headers: { "User-Agent": userAgent, Accept: "application/json" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        lastError = err instanceof Error ? err.name : "network error";
        continue;
      } finally {
        lastEnd = Date.now();
      }
      if (res.status === 429 || res.status >= 500) { lastError = `HTTP ${res.status}`; continue; }
      if (res.status === 404) throw new FplNotFound(path);
      if (res.status !== 200) throw new FplUnavailable(`HTTP ${res.status} for ${path}`);
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        // FPL answers with text while "the game is being updated".
        throw new FplUnavailable(`non-JSON body (${text.length} bytes) for ${path}`);
      }
    }
    throw new FplUnavailable(`gave up after ${ATTEMPTS} attempts for ${path}: ${lastError}`);
  }

  return {
    get(path) {
      const run = queue.then(() => once(path), () => once(path));
      queue = run.catch(() => undefined);
      return run;
    },
  };
}
