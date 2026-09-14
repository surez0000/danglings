import type { CharmSize } from "../App";

export type CompanionId =
  | "bluebird"
  | "monkey"
  | "elephant"
  | "kitten"
  | "leopard"
  | "fox"
  | "tiger"
  | "chipmunk"
  | "rabbit"
  | "bunny"
  | "owlet"
  | "professor"
  | "mia"
  | "riko";

export type CompanionSelection =
  | { kind: "charm" }
  | { kind: "companion"; id: CompanionId; variantId?: string };

export type BoneHints = Partial<
  Record<"head" | "tail" | "earL" | "earR" | "wingL" | "wingR", string>
>;

/* A color variant: same character, different model file. Meshy re-rigs every
   variant, so bone NAMES differ between variants of one family — hints are
   therefore per-variant, falling back to the family default. */
export type CompanionVariant = {
  id: string;
  label: string;
  /* CSS color for the picker dot. */
  swatch: string;
  modelUrl: string;
  boneHints?: BoneHints;
};

/* seat: sits on the physics swing (two cords + seat bar).
   hang: the model has its own rope/swing baked into the mesh and dangles from a
   single short cord — our SVG draws one strand and no seat bar. */
export type CompanionAttach = "seat" | "hang";

export const COMPANION_STORAGE_KEY = "danglings.companion";

/* Emitted by the Rust hit-test loop: window-local LOGICAL px, dead-banded 2px,
   capped at 30Hz with a 150ms trailing settle emit. Payload is [x, y]. */
export const CURSOR_EVENT = "cursor-moved";

export type CompanionDef = {
  id: CompanionId;
  name: string;
  description: string;
  actionLabel: string;
  packId: string;
  free: boolean;
  modelUrl: string;
  wantsCursor: boolean;
  /* Picker thumbnail for models without a hand-drawn glyph (bluebird uses BirdGlyph). */
  emoji: string;
  attach: CompanionAttach;
  /* Model bbox width/height (measured in dev-viewer) — shapes the hang canvas. */
  aspect: number;
  /* On-screen model height per size; for hang models this includes the baked rope. */
  heightPx: Record<CharmSize, number>;
  /* Where the face sits, as a fraction of model height from its TOP (hang mode). */
  focusFrac: number;
  /* Motion personality: look-at yaw clamp (rad), pitch multiplier, idle-bob multiplier. */
  yawClamp: number;
  pitchMul: number;
  bobMul: number;
  /* Color variants; the first one is the default. modelUrl above is the
     fallback when variants is absent. */
  variants?: CompanionVariant[];
  /* Bone names per rig role, produced by the asset-pipeline analysis (Meshy
     bones are anonymous, so heuristics guess — hints override per model). */
  boneHints?: BoneHints;
  /* Baked animation clips (humanoids): the base model carries the looping idle
     clip; these URLs hold one-shot reaction clips retargeted at runtime. */
  clips?: Partial<Record<"chirp" | "flutter", string>>;
};

export function companionModelUrl(def: CompanionDef, variantId?: string): string {
  if (!def.variants || def.variants.length === 0) return def.modelUrl;
  const v = def.variants.find((x) => x.id === variantId);
  return (v ?? def.variants[0]).modelUrl;
}

export function companionBoneHints(def: CompanionDef, variantId?: string): BoneHints | undefined {
  if (!def.variants || def.variants.length === 0) return def.boneHints;
  const v = def.variants.find((x) => x.id === variantId) ?? def.variants[0];
  return v.boneHints ?? def.boneHints;
}

