import type { CursorState } from "./useCursorFeed";
import type { SeatState } from "./useSwing";

/* Pure, framework-free bird brain. Stepped by BirdCompanion's master loop with
   real (clamped) frame dt; all smoothing is framerate-independent:
   r += (target - r) * (1 - exp(-dt/tau)). */

export type BirdPose = {
  yaw: number;
  pitch: number;
  roll: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
};

export type BehaviorState = "idle" | "watch" | "flutter" | "peck" | "chirp" | "dragged" | "doze";

export type BehaviorCtx = {
  now: number; // ms, performance.now() timeline (same clock as cursor.lastMoveAt)
  dt: number; // seconds since the previous step, clamped by the loop
  cursor: CursorState;
  headX: number;
  headY: number;
  birdCenterX: number;
  birdCenterY: number;
  seat: SeatState;
  dragging: boolean;
  clicked: boolean;
  stageW: number;
  stageH: number;
};

export type StepResult = {
  pose: BirdPose;
  wantsRender: boolean;
  sfx: "chirp" | "peck" | "flutter" | null;
  seatImpulseX: number;
  /* True while a flutter/peck/chirp animation is actually playing — drives the
     60fps render tier. Doze vignettes are slow and stay at 30fps. */
  oneShotActive: boolean;
};

export type Behavior = {
  state: BehaviorState;
  stateSince: number;
  pose: BirdPose;
  // idle gaze drift
  gazeYaw: number;
  gazePitch: number;
  nextGazeRollAt: number;
  // peck scheduling/playback
  nextPeckAt: number;
  peckReps: number;
  peckSfxRep: number;
  // flutter hysteresis
  flutterCooldownUntil: number;
  flutterImpulseSign: number;
  // saccade darts
  saccadeRefX: number;
  saccadeRefY: number;
  saccadeRefAt: number;
  saccadeUntil: number;
  // doze settle + vignettes; nextVignetteAt is read by BirdCompanion to arm the
  // wake timer once the loop stops.
  dozeSettled: boolean;
  finalFramePending: boolean;
  nextVignetteAt: number;
  vignetteUntil: number;
  vignetteKind: "peck" | "gaze";
  vignetteFromYaw: number;
  vignetteToYaw: number;
  vignetteSfxSent: boolean;
  lastRenderPose: BirdPose;
};

const TAU_WATCH = 0.12;
const TAU_RELAX = 0.5;
const TAU_SACCADE = 0.04;
const TAU_DRAG = 0.2;
const TAU_DOZE_SETTLE = 0.08;

const LOOK_DEPTH_PX = 600;
const YAW_CLAMP = 0.6;
const PITCH_MIN = -0.35;
const PITCH_MAX = 0.5;
const PITCH_BODY_SCALE = 0.4;
const ROLL_COUNTER = 0.15;

const WATCH_TIMEOUT_MS = 2000;
const DOZE_AFTER_MS = 10000;
const DOZE_ENERGY = 0.02;

const FLUTTER_ENTER_NEAR_PX = 90;
const FLUTTER_ENTER_FAR_PX = 130;
const FLUTTER_EXIT_PX = 130;
const FLUTTER_APPROACH_PX_S = 250;
const FLUTTER_ANIM_MS = 700;
const FLUTTER_MIN_MS = 600;
const FLUTTER_COOLDOWN_MS = 3000;
const FLUTTER_HZ = 14;
const FLUTTER_IMPULSE = 1.5;

const PECK_GAP_MIN_MS = 8000;
const PECK_GAP_MAX_MS = 20000;
const PECK_DOWN_MS = 180;
const PECK_HOLD_MS = 80;
const PECK_UP_MS = 220;
const PECK_REP_MS = PECK_DOWN_MS + PECK_HOLD_MS + PECK_UP_MS;
const PECK_PITCH = 0.5;

const CHIRP_MS = 490;

const DOZE_SETTLE_MS = 300;
const DOZE_DROOP_PITCH = 0.06;
const VIGNETTE_GAP_MIN_MS = 20000;
const VIGNETTE_GAP_MAX_MS = 45000;
const VIGNETTE_MS = 2000;

const SACCADE_DIST_PX = 250;
const SACCADE_WINDOW_MS = 120;
const SACCADE_HOLD_MS = 150;

