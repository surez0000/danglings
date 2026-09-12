##### SPACESFIX #####
CONFIG: in /Users/suresh-7239/danglings/src-tauri/tauri.conf.json add "visibleOnAllWorkspaces": true to the main window object. This maps to NSWindowCollectionBehaviorCanJoinAllSpaces at window creation, before the first show — fixing the plain desktop-Spaces bug on its own (window follows every Mission Control desktop). Do NOT also call the runtime set_visible_on_all_workspaces on macOS afterwards, because tao's implementation rewrites the collectionBehavior bitmask and would clobber the extra flags below; the config key + our raw call are the single source of truth.

RUNTIME (macOS only, in lib.rs setup, after `window.show()`): add `fn apply_macos_overlay_behavior(window: &WebviewWindow)` — inside `window.run_on_main_thread(...)` (AppKit is main-thread-only), get the raw pointer via `window.ns_window()? as *mut objc2_app_kit::NSWindow`, then `unsafe { (&*ns).setCollectionBehavior(NSWindowCollectionBehavior::CanJoinAllSpaces | NSWindowCollectionBehavior::FullScreenAuxiliary | NSWindowCollectionBehavior::Stationary | NSWindowCollectionBehavior::IgnoresCycle) }`. Also re-invoke it inside `toggle_charm` after the `show()` branch (cheap idempotent belt-and-braces in case any tauri window op resets the mask). Cargo.toml (macos target section): `objc2 = "0.6"`, `objc2-app-kit = { version = "0.3", features = ["NSWindow", "NSResponder"] }` — pick the objc2 minor that matches tauri 2.11's own objc2 to avoid a duplicate objc2 in the tree (check `cargo tree -i objc2`).

FULLSCREEN-AUX VERDICT: INCLUDE IT. NSWindowCollectionBehaviorFullScreenAuxiliary is public AppKit API since 10.7 — it is NOT a private API, so it carries zero notarization risk and is irrelevant to the (already-accepted) macOSPrivateApi transparency flag; MAS is permanently skipped per CLAUDE.md anyway. Cost is ~15 lines + one small dep; benefit is the flagship demo case ("bird stays while I fullscreen a YouTube video") — without it the overlay vanishes on every fullscreen Space, which users will file as the same bug. CanJoinAllSpaces composes fine with FullScreenAuxiliary (it conflicts only with FullScreenPrimary). Stationary keeps the overlay from being swept around by Exposé; IgnoresCycle keeps it out of Cmd+backtick. Keep the window at its current floating level first; if QA finds it hidden behind a fullscreen app's content on some macOS version, the documented escalation is `setLevel(NSPopUpMenuWindowLevel)` via the same objc2 path (note in code comment, do not ship by default — higher levels sit above the fullscreen menu-bar reveal, which looks wrong).

WINDOWS CAVEAT: set_visible_on_all_workspaces / the config key is a NO-OP on Windows (tao does not implement virtual-desktop pinning; the public IVirtualDesktopManager COM interface can query/move but "pin to all desktops" requires the undocumented IVirtualDesktopPinnedApps). Accepted for v1 (Windows is secondary); the overlay simply stays on the desktop where it was shown, and Shift+Alt+K re-summons it. Document this in CLAUDE.md Gotchas. Multi-monitor note: with "Displays have separate Spaces" the window still only covers the primary monitor — unchanged, out of scope.

##### CURSORFEED #####
MECHANISM: Rust-push events, NOT frontend polling. Rationale: (a) the 16ms hit-test thread already computes `cursor_local()` every tick, so the marginal Rust cost is a distance check; (b) a JS `invoke` poll costs a full serialize/deserialize round trip per frame AND cannot run while the renderer sleeps — but a sleeping renderer is exactly when we need the cursor as a WAKE signal; a Rust emit (evaluateJavaScript on WKWebView) is the wake; (c) with dead-banding, an idle cursor produces ZERO IPC, which frontend polling can never achieve.

OPT-IN GATE: extend HitState in lib.rs with `cursor_stream: bool` (default false) and add command `set_cursor_stream(state, active: bool)` registered in the invoke_handler. The frontend enables it only when the bird companion is active, so charm-only users pay nothing. (Capabilities: `core:event:default` is already granted in src-tauri/capabilities/default.json — `listen` works with no config change.)

EMIT LOGIC (inside the existing start_hit_test_loop, after cursor_local() succeeds, only when cursor_stream is true and the window is visible): keep loop-local `last_sent: Option<(f64,f64)>`, `last_emit: Instant`, `pending: bool`. Emit when `dist(cur, last_sent) > CURSOR_DEADBAND_PX (2.0)` AND `last_emit.elapsed() >= 33ms` (30Hz cap) — then `let _ = window.emit("cursor-moved", (x, y));` and update last_sent/last_emit, else if movement exceeded 0.5px but was rate-limited set pending=true. TRAILING EDGE: if pending && last_emit.elapsed() >= 150ms, emit once more and clear pending — so the bird's gaze never freezes one frame short of the final cursor position.

