// Vercel entry, bundled by `pnpm --filter server build` into server/dist/vercel.js (one
// self-contained ES module: Vercel compiles api/ but not the TypeScript it imports from
// workspace packages). api/index.js re-exports it.
import { handle } from "hono/vercel";
import { createApp } from "./app.js";
import { appOptionsFromEnv } from "./env.js";
import { createPgRepo, requireDatabaseUrl } from "./repo.js";

// Module scope: reused across warm invocations, so the in-process cache and pool survive.
const app = createApp(createPgRepo(requireDatabaseUrl()), undefined, appOptionsFromEnv());

export const GET = handle(app);
