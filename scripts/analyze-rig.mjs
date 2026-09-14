#!/usr/bin/env node
// Rig/geometry report for a GLB (raw Meshy exports or optimized output).
// Prints JSON: size, tris, verts, images, animation clip names, and every
// bone with its parent and its position NORMALIZED to the model's own space
// (height = 1, feet at y = 0, centered x/z) — the same space birdScene uses,
// so bone-role classification transfers directly.
// Usage: node scripts/analyze-rig.mjs <model.glb>
import { readFileSync } from "node:fs";

const file = process.argv[2];
const buf = readFileSync(file);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString());

// --- minimal TRS -> matrix math -------------------------------------------
const I = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; // column-major
function quatToMat(q) {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
}
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function nodeLocal(n) {
  if (n.matrix) return n.matrix;
  let m = I();
  if (n.translation) {
    const t = I();
    t[12] = n.translation[0];
    t[13] = n.translation[1];
    t[14] = n.translation[2];
    m = mul(m, t);
  }
  if (n.rotation) m = mul(m, quatToMat(n.rotation));
  if (n.scale) {
    const s = I();
    s[0] = n.scale[0];
    s[5] = n.scale[1];
    s[10] = n.scale[2];
    m = mul(m, s);
  }
  return m;
}
const apply = (m, v) => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
];

// --- world matrices for all nodes ------------------------------------------
const nodes = json.nodes ?? [];
const parent = new Map();
nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
const worldCache = new Map();
function world(i) {
  if (worldCache.has(i)) return worldCache.get(i);
  const local = nodeLocal(nodes[i]);
  const p = parent.has(i) ? world(parent.get(i)) : I();
  const w = mul(p, local);
  worldCache.set(i, w);
  return w;
}

// --- mesh bbox in world space (from POSITION accessor min/max) --------------
let bboxMin = [Infinity, Infinity, Infinity];
let bboxMax = [-Infinity, -Infinity, -Infinity];
let tris = 0;
let verts = 0;
nodes.forEach((n, i) => {
  if (n.mesh === undefined) return;
  const w = world(i);
  for (const prim of json.meshes[n.mesh].primitives) {
    const acc = json.accessors[prim.attributes.POSITION];
    verts += acc.count;
    if (prim.indices !== undefined) tris += json.accessors[prim.indices].count / 3;
    if (!acc.min || !acc.max) continue;
    // Transform all 8 bbox corners.
    for (const cx of [acc.min[0], acc.max[0]])
      for (const cy of [acc.min[1], acc.max[1]])
        for (const cz of [acc.min[2], acc.max[2]]) {
          const p = apply(w, [cx, cy, cz]);
          for (let k = 0; k < 3; k++) {
            bboxMin[k] = Math.min(bboxMin[k], p[k]);
            bboxMax[k] = Math.max(bboxMax[k], p[k]);
          }
        }
  }
});
const height = bboxMax[1] - bboxMin[1] || 1;
const center = [(bboxMin[0] + bboxMax[0]) / 2, bboxMin[1], (bboxMin[2] + bboxMax[2]) / 2];
const norm = (p) => [
  (p[0] - center[0]) / height,
  (p[1] - center[1]) / height,
  (p[2] - center[2]) / height,
];

// --- bones -------------------------------------------------------------------
const jointSet = new Set((json.skins ?? []).flatMap((s) => s.joints));
const bones = [...jointSet].map((i) => {
  const p = parent.get(i);
  const wp = apply(world(i), [0, 0, 0]);
  const [x, y, z] = norm(wp).map((v) => Math.round(v * 1000) / 1000);
  return {
    index: i,
    name: nodes[i].name ?? `#${i}`,
    parent: p !== undefined && jointSet.has(p) ? (nodes[p].name ?? `#${p}`) : null,
    leaf: !(nodes[i].children ?? []).some((c) => jointSet.has(c)),
    pos: { x, y, z },
  };
});

console.log(
  JSON.stringify(
    {
      file,
      sizeMB: Math.round((buf.length / 1048576) * 10) / 10,
      tris: Math.round(tris),
      verts,
      images: (json.images ?? []).length,
      animations: (json.animations ?? []).map((a) => a.name ?? "unnamed"),
      aspectWH: Math.round(((bboxMax[0] - bboxMin[0]) / height) * 100) / 100,
      aspectDH: Math.round(((bboxMax[2] - bboxMin[2]) / height) * 100) / 100,
      bones,
    },
    null,
    1,
  ),
);
