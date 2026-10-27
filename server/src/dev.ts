import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { appOptionsFromEnv } from "./env.js";
import { createPgRepo, requireDatabaseUrl } from "./repo.js";

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: createApp(createPgRepo(requireDatabaseUrl()), undefined, appOptionsFromEnv()).fetch, port }, () =>
  console.log(`API on http://localhost:${port}/api/players`),
);