const EPS_ROT = 0.001;
const EPS_OFFSET = 0.0005;
const EPS_SCALE = 0.001;

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function smooth(current: number, target: number, dt: number, tau: number): number {
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

function identityPose(): BirdPose {
  return { yaw: 0, pitch: 0, roll: 0, offsetY: 0, scaleX: 1, scaleY: 1 };
}

export function createBehavior(): Behavior {
  return {
    state: "idle",
    stateSince: 0,
    pose: identityPose(),
    gazeYaw: 0,
    gazePitch: 0.05,
    nextGazeRollAt: 0,
    nextPeckAt: 0,
    peckReps: 1,
    peckSfxRep: -1,
    flutterCooldownUntil: 0,
    flutterImpulseSign: 1,
    saccadeRefX: 0,
    saccadeRefY: 0,
    saccadeRefAt: 0,
    saccadeUntil: 0,
    dozeSettled: false,
    finalFramePending: false,
    nextVignetteAt: 0,
    vignetteUntil: 0,
    vignetteKind: "gaze",
    vignetteFromYaw: 0,
    vignetteToYaw: 0,
    vignetteSfxSent: false,
    lastRenderPose: { ...identityPose(), yaw: NaN },
  };
}

function enter(b: Behavior, state: BehaviorState, now: number) {
  b.state = state;
  b.stateSince = now;
  if (state === "idle" && b.nextPeckAt <= now) {
    b.nextPeckAt = now + rand(PECK_GAP_MIN_MS, PECK_GAP_MAX_MS);
  }
  if (state === "peck") {
    b.peckReps = 1 + Math.floor(Math.random() * 3);
    b.peckSfxRep = -1;
  }
  if (state === "doze") {
    b.dozeSettled = false;
    b.vignetteUntil = 0;
    b.nextVignetteAt = now + rand(VIGNETTE_GAP_MIN_MS, VIGNETTE_GAP_MAX_MS);
  }
}

function rollGaze(b: Behavior, now: number) {
  b.gazeYaw = rand(-0.3, 0.3);
  b.gazePitch = rand(-0.1, 0.2);
  b.nextGazeRollAt = now + rand(4000, 9000);
}

function lookTarget(ctx: BehaviorCtx): { yaw: number; pitch: number } {
  const dx = ctx.cursor.x - ctx.headX;
  const dy = ctx.cursor.y - ctx.headY;
  /* Virtual cursor-plane depth: screen offsets read as gaze angles. Screen y is
     down, so cursor below the head means +pitch (look down) in three.js. */
  return {
    yaw: clamp(Math.atan2(dx, LOOK_DEPTH_PX), -YAW_CLAMP, YAW_CLAMP),
    pitch: clamp(Math.atan2(dy, LOOK_DEPTH_PX), PITCH_MIN, PITCH_MAX),
  };
}

function cursorDist(ctx: BehaviorCtx): number {
  return Math.hypot(ctx.birdCenterX - ctx.cursor.x, ctx.birdCenterY - ctx.cursor.y);
}

function approachSpeed(ctx: BehaviorCtx): number {
  const vx = ctx.cursor.x - ctx.cursor.prevX;
  const vy = ctx.cursor.y - ctx.cursor.prevY;
  const vlen = Math.hypot(vx, vy);
  if (vlen === 0) return 0;
  const tx = ctx.birdCenterX - ctx.cursor.x;
  const ty = ctx.birdCenterY - ctx.cursor.y;
  const tlen = Math.hypot(tx, ty) || 1;
  return ctx.cursor.speed * Math.max(0, (vx * tx + vy * ty) / (vlen * tlen));
}

function easeInQuad(u: number): number {
  return u * u;
}

function easeOutQuad(u: number): number {
  return 1 - (1 - u) * (1 - u);
}

function easeInOut(u: number): number {
  return u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
}

function poseChanged(a: BirdPose, last: BirdPose): boolean {
  // The first term is negated so a NaN sentinel (fresh Behavior) compares as
  // changed, guaranteeing the very first frame renders.
  return (
    !(Math.abs(a.yaw - last.yaw) <= EPS_ROT) ||
    Math.abs(a.pitch - last.pitch) > EPS_ROT ||
    Math.abs(a.roll - last.roll) > EPS_ROT ||
    Math.abs(a.offsetY - last.offsetY) > EPS_OFFSET ||
    Math.abs(a.scaleX - last.scaleX) > EPS_SCALE ||
    Math.abs(a.scaleY - last.scaleY) > EPS_SCALE
  );
}

export function stepBehavior(b: Behavior, ctx: BehaviorCtx): StepResult {
  const { now, dt } = ctx;
  const p = b.pose;
  let sfx: StepResult["sfx"] = null;
  let seatImpulseX = 0;

  // Lazy timer init (createBehavior has no clock).
  if (b.nextPeckAt === 0) b.nextPeckAt = now + rand(PECK_GAP_MIN_MS, PECK_GAP_MAX_MS);
  if (b.nextGazeRollAt === 0) rollGaze(b, now);
  if (b.saccadeRefAt === 0) {
    b.saccadeRefAt = now;
    b.saccadeRefX = ctx.cursor.x;
    b.saccadeRefY = ctx.cursor.y;
  }

  // Saccade darts: a >250px cursor jump within ~120ms tightens the look-at tau.
  const saccadeD = Math.hypot(ctx.cursor.x - b.saccadeRefX, ctx.cursor.y - b.saccadeRefY);
  if (saccadeD > SACCADE_DIST_PX && now - b.saccadeRefAt <= SACCADE_WINDOW_MS) {
    b.saccadeUntil = now + SACCADE_HOLD_MS;
  }
  if (now - b.saccadeRefAt > SACCADE_WINDOW_MS || saccadeD > SACCADE_DIST_PX) {
    b.saccadeRefAt = now;
    b.saccadeRefX = ctx.cursor.x;
    b.saccadeRefY = ctx.cursor.y;
  }

  // Global transitions. A click interrupts anything but an active drag — the
  // "non-interruptible" flutter guards against cursor hysteresis, not intent.
  if (ctx.dragging) {
    if (b.state !== "dragged") enter(b, "dragged", now);
  } else if (ctx.clicked && b.state !== "chirp") {
    enter(b, "chirp", now);
    sfx = "chirp";
  } else if (b.state === "dragged") {
    enter(b, "watch", now);
  }

  const cursorRecent = now - ctx.cursor.lastMoveAt < WATCH_TIMEOUT_MS;
  const tauLook = now < b.saccadeUntil ? TAU_SACCADE : TAU_WATCH;
  const elapsed = now - b.stateSince;
  let oneShotActive = false;

  switch (b.state) {
    case "idle": {
      if (now >= b.nextGazeRollAt) rollGaze(b, now);
      p.yaw = smooth(p.yaw, b.gazeYaw, dt, TAU_RELAX);
      p.pitch = smooth(p.pitch, b.gazePitch, dt, TAU_RELAX);
      p.roll = -p.yaw * ROLL_COUNTER;
      const t = now / 1000;
      p.offsetY = 0.015 * Math.sin((2 * Math.PI * t) / 3.2);
      p.scaleY = 1 + 0.01 * Math.sin((2 * Math.PI * t) / 2.4);
      p.scaleX = smooth(p.scaleX, 1, dt, TAU_RELAX);
      if (cursorRecent) {
        enter(b, "watch", now);
      } else if (now >= b.nextPeckAt) {
        enter(b, "peck", now);
      } else if (now - ctx.cursor.lastMoveAt > DOZE_AFTER_MS && ctx.seat.energy < DOZE_ENERGY) {
        enter(b, "doze", now);
      }
      break;
    }

    case "watch": {
      const look = lookTarget(ctx);
      p.yaw = smooth(p.yaw, look.yaw, dt, tauLook);
      p.pitch = smooth(p.pitch, look.pitch * PITCH_BODY_SCALE, dt, tauLook);
      p.roll = -p.yaw * ROLL_COUNTER;
      p.offsetY = smooth(p.offsetY, 0, dt, TAU_RELAX);
      p.scaleX = smooth(p.scaleX, 1, dt, TAU_RELAX);
      p.scaleY = smooth(p.scaleY, 1, dt, TAU_RELAX);
      const dist = cursorDist(ctx);
      if (!cursorRecent) {
        enter(b, "idle", now);
      } else if (
        now >= b.flutterCooldownUntil &&
        (dist < FLUTTER_ENTER_NEAR_PX ||
          (dist < FLUTTER_ENTER_FAR_PX && approachSpeed(ctx) > FLUTTER_APPROACH_PX_S))
      ) {
        enter(b, "flutter", now);
        b.flutterImpulseSign = Math.sign(ctx.birdCenterX - ctx.cursor.x) || 1;
        sfx = "flutter";
        seatImpulseX = FLUTTER_IMPULSE * b.flutterImpulseSign;
      }
      break;
    }

    case "flutter": {
      const look = lookTarget(ctx);
      p.yaw = smooth(p.yaw, look.yaw, dt, tauLook);
      p.pitch = smooth(p.pitch, look.pitch * PITCH_BODY_SCALE, dt, tauLook);
      p.roll = -p.yaw * ROLL_COUNTER;
      if (elapsed <= FLUTTER_ANIM_MS) {
        oneShotActive = true;
        const u = elapsed / FLUTTER_ANIM_MS;
        const decay = 1 - u;
        const buzz = Math.sin(2 * Math.PI * FLUTTER_HZ * (elapsed / 1000));
        p.scaleX = 1 + 0.04 * buzz * decay;
        p.scaleY = 1;
        p.offsetY = 0.03 * buzz * decay + 0.08 * Math.sin(Math.PI * Math.min(u * 2.8, 1));
      } else {
        p.scaleX = smooth(p.scaleX, 1, dt, TAU_RELAX);
        p.scaleY = smooth(p.scaleY, 1, dt, TAU_RELAX);
        p.offsetY = smooth(p.offsetY, 0, dt, TAU_RELAX);
      }
      if (elapsed >= FLUTTER_MIN_MS && cursorDist(ctx) > FLUTTER_EXIT_PX) {
        b.flutterCooldownUntil = now + FLUTTER_COOLDOWN_MS;
        enter(b, "watch", now);
      }
      break;
    }

    case "peck": {
      oneShotActive = true;
      const rep = Math.floor(elapsed / PECK_REP_MS);
      if (rep >= b.peckReps) {
        b.nextPeckAt = now + rand(PECK_GAP_MIN_MS, PECK_GAP_MAX_MS);
        enter(b, "idle", now);
        break;
      }
      if (rep !== b.peckSfxRep) {
        b.peckSfxRep = rep;
        sfx = "peck";
      }
      const e = elapsed - rep * PECK_REP_MS;
      let pitch: number;
      if (e < PECK_DOWN_MS) pitch = PECK_PITCH * easeInQuad(e / PECK_DOWN_MS);
      else if (e < PECK_DOWN_MS + PECK_HOLD_MS) pitch = PECK_PITCH;
      else pitch = PECK_PITCH * (1 - easeOutQuad((e - PECK_DOWN_MS - PECK_HOLD_MS) / PECK_UP_MS));
      p.pitch = pitch;
      p.yaw = smooth(p.yaw, 0, dt, TAU_RELAX);
      p.roll = -p.yaw * ROLL_COUNTER;
      const t = now / 1000;
      p.offsetY = 0.015 * Math.sin((2 * Math.PI * t) / 3.2);
      p.scaleY = 1 + 0.01 * Math.sin((2 * Math.PI * t) / 2.4);
      break;
    }

    case "chirp": {
      oneShotActive = true;
      if (elapsed >= CHIRP_MS) {
        enter(b, "watch", now);
        break;
      }
      if (elapsed < 90) {
        const u = elapsed / 90;
        p.scaleY = 1 - 0.08 * u;
        p.offsetY = 0;
      } else if (elapsed < 250) {
        const u = easeOutQuad((elapsed - 90) / 160);
        p.scaleY = 0.92 + (1.06 - 0.92) * u;
        p.offsetY = 0.06 * u;
      } else {
        const u = (elapsed - 250) / 240;
        p.scaleY = 1.06 + (1 - 1.06) * u;
        p.offsetY = 0.06 * (1 - u);
      }
      p.scaleX = 1;
      p.yaw = smooth(p.yaw, 0, dt, TAU_WATCH);
      p.pitch = smooth(p.pitch, -0.05, dt, TAU_WATCH);
      p.roll = -p.yaw * ROLL_COUNTER;
      break;
    }

    case "dragged": {
      p.yaw = smooth(p.yaw, 0, dt, TAU_DRAG);
      p.pitch = smooth(p.pitch, 0, dt, TAU_DRAG);
      p.roll = -p.yaw * ROLL_COUNTER;
      p.offsetY = smooth(p.offsetY, 0, dt, TAU_DRAG);
      p.scaleX = smooth(p.scaleX, 1, dt, TAU_DRAG);
      p.scaleY = smooth(p.scaleY, 0.97, dt, TAU_DRAG);
      break;
    }

    case "doze": {
      // Any cursor movement since dozing off exits instantly.
      if (ctx.cursor.lastMoveAt > b.stateSince) {
        enter(b, "watch", now);
        break;
      }
      const inVignette = b.vignetteUntil !== 0 && now < b.vignetteUntil;
      if (!b.dozeSettled) {
        // Settle-to-sleep: ease toward the droop pose, then one final frame.
        p.yaw = smooth(p.yaw, 0, dt, TAU_DOZE_SETTLE);
        p.pitch = smooth(p.pitch, DOZE_DROOP_PITCH, dt, TAU_DOZE_SETTLE);
        p.roll = smooth(p.roll, 0, dt, TAU_DOZE_SETTLE);
        p.offsetY = smooth(p.offsetY, 0, dt, TAU_DOZE_SETTLE);
        p.scaleX = smooth(p.scaleX, 1, dt, TAU_DOZE_SETTLE);
        p.scaleY = smooth(p.scaleY, 1, dt, TAU_DOZE_SETTLE);
        if (elapsed >= DOZE_SETTLE_MS) {
          p.yaw = 0;
          p.pitch = DOZE_DROOP_PITCH;
          p.roll = 0;
          p.offsetY = 0;
          p.scaleX = 1;
          p.scaleY = 1;
          b.dozeSettled = true;
          b.finalFramePending = true;
        }
      } else if (inVignette) {
        const u = clamp((now - (b.vignetteUntil - VIGNETTE_MS)) / VIGNETTE_MS, 0, 1);
        if (b.vignetteKind === "peck") {
          if (!b.vignetteSfxSent) {
            b.vignetteSfxSent = true;
            sfx = "peck";
          }
          p.pitch = DOZE_DROOP_PITCH + 0.34 * Math.sin(Math.PI * u);
        } else {
          p.yaw = b.vignetteFromYaw + (b.vignetteToYaw - b.vignetteFromYaw) * easeInOut(u);
          p.roll = -p.yaw * ROLL_COUNTER;
        }
      } else if (b.vignetteUntil !== 0) {
        // Vignette just ended: restore the droop, render once more, re-doze.
        b.vignetteUntil = 0;
        b.nextVignetteAt = now + rand(VIGNETTE_GAP_MIN_MS, VIGNETTE_GAP_MAX_MS);
        p.yaw = 0;
        p.pitch = DOZE_DROOP_PITCH;
        p.roll = 0;
        b.finalFramePending = true;
      } else if (now >= b.nextVignetteAt) {
        b.vignetteUntil = now + VIGNETTE_MS;
        b.vignetteKind = Math.random() < 0.5 ? "peck" : "gaze";
        b.vignetteSfxSent = false;
        const sweep = rand(0.15, 0.3);
        b.vignetteFromYaw = Math.random() < 0.5 ? -sweep : sweep;
        b.vignetteToYaw = -b.vignetteFromYaw;
      }
      break;
    }
  }

  // Render gate: outside doze render when the pose meaningfully changed (the
  // epsilon check coalesces idle's slow bob); in doze only the settle ease,
  // vignettes and their final frames render — otherwise exactly 0fps.
  const dozeActive =
    b.state === "doze" &&
    (!b.dozeSettled || (b.vignetteUntil !== 0 && now < b.vignetteUntil) || b.finalFramePending);
  let wantsRender = false;
  if (b.state !== "doze" || dozeActive) {
    wantsRender = b.finalFramePending || poseChanged(p, b.lastRenderPose);
    if (wantsRender) {
      b.finalFramePending = false;
      b.lastRenderPose = { ...p };
    }
  }

  return { pose: p, wantsRender, sfx, seatImpulseX, oneShotActive };
}
