import { defineConfig } from "vite";

// Bundles the Vercel entry and everything it imports (contract, hono, postgres) into one
// Node ES module. Node built-ins stay external.
export default defineConfig({
  build: {
    ssr: "src/vercel.ts",
    outDir: "dist",
    target: "node22",
    emptyOutDir: true,
    rollupOptions: { output: { format: "es", entryFileNames: "vercel.js" } },
  },
  ssr: { noExternal: true },
});
