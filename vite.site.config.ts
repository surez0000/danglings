import { defineConfig } from "vite";
// @ts-expect-error type error without @types/node package
import { fileURLToPath } from "node:url";

/* Landing-page build. Source lives in site/ and REUSES the app's companion
   modules (birdScene / useSwing / birdBehavior / types) so the hero is the
   actual product renderer, not a re-implementation. Output goes to docs/,
   which GitHub Pages serves from main. `base: "./"` keeps every asset URL
   relative, so the same build works at surez0000.github.io/danglings/ and
   on a custom domain root.

   Build:   npx vite build -c vite.site.config.ts
   Dev:     npx vite -c vite.site.config.ts --port 1430   (or preview the built
            docs/ through the app's dev server at /docs/index.html) */
export default defineConfig({
  root: fileURLToPath(new URL("./site", import.meta.url)),
  publicDir: fileURLToPath(new URL("./site/public", import.meta.url)),
  base: "./",
  build: {
    outDir: fileURLToPath(new URL("./docs", import.meta.url)),
    emptyOutDir: true,
    target: "es2020",
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: fileURLToPath(new URL("./site/index.html", import.meta.url)),
    },
  },
});