PAYLOAD + COORDINATE SPACE: tuple `(f64, f64)` serialized as `[x, y]` — window-local LOGICAL coordinates, exactly what cursor_local() already returns and identical to the frontend's clientX/clientY / stage space (window covers the monitor at its scale factor). No conversion anywhere in JS. Coordinates may be negative or exceed stage bounds when the cursor is on another monitor — that is intentional; the frontend clamps for look-at so the bird gazes toward the correct screen edge.

FRONTEND SINK: /Users/suresh-7239/danglings/src/companion/useCursorFeed.ts — module-level mutable singleton, NO React state (zero re-renders): `export type CursorState = { x: number; y: number; prevX: number; prevY: number; lastMoveAt: number; speed: number }` (speed in px/s computed from the last two events); `export const cursorState: CursorState`; `export async function startCursorFeed(): Promise<() => void>` — invokes `set_cursor_stream({active:true})`, `listen<[number, number]>("cursor-moved", ...)` writes the singleton; the returned disposer unlistens and invokes set_cursor_stream(false). The bird's rAF loop reads `cursorState` by reference; `lastMoveAt` age drives WATCH/doze transitions; the listener also calls the loop's `wake()` (see battery section). Budget: worst case 30 msgs/s × ~40 bytes JSON — negligible; steady state 0.

##### SWINGPHYSICS #####
NEW self-contained file /Users/suresh-7239/danglings/src/companion/useSwing.ts. It imports ONLY `type RopePoint` from "../useRope" (already exported) and re-implements the ~35-line verlet integrate/constraint primitives locally — deliberate small duplication so the new-files agent has zero dependency on edits to useRope.ts and the charm physics path is untouched byte-for-byte.

LAYOUT: two cords + seat bar. `export type Swing = { left: RopePoint[]; right: RopePoint[] }` — each cord has CORD_SEGMENTS = 4 segments (5 points, index 0 pinned). Per size (see integration): seatLen = 44/56/68 px (S/M/L), cordSegLen = 18/22/26 px → cord length 72/88/104 px. Anchors: left[0] pinned at (anchorX − seatLen/2, ANCHOR_Y=8), right[0] at (anchorX + seatLen/2, ANCHOR_Y) — parallel cords. Seat bar = ONE stiff distance constraint left[4]↔right[4] at rest length seatLen.

API:
- `createSwing(anchorX: number, anchorY: number, seatLen: number, cordSegLen: number): Swing` — points laid out vertically like createRope.
- `stepSwing(s: Swing, anchorX: number, anchorY: number, seatLen: number, cordSegLen: number, windX: number, drag: { x: number; y: number } | null, bounds: { width: number; height: number; margin: number }): void`
- `export type SeatState = { midX: number; midY: number; barAngle: number; velX: number; velY: number; energy: number }`; `readSeat(s: Swing, prev: SeatState | null): SeatState`.

stepSwing ALGORITHM (per frame): (1) re-pin both anchors from anchorX/seatLen. (2) Verlet-integrate every free point: v = (p − prev) × damping; p += v + (windX, GRAVITY 0.35); damping = 0.985 for cord points (indices 1–3) and DAMPING_SEAT = 0.995 for the two seat points — the lighter seat damping is what makes a flick swing satisfyingly for several seconds like a real swing. (3) DRAG (seat-midpoint constraint, keeps bar free to tilt naturally): if drag != null, after each constraint iteration compute mid = ((L4+R4)/2) and translate BOTH seat points by (drag − mid); before step 2, when a drag is active, set each seat point's px/py to its current x/y first (same trick as stepRope's drag branch) so release velocity = last frame's real displacement → flick works identically to the charm. (4) Constraints × 6 iterations, order per iteration: left chain (4 distance constraints at cordSegLen, pinned-aware exactly like stepRope), right chain, then the seat bar constraint L4↔R4 at seatLen applied TWICE (stiffer bar than cords, prevents rubber-band seat). No diagonal braces in v1 — with 6 iterations and gravity the system settles cleanly; a momentary cord-cross on a violent flick self-resolves and reads as slapstick (documented tuning lever: add max-distance-only diagonals L4↔right[0]/R4↔left[0] at sqrt(cord²+seat²)×1.05 if QA dislikes it). (5) Bounds clamp identical to stepRope (margin 26, write-back to px/py on clamp).

SEAT → BIRD TRANSFORM MATH: mid = ((L4.x+R4.x)/2, (L4.y+R4.y)/2); barAngle_screen = atan2(R4.y − L4.y, R4.x − L4.x) (radians, 0 = level, positive = right end lower in screen coords). Canvas placement (CSS, no re-render): translate3d(mid.x − canvasPx/2, mid.y − canvasPx × SEAT_ANCHOR_FRAC, 0) with SEAT_ANCHOR_FRAC = 0.82 (derived from the ortho frustum: seat-contact world y=0 sits at 82% of canvas height — see rendering). Bird tilt INSIDE the scene (so lighting stays world-stable): three.js is y-up, screen is y-down, so `birdGroup.rotation.z = −barAngle_screen`; plus momentum lean `+ clamp(seat.velX × 0.02, −0.18, 0.18)` rad (velX = midX − prevMidX per frame) so the bird leans into the swing. ENERGY for sleep logic: energy = |velX| + |velY| + |barAngle − prevBarAngle| × 60 (px-per-frame-equivalent scalar).

