/* Dev-only portrait renderer: loads one companion model with the app's exact
   scene (lights, environment, ACES tone mapping) into a 512² transparent
   canvas and exposes window.__portrait() → PNG data URL. Driven by hand (or
   a browser automation) to produce site/public/portraits/*.png. */

import { COMPANIONS, companionBoneHints, companionModelUrl, type CompanionDef } from "../src/companion/types";
import { createBirdScene } from "../src/companion/birdScene";

const q = new URLSearchParams(location.search);
const modelFile = q.get("model") ?? "kitten-tabby"; // file base name, e.g. monkey-classic
const yaw = Number(q.get("yaw") ?? 0.32);
const pitch = Number(q.get("pitch") ?? 0.04);
// Hang models carry their rope in the mesh; zoom past it so the character fills the frame.
const zoom = Number(q.get("zoom") ?? 1);
const SIZE = 512;

function findDef(file: string): { def: CompanionDef; variantId?: string } | null {
  for (const def of COMPANIONS) {
    if (def.variants) {
      const v = def.variants.find((x) => x.modelUrl.endsWith(`/${file}.glb`));
      if (v) return { def, variantId: v.id };
    }
    if (def.modelUrl.endsWith(`/${file}.glb`)) return { def };
  }
  return null;
}

const status = document.getElementById("status")!;
const canvas = document.getElementById("c") as HTMLCanvasElement;

(async () => {
  const hit = findDef(modelFile);
  if (!hit) {
    status.textContent = `unknown model "${modelFile}"`;
    return;
  }
  const { def, variantId } = hit;
  const scene = await createBirdScene(canvas);
  // Fill the square: seat-attach frustum puts the seat at 82% height, so the
  // model gets ~0.59 of the canvas; hang models get their own framing.
  const modelPx = Math.round((def.attach === "seat" ? SIZE * 0.6 : SIZE * 0.86) * zoom);
  await scene.configure({
    url: companionModelUrl(def, variantId),
    boneHints: companionBoneHints(def, variantId),
    clips: def.clips,
    attach: def.attach,
    canvasW: SIZE,
    canvasH: SIZE,
    modelPx,
  });
  scene.setSize({ canvasW: SIZE, canvasH: SIZE, modelPx }, 1);
  const rigged = scene.hasRig();
  const pose = { yaw: rigged ? yaw * 0.15 : yaw, pitch: rigged ? pitch * 0.2 : pitch, roll: 0, offsetY: 0, scaleX: 1, scaleY: 1 };
  const rig = rigged ? { headYaw: yaw, headPitch: pitch, flapAngle: 0, wagAngle: 0, earWiggle: 0 } : undefined;
  scene.setPose(pose, rig);
  scene.render(0);
  status.textContent = `${def.name}${variantId ? ` · ${variantId}` : ""} · rig ${rigged ? "yes" : "no"} · ready`;
  (window as unknown as { __portrait: () => string }).__portrait = () => {
    scene.setPose(pose, rig);
    scene.render(0);
    return canvas.toDataURL("image/png");
  };
  // ?save=1 → POST the PNG to the dev server's sink (see vite.config.ts).
  if (q.get("save")) {
    scene.setPose(pose, rig);
    scene.render(0);
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const r = await fetch(`/__portrait?name=${encodeURIComponent(modelFile)}`, { method: "POST", body: blob });
      status.textContent += ` · ${await r.text()}`;
    }, "image/png");
  }
})().catch((e) => {
  status.textContent = `failed: ${e}`;
});
