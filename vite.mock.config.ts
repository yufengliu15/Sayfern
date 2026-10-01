// Serves the renderer in a normal browser against the in-memory mock API:
//   npx vite --config vite.mock.config.ts        → http://localhost:5174
//   npx vite build --config vite.mock.config.ts  → static build (outDir overridable)
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));

// The Electron CSP forbids inline scripts, which Vite's dev client and React Refresh need.
const dropCsp: Plugin = {
  name: "sayfern-drop-csp",
  transformIndexHtml: (html) => html.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, ""),
};

export default defineConfig({
  root: resolve(here, "src/renderer"),
  base: "./",
  plugins: [react(), dropCsp],
  server: { port: 5174, strictPort: true },
  build: { outDir: resolve(here, "out/mock-renderer"), emptyOutDir: true },
});