FLUTTER IMPULSE COUPLING: when the behavior machine enters FLUTTER, apply `L4.px −= k; R4.px −= k` with k = 1.5 × sign(birdX − cursorX) (bird 'pushes off' away from the cursor) — one-line hook exposed as `nudgeSeat(s: Swing, impulseX: number): void`.

##### RENDERING #####
FILE: /Users/suresh-7239/danglings/src/companion/birdScene.ts. LAZY LOADING IS MANDATORY: BirdCompanion.tsx loads it via `await import("./birdScene")` and birdScene itself statically imports three + GLTFLoader + MeshoptDecoder — Vite code-splits automatically, so charm-only users never parse ~150KB-gzip of three.js in WKWebView (startup time + memory win).

CANVAS SIZING — THE CORE PERF DECISION: never a monitor-sized canvas. A 5K monitor canvas at DPR 2 is ~14.7 Mpx × 4 B × 2–3 swap buffers ≈ 120–180 MB of surfaces recomposited every frame. Instead: a SQUARE canvas of canvasPx = 96/128/160 LOGICAL px (S/M/L), buffer = canvasPx × min(devicePixelRatio, 2) (DPR cap constant DPR_CAP = 2; at L on retina that is 320×320 = 0.1 Mpx). The canvas is position:absolute at 0,0 with `will-change: transform` and is MOVED each frame via style.transform = translate3d(...) following the seat (compositor-only, no layout, promoted to its own CALayer by WebKit). The canvas never rotates in CSS — all bird rotation happens in-scene so lights don't swing with the bird. `pointer-events: none` on the canvas; clicks land on a separate transparent hit-proxy div (see integration).

RENDERER: `new WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: "low-power", preserveDrawingBuffer: false })`; renderer.setPixelRatio(min(dpr,2)); renderer.setSize(canvasPx, canvasPx, false); renderer.setClearColor(0x000000, 0); outputColorSpace = SRGBColorSpace (three default); toneMapping = NoToneMapping (keeps the flat-cute baseColor punchy at 100px). low-power keeps older dual-GPU MacBooks on the iGPU; harmless on Apple Silicon.

WKWEBVIEW QUIRKS handled explicitly: (1) context loss on GPU switch / memory pressure — canvas.addEventListener("webglcontextlost", e => e.preventDefault()) and on "webglcontextrestored" dispose + rebuild renderer and re-apply materials (GLTF scene graph survives; only GL resources rebuild); expose this inside birdScene, invisible to callers. (2) No OffscreenCanvas/worker rendering — main-thread render at ≤30fps is fine at this canvas size. (3) WebP textures in GLB use EXT_texture_webp — GLTFLoader supports it and WKWebView (macOS 11+) decodes WebP natively. (4) MeshoptDecoder: `loader.setMeshoptDecoder(MeshoptDecoder)` from "three/examples/jsm/libs/meshopt_decoder.module.js" (typed by @types/three); its ~25KB WASM instantiates in ms; decode of the optimized mesh is a one-time ms-scale cost at selection time, not startup.

SCENE: OrthographicCamera(left −0.85, right 0.85, top 0.85, bottom −0.85, near 0.1, far 30) at position (0, 0.55, 10) looking at (0, 0.55, 0) — frustum covers world-y [−0.3, 1.4], height 1.7. On GLTF load, NORMALIZE the model: compute Box3, uniform-scale so bbox height = 1.0, recenter so feet (min y) sit at y = 0 and x/z centered — then seat contact = world origin, and world y=0 maps to (1.4/1.7) = 82% down the canvas → SEAT_ANCHOR_FRAC 0.82 used by the CSS placement. Bird occupies ~59% of canvas height, leaving headroom for hop + tilt. LIGHTS (no shadows — bird hangs mid-air, shadow maps add a pointless depth pass): HemisphereLight(0xbfd8ff, 0x8a7a66, 1.0) + DirectionalLight(0xfff4e0, 1.2) at (1.5, 2.5, 2). Materials: as-loaded MeshStandardMaterial (baseColor + normal + metallicRoughness); optional micro-opt: skip assigning the normal map below medium size (invisible at 56px) — leave as a code comment, ship with it on.

API SURFACE: `export type BirdPose = { yaw: number; pitch: number; roll: number; offsetY: number; scaleX: number; scaleY: number }`; `export type BirdScene = { setPose(p: BirdPose): void; render(): void; setSize(canvasPx: number, dpr: number): void; dispose(): void }`; `export async function createBirdScene(canvas: HTMLCanvasElement, canvasPx: number): Promise<BirdScene>` (awaits MeshoptDecoder.ready + GLTF load of "/companions/bluebird.glb"). setPose composes onto a single Group: group.rotation.set(pitch, yaw, roll), group.position.y = offsetY, group.scale.set(scaleX, 1, scaleX) with y = scaleY. render() is only called by the battery-gated loop.

GPU BUDGET of the decimated asset: at the target ~40–60k triangles with meshopt quantization, vertex buffers ≈ 2–4 MB; textures 3 × 1024² RGBA8 + mips ≈ 16 MB; total well under 25 MB GPU — irrelevant next to the saved monitor-sized surface. Draw call count: 1 mesh, 1 material, 1 draw call.

