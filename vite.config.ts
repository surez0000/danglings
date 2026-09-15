import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error type error without @types/node package
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// Dev-only sink for site/portrait.ts: POST /__portrait?name=<model> with a PNG
// body writes site/public/portraits/<model>.png, so the fleet's portraits are
// rendered by the real scene in a browser without hauling data URLs around.
function portraitSink() {
  return {
    name: "danglings-portrait-sink",
    apply: "serve" as const,
    configureServer(server: { middlewares: { use: (path: string, fn: (req: any, res: any) => void) => void } }) {
      server.middlewares.use("/__portrait", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        const name = String(new URL(req.url ?? "/", "http://x").searchParams.get("name") ?? "portrait").replace(/[^a-z0-9-]/gi, "");
        const chunks: Uint8Array[] = [];
        req.on("data", (c: Uint8Array) => chunks.push(c));
        req.on("end", () => {
          // @ts-expect-error node globals without @types/node
          const buf = Buffer.concat(chunks);
          const dir = new URL("./site/public/portraits/", import.meta.url);
          mkdirSync(dir, { recursive: true });
          writeFileSync(new URL(`./${name}.png`, dir), buf);
          res.end(`saved ${name}.png (${buf.length} bytes)`);
        });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), portraitSink()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
