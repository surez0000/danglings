import type { CharmSize } from "../App";

export type CompanionId = "bluebird" | "monkey" | "panda" | "chameleon" | "swinger";

export type CompanionSelection = { kind: "charm" } | { kind: "companion"; id: CompanionId };

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
};

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
    name: "Monkey",
    description:
      "A cheeky pink-haired monkey that perches on the swing and tracks your every move, tail curled for balance.",
    actionLabel: "Make it grin",
    packId: "core",
    free: true,
    modelUrl: "/companions/monkey.glb",
    wantsCursor: true,
    emoji: "🐒",
    attach: "seat",
    aspect: 0.9,
    heightPx: { small: 64, medium: 96, large: 128 },
    focusFrac: 0.3,
    yawClamp: 0.5,
    pitchMul: 0.8,
    bobMul: 0.7,
  },
  {
    id: "panda",
    name: "Rope Panda",
    description:
      "Slides down its own rope with a lucky smiley in paw, keeping an eye on whatever you're up to.",
    actionLabel: "Give the rope a tug",
    packId: "core",
    free: true,
    modelUrl: "/companions/panda.glb",
    wantsCursor: true,
    emoji: "🐼",
    attach: "hang",
    aspect: 0.26,
    heightPx: { small: 170, medium: 230, large: 300 },
    focusFrac: 0.55,
    yawClamp: 0.45,
    pitchMul: 0.3,
    bobMul: 0.25,
  },
  {
    id: "chameleon",
    name: "Chameleon",
    description:
      "Clings to the line in its little red scarf and swivels those big eyes wherever your cursor goes.",
    actionLabel: "Catch its eye",
    packId: "core",
    free: true,
    modelUrl: "/companions/chameleon.glb",
    wantsCursor: true,
    emoji: "🦎",
    attach: "hang",
    aspect: 0.29,
    heightPx: { small: 160, medium: 220, large: 290 },
    focusFrac: 0.72,
    yawClamp: 0.4,
    pitchMul: 0.25,
    bobMul: 0.2,
  },
  {
    id: "swinger",
    name: "Vine Swinger",
    description:
      "A wide-eyed chameleon on a flowered vine swing, kicking along happily with the breeze.",
    actionLabel: "Push the swing",
    packId: "core",
    free: true,
    modelUrl: "/companions/swinger.glb",
    wantsCursor: true,
    emoji: "🌿",
    attach: "hang",
    aspect: 0.48,
    heightPx: { small: 150, medium: 210, large: 280 },
    focusFrac: 0.6,
    yawClamp: 0.5,
    pitchMul: 0.3,
    bobMul: 0.3,
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