##### BEHAVIORS #####
FILE: /Users/suresh-7239/danglings/src/companion/birdBehavior.ts — a pure, framework-free module stepped by the master loop. API: `export type BehaviorCtx = { now: number; dt: number; cursor: CursorState; headX: number; headY: number; birdCenterX: number; birdCenterY: number; seat: SeatState; dragging: boolean; clicked: boolean; stageW: number; stageH: number }`; `export type Behavior = { state: 'idle'|'watch'|'flutter'|'peck'|'chirp'|'dragged'|'doze'; ... internal timers }`; `export function createBehavior(): Behavior`; `export function stepBehavior(b: Behavior, ctx: BehaviorCtx): { pose: BirdPose; wantsRender: boolean; sfx: 'chirp'|'peck'|'flutter'|null; seatImpulseX: number }`.

LOOK-AT MATH (WATCH): head screen position headY = seatMidY − birdPx × 0.72, headX = seatMidX. dx = cursor.x − headX, dy = cursor.y − headY. Virtual cursor-plane depth D = 600 logical px. yawTarget = clamp(atan2(dx, D), −0.6, 0.6) rad (~±34°; three.js +yaw turns the +z-facing bird toward screen-right, matching +dx directly). pitchRaw = clamp(atan2(dy, D), −0.35, +0.5) (screen y-down: cursor below → +pitch = look down in three.js; birds look down further than up). Whole-body compensation for no rig: rotation.y = yaw (full), rotation.x = pitchRaw × 0.4 (full-body pitch reads as falling, so scale it), rotation.z gets a counter-lean −yaw × 0.15 for cuteness, ADDED to the swing tilt (−barAngle + momentum lean) computed by BirdCompanion. SMOOTHING (framerate-independent): r += (target − r) × (1 − exp(−dt/τ)) with τ_watch = 0.12 s; relaxing back to idle uses τ_relax = 0.5 s.

STATES & TRANSITIONS:
- IDLE: bob offsetY = 0.015 × sin(2π × t / 3.2s), breath scaleY = 1 + 0.01 × sin(2π × t / 2.4s); gaze drifts to a random target (yaw ∈ [−0.3, 0.3], pitch ∈ [−0.1, 0.2]) re-rolled every 4–9 s. → WATCH when (now − cursor.lastMoveAt) < 2000 ms. → PECK on a random 8–20 s timer. → DOZE after 10 s of no cursor movement AND seat.energy < 0.02.
- WATCH: look-at math above. → IDLE after 2000 ms without a cursor-moved event. → FLUTTER when dist(cursor, birdCenter) < FLUTTER_R = 130 px AND (approachSpeed > 250 px/s OR dist < 60 px), where approachSpeed = cursor.speed × max(0, dot(v̂cursor, normalize(birdCenter − cursor))); FLUTTER_COOLDOWN = 3000 ms.
- FLUTTER (700 ms, non-interruptible): wing-buzz fake via scaleX = 1 + 0.04 × sin(2π × 14 Hz × t) and offsetY jitter 0.03 × sin(2π × 14 Hz × t), both × (1 − u) decay (u = elapsed/700ms), plus one hop offsetY += 0.08 × sin(π × min(u × 2.8, 1)); emits sfx 'flutter' once on entry and seatImpulseX = 1.5 × sign(birdX − cursor.x). → WATCH.
- PECK (from IDLE only): 1–3 reps of [pitch down to +0.5 rad over 180 ms ease-in, hold 80 ms, return 220 ms ease-out]; sfx 'peck' per rep ONLY if the shared AudioContext state === 'running' (WebKit gesture gate — no gesture yet means silent peck, never resume() here). → IDLE.
- CHIRP (on click, 490 ms): crouch scaleY → 0.92 over 90 ms, spring to scaleY 1.06 + offsetY 0.06 over 160 ms, settle 240 ms; sfx 'chirp' on entry; BirdCompanion also spawns a DOM ".chirp-note" particle (♪) above the head, CSS-animated like the existing sparkle burst. → WATCH. (Click detection lives in BirdCompanion: pointerup with total movement < 4 px, same threshold as the charm.)
- DRAGGED: while seat drag active — yaw/pitch relax to 0 with τ = 0.2 s, scaleY squish 0.97; physics does the visual work. → WATCH on release.
- DOZE: renderer asleep (wantsRender = false, pose frozen); every 12–20 s (random) wake for one 2 s vignette (a PECK or a slow gaze sweep), render it, re-doze. Any cursor-moved event or pointer event exits instantly to WATCH.

wantsRender = true iff state ∉ {doze} OR a vignette is playing OR |pose − lastRenderedPose| exceeds epsilons (0.001 rad rotations, 0.0005 offsetY, 0.001 scales) — the epsilon check is what lets IDLE's slow bob coalesce to ~30fps and lets DOZE hit exactly 0fps.

##### BATTERYSTRATEGY #####
PRINCIPLE: steady-state cost of the bird = zero GPU frames, zero rAF ticks, zero IPC. Only the pre-existing 16 ms Rust cursor poll remains (it already runs for the charm; a CGEvent query is microseconds).