/* Registry of shipped companions; packs later slice this by packId. */
export const COMPANIONS: CompanionDef[] = [
  {
    id: "bluebird",
    name: "Blue Bird",
    description:
      "A little blue watcher on a swing. It follows your cursor, flutters when you get close, and dozes off when you work.",
    actionLabel: "Say hi",
    packId: "core",
    free: true,
    modelUrl: "/companions/bluebird.glb",
    wantsCursor: true,
    emoji: "🐦",
    attach: "seat",
    aspect: 1.21,
    heightPx: { small: 64, medium: 96, large: 128 },
    focusFrac: 0.28,
    yawClamp: 0.6,
    pitchMul: 1,
    bobMul: 1,
  },
  {
    id: "monkey",
    name: "Momo the Monkey",
    description:
      "A cheeky little monkey with a fully rigged tail, perched on the swing and tracking your every move.",
    actionLabel: "Make it grin",
    packId: "core",
    free: true,
    modelUrl: "/companions/monkey-classic.glb",
    wantsCursor: true,
    emoji: "🐒",
    attach: "seat",
    aspect: 0.9,
    heightPx: { small: 64, medium: 96, large: 128 },
    focusFrac: 0.3,
    yawClamp: 0.5,
    pitchMul: 0.8,
    bobMul: 0.7,
    variants: [
      { id: "classic", label: "Classic", swatch: "#b76e79", modelUrl: "/companions/monkey-classic.glb", boneHints: { head: "Bone_032", tail: "Bone_020", wingL: "Bone_025", wingR: "Bone_030" } },
      { id: "snowy", label: "Snowy", swatch: "#e8e2dc", modelUrl: "/companions/monkey-snowy.glb", boneHints: { head: "Bone_033", tail: "Bone_021", wingL: "Bone_026", wingR: "Bone_031" } },
      { id: "cream", label: "Cream", swatch: "#d8c4a8", modelUrl: "/companions/monkey-cream.glb", boneHints: { head: "Bone_033", tail: "Bone_021", wingL: "Bone_026", wingR: "Bone_031" } },
    ],
  },
  {
    id: "elephant",
    name: "Baby Elephant",
    description:
      "A round baby elephant with rigged flappy ears, planted happily on the swing.",
    actionLabel: "Boop the trunk",
    packId: "core",
    free: true,
    modelUrl: "/companions/elephant-grey.glb",
    wantsCursor: true,
    emoji: "🐘",
    attach: "seat",
    aspect: 1.07,
    heightPx: { small: 64, medium: 96, large: 128 },
    focusFrac: 0.3,
    yawClamp: 0.45,
    pitchMul: 0.7,
    bobMul: 0.8,
    variants: [
      { id: "grey", label: "Grey", swatch: "#9aa0a8", modelUrl: "/companions/elephant-grey.glb", boneHints: { head: "Bone_021", earL: "Bone_050", earR: "Bone_047", tail: "Bone_005" } },
      { id: "pink", label: "Pink", swatch: "#d8a3b6", modelUrl: "/companions/elephant-pink.glb", boneHints: { head: "Bone_021", earL: "Bone_050", earR: "Bone_048", tail: "Bone_005" } },
      { id: "snow", label: "Snow", swatch: "#e9e6e7", modelUrl: "/companions/elephant-snow.glb", boneHints: { head: "Bone_021", earL: "Bone_053", earR: "Bone_050", tail: "Bone_005" } },
      { id: "blue", label: "Blue", swatch: "#7d93b8", modelUrl: "/companions/elephant-blue.glb", boneHints: { head: "Bone_028", earL: "Bone_038", earR: "Bone_036", tail: "Bone_009" } },
    ],
  },
  {
    id: "kitten",
    name: "Kitten",
    description:
      "A chibi kitten with rigged ears and tail, following your cursor with enormous eyes.",
    actionLabel: "Pspsps",
    packId: "core",
    free: true,
    modelUrl: "/companions/kitten-cloud.glb",
    wantsCursor: true,
    emoji: "🐱",
    attach: "seat",
    aspect: 0.91,
    heightPx: { small: 64, medium: 96, large: 128 },
    focusFrac: 0.3,
    yawClamp: 0.55,
    pitchMul: 0.8,
    bobMul: 0.9,
    variants: [
      { id: "cloud", label: "Cloud", swatch: "#dfe3e8", modelUrl: "/companions/kitten-cloud.glb", boneHints: { head: "Bone_028", earL: "Bone_037", earR: "Bone_034", tail: "Bone_015" } },
      { id: "tabby", label: "Tabby", swatch: "#e8973f", modelUrl: "/companions/kitten-tabby.glb", boneHints: { head: "Bone_021", earL: "Bone_048", earR: "Bone_045", tail: "Bone_015" } },
    ],
  },
  {
    id: "leopard",
    name: "Leopard Cub",
    description:
      "A spotted cub in a pink bow, tail curled around the swing seat.",
    actionLabel: "Straighten the bow",
    packId: "core",
    free: true,
    modelUrl: "/companions/leopard-golden.glb",
    wantsCursor: true,
    emoji: "🐆",
    attach: "seat",
    aspect: 0.87,
    heightPx: { small: 64, medium: 96, large: 128 },
    focusFrac: 0.3,
    yawClamp: 0.5,
    pitchMul: 0.8,
    bobMul: 0.8,
    variants: [
      { id: "golden", label: "Golden", swatch: "#d9a441", modelUrl: "/companions/leopard-golden.glb", boneHints: { head: "Bone_026", earL: "Bone_037", earR: "Bone_035", tail: "Bone_014", wingL: "Bone_025", wingR: "Bone_023" } },
      { id: "snow", label: "Snow", swatch: "#e8e4df", modelUrl: "/companions/leopard-snow.glb", boneHints: { head: "Bone_026", tail: "Bone_020", wingL: "Bone_024", wingR: "Bone_022" } },
    ],
  },
  {
    id: "fox",
    name: "Fox Kit",
    description:
      "An orange fox kit wrapped in its own fluffy rigged tail.",
    actionLabel: "Fluff the tail",
    packId: "core",
    free: true,
    modelUrl: "/companions/fox.glb",
    wantsCursor: true,
    emoji: "🦊",
    attach: "seat",
    aspect: 0.76,
    heightPx: { small: 64, medium: 96, large: 128 },
    focusFrac: 0.3,
    yawClamp: 0.55,
    pitchMul: 0.8,
    bobMul: 0.8,
    boneHints: { head: "Bone_024", tail: "Bone_020" },
  },
  {
    id: "tiger",
    name: "Tiger Cub",
    description:
      "A laughing tiger cub with rigged ears and a striped tail that swishes behind the seat.",
    actionLabel: "Hear it roar",
    packId: "core",
    free: true,
    modelUrl: "/companions/tiger.glb",
    wantsCursor: true,
    emoji: "🐯",
    attach: "seat",
    aspect: 0.85,
    heightPx: { small: 64, medium: 96, large: 128 },
    focusFrac: 0.3,
    yawClamp: 0.5,
    pitchMul: 0.8,
    bobMul: 0.8,
    boneHints: { head: "Bone_023 (node 15)", earL: "Bone_047 (node 11)", earR: "Bone_050 (node 14)", tail: "Bone_020 (node 48)" },
  },
  {
    id: "chipmunk",
    name: "Chipmunk",
    description:
      "A waving chipmunk with the richest rig of the fleet — 76 bones, tail included.",
    actionLabel: "Wave hello",
    packId: "core",
    free: true,
    modelUrl: "/companions/chipmunk.glb",
    wantsCursor: true,
    emoji: "🐿️",
    attach: "seat",
    aspect: 0.94,
    heightPx: { small: 64, medium: 96, large: 128 },
    focusFrac: 0.3,
    yawClamp: 0.55,
    pitchMul: 0.85,
    bobMul: 0.8,
    boneHints: { head: "Bone_024", wingL: "Bone_030", wingR: "Bone_035", tail: "Bone_022" },
  },
  {
    id: "rabbit",
    name: "Meadow Rabbit",
    description:
      "A tall standing rabbit with rigged ears, balancing on the swing and watching you work.",
    actionLabel: "Twitch the ears",
    packId: "core",
    free: true,
    modelUrl: "/companions/rabbit.glb",
    wantsCursor: true,
    emoji: "🐇",
    attach: "seat",
    aspect: 0.31,
    heightPx: { small: 72, medium: 108, large: 144 },
    focusFrac: 0.3,
    yawClamp: 0.5,
    pitchMul: 0.7,
    bobMul: 0.5,
    boneHints: { head: "Bone_010", earL: "Bone_026", earR: "Bone_029", wingL: "Bone_013", wingR: "Bone_015", tail: "Bone_003" },
  },
  {
    id: "bunny",
    name: "Chibi Bunny",
    description:
      "A tiny white bunny whose long rigged ears wiggle when it gets excited.",
    actionLabel: "Wiggle the ears",
    packId: "core",
    free: true,
    modelUrl: "/companions/bunny.glb",
    wantsCursor: true,
    emoji: "🐰",
    attach: "seat",
    aspect: 0.59,
    heightPx: { small: 64, medium: 96, large: 128 },
    focusFrac: 0.3,
    yawClamp: 0.55,
    pitchMul: 0.8,
    bobMul: 0.9,
    boneHints: { head: "Bone_008", earL: "Bone_017", earR: "Bone_019", wingL: "Bone_015", wingR: "Bone_012" },
  },
  {
    id: "owlet",
    name: "Owlet",
    description:
      "A grey baby owl with rigged wings and ear tufts, blinking down at your cursor.",
    actionLabel: "Ruffle its feathers",
    packId: "core",
    free: true,
    modelUrl: "/companions/owlet.glb",
    wantsCursor: true,
    emoji: "🦉",
    attach: "seat",
    aspect: 0.68,
    heightPx: { small: 64, medium: 96, large: 128 },
    focusFrac: 0.3,
    yawClamp: 0.6,
    pitchMul: 0.9,
    bobMul: 0.9,
    boneHints: { head: "Bone_020", earL: "Bone_051", earR: "Bone_053", wingL: "Bone_015", wingR: "Bone_019" },
  },
  {
    id: "professor",
    name: "Professor Finch",
    description:
      "A scholarly blue bird in round glasses, supervising your work from the swing.",
    actionLabel: "Adjust the spectacles",
    packId: "core",
    free: true,
    modelUrl: "/companions/professor.glb",
    wantsCursor: true,
    emoji: "🧐",
    attach: "seat",
    aspect: 0.74,
    heightPx: { small: 64, medium: 96, large: 128 },
    focusFrac: 0.3,
    yawClamp: 0.6,
    pitchMul: 0.9,
    bobMul: 0.8,
    boneHints: { head: "Bone_010", earL: "Bone_047", earR: "Bone_049", tail: "Bone_017" },
  },
  {
    id: "mia",
    name: "Mia",
    description:
      "A pigtailed girl who genuinely sits cross-legged on the swing — click her for a thumbs-up.",
    actionLabel: "Thumbs up!",
    packId: "core",
    free: true,
    modelUrl: "/companions/mia.glb",
    wantsCursor: true,
    emoji: "🎀",
    attach: "seat",
    aspect: 0.8,
    heightPx: { small: 76, medium: 112, large: 148 },
    focusFrac: 0.3,
    yawClamp: 0.45,
    pitchMul: 0.6,
    bobMul: 0.4,
    boneHints: { head: "Head", wingL: "LeftArm", wingR: "RightArm" },
    clips: { chirp: "/companions/mia-chirp.glb" },
  },
  {
    id: "riko",
    name: "Riko",
    description:
      "A pink-haired kid in a hoodie, sitting cross-legged — dodges when your cursor rushes in.",
    actionLabel: "Thumbs up!",
    packId: "core",
    free: true,
    modelUrl: "/companions/riko.glb",
    wantsCursor: true,
    emoji: "🎧",
    attach: "seat",
    aspect: 0.87,
    heightPx: { small: 76, medium: 112, large: 148 },
    focusFrac: 0.3,
    yawClamp: 0.45,
    pitchMul: 0.6,
    bobMul: 0.4,
    boneHints: { head: "Head", wingL: "LeftArm", wingR: "RightArm" },
    clips: { chirp: "/companions/riko-chirp.glb", flutter: "/companions/riko-flutter.glb" },
  },
];

