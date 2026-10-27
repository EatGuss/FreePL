import type { AppOptions } from "./app.js";
import { createFplClient } from "./fpl.js";

/**
 * Server-only settings for live entry reads (spec 0004). FPL_ENTRY_ID is the team shown by
 * default; FPL_CONTACT goes in the User-Agent. Never VITE_-prefixed, never sent to the browser.
 */
export function appOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): AppOptions {
  const id = env.FPL_ENTRY_ID;
  return {
    fpl: createFplClient(env.FPL_CONTACT || undefined),
    defaultEntryId: id && /^[1-9]\d{0,9}$/.test(id) ? Number(id) : undefined,
  };
}