THREE INDEPENDENT GATES, most-nested first:
1. RENDER GATE (per master-loop tick, bird mode): call birdScene.render() only when (behavior.wantsRender OR seat.energy > 0.02 OR dragging) AND (now − lastRenderTs ≥ 33 ms) → hard 30fps cap (FLUTTER's 14 Hz jitter samples fine at 30fps; no 60fps burst mode — simplicity wins). Canvas repositioning via CSS transform does NOT require a render (scene is seat-relative), so a gliding-but-settled swing costs compositor-only work.
2. PHYSICS GATE: run stepSwing every tick while awake; when seat.energy < ENERGY_SLEEP = 0.02 for SLEEP_FRAMES = 90 consecutive frames, snap all points (px = x, py = y) and stop calling stepSwing. Wind deliberately does NOT keep the swing awake (unlike the charm's rope): wind applies only within 8 s after any wake event — a bird-laden swing damping to rest is physically plausible and buys perpetual sleep with windEnabled on. (Charm mode behavior is untouched — its rope keeps the existing always-on wind.)
3. LOOP GATE: the master rAF loop itself STOPS (cancelAnimationFrame, loopMode = 'stopped') when physics is asleep AND behavior.state === 'doze' AND no menu open AND no drag. Wake is purely event-driven — every wake source calls an idempotent ensureLoop(): (a) the "cursor-moved" listener in useCursorFeed (this is why cursor transport must be Rust-push: the emit's evaluateJavaScript is itself the webview wake), (b) pointerdown/contextmenu on the hit-proxy, (c) the DOZE vignette setTimeout, (d) settings/size changes, (e) the existing "recenter" event. ensureLoop is guarded by a loopMode check so concurrent wakes are safe.

HIT-POINT IPC GATE: in bird mode, invoke update_hit_points only when any point moved > 1 px since the last send (checked every other frame, mirroring the charm's cadence); when the swing is asleep the points are static → zero invokes, and the Rust thread keeps hit-testing the last-sent static points correctly forever.

INTERPLAY WITH EXISTING rAF: App.tsx's current charm loop remains ALWAYS-ON in charm mode exactly as today (keep-100%-intact constraint). In bird mode that charm effect early-returns (one-line gate) and BirdCompanion owns the only loop. Window hidden (tray toggle / Shift+Alt+K): WebKit throttles rAF of occluded webviews toward 0 on its own, the Rust hit loop already `continue`s when hidden, and cursor emits are skipped when hidden — so hide ≈ free with no extra code; additionally listen to document.visibilitychange to hard-stop the loop and mark physics asleep (defensive, 3 lines). WebGL context is KEPT during doze (a 320×320 idle Metal surface costs nothing; forcing context loss would add restore jank). AudioContext: never resume() outside a user gesture; peck sound silently skipped until first click.

EXPECTED PROFILE (M-series): DOZE = 0% GPU / 0 webview CPU wakeups beyond WebKit housekeeping; WATCH = 30fps on a 0.1 Mpx buffer, low single-digit % GPU; FLUTTER/CHIRP = sub-second bursts.

##### INTEGRATION #####
PERSISTENCE — NEW KEY `danglings.companion` (JSON: `{ kind: 'charm' } | { kind: 'bird'; id: 'bluebird' }`, default `{kind:'charm'}` on missing/corrupt). Justification for a new key over overloading `danglings.charm`: (1) `danglings.charm` stores a full Charm object and loadCharm() JSON-parses it directly — a bird variant would break that contract and crash older builds on downgrade (unknown keys are simply ignored instead); (2) the last-chosen charm is preserved for free, so bird→charm switch restores exactly what the user had; (3) `{kind, id}` scales to the paid companion packs in the product plan. Helpers in /Users/suresh-7239/danglings/src/companion/companionStore.ts: `loadCompanion(): CompanionSelection`, `saveCompanion(c: CompanionSelection): void`.

SINGLE-SLOT SWAP in App.tsx: new state `companion` (from loadCompanion, persisted via effect). When companion.kind === 'bird': (a) the existing charm rAF effect early-returns (gate added to its existing `if (!stage) return;`), (b) the thread SVG + charm div + ritual overlays are not rendered; instead `<BirdCompanion stage={stage} anchorX={anchorX} anchorY={ANCHOR_Y} size={settings.size} windEnabled={settings.windEnabled} windIntensity={settings.windIntensity} onRequestMenu={(x, y) => { setMenuPos({x, y}); setMenuOpen(true); setForceInteractive(true); }} setForceInteractive={setForceInteractive} />`. The anchor-handle div stays in App.tsx for BOTH modes (drag moves anchorX; swing anchors derive from it; anchorRatio persistence unchanged). New state `menuPos: {x: number; y: number} | null`; the menu's left/top uses menuPos in bird mode and the existing charmPos math in charm mode.

PICKER: a "companions" section is added ABOVE the existing "choose a charm" label — two cards styled like roster-cards: "Classic charm" (active when kind==='charm'; clicking it just sets companion to charm, restoring the saved charm) and "Blue bird" (active when kind==='bird'). Additionally chooseCharm() and applyCustomEmoji() gain one line: saveCompanion + setCompanion({kind:'charm'}) — picking any charm naturally exits bird mode. Everything else in the menu (roster, custom emoji, size, sway settings) is shared and untouched.

RITUALS: clicking the bird triggers behavior CHIRP + playChirp() — it never sets activeRitual and never renders charm ritual overlays. Right-click on the bird's hit-proxy → preventDefault → onRequestMenu(seatMidX, seatMidY + birdPx + 18).

HIT POINTS (bird mode, sent by BirdCompanion, 9 points): left anchor, right anchor, left-cord midpoint (left[2]), right-cord midpoint (right[2]), L4, R4, seat mid, bird center (seatMid − birdPx×0.45 in y), bird head (seatMid − birdPx×0.72 in y). Max gap along a 104 px cord is 52 px < 2 × 42 px enter radius → continuous coverage of cords + seat + bird; the Rust side is shape-agnostic (any Vec<(f64,f64)>), zero Rust changes needed for this.

SIZE MAPPING — reuse existing S/M/L, no new setting: `export const BIRD_SIZE: Record<CharmSize, { birdPx: number; canvasPx: number; seatLen: number; cordSegLen: number }> = { small: {56, 96, 44, 18}, medium: {76, 128, 56, 22}, large: {96, 160, 68, 26} }` in src/companion/types.ts. The bird is deliberately larger than the equivalent charm (a 24 px bird is illegible); "never in the way" is preserved because doze + click-through still apply. Size change → recreate swing at same anchorX, birdScene.setSize, one render.

INTERACTION SURFACES: transparent div `.bird-hit` (position absolute, width birdPx×1.2, height birdPx×1.3, centered on bird, cursor: pointer, touch-action: none) carries onPointerDown/Move/Up/ContextMenu — pointer capture + setForceInteractive(true) on down, drag routes to stepSwing's drag param, click (<4 px movement) fires CHIRP; a second transparent div `.seat-hit` (seatLen+16 × 14 px, rotated to barAngle via transform) allows grabbing the seat itself. SVG cords + seat bar are drawn in the existing DOM style (double-stroke polylines: rgba(20,16,12,0.55) 3.2w under rgba(255,250,240,0.85) 1.1w; seat bar: single 5 px round-cap line, stroke #8a6b4a with the same dark underlay) inside BirdCompanion's own <svg class="thread"> — crisp, theme-consistent, and visible even when WebGL sleeps.

##### FILECHANGES #####
[edit] /Users/suresh-7239/danglings/src-tauri/tauri.conf.json :: Add "visibleOnAllWorkspaces": true to the main window object in app.windows[0]. One-line change. (Rust agent)
[edit] /Users/suresh-7239/danglings/src-tauri/Cargo.toml :: Under [target.'cfg(target_os = "macos")'.dependencies] add: objc2 = "0.6" and objc2-app-kit = { version = "0.3", features = ["NSWindow", "NSResponder"] }. Match objc2 minor to tauri's own (cargo tree -i objc2) to avoid duplicate crate versions. (Rust agent)
[edit] /Users/suresh-7239/danglings/src-tauri/src/lib.rs :: Three additions, no existing behavior changed: (1) HitState gains cursor_stream: bool (init false) + new #[tauri::command] fn set_cursor_stream(state, active: bool), registered in generate_handler!. (2) In start_hit_test_loop after cursor_local() succeeds: dead-banded (2.0 px), 30Hz-capped (33 ms) window.emit("cursor-moved", (x, y)) with 150 ms trailing settle emit; only when cursor_stream && visi
[new] /Users/suresh-7239/danglings/public/companions/bluebird.glb :: Offline-optimized runtime asset from 3ds/Blue_bird.glb via gltf-transform: meshopt compression (EXT_meshopt_compression), quantized attributes, simplify to <=60k triangles (ratio ~0.02, error tolerance tuned by visual QA at 96-160 px), textures resized to 1024 and converted to WebP (EXT_texture_webp), target file <=5 MB. (Asset agent)
[new] /Users/suresh-7239/danglings/scripts/optimize-bird.mjs :: Repeatable gltf-transform Node script encoding the exact pipeline above (input 3ds/Blue_bird.glb -> output public/companions/bluebird.glb) so the asset can be regenerated when tuning simplification error. Uses @gltf-transform/core/functions/cli as devDependency or npx. (Asset agent)
[new] /Users/suresh-7239/danglings/src/companion/types.ts :: Exports: type CompanionSelection = { kind: 'charm' } | { kind: 'bird'; id: 'bluebird' }; const COMPANION_STORAGE_KEY = 'danglings.companion'; const CURSOR_EVENT = 'cursor-moved'; const BIRD_SIZE: Record<CharmSize, { birdPx; canvasPx; seatLen; cordSegLen }> = { small: {56,96,44,18}, medium: {76,128,56,22}, large: {96,160,68,26} }; const DPR_CAP = 2, RENDER_INTERVAL_MS = 33, ENERGY_SLEEP = 0.02, SLE
[new] /Users/suresh-7239/danglings/src/companion/companionStore.ts :: loadCompanion(): CompanionSelection (try/catch JSON.parse of localStorage[COMPANION_STORAGE_KEY], validate kind field, default {kind:'charm'}); saveCompanion(c): void. (New-frontend agent)
[new] /Users/suresh-7239/danglings/src/companion/useCursorFeed.ts :: Module singleton export const cursorState: CursorState = { x, y, prevX, prevY, lastMoveAt, speed }; export async function startCursorFeed(onWake: () => void): Promise<() => void> — invoke('set_cursor_stream', {active:true}), listen<[number,number]>('cursor-moved') updating the singleton (speed = dist/dt from previous event, px/s) and calling onWake(); disposer unlistens + set_cursor_stream(false).
[new] /Users/suresh-7239/danglings/src/companion/useSwing.ts :: Self-contained verlet swing (imports only `type RopePoint` from '../useRope'). Exports: type Swing = { left: RopePoint[]; right: RopePoint[] }; type SeatState = { midX; midY; barAngle; velX; velY; energy }; createSwing(anchorX, anchorY, seatLen, cordSegLen): Swing (4 segments/cord, index 0 pinned at anchorX -/+ seatLen/2); stepSwing(s, anchorX, anchorY, seatLen, cordSegLen, windX, drag: {x,y}|null
[new] /Users/suresh-7239/danglings/src/companion/birdBehavior.ts :: Pure state machine. Exports: type BirdPose = { yaw; pitch; roll; offsetY; scaleX; scaleY }; type BehaviorCtx (now, dt, cursor, headX/Y, birdCenterX/Y, seat, dragging, clicked, stageW/H); createBehavior(): Behavior; stepBehavior(b, ctx): { pose: BirdPose; wantsRender: boolean; sfx: 'chirp'|'peck'|'flutter'|null; seatImpulseX: number }. States idle/watch/flutter/peck/chirp/dragged/doze with the exac
[new] /Users/suresh-7239/danglings/src/companion/birdScene.ts :: Statically imports three, GLTFLoader (three/examples/jsm/loaders/GLTFLoader.js), MeshoptDecoder (three/examples/jsm/libs/meshopt_decoder.module.js) — this file is ONLY ever loaded via dynamic import. Exports: type BirdScene = { setPose(p: BirdPose): void; render(): void; setSize(canvasPx: number, dpr: number): void; dispose(): void }; async function createBirdScene(canvas: HTMLCanvasElement, canva
[new] /Users/suresh-7239/danglings/src/companion/BirdCompanion.tsx :: React 19 function component, the bird-mode owner. Props: { stage: {width;height}; anchorX: number; anchorY: number; size: CharmSize; windEnabled: boolean; windIntensity: number; onRequestMenu: (x: number, y: number) => void; setForceInteractive: (active: boolean) => void }. Owns: swing state (createSwing), dynamic import + createBirdScene into a <canvas class='bird-canvas'>, startCursorFeed(wake),
[edit] /Users/suresh-7239/danglings/src/App.tsx :: Minimal, well-bounded edits: (1) import BirdCompanion, companionStore, CompanionSelection; (2) new state companion = loadCompanion(), menuPos: {x;y}|null = null; persist companion via effect (saveCompanion); (3) gate the existing charm rAF effect: `if (!stage || companion.kind !== 'charm') return;` (one line) and add companion.kind to its dep array; (4) conditional render: charm-mode JSX (thread s
[edit] /Users/suresh-7239/danglings/src/App.css :: Append-only: .bird-canvas { position: absolute; left: 0; top: 0; pointer-events: none; will-change: transform; } .bird-hit, .seat-hit { position: absolute; cursor: pointer; touch-action: none; } .chirp-note { ... 900ms float-up-and-fade keyframes like .spark ...} .companion-row / .companion-card styles echoing .roster-card; keep everything existing byte-identical. (Integration agent)
[edit] /Users/suresh-7239/danglings/src/sound.ts :: Append-only: export function playChirp(): void — two 80 ms triangle-wave blips glissing 2.8 kHz -> 3.4 kHz with a 5 ms noise transient, routed through the module's existing ctx + convolution reverb send at low wet; export function playPeck(): void — single 30 ms filtered noise tick at low gain; BOTH return early (silent) unless the AudioContext state === 'running' (never call resume() here — WebKi
[edit] /Users/suresh-7239/danglings/CLAUDE.md :: Document: companion architecture (src/companion/*), 'danglings.companion' storage key and its shape, cursor-moved event contract (window-local logical px, 30Hz/2px dead-band, set_cursor_stream opt-in), Spaces fix + Windows no-op caveat + FullScreenAuxiliary rationale, asset pipeline command (scripts/optimize-bird.mjs), battery gates summary. (Integration agent)

##### AMENDMENTS (binding — override anything above that conflicts; from the judge panel) #####

A1. SIZE MAPPING (overrides integration section): BIRD_SIZE = {
  small:  { birdPx: 64,  canvasPx: 112, seatLen: 48, cordSegLen: 20 },
  medium: { birdPx: 96,  canvasPx: 160, seatLen: 60, cordSegLen: 24 },
  large:  { birdPx: 128, canvasPx: 216, seatLen: 72, cordSegLen: 28 },
} (canvasPx ~= birdPx / 0.59, SEAT_ANCHOR_FRAC stays 0.82).

A2. RENDER TIERS (overrides flat 30fps): ACTIVE 60fps (16ms interval) while seat drag is active,
for 600ms after drag release, and while a one-shot (flutter/peck/chirp) is playing; otherwise
30fps (33ms); DOZE 0fps. Keep the pose-epsilon skip in all tiers.

A3. FIXED-TIMESTEP PHYSICS: master loop uses an accumulator — acc += min(dt, 50ms);
while (acc >= 16.667 && steps < 3) { stepSwing(...); acc -= 16.667; steps++ }.
Verlet constants are tuned for 60Hz steps; never step with variable dt.

A4. SACCADE DARTS: if the cursor jumps >250px within ~120ms, use tau = 0.04s for the look-at
smoothing for the next 150ms (instead of tau_watch 0.12s), then revert.

A5. SETTLE-TO-SLEEP: on entering doze, play a 300ms ease of yaw/pitch/roll toward the idle pose
(slight droop: pitch +0.06), render one final frame, THEN stop the loop. Never freeze mid-pose.

A6. DOZE VIGNETTES every 20-45s (not 12-20s), ~2s each.

A7. BirdGlyph SVG: new file src/companion/BirdGlyph.tsx — a hand-authored, cute flat-style blue
bird SVG (charmArt.tsx visual language, ~40 lines: body circle, belly, wing, eye, beak, tail;
blues #4a90d9/#6db3f2, belly #fff3d6, beak #f5a623). Used as (a) the picker-card thumbnail,
(b) the loading placeholder at the seat while the GLB loads, (c) the PERMANENT fallback if
WebGL context creation or GLB load fails (positioned/rotated at the seat via the same transform
as the canvas — the swing still works). BirdGlyph must NOT import three (bundle boundary).

A8. BUNDLE BOUNDARY (hard rule): App.tsx may statically import ONLY src/companion/types.ts,
companionStore.ts, and BirdGlyph.tsx. BirdCompanion.tsx is loaded via React.lazy(() =>
import("./companion/BirdCompanion")) wrapped in <Suspense fallback={null}>. birdScene.ts (which
statically imports three/GLTFLoader/MeshoptDecoder) is dynamically imported by BirdCompanion
only. Run `npx vite build` and confirm three.js lands in a separate chunk.

A9. RUST — overlay-visibility event: toggle_charm emits window.emit("overlay-visibility", bool)
on BOTH branches (false on hide, true on show). Frontend hard-stops the loop on false, ensureLoop
on true (do not trust WKWebView visibilitychange for NSWindow orderOut).

A10. RUST — cursor stream re-enable: when set_cursor_stream(false) is called, reset the loop-local
last_sent to None so re-enabling emits immediately.

A11. RUST — do NOT call tao's set_visible_on_all_workspaces at all. The config key
visibleOnAllWorkspaces:true (creation-time) + our objc2 full-mask setCollectionBehavior (after
show, re-asserted in toggle_charm's show branch) are the single source of truth.

A12. RUST — add a comment on cursor_local (macOS): the formula assumes the window sits on the
primary monitor whose CG origin is (0,0); multi-monitor is out of scope for v1.

A13. FLUTTER hysteresis: enter at dist < 90px (or approach: dist < 130px AND approachSpeed >
250px/s), exit only when dist > 130px; minimum flutter duration 600ms; cooldown 3000ms.

A14. POST-RELEASE VELOCITY CLAMP in stepSwing: for 6 frames after a drag release, clamp each
seat point's per-frame displacement magnitude to 28px (explosion insurance on violent flicks).

A15. SOUND GATE: playChirp() is click-driven (a real user gesture) — route through the existing
getCtx() path like rituals. playPeck() fires with NO gesture: it must check the module-level
`ctx` variable directly (add `export function isAudioReady(): boolean { return ctx !== null &&
ctx.state === "running"; }` to sound.ts) and return silently if not ready — never auto-create or
resume() the context from peck.

A16. WIND vs SLEEP (already in battery section, binding): in bird mode wind applies only within
8s after a wake event; the swing is allowed to fully settle and sleep even with windEnabled=true.
Charm mode wind behavior unchanged.

A17. COMPANIONS registry metadata in types.ts (inert, for future packs):
export const COMPANIONS = [{ id: "bluebird", name: "Blue Bird", description: "A little blue
watcher on a swing. It follows your cursor, flutters when you get close, and dozes off when
you work.", actionLabel: "Say hi", packId: "core", free: true, modelUrl:
"/companions/bluebird.glb", wantsCursor: true }] as const;

A18. meshopt typings: if @types/three 0.186 lacks a declaration for
"three/examples/jsm/libs/meshopt_decoder.module.js", add src/companion/meshopt.d.ts with an
ambient module declaration (export const MeshoptDecoder: { ready: Promise<void>; ... }).
Check first; only add if tsc fails.

A19. ASSET (already done, do not redo): public/companions/bluebird.glb exists — 620KB, 61,416
tris, meshopt + webp 1024. scripts/optimize-bird.sh documents the regeneration command.
