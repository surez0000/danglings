import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CharmSize } from "../App";
import { playChirp, playPeck } from "../sound";
import {
  ACTIVE_AFTER_RELEASE_MS,
  COMPANION_BY_ID,
  ENERGY_SLEEP,
  FRAME_DT_CLAMP_MS,
  HIT_POINT_MIN_DELTA_PX,
  MAX_PHYSICS_STEPS,
  PHYSICS_STEP_MS,
  RENDER_INTERVAL_ACTIVE_MS,
  RENDER_INTERVAL_MS,
  SLEEP_FRAMES,
  WIND_WAKE_WINDOW_MS,
  companionModelUrl,
  companionSpec,
  type CompanionId,
  type CompanionSizeSpec,
} from "./types";
import { cursorState, startCursorFeed } from "./useCursorFeed";
import { createSwing, nudgeSeat, readSeat, stepSwing, type SeatState, type Swing } from "./useSwing";
import { createBehavior, stepBehavior, type Behavior, type BehaviorCtx } from "./birdBehavior";
import type { BirdScene } from "./birdScene";
import { BirdGlyph } from "./BirdGlyph";

const MARGIN = 26;

export type BirdCompanionProps = {
  stage: { width: number; height: number };
  anchorX: number;
  anchorY: number;
  companionId: CompanionId;
  variantId?: string;
  size: CharmSize;
  /* True while the picker menu is open: physics and behavior freeze so nobody
     has to click a card anchored to a moving target. */
  paused: boolean;
  windEnabled: boolean;
  windIntensity: number;
  onRequestMenu: (x: number, y: number) => void;
  setForceInteractive: (active: boolean) => void;
};

type SceneStatus = "loading" | "ready" | "failed";
type ChirpNote = { id: number; x: number; y: number };

function snapSwing(swing: Swing) {
  for (const cord of [swing.left, swing.right]) {
    for (const p of cord) {
      p.px = p.x;
      p.py = p.y;
    }
  }
}

function cordPoints(cord: { x: number; y: number }[]): string {
  return cord.map((p) => `${p.x},${p.y}`).join(" ");
}

/* Tilt of the model's support: the seat bar's angle in seat mode; in hang mode
   the lean of the (invisible) pendulum cord from vertical, expressed so that
   `rotate(tilt)` swings the model's dangling end toward the physics bob. The
   physics bob sits at the character's position (cord length = focusFrac ×
   modelPx), so the character visually rides the pendulum. */
function swingTilt(anchorX: number, anchorY: number, seat: SeatState, attach: "seat" | "hang"): number {
  if (attach === "seat") return seat.barAngle;
  const dx = seat.midX - anchorX;
  const dy = seat.midY - anchorY;
  return -Math.atan2(dx, Math.max(dy, 1));
}

/* The face's y offset from the tracked point: seat models stand above the seat;
   hang models' physics bob IS the character position (see swingTilt). */
function headOffsetY(spec: CompanionSizeSpec): number {
  return spec.attach === "seat" ? -spec.modelPx * 0.72 : 0;
}

