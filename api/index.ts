// The only file in api/: mounts server/ as one Vercel Node function. vercel.json rewrites
// every /api/* path here; the request keeps its original path, so Hono's /api routes match.
import { handle } from "hono/vercel";
import { createApp, createPgRepo, requireDatabaseUrl } from "server";

// Module scope: reused across warm invocations, so the in-process cache and pool survive.
const app = createApp(createPgRepo(requireDatabaseUrl()));

export const GET = handle(app);
