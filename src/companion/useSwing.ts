import type { RopePoint } from "../useRope";

/* Self-contained verlet swing: two 4-segment cords joined by a stiff seat bar.
   The integrate/constraint primitives are deliberately duplicated from useRope
   so the charm physics path stays untouched byte-for-byte. */

const CORD_SEGMENTS = 4;
const GRAVITY = 0.35;
const DAMPING_CORD = 0.985;
/* Lighter damping on the seat points is what makes a flick swing for seconds. */
const DAMPING_SEAT = 0.995;
const CONSTRAINT_ITERATIONS = 6;
/* Post-release explosion insurance: clamp seat velocity for a few frames. */
const RELEASE_CLAMP_FRAMES = 6;
const RELEASE_CLAMP_PX = 28;

export type Swing = { left: RopePoint[]; right: RopePoint[] };

export type SeatState = {
  midX: number;
  midY: number;
  barAngle: number;
  velX: number;
  velY: number;
  energy: number;
};

type SwingInternal = Swing & { wasDragging: boolean; releaseFrames: number };

function makeCord(x: number, anchorY: number, cordSegLen: number): RopePoint[] {
  const points: RopePoint[] = [];
  for (let i = 0; i <= CORD_SEGMENTS; i++) {
    const y = anchorY + i * cordSegLen;
    points.push({ x, y, px: x, py: y, pinned: i === 0 });
  }
  return points;
}

export function createSwing(
  anchorX: number,
  anchorY: number,
  seatLen: number,
  cordSegLen: number,
): Swing {
  const swing: SwingInternal = {
    left: makeCord(anchorX - seatLen / 2, anchorY, cordSegLen),
    right: makeCord(anchorX + seatLen / 2, anchorY, cordSegLen),
    wasDragging: false,
    releaseFrames: 0,
  };
  return swing;
}

function pinAnchor(p: RopePoint, x: number, y: number) {
  p.x = x;
  p.y = y;
  p.px = x;
  p.py = y;
}

function integrateCord(cord: RopePoint[], windX: number, clampVel: boolean) {
  for (let i = 1; i < cord.length; i++) {
    const p = cord[i];
    const damping = i === CORD_SEGMENTS ? DAMPING_SEAT : DAMPING_CORD;
    let vx = (p.x - p.px) * damping;
    let vy = (p.y - p.py) * damping;
    if (clampVel && i === CORD_SEGMENTS) {
      const mag = Math.hypot(vx, vy);
      if (mag > RELEASE_CLAMP_PX) {
        vx *= RELEASE_CLAMP_PX / mag;
        vy *= RELEASE_CLAMP_PX / mag;
      }
    }
    p.px = p.x;
    p.py = p.y;
    p.x += vx + windX;
    p.y += vy + GRAVITY;
  }
}

function constrainChain(cord: RopePoint[], segLen: number) {
  for (let i = 0; i < cord.length - 1; i++) {
    const a = cord[i];
    const b = cord[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
    const diff = (dist - segLen) / dist;
    if (a.pinned) {
      b.x -= dx * diff;
      b.y -= dy * diff;
    } else {
      a.x += dx * diff * 0.5;
      a.y += dy * diff * 0.5;
      b.x -= dx * diff * 0.5;
      b.y -= dy * diff * 0.5;
    }
  }
}

function constrainBar(l: RopePoint, r: RopePoint, seatLen: number) {
  const dx = r.x - l.x;
  const dy = r.y - l.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
  const diff = (dist - seatLen) / dist;
  l.x += dx * diff * 0.5;
  l.y += dy * diff * 0.5;
  r.x -= dx * diff * 0.5;
  r.y -= dy * diff * 0.5;
}

function clampCord(cord: RopePoint[], bounds: { width: number; height: number; margin: number }) {
  const { width, height, margin } = bounds;
  for (let i = 1; i < cord.length; i++) {
    const p = cord[i];
    const clampedX = Math.min(Math.max(p.x, margin), width - margin);
    const clampedY = Math.min(Math.max(p.y, margin), height - margin);
    if (clampedX !== p.x) p.px = clampedX;
    if (clampedY !== p.y) p.py = clampedY;
    p.x = clampedX;
    p.y = clampedY;
  }
}

export function stepSwing(
  s: Swing,
  anchorX: number,
  anchorY: number,
  seatLen: number,
  cordSegLen: number,
  windX: number,
  drag: { x: number; y: number } | null,
  bounds: { width: number; height: number; margin: number },
): void {
  const si = s as SwingInternal;
  const { left, right } = s;
  const seatL = left[CORD_SEGMENTS];
  const seatR = right[CORD_SEGMENTS];

  if (drag) {
    si.wasDragging = true;
    si.releaseFrames = 0;
    /* Same trick as stepRope's drag branch: zero the seat's stored velocity so
       release velocity equals the last frame's real displacement (flick). */
    seatL.px = seatL.x;
    seatL.py = seatL.y;
    seatR.px = seatR.x;
    seatR.py = seatR.y;
  } else if (si.wasDragging) {
    si.wasDragging = false;
    si.releaseFrames = RELEASE_CLAMP_FRAMES;
  }
  const clampVel = si.releaseFrames > 0;
  if (clampVel) si.releaseFrames--;

  pinAnchor(left[0], anchorX - seatLen / 2, anchorY);
  pinAnchor(right[0], anchorX + seatLen / 2, anchorY);

  integrateCord(left, windX, clampVel);
  integrateCord(right, windX, clampVel);

  for (let iter = 0; iter < CONSTRAINT_ITERATIONS; iter++) {
    constrainChain(left, cordSegLen);
    constrainChain(right, cordSegLen);
    /* Bar applied twice per iteration: stiffer than the cords, so the seat
       never rubber-bands. */
    constrainBar(seatL, seatR, seatLen);
    constrainBar(seatL, seatR, seatLen);
    if (drag) {
      const midX = (seatL.x + seatR.x) / 2;
      const midY = (seatL.y + seatR.y) / 2;
      const dx = drag.x - midX;
      const dy = drag.y - midY;
      seatL.x += dx;
      seatL.y += dy;
      seatR.x += dx;
      seatR.y += dy;
    }
  }

  clampCord(left, bounds);
  clampCord(right, bounds);
}

export function readSeat(s: Swing, prev: SeatState | null): SeatState {
  const l = s.left[CORD_SEGMENTS];
  const r = s.right[CORD_SEGMENTS];
  const midX = (l.x + r.x) / 2;
  const midY = (l.y + r.y) / 2;
  const barAngle = Math.atan2(r.y - l.y, r.x - l.x);
  const velX = prev ? midX - prev.midX : 0;
  const velY = prev ? midY - prev.midY : 0;
  const dAngle = prev ? barAngle - prev.barAngle : 0;
  return {
    midX,
    midY,
    barAngle,
    velX,
    velY,
    energy: Math.abs(velX) + Math.abs(velY) + Math.abs(dAngle) * 60,
  };
}

/* Flutter coupling: the bird 'pushes off', nudging the seat sideways. Positive
   impulseX pushes the seat toward +x. */
export function nudgeSeat(s: Swing, impulseX: number): void {
  s.left[CORD_SEGMENTS].px -= impulseX;
  s.right[CORD_SEGMENTS].px -= impulseX;
}
