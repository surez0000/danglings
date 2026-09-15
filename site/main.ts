/* Landing-page hero: the tabby kitten on its swing, hung from the top edge of
   the browser window, rendered by the app's own three.js scene and driven by
   the app's own swing physics and behavior state machine. This file is the
   browser stand-in for BirdCompanion.tsx: no React, no Tauri — the cursor
   comes from mousemove and the hit area is a plain div. */

import { COMPANION_BY_ID, companionBoneHints, companionModelUrl, SEAT_ANCHOR_FRAC } from "../src/companion/types";
import { createSwing, readSeat, stepSwing, type SeatState, type Swing } from "../src/companion/useSwing";
import { createBehavior, stepBehavior, type BehaviorCtx } from "../src/companion/birdBehavior";
import type { CursorState } from "../src/companion/useCursorFeed";
import type { BirdScene } from "../src/companion/birdScene";
import { playChirp } from "../src/sound";

const HERO = { id: "kitten" as const, variant: "tabby", modelPx: 150 };
const PHYSICS_STEP_MS = 16.667;
const MAX_STEPS = 3;
const RENDER_MS = 33;
const RENDER_ACTIVE_MS = 16;

/* Same derivation as companionSpec()'s seat branch, for an arbitrary size. */
function heroSpec(modelPx: number) {
  const canvasH = Math.round(modelPx / 0.59);
  return {
    modelPx,
    canvasW: canvasH,
    canvasH,
    seatLen: Math.round(modelPx * 0.56),
    cordSegLen: Math.round(modelPx * 0.36),
    anchorFracY: SEAT_ANCHOR_FRAC,
  };
}

const ROPE_LAYERS: Array<{ w: number; stroke: string; dash?: string; dashOffset?: number }> = [
  { w: 6, stroke: "rgba(30, 19, 10, 0.85)" },
  { w: 4.4, stroke: "#a97c50" },
  { w: 4.4, stroke: "rgba(255, 238, 205, 0.3)", dash: "3 5.2" },
  { w: 4.4, stroke: "rgba(46, 28, 14, 0.4)", dash: "3 5.2", dashOffset: 4.1 },
];