export const COMPANION_BY_ID: Record<CompanionId, CompanionDef> = Object.fromEntries(
  COMPANIONS.map((c) => [c.id, c]),
) as Record<CompanionId, CompanionDef>;

/* Attach-point y as a fraction of canvas height. Seat contact (world y=0) sits at
   82% of the canvas; a hang model's rope top (world y=1) sits at 5%. birdScene
   derives its ortho frustum from the same numbers. */
export const SEAT_ANCHOR_FRAC = 0.82;
export const HANG_ANCHOR_FRAC = 0.05;

export type CompanionSizeSpec = {
  attach: CompanionAttach;
  modelPx: number;
  canvasW: number;
  canvasH: number;
  seatLen: number;
  cordSegLen: number;
  anchorFracY: number;
};

/* The anchor sits at the true top edge (y=0), partly behind the macOS menu bar
   — the rope reads as tied somewhere above, which is the point. Cord length
   (4 segments) = model height + ~56px, so every size's head clears the menu-bar
   strip (~24-37px) with sway headroom to spare. */
const SEAT_RIG: Record<CharmSize, { seatLen: number; cordSegLen: number }> = {
  small: { seatLen: 48, cordSegLen: 30 },
  medium: { seatLen: 60, cordSegLen: 38 },
  large: { seatLen: 72, cordSegLen: 46 },
};

