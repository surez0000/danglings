#!/usr/bin/env node
// Extract a variant GLB's texture set as standalone files (a "skin") so
// same-geometry color variants ship ~90KB of textures instead of a ~360KB
// full model. Usage:
//   node scripts/extract-skin.mjs <variant.glb> <outPrefix>
// Writes <outPrefix>.base.webp, <outPrefix>.normal.webp, <outPrefix>.mr.webp
import { readFileSync, writeFileSync } from "node:fs";

const [input, outPrefix] = process.argv.slice(2);
if (!input || !outPrefix) {
  console.error("usage: extract-skin.mjs <variant.glb> <outPrefix>");
  process.exit(1);
}

const buf = readFileSync(input);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString());
const binStart = 20 + jsonLen + 8;

const mat = json.materials?.[0];
if (!mat) throw new Error("no material in " + input);

const imageBytes = (texInfo) => {
  const tex = json.textures[texInfo.index];
  // webp sources live under EXT_texture_webp, not the core `source` field.
  const sourceIdx = tex.extensions?.EXT_texture_webp?.source ?? tex.source;
  const image = json.images[sourceIdx];
  if (image.mimeType !== "image/webp") throw new Error("expected webp, got " + image.mimeType);
  const bv = json.bufferViews[image.bufferView];
  const start = binStart + (bv.byteOffset ?? 0);
  return buf.slice(start, start + bv.byteLength);
};

const slots = {
  base: mat.pbrMetallicRoughness?.baseColorTexture,
  normal: mat.normalTexture,
  mr: mat.pbrMetallicRoughness?.metallicRoughnessTexture,
};
for (const [slot, texInfo] of Object.entries(slots)) {
  if (!texInfo) {
    console.log(`${slot}: absent, skipped`);
    continue;
  }
  const bytes = imageBytes(texInfo);
  writeFileSync(`${outPrefix}.${slot}.webp`, bytes);
  console.log(`${outPrefix}.${slot}.webp  ${(bytes.length / 1024).toFixed(0)}K`);
}
