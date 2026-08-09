import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const workspacePath = fileURLToPath(new URL(".", import.meta.url));
const pagesRoot = resolve(workspacePath, "apps", "pages-demo");
const configuredBasePath =
  process.env.CNC_RENDER_BASE_PATH ?? "/CNC-Render";
const normalizedBasePath =
  "/" + configuredBasePath.replace(/^\/+|\/+$/g, "");

export default defineConfig({
  root: pagesRoot,
  base: normalizedBasePath + "/",
  publicDir: resolve(workspacePath, "public"),
  plugins: [react()],
  build: {
    outDir: resolve(workspacePath, "dist", "pages"),
    emptyOutDir: true,
  },
});