export function companionSpec(def: CompanionDef, size: CharmSize): CompanionSizeSpec {
  const modelPx = def.heightPx[size];
  if (def.attach === "seat") {
    /* canvasH ~= modelPx / 0.59 so the model has headroom for hop + tilt. */
    const canvasH = Math.round(modelPx / 0.59);
    return {
      attach: "seat",
      modelPx,
      canvasW: canvasH,
      canvasH,
      ...SEAT_RIG[size],
      anchorFracY: SEAT_ANCHOR_FRAC,
    };
  }
  /* Hang: the model's own baked rope IS the rope. Its top pins at the anchor
     and the whole model swings rigidly around it (the canvas rotates via CSS).
     The invisible physics cord is sized to the character's position down the
     model (focusFrac), so the pendulum period matches what the eye sees. */
  const canvasH = Math.round(modelPx * 1.12);
  const canvasW = Math.max(72, Math.round(canvasH * Math.max(def.aspect * 1.7, 0.4)));
  return {
    attach: "hang",
    modelPx,
    canvasW,
    canvasH,
    seatLen: 12,
    cordSegLen: Math.max(8, Math.round((modelPx * def.focusFrac) / 4)),
    anchorFracY: HANG_ANCHOR_FRAC,
  };
}

export const DPR_CAP = 2;

/* Render tiers: 60fps during drag / 600ms after release / one-shots, else 30fps. */
export const RENDER_INTERVAL_MS = 33;
export const RENDER_INTERVAL_ACTIVE_MS = 16;
export const ACTIVE_AFTER_RELEASE_MS = 600;

/* Fixed-timestep physics: verlet constants are tuned for 60Hz steps. */
export const PHYSICS_STEP_MS = 16.667;
export const MAX_PHYSICS_STEPS = 3;
export const FRAME_DT_CLAMP_MS = 50;

export const ENERGY_SLEEP = 0.02;
export const SLEEP_FRAMES = 90;

/* Wind applies only within this window after a wake event (companion mode only)
   so a settled swing can sleep forever even with windEnabled on. */
export const WIND_WAKE_WINDOW_MS = 8000;

/* Skip the update_hit_points invoke unless some point moved more than this. */
export const HIT_POINT_MIN_DELTA_PX = 1;