export default function BirdCompanion(props: BirdCompanionProps) {
  const { stage, size, companionId, variantId } = props;
  const def = COMPANION_BY_ID[companionId];
  const spec = companionSpec(def, size);

  const [sceneStatus, setSceneStatus] = useState<SceneStatus>("loading");
  const [notes, setNotes] = useState<ChirpNote[]>([]);

  // Latest-props ref so the rAF loop and event closures never go stale.
  const propsRef = useRef(props);
  propsRef.current = props;

  const swingRef = useRef<Swing | null>(null);
  if (!swingRef.current) {
    swingRef.current = createSwing(props.anchorX, props.anchorY, spec.seatLen, spec.cordSegLen);
  }
  const behaviorRef = useRef<Behavior | null>(null);
  if (!behaviorRef.current) behaviorRef.current = createBehavior();

  const sceneRef = useRef<BirdScene | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glyphRef = useRef<HTMLDivElement | null>(null);
  const birdHitRef = useRef<HTMLDivElement | null>(null);
  const seatHitRef = useRef<HTMLDivElement | null>(null);
  const leftUnderRef = useRef<SVGPolylineElement | null>(null);
  const leftOverRef = useRef<SVGPolylineElement | null>(null);
  const rightUnderRef = useRef<SVGPolylineElement | null>(null);
  const rightOverRef = useRef<SVGPolylineElement | null>(null);
  const barUnderRef = useRef<SVGLineElement | null>(null);
  const barOverRef = useRef<SVGLineElement | null>(null);

  const rafRef = useRef(0);
  const loopModeRef = useRef<"running" | "stopped">("stopped");
  const lastTickRef = useRef(0);
  const accRef = useRef(0);
  const stepCountRef = useRef(0);
  const physicsAwakeRef = useRef(true);
  const sleepFramesRef = useRef(0);
  const lastRenderTsRef = useRef(0);
  const releaseUntilRef = useRef(0);
  const lastWakeAtRef = useRef(0);
  const prevSeatRef = useRef<SeatState | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const downRef = useRef<{ x: number; y: number } | null>(null);
  const clickedRef = useRef(false);
  const frameCountRef = useRef(0);
  const lastSentRef = useRef<[number, number][] | null>(null);
  const hiddenRef = useRef(false);
  const vignetteTimerRef = useRef<number | undefined>(undefined);
  const noteIdRef = useRef(0);

  /* Seat mode: the canvas glides with the seat, rotation happens in-scene.
     Hang mode: the canvas is PINNED at the anchor (the model's baked rope
     starts at the top edge) and the whole canvas rotates around the attach
     point via CSS — no in-scene tilt, no rotation clipping. */
  const canvasTransform = (seat: SeatState, s: CompanionSizeSpec, tilt: number) => {
    if (s.attach === "seat") {
      return `translate3d(${seat.midX - s.canvasW / 2}px, ${seat.midY - s.canvasH * s.anchorFracY}px, 0)`;
    }
    const { anchorX: ax, anchorY: ay } = propsRef.current;
    return `translate3d(${ax - s.canvasW / 2}px, ${ay - s.canvasH * s.anchorFracY}px, 0) rotate(${tilt}rad)`;
  };
  const glyphTransform = (seat: SeatState, s: CompanionSizeSpec, tilt: number) => {
    const gsize = Math.min(s.modelPx, 96);
    const top = s.attach === "seat" ? seat.midY - gsize : seat.midY - gsize / 2;
    return `translate3d(${seat.midX - gsize / 2}px, ${top}px, 0) rotate(${tilt}rad)`;
  };
  const birdHitTransform = (seat: SeatState, s: CompanionSizeSpec) => {
    if (s.attach === "seat") {
      return `translate3d(${seat.midX - (s.modelPx * 1.2) / 2}px, ${seat.midY - s.modelPx * 0.45 - (s.modelPx * 1.3) / 2}px, 0)`;
    }
    return `translate3d(${seat.midX - hitW(s) / 2}px, ${seat.midY - (s.modelPx * 0.5) / 2}px, 0)`;
  };
  const seatHitTransform = (seat: SeatState, s: CompanionSizeSpec) =>
    `translate3d(${seat.midX - (s.seatLen + 16) / 2}px, ${seat.midY - 7}px, 0) rotate(${seat.barAngle}rad)`;
  const hitW = (s: CompanionSizeSpec) => Math.max(s.canvasW * 0.8, 44);

  const updateDom = (seat: SeatState, s: CompanionSizeSpec, tilt: number) => {
    const swing = swingRef.current!;
    if (canvasRef.current) canvasRef.current.style.transform = canvasTransform(seat, s, tilt);
    if (glyphRef.current) glyphRef.current.style.transform = glyphTransform(seat, s, tilt);
    if (birdHitRef.current) birdHitRef.current.style.transform = birdHitTransform(seat, s);
    if (seatHitRef.current) seatHitRef.current.style.transform = seatHitTransform(seat, s);
    if (s.attach === "seat") {
      const left = cordPoints(swing.left);
      const right = cordPoints(swing.right);
      leftUnderRef.current?.setAttribute("points", left);
      leftOverRef.current?.setAttribute("points", left);
      rightUnderRef.current?.setAttribute("points", right);
      rightOverRef.current?.setAttribute("points", right);
      const l = swing.left[swing.left.length - 1];
      const r = swing.right[swing.right.length - 1];
      for (const bar of [barUnderRef.current, barOverRef.current]) {
        if (!bar) continue;
        bar.setAttribute("x1", String(l.x));
        bar.setAttribute("y1", String(l.y));
        bar.setAttribute("x2", String(r.x));
        bar.setAttribute("y2", String(r.y));
      }
    }
    // Hang mode draws no SVG at all — the model's baked rope is the rope.
  };

  const sendHitPoints = (swing: Swing, seat: SeatState, s: CompanionSizeSpec) => {
    frameCountRef.current++;
    if (frameCountRef.current % 2 !== 0) return;
    let pts: [number, number][];
    if (s.attach === "seat") {
      const l4 = swing.left[swing.left.length - 1];
      const r4 = swing.right[swing.right.length - 1];
      pts = [
        [swing.left[0].x, swing.left[0].y],
        [swing.right[0].x, swing.right[0].y],
        [swing.left[2].x, swing.left[2].y],
        [swing.right[2].x, swing.right[2].y],
        [l4.x, l4.y],
        [r4.x, r4.y],
        [seat.midX, seat.midY],
        [seat.midX, seat.midY - s.modelPx * 0.45],
        [seat.midX, seat.midY - s.modelPx * 0.72],
      ];
    } else {
      // Points spaced along the tilted model line, anchor through bob to tail.
      const { anchorX: ax, anchorY: ay } = propsRef.current;
      const len = Math.hypot(seat.midX - ax, seat.midY - ay) || 1;
      const ux = (seat.midX - ax) / len;
      const uy = (seat.midY - ay) / len;
      pts = [[ax, ay]];
      for (const f of [0.15, 0.35, 0.55, 0.75, 0.95]) {
        pts.push([ax + ux * s.modelPx * f, ay + uy * s.modelPx * f]);
      }
    }
    const last = lastSentRef.current;
    let moved = last === null || last.length !== pts.length;
    if (last && !moved) {
      for (let i = 0; i < pts.length; i++) {
        if (
          Math.abs(pts[i][0] - last[i][0]) > HIT_POINT_MIN_DELTA_PX ||
          Math.abs(pts[i][1] - last[i][1]) > HIT_POINT_MIN_DELTA_PX
        ) {
          moved = true;
          break;
        }
      }
    }
    if (!moved) return;
    lastSentRef.current = pts;
    invoke("update_hit_points", { points: pts }).catch(() => {});
  };

  const tick = (now: number) => {
    if (propsRef.current.paused) {
      lastTickRef.current = now;
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    const { stage: st, anchorX, anchorY, size: sz, companionId: cid, windEnabled, windIntensity } =
      propsRef.current;
    const d = COMPANION_BY_ID[cid];
    const s = companionSpec(d, sz);
    const swing = swingRef.current!;
    const behavior = behaviorRef.current!;
    const dtMs = Math.min(Math.max(now - lastTickRef.current, 0), FRAME_DT_CLAMP_MS);
    lastTickRef.current = now;

    // Fixed-timestep physics: verlet constants assume 60Hz steps.
    if (physicsAwakeRef.current) {
      accRef.current += dtMs;
      let steps = 0;
      while (accRef.current >= PHYSICS_STEP_MS && steps < MAX_PHYSICS_STEPS) {
        stepCountRef.current++;
        // Wind only within 8s of a wake, so the swing may fully settle and sleep.
        const windX =
          windEnabled && now - lastWakeAtRef.current < WIND_WAKE_WINDOW_MS
            ? Math.sin(stepCountRef.current * 0.02) * 0.06 * windIntensity
            : 0;
        stepSwing(swing, anchorX, anchorY, s.seatLen, s.cordSegLen, windX, dragRef.current, {
          width: st.width,
          height: st.height,
          margin: MARGIN,
        });
        accRef.current -= PHYSICS_STEP_MS;
        steps++;
      }
      if (steps === MAX_PHYSICS_STEPS) accRef.current = 0; // shed backlog after a stall
    }

    const seat = readSeat(swing, prevSeatRef.current);
    prevSeatRef.current = seat;

    if (physicsAwakeRef.current && !dragRef.current && seat.energy < ENERGY_SLEEP) {
      if (++sleepFramesRef.current >= SLEEP_FRAMES) {
        snapSwing(swing);
        physicsAwakeRef.current = false;
      }
    } else {
      sleepFramesRef.current = 0;
    }

    const headY = seat.midY + headOffsetY(s);
    const centerY = s.attach === "seat" ? seat.midY - s.modelPx * 0.45 : seat.midY + s.modelPx * 0.06;
    const ctx: BehaviorCtx = {
      now,
      dt: dtMs / 1000,
      cursor: cursorState,
      headX: seat.midX,
      headY,
      birdCenterX: seat.midX,
      birdCenterY: centerY,
      seat,
      dragging: dragRef.current !== null,
      clicked: clickedRef.current,
      stageW: st.width,
      stageH: st.height,
    };
    clickedRef.current = false;
    const result = stepBehavior(behavior, ctx);

    if (result.seatImpulseX !== 0) {
      physicsAwakeRef.current = true;
      sleepFramesRef.current = 0;
      nudgeSeat(swing, result.seatImpulseX);
    }
    // Chirp audio plays at gesture time (WebKit audio gate needs the real
    // click); flutter has no mapped sound yet.
    if (result.sfx === "peck") playPeck();

    const tilt = swingTilt(anchorX, anchorY, seat, s.attach);

    // Render tiers: 60fps while dragging / just released / one-shots / fast
    // sway (a 30fps tilt against the 60Hz-translated canvas reads as shimmer),
    // else 30fps.
    const active =
      dragRef.current !== null ||
      now < releaseUntilRef.current ||
      result.oneShotActive ||
      seat.energy > 0.35;
    const interval = active ? RENDER_INTERVAL_ACTIVE_MS : RENDER_INTERVAL_MS;
    const scene = sceneRef.current;
    if (
      scene &&
      (result.wantsRender || seat.energy > ENERGY_SLEEP || dragRef.current !== null) &&
      now - lastRenderTsRef.current >= interval
    ) {
      // Seat mode tilts in-scene (lights stay world-stable, model leans into
      // its momentum); hang mode tilts the whole CANVAS via CSS, so the scene
      // only carries the behavior's micro-roll. Per-companion motion
      // personality is applied here (clamped yaw, scaled pitch/bob).
      const lean = Math.min(Math.max(seat.velX * 0.02, -0.18), 0.18);
      const sceneRoll =
        s.attach === "seat" ? result.pose.roll - tilt + lean : result.pose.roll + lean * 0.4;
      const clampedYaw = Math.min(Math.max(result.pose.yaw, -d.yawClamp), d.yawClamp);
      const rigged = scene.hasRig();
      // Rigged models track with the HEAD bone (fuller range) while the body
      // only hints at the turn; unrigged models rotate whole-body as before.
      scene.setPose(
        {
          yaw: rigged ? clampedYaw * 0.25 : clampedYaw,
          pitch: (rigged ? 0.35 : 1) * result.pose.pitch * d.pitchMul,
          roll: sceneRoll,
          offsetY: result.pose.offsetY * d.bobMul,
          scaleX: result.pose.scaleX,
          scaleY: result.pose.scaleY,
        },
        rigged
          ? {
              headYaw: clampedYaw,
              headPitch: Math.min(Math.max(result.pose.pitch * 2, -0.5), 0.55),
              flapAngle:
                result.flapAmp > 0
                  ? result.flapAmp * 0.55 * Math.sin(2 * Math.PI * 13 * (now / 1000))
                  : 0,
              wagAngle:
                result.tailWag > 0
                  ? result.tailWag * 0.3 * Math.sin(2 * Math.PI * 3 * (now / 1000))
                  : 0,
            }
          : undefined,
      );
      scene.render();
      lastRenderTsRef.current = now;
    }

    updateDom(seat, s, tilt);
    sendHitPoints(swing, seat, s);

    // Loop gate: stop entirely when physics sleeps, the model dozes, and no
    // interaction is in flight. Every wake is event-driven from here on.
    if (
      !physicsAwakeRef.current &&
      behavior.state === "doze" &&
      !dragRef.current &&
      !result.wantsRender
    ) {
      loopModeRef.current = "stopped";
      armVignetteTimer();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  };

  // Start the rAF loop without touching physics/wind state — used by the doze
  // vignette timer so a sleeping swing stays asleep during a pose-only vignette.
  const startLoopOnly = () => {
    if (hiddenRef.current) return;
    if (loopModeRef.current === "stopped") {
      loopModeRef.current = "running";
      lastTickRef.current = performance.now();
      accRef.current = 0;
      rafRef.current = requestAnimationFrame(tick);
    }
  };

  // Idempotent full wake: opens the wind window, wakes physics, starts the loop.
  const ensureLoop = () => {
    if (hiddenRef.current) return;
    lastWakeAtRef.current = performance.now();
    physicsAwakeRef.current = true;
    sleepFramesRef.current = 0;
    if (vignetteTimerRef.current !== undefined) {
      clearTimeout(vignetteTimerRef.current);
      vignetteTimerRef.current = undefined;
    }
    startLoopOnly();
  };

  const armVignetteTimer = () => {
    const behavior = behaviorRef.current!;
    if (behavior.state !== "doze" || hiddenRef.current) return;
    if (vignetteTimerRef.current !== undefined) clearTimeout(vignetteTimerRef.current);
    const delay = Math.max(0, behavior.nextVignetteAt - performance.now()) + 20;
    vignetteTimerRef.current = window.setTimeout(() => {
      vignetteTimerRef.current = undefined;
      startLoopOnly();
    }, delay);
  };

  const hardStop = () => {
    if (loopModeRef.current === "running") cancelAnimationFrame(rafRef.current);
    loopModeRef.current = "stopped";
    if (swingRef.current) snapSwing(swingRef.current);
    physicsAwakeRef.current = false;
    if (vignetteTimerRef.current !== undefined) {
      clearTimeout(vignetteTimerRef.current);
      vignetteTimerRef.current = undefined;
    }
  };

  // Size or companion change: recreate the swing at the same anchor and resize
  // the canvas. (Anchor drags need no recreation — stepSwing re-pins each step.)
  useEffect(() => {
    const d = COMPANION_BY_ID[propsRef.current.companionId];
    const sp = companionSpec(d, propsRef.current.size);
    swingRef.current = createSwing(
      propsRef.current.anchorX,
      propsRef.current.anchorY,
      sp.seatLen,
      sp.cordSegLen,
    );
    prevSeatRef.current = null;
    lastSentRef.current = null;
    sceneRef.current?.setSize(
      { canvasW: sp.canvasW, canvasH: sp.canvasH, modelPx: sp.modelPx },
      window.devicePixelRatio || 1,
    );
    lastRenderTsRef.current = 0;
    ensureLoop();
  }, [size, companionId]);

  // Any anchor/stage/wind-setting change is a wake event; so is unpausing.
  useEffect(() => {
    if (!props.paused) ensureLoop();
  }, [props.anchorX, stage.width, stage.height, props.windEnabled, props.windIntensity, props.paused]);

  // The GL world (renderer + environment + lights) is created ONCE and only
  // the model is swapped on companion/variant changes — a full scene rebuild
  // stalls the main thread ~1s, and with the picker holding the whole overlay
  // window interactive, that stall swallowed every click on the screen. The
  // previous model stays visible until the new one is ready; configure() is
  // latest-wins, so rapid dot-clicking never queues rebuilds.
  const scenePromiseRef = useRef<Promise<BirdScene> | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!scenePromiseRef.current) {
          scenePromiseRef.current = import("./birdScene").then((m) =>
            m.createBirdScene(canvasRef.current!),
          );
        }
        const scene = await scenePromiseRef.current;
        if (cancelled) return;
        const d = COMPANION_BY_ID[propsRef.current.companionId];
        const sp = companionSpec(d, propsRef.current.size);
        await scene.configure({
          url: companionModelUrl(d, propsRef.current.variantId),
          attach: sp.attach,
          canvasW: sp.canvasW,
          canvasH: sp.canvasH,
          modelPx: sp.modelPx,
        });
        if (cancelled) return;
        sceneRef.current = scene;
        setSceneStatus("ready");
        lastRenderTsRef.current = 0;
        ensureLoop();
      } catch {
        if (!cancelled) setSceneStatus("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companionId, variantId]);

  // Unmount: tear the GL world down and clear the ref — StrictMode's dev
  // double-mount would otherwise reconfigure a disposed scene on remount.
  useEffect(() => {
    return () => {
      sceneRef.current = null;
      const p = scenePromiseRef.current;
      scenePromiseRef.current = null;
      p?.then((s) => s.dispose()).catch(() => {});
    };
  }, []);

  // Cursor feed: Rust pushes dead-banded 30Hz events; each one wakes the LOOP
  // (the gaze must track) but deliberately not the wind window and not the
  // physics — otherwise every mouse move gusts the swing, which reads as the
  // sway "following the pointer".
  const wakeForGaze = () => {
    if (hiddenRef.current) return;
    if (vignetteTimerRef.current !== undefined) {
      clearTimeout(vignetteTimerRef.current);
      vignetteTimerRef.current = undefined;
    }
    startLoopOnly();
  };

  useEffect(() => {
    let dispose: (() => void) | null = null;
    let dead = false;
    startCursorFeed(wakeForGaze).then((d) => {
      if (dead) d();
      else dispose = d;
    });
    return () => {
      dead = true;
      dispose?.();
    };
  }, []);

  // Wake/stop plumbing: recenter, tray hide/show, and (defensively) webview
  // visibility. Do not trust WKWebView visibilitychange for NSWindow orderOut —
  // the Rust side emits overlay-visibility on both toggle branches.
  useEffect(() => {
    const unlistenRecenter = listen("recenter", () => ensureLoop());
    const unlistenVisibility = listen<boolean>("overlay-visibility", (event) => {
      if (event.payload) {
        hiddenRef.current = false;
        ensureLoop();
      } else {
        hiddenRef.current = true;
        hardStop();
      }
    });
    const onVisibilityChange = () => {
      if (document.hidden) hardStop();
      else if (!hiddenRef.current) ensureLoop();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      unlistenRecenter.then((f) => f());
      unlistenVisibility.then((f) => f());
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  // Initial kick + unmount cleanup.
  useEffect(() => {
    ensureLoop();
    return () => {
      if (loopModeRef.current === "running") cancelAnimationFrame(rafRef.current);
      loopModeRef.current = "stopped";
      if (vignetteTimerRef.current !== undefined) clearTimeout(vignetteTimerRef.current);
      if (dragRef.current) propsRef.current.setForceInteractive(false);
    };
  }, []);

  const spawnChirpNote = () => {
    const seat = prevSeatRef.current;
    if (!seat) return;
    const d = COMPANION_BY_ID[propsRef.current.companionId];
    const sp = companionSpec(d, propsRef.current.size);
    const y = seat.midY + headOffsetY(sp) - 22;
    const id = ++noteIdRef.current;
    setNotes((n) => [...n, { id, x: seat.midX + 6, y }]);
    window.setTimeout(() => setNotes((n) => n.filter((note) => note.id !== id)), 900);
  };

  // No stopPropagation on pointerdown: the stage's own handler closes an open
  // menu, which is exactly what a click on the model should do.
  const onHitPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY };
    downRef.current = { x: e.clientX, y: e.clientY };
    propsRef.current.setForceInteractive(true);
    ensureLoop();
  };

  const onHitPointerMove = (e: React.PointerEvent) => {
    if (dragRef.current) dragRef.current = { x: e.clientX, y: e.clientY };
  };

  const endDrag = () => {
    dragRef.current = null;
    releaseUntilRef.current = performance.now() + ACTIVE_AFTER_RELEASE_MS;
    propsRef.current.setForceInteractive(false);
  };

  const onHitPointerUp = (isBird: boolean) => (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    endDrag();
    const down = downRef.current;
    downRef.current = null;
    if (isBird && down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) {
      // Chirp sound inside the real click gesture; the state machine picks up
      // the CHIRP animation on the next tick via clickedRef.
      clickedRef.current = true;
      playChirp();
      spawnChirpNote();
    }
    ensureLoop();
  };

  const onLostPointerCapture = () => {
    if (dragRef.current) endDrag();
    downRef.current = null;
  };

  const onHitContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const seat = prevSeatRef.current;
    const d = COMPANION_BY_ID[propsRef.current.companionId];
    const sp = companionSpec(d, propsRef.current.size);
    const x = seat ? seat.midX : propsRef.current.anchorX;
    const baseY = seat ? seat.midY : propsRef.current.anchorY;
    const y = sp.attach === "seat" ? baseY + sp.modelPx * 0.6 + 18 : baseY + sp.modelPx * 0.35 + 18;
    propsRef.current.onRequestMenu(x, y);
    ensureLoop();
  };

  // Render-time seat snapshot: fresh initial transforms on mount, and any React
  // re-render writes current values rather than stale ones (the rAF loop keeps
  // mutating them between renders).
  const seatNow = readSeat(swingRef.current, null);
  const tiltNow = swingTilt(props.anchorX, props.anchorY, seatNow, spec.attach);
  const showGlyph = sceneStatus !== "ready";
  const isSeat = spec.attach === "seat";
  const leftNow = cordPoints(swingRef.current.left);
  const rightNow = cordPoints(swingRef.current.right);
  const lNow = swingRef.current.left[swingRef.current.left.length - 1];
  const rNow = swingRef.current.right[swingRef.current.right.length - 1];
  const glyphSize = Math.min(spec.modelPx, 96);

  return (
    <>
      {/* Hang mode draws no SVG: the model's baked rope is the visible rope. */}
      {isSeat && (
        <svg className="thread" width={stage.width} height={stage.height}>
          <polyline ref={leftUnderRef} points={leftNow} fill="none" stroke="rgba(20,16,12,0.55)" strokeWidth={3.2} strokeLinecap="round" />
          <polyline ref={leftOverRef} points={leftNow} fill="none" stroke="rgba(255,250,240,0.85)" strokeWidth={1.1} strokeLinecap="round" />
          <polyline ref={rightUnderRef} points={rightNow} fill="none" stroke="rgba(20,16,12,0.55)" strokeWidth={3.2} strokeLinecap="round" />
          <polyline ref={rightOverRef} points={rightNow} fill="none" stroke="rgba(255,250,240,0.85)" strokeWidth={1.1} strokeLinecap="round" />
          <line ref={barUnderRef} x1={lNow.x} y1={lNow.y} x2={rNow.x} y2={rNow.y} stroke="rgba(20,16,12,0.55)" strokeWidth={6.8} strokeLinecap="round" />
          <line ref={barOverRef} x1={lNow.x} y1={lNow.y} x2={rNow.x} y2={rNow.y} stroke="#8a6b4a" strokeWidth={5} strokeLinecap="round" />
        </svg>
      )}

      {/* Positioning basics are inlined (not only in .bird-canvas/.bird-hit/
          .seat-hit CSS) because every per-frame transform assumes an origin of
          (0,0); the classes add cursor/touch-action/will-change polish. */}
      <canvas
        ref={canvasRef}
        className="bird-canvas"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: spec.canvasW,
          height: spec.canvasH,
          pointerEvents: "none",
          visibility: showGlyph ? "hidden" : "visible",
          // Hang mode rotates the canvas around the rope-top attach point.
          transformOrigin: `50% ${spec.anchorFracY * 100}%`,
          willChange: "transform",
          transform: canvasTransform(seatNow, spec, tiltNow),
        }}
      />

      {showGlyph && (
        <div
          ref={glyphRef}
          className="bird-glyph"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: glyphSize,
            height: glyphSize,
            pointerEvents: "none",
            transformOrigin: "50% 100%",
            willChange: "transform",
            transform: glyphTransform(seatNow, spec, tiltNow),
          }}
        >
          {companionId === "bluebird" ? (
            <BirdGlyph size={glyphSize} />
          ) : (
            <span style={{ fontSize: glyphSize * 0.8, lineHeight: 1 }}>{def.emoji}</span>
          )}
        </div>
      )}

      <div
        ref={birdHitRef}
        className="bird-hit"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: isSeat ? spec.modelPx * 1.2 : hitW(spec),
          height: isSeat ? spec.modelPx * 1.3 : spec.modelPx * 0.95,
          transform: birdHitTransform(seatNow, spec),
        }}
        onPointerDown={onHitPointerDown}
        onPointerMove={onHitPointerMove}
        onPointerUp={onHitPointerUp(true)}
        onLostPointerCapture={onLostPointerCapture}
        onContextMenu={onHitContextMenu}
        title={`${def.name} — click to say hi, right-click to change`}
      />
      {isSeat && (
        <div
          ref={seatHitRef}
          className="seat-hit"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: spec.seatLen + 16,
            height: 14,
            transform: seatHitTransform(seatNow, spec),
          }}
          onPointerDown={onHitPointerDown}
          onPointerMove={onHitPointerMove}
          onPointerUp={onHitPointerUp(false)}
          onLostPointerCapture={onLostPointerCapture}
          onContextMenu={onHitContextMenu}
          title="Drag the swing"
        />
      )}

      {notes.map((n) => (
        <span key={n.id} className="chirp-note" style={{ position: "absolute", left: n.x, top: n.y }}>
          ♪
        </span>
      ))}
    </>
  );
}
