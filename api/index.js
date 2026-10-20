// The only file in api/: one Vercel Node function. vercel.json rewrites every /api/* path
// here; the request keeps its original path, so Hono's /api routes match. The app itself is
// server/src/vercel.ts, bundled to server/dist/vercel.js by `pnpm build` before this runs.
export { GET } from "../server/dist/vercel.js";