const NS = "http://www.w3.org/2000/svg";
const el = <T extends Element>(tag: string, attrs: Record<string, string | number> = {}): T => {
  const e = document.createElementNS(NS, tag) as unknown as T;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

export function mountHero(): void {
  const stage = document.getElementById("stage");
  const svg = document.getElementById("rig") as unknown as SVGSVGElement | null;
  const canvas = document.getElementById("hero3d") as HTMLCanvasElement | null;
  const poster = document.getElementById("poster") as HTMLImageElement | null;
  const hit = document.getElementById("hit");
  const hint = document.getElementById("hint");
  if (!stage || !svg || !canvas || !poster || !hit) return;

  const def = COMPANION_BY_ID[HERO.id];
  const spec = heroSpec(HERO.modelPx);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let W = innerWidth;
  let H = innerHeight;
  const anchorX = () => Math.round(W * (W < 640 ? 0.84 : 0.8));

  // --- SVG swing (cords + plank), posed every frame from the physics points ---
  const leftLayers: SVGPolylineElement[] = [];
  const rightLayers: SVGPolylineElement[] = [];
  for (const l of ROPE_LAYERS) {
    for (const bucket of [leftLayers, rightLayers]) {
      const p = el<SVGPolylineElement>("polyline", {
        fill: "none",
        stroke: l.stroke,
        "stroke-width": l.w,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        ...(l.dash ? { "stroke-dasharray": l.dash } : {}),
        ...(l.dashOffset ? { "stroke-dashoffset": l.dashOffset } : {}),
      });
      svg.appendChild(p);
      bucket.push(p);
    }
  }
  const defs = el<SVGDefsElement>("defs");
  const grad = el<SVGLinearGradientElement>("linearGradient", { id: "hero-wood", gradientUnits: "userSpaceOnUse", x1: 0, y1: -4, x2: 0, y2: 4 });
  grad.appendChild(el("stop", { offset: 0, "stop-color": "#c79a66" }));
  grad.appendChild(el("stop", { offset: 0.55, "stop-color": "#a87c50" }));
  grad.appendChild(el("stop", { offset: 1, "stop-color": "#835d3e" }));
  defs.appendChild(grad);
  svg.appendChild(defs);
  const seatG = el<SVGGElement>("g");
  const half = spec.seatLen / 2;
  seatG.appendChild(el("rect", { x: -(half + 6), y: -5, width: spec.seatLen + 12, height: 10, rx: 3.2, fill: "rgba(30, 19, 10, 0.85)" }));
  seatG.appendChild(el("rect", { x: -(half + 5), y: -4, width: spec.seatLen + 10, height: 8, rx: 2.6, fill: "url(#hero-wood)" }));
  seatG.appendChild(el("line", { x1: -(half + 3), y1: -2.9, x2: half + 3, y2: -2.9, stroke: "rgba(255, 235, 200, 0.4)", "stroke-width": 0.8, "stroke-linecap": "round" }));
  seatG.appendChild(el("line", { x1: -(half - 2), y1: -1.1, x2: half - 3, y2: -1.4, stroke: "rgba(74, 46, 24, 0.4)", "stroke-width": 0.8, "stroke-linecap": "round" }));
  for (const sgn of [-1, 1]) {
    seatG.appendChild(el("rect", { x: sgn * half - 1.6, y: -6, width: 3.2, height: 12, rx: 1.6, fill: "#96693f", stroke: "rgba(30, 19, 10, 0.6)", "stroke-width": 0.8 }));
  }
  svg.appendChild(seatG);

  // --- physics + behavior state (the app's modules) ---
  let swing: Swing = createSwing(anchorX(), 0, spec.seatLen, spec.cordSegLen);
  const behavior = createBehavior();
  const cursor: CursorState = { x: -10000, y: -10000, prevX: -10000, prevY: -10000, lastMoveAt: 0, speed: 0 };
  let prevSeat: SeatState | null = null;
  let scene: BirdScene | null = null;
  let acc = 0;
  let last = performance.now();
  let stepCount = 0;
  let lastRender = 0;
  let clicked = false;
  let running = false;
  let rafId = 0;

  const cordPoints = (c: { x: number; y: number }[]) => c.map((p) => `${p.x},${p.y}`).join(" ");

  function placeDom(seat: SeatState) {
    const left = cordPoints(swing.left);
    const right = cordPoints(swing.right);
    for (const p of leftLayers) p.setAttribute("points", left);
    for (const p of rightLayers) p.setAttribute("points", right);
    seatG.setAttribute("transform", `translate(${seat.midX} ${seat.midY}) rotate(${(seat.barAngle * 180) / Math.PI})`);
    const tx = seat.midX - spec.canvasW / 2;
    const ty = seat.midY - spec.canvasH * spec.anchorFracY;
    canvas!.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
    poster!.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
    const hw = spec.modelPx * 1.15;
    const hh = spec.modelPx * 1.25;
    hit!.style.width = `${hw}px`;
    hit!.style.height = `${hh}px`;
    hit!.style.transform = `translate3d(${seat.midX - hw / 2}px, ${seat.midY - spec.modelPx * 0.45 - hh / 2}px, 0)`;
    if (hint) {
      hint.style.left = `${seat.midX}px`;
      hint.style.top = `${seat.midY + 34}px`;
    }
  }

  function tick(now: number) {
    if (!running) return;
    const dtMs = Math.min(Math.max(now - last, 0), 50);
    last = now;

    acc += dtMs;
    let steps = 0;
    while (acc >= PHYSICS_STEP_MS && steps < MAX_STEPS) {
      stepCount++;
      const windX = reduce ? 0 : Math.sin(stepCount * 0.02) * 0.06;
      stepSwing(swing, anchorX(), 0, spec.seatLen, spec.cordSegLen, windX, null, { width: W, height: H, margin: 26 });
      acc -= PHYSICS_STEP_MS;
      steps++;
    }
    if (steps === MAX_STEPS) acc = 0;

    const seat = readSeat(swing, prevSeat);
    prevSeat = seat;

    const ctx: BehaviorCtx = {
      now,
      dt: dtMs / 1000,
      cursor,
      headX: seat.midX,
      headY: seat.midY - spec.modelPx * 0.72,
      birdCenterX: seat.midX,
      birdCenterY: seat.midY - spec.modelPx * 0.45,
      seat,
      dragging: false,
      clicked,
      stageW: W,
      stageH: H,
    };
    clicked = false;
    const r = stepBehavior(behavior, ctx);

    if (scene) {
      const active = r.oneShotActive || seat.energy > 0.35;
      const interval = active ? RENDER_ACTIVE_MS : RENDER_MS;
      if ((r.wantsRender || seat.energy > 0.02) && now - lastRender >= interval) {
        const lean = Math.min(Math.max(seat.velX * 0.02, -0.18), 0.18);
        const clampedYaw = Math.min(Math.max(r.pose.yaw, -def.yawClamp), def.yawClamp);
        const rigged = scene.hasRig();
        scene.setPose(
          {
            yaw: rigged ? clampedYaw * 0.1 : clampedYaw,
            pitch: (rigged ? 0.15 : 1) * r.pose.pitch * def.pitchMul,
            roll: r.pose.roll - seat.barAngle + lean,
            offsetY: r.pose.offsetY * def.bobMul,
            scaleX: r.pose.scaleX,
            scaleY: r.pose.scaleY,
          },
          rigged
            ? {
                headYaw: clampedYaw,
                headPitch: Math.min(Math.max(r.pose.pitch * 2, -0.5), 0.55),
                flapAngle: r.flapAmp > 0 ? r.flapAmp * 0.55 * Math.sin(2 * Math.PI * 13 * (now / 1000)) : 0,
                wagAngle: r.tailWag > 0 ? r.tailWag * 0.3 * Math.sin(2 * Math.PI * 3 * (now / 1000)) : 0,
                earWiggle:
                  r.flapAmp > 0 || r.tailWag > 0
                    ? (r.flapAmp * 0.3 + r.tailWag * 0.15) * Math.sin(2 * Math.PI * 7 * (now / 1000))
                    : 0,
              }
            : undefined,
        );
        scene.render((now - lastRender) / 1000);
        lastRender = now;
      }
    }

    placeDom(seat);
    rafId = requestAnimationFrame(tick);
  }

  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    acc = 0;
    rafId = requestAnimationFrame(tick);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
  }

  // Cursor feed: the page's mousemove stands in for the Rust cursor stream.
  let hintShown = true;
  const hideHint = () => {
    if (hintShown && hint) {
      hintShown = false;
      hint.classList.add("gone");
    }
  };
  addEventListener(
    "pointermove",
    (e) => {
      const now = performance.now();
      const dt = (now - cursor.lastMoveAt) / 1000;
      cursor.speed = cursor.lastMoveAt > 0 && dt > 0 ? Math.hypot(e.clientX - cursor.x, e.clientY - cursor.y) / dt : 0;
      cursor.prevX = cursor.x;
      cursor.prevY = cursor.y;
      cursor.x = e.clientX;
      cursor.y = e.clientY;
      cursor.lastMoveAt = now;
    },
    { passive: true },
  );
  hit.addEventListener("click", () => {
    clicked = true;
    playChirp();
    hideHint();
    const seat = prevSeat;
    if (seat) spawnNote(stage!, seat.midX + 8, seat.midY - spec.modelPx * 0.72 - 20);
  });
  setTimeout(hideHint, 6000);
  addEventListener("scroll", hideHint, { once: true, passive: true });
  addEventListener("resize", () => {
    W = innerWidth;
    H = innerHeight;
    swing = createSwing(anchorX(), 0, spec.seatLen, spec.cordSegLen);
    prevSeat = null;
  });
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));

  // First paint: cords + plank + poster immediately, at rest.
  placeDom(readSeat(swing, null));
  start();

  // Then the real renderer. If WebGL or the model fails, the poster stays.
  (async () => {
    try {
      const { createBirdScene } = await import("../src/companion/birdScene");
      const s = await createBirdScene(canvas!);
      const base = import.meta.env.BASE_URL;
      const modelPath = companionModelUrl(def, HERO.variant).replace(/^\//, "");
      await s.configure({
        url: `${base}${modelPath}`,
        boneHints: companionBoneHints(def, HERO.variant),
        clips: def.clips,
        attach: "seat",
        canvasW: spec.canvasW,
        canvasH: spec.canvasH,
        modelPx: spec.modelPx,
      });
      s.setSize({ canvasW: spec.canvasW, canvasH: spec.canvasH, modelPx: spec.modelPx }, Math.min(devicePixelRatio || 1, 2));
      scene = s;
      lastRender = 0;
      // One guaranteed frame before the poster fades so there is no blink.
      scene.setPose({ yaw: 0, pitch: 0, roll: 0, offsetY: 0, scaleX: 1, scaleY: 1 }, undefined);
      scene.render(0);
      canvas!.style.visibility = "visible";
      poster.classList.add("gone");
      stage.classList.add("live");
    } catch (err) {
      console.warn("Danglings hero: falling back to the still portrait", err);
    }
  })();
}

function spawnNote(stage: HTMLElement, x: number, y: number) {
  const n = document.createElement("span");
  n.className = "chirp-note";
  n.textContent = "♪";
  n.style.left = `${x}px`;
  n.style.top = `${y}px`;
  stage.appendChild(n);
  setTimeout(() => n.remove(), 900);
}

mountHero();
