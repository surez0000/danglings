#!/usr/bin/env node
/* Build the updater manifest (latest.json) after `npm run tauri build`.

   Usage:
     node scripts/make-latest-json.mjs [--notes "What changed"] [--out dist-release]

   Reads the version from src-tauri/tauri.conf.json, scans every
   src-tauri/target/<target>/release/bundle for updater artifacts and their .sig
   files (produced because bundle.createUpdaterArtifacts is true and
   TAURI_SIGNING_PRIVATE_KEY[_PATH] was set during the build), and writes
   <out>/latest.json whose URLs point at the GitHub release tag v<version>.
   Upload the listed artifacts + latest.json as that release's assets; the
   app's updater fetches .../releases/latest/download/latest.json. */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "surez0000/danglings";
const root = fileURLToPath(new URL("..", import.meta.url));

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const conf = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
const version = conf.version;
const notes = argValue("--notes") ?? `Danglings ${version}`;
const out = argValue("--out") ?? join(root, "dist-release");

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

// Native build + any cross/universal targets (target/<triple>/release/bundle).
const targetRoot = join(root, "src-tauri/target");
const bundleDirs = [join(targetRoot, "release/bundle")];
if (existsSync(targetRoot)) {
  for (const name of readdirSync(targetRoot)) {
    const candidate = join(targetRoot, name, "release/bundle");
    if (existsSync(candidate)) bundleDirs.push(candidate);
  }
}
const files = bundleDirs.flatMap((d) => walk(d));

// Merge with a manifest already in <out> for the SAME version, so the macOS
// and Windows builds (different machines) can each add their platforms.
const platforms = {};
const uploads = [];
const manifestPath = join(out, "latest.json");
if (existsSync(manifestPath)) {
  try {
    const prev = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (prev.version === version && prev.platforms) {
      Object.assign(platforms, prev.platforms);
      console.log(`merging existing latest.json (${Object.keys(prev.platforms).join(", ")})`);
    }
  } catch {
    // unreadable previous manifest — start fresh
  }
}

function add(key, file) {
  const sig = `${file}.sig`;
  if (!existsSync(sig)) {
    console.warn(`! no signature next to ${basename(file)} — was TAURI_SIGNING_PRIVATE_KEY(_PATH) set for the build?`);
    return;
  }
  platforms[key] = {
    signature: readFileSync(sig, "utf8").trim(),
    url: `https://github.com/${REPO}/releases/download/v${version}/${encodeURIComponent(basename(file))}`,
  };
  uploads.push(file, sig);
}

for (const f of files) {
  const name = basename(f);
  if (name.endsWith(".app.tar.gz")) {
    const arch = /aarch64|arm64/.test(name) ? "aarch64" : /x64|x86_64/.test(name) ? "x86_64" : "universal";
    if (arch === "universal") {
      add("darwin-aarch64", f);
      add("darwin-x86_64", f);
    } else {
      add(`darwin-${arch}`, f);
    }
  } else if (name.endsWith("-setup.exe")) {
    const arch = /arm64|aarch64/.test(name) ? "aarch64" : "x86_64";
    add(`windows-${arch}`, f);
  }
}

if (Object.keys(platforms).length === 0) {
  console.error("No signed updater artifacts found. Run `npm run tauri build` with the signing key first.");
  process.exit(1);
}

mkdirSync(out, { recursive: true });
const manifest = { version, notes, pub_date: new Date().toISOString(), platforms };
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`latest.json for v${version} -> ${manifestPath}`);
console.log(`platforms: ${Object.keys(platforms).join(", ")}`);
console.log("\nUpload these as assets of GitHub release v" + version + ":");
for (const u of [...new Set(uploads)]) console.log("  " + u);
console.log("  " + manifestPath);
console.log(
  "\nAlso attach the user-facing installers (the .dmg from bundle/dmg and the -setup.exe) — the .exe doubles as the updater artifact.",
);
