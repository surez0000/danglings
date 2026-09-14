# Danglings — project guide

Repo: https://github.com/surez0000/danglings (renamed from DeskCharm on 2026-09-12).
Push directly to `main` — no branch protection on this repo.

A Tauri 2 + React 19/TS/Vite desktop overlay: a lucky charm hangs on a physics-simulated
thread from the top edge of the screen. Transparent, always-on-top, full-monitor window
that is click-through except near the charm. Tray menu + Shift+Alt+K toggle.

## Architecture

- `src/App.tsx` — main component: rAF loop steps rope physics, drag/click/ritual handling,
  right-click charm picker + settings. localStorage: `danglings.charm`, `danglings.settings`
  (size small/medium/large, windEnabled, windIntensity, anchorRatio), `danglings.companion`
  (JSON `{ kind: 'charm' } | { kind: 'companion'; id: CompanionId }`, default `{kind:'charm'}`
  on missing/corrupt; the legacy `{kind:'bird'}` shape migrates to bluebird on load — the
  last-chosen charm is preserved separately so companion→charm restores it).
- `src/useRope.ts` — Verlet rope: 7 points, 16px segments, 6 constraint iterations.
- `src/charms.ts` — charm roster data (id, emoji, ritual type, region, description).
- `src/charmArt.tsx` — glyph renderer (custom SVG art per charm id, emoji fallback).
- `src/sound.ts` — Web Audio synthesized ritual sounds + generated convolution reverb; also
  `playChirp` (click-driven, may create/resume ctx) and `playPeck` (gated on `isAudioReady()`,
  never creates/resumes — WebKit gesture rule).
- `src/companion/` — bird-on-a-swing companion (Phase 1):
  - `types.ts` — CompanionSelection, the COMPANIONS registry (5 entries: bluebird + monkey
    sit on the physics swing via `attach: "seat"`; panda/chameleon/swinger have ropes baked
    into the mesh and dangle from a short single cord via `attach: "hang"`), per-companion
    motion knobs (yawClamp/pitchMul/bobMul/focusFrac), `companionSpec(def, size)` deriving
    modelPx/canvas dims/rig lengths, and the loop/battery constants. Adding a companion =
    one optimized GLB in public/companions/ + one registry entry. A companion may declare
    `variants` (color variants: same character, different GLB — monkey ×3, elephant ×4);
    the picker card shows a swatch dot per variant and the selection persists as
    `{kind:'companion', id, variantId?}`.
  - `companionStore.ts` — load/save `danglings.companion`.
  - `useCursorFeed.ts` — module singleton `cursorState` fed by the Rust `cursor-moved` event;
    `startCursorFeed(onWake)` opts in via `set_cursor_stream`, disposer opts out.
  - `useSwing.ts` — self-contained Verlet swing (two 4-segment cords + stiff seat bar);
    deliberately duplicates the rope primitives so charm physics stays untouched.
  - `birdBehavior.ts` — pure state machine (idle/watch/flutter/peck/chirp/dragged/doze),
    look-at math, pose smoothing, doze vignettes.
  - `birdScene.ts` — three.js ortho scene + GLTF/meshopt/webp loader, context-loss recovery.
    The ONLY file that statically imports three; only ever loaded via dynamic import.
    Rigged GLBs are auto-detected (Meshy bones are anonymous: heuristics by normalized
    position, overridden by per-model/per-VARIANT `boneHints` from the offline pipeline
    — Meshy re-rigs each color variant so bone names differ between variants!) and
    driven procedurally via RigPose: head-only cursor tracking, wing flap, tail wag,
    ear wiggle. Models with baked clips (mia/riko humanoids) run an AnimationMixer:
    first clip loops as idle, `clips` URLs hold one-shot reactions (chirp/flutter)
    retargeted by bone name; bone offsets premultiply ON TOP of the mixer output.
    Rigged asset pipeline: scripts/analyze-rig.mjs reports bones/positions/animations
    (NOTE: its normalized positions are degenerate on meshopt-quantized outputs —
    classify roles from the RAW export, verify counts on the output). The whole fleet
    (bluebird + 13 rigged families, 20 models + 3 clip files) lives in
    public/companions/; raw exports in "Rigged models/" are gitignored.
  - `BirdCompanion.tsx` — bird-mode owner: fixed-timestep physics accumulator, render tiers,
    sleep/wake gates, hit-point sends, drag/click/context-menu surfaces, glyph fallback.
  - `BirdGlyph.tsx` — flat-cute SVG bird: picker thumbnail, GLB-loading placeholder, and
    permanent fallback when WebGL/GLB fail. Must never import three.
- `src-tauri/src/lib.rs` — the core trick: window starts `set_ignore_cursor_events(true)`;
  frontend sends charm/anchor coords via `update_hit_points` every other frame; a 16ms Rust
  thread polls the global cursor and flips interactivity when the cursor is within 42px of a
  hit point (58px hysteresis to leave). `set_force_interactive` pins it during drags/menu.
  The same thread powers the opt-in `cursor-moved` event stream (see Gotchas), and
  `toggle_charm` emits `overlay-visibility` (bool) on both hide/show branches.

### Bundle boundary (hard rule)

`App.tsx` may statically import ONLY `src/companion/types.ts`, `companionStore.ts`, and
`BirdGlyph.tsx`. `BirdCompanion.tsx` is loaded via `React.lazy(() =>
import("./companion/BirdCompanion"))` inside `<Suspense fallback={null}>`, and `birdScene.ts`
(which statically imports three/GLTFLoader/MeshoptDecoder) is dynamically imported by
BirdCompanion only — so charm-only users never parse the ~150KB-gzip three.js chunk. After
touching imports in this area, run `npx vite build` and confirm three.js still lands in a
separate lazy chunk, not the entry chunk.

### cursor-moved event contract

- Opt-in: frontend calls `set_cursor_stream { active: bool }`; default off, so charm-only
  users pay zero IPC. Disabling resets the stream's `last_sent` so re-enabling emits at once.
- Payload: `[x, y]` — window-local LOGICAL px, same space as `clientX/clientY`. May be
  negative/out-of-bounds when the cursor is on another monitor (frontend clamps for look-at).
- Rate: 2px dead-band, 30Hz cap (33ms min interval), plus one trailing settle emit ~150ms
  after movement that got swallowed by the cap/dead-band — the gaze never freezes one frame
  short of the final cursor position.
- Emitted only while the overlay window is visible. Each emit doubles as the webview wake
  signal for the bird's stopped loop (this is why it's Rust-push, not JS polling).

### Bird battery gates (steady state = 0 GPU frames, 0 rAF ticks, 0 IPC)

1. Render gate: render only when the pose changed beyond epsilons / swing has energy /
   dragging; 60fps tier during drag + 600ms post-release + one-shots, else 30fps, doze 0fps.
2. Physics gate: fixed 16.667ms steps (max 3/frame); swing snaps + stops stepping after 90
   low-energy frames. Wind applies only within 8s of a wake event in bird mode, so the swing
   settles and sleeps even with windEnabled on (charm-mode wind unchanged).
3. Loop gate: the rAF loop itself stops when physics sleeps + behavior dozes + no drag; wakes
   are event-driven (cursor-moved, pointer events, doze-vignette timer, prop changes,
   `recenter`, `overlay-visibility`). Hit points are re-sent only when a point moved >1px.

## Gotchas

- **Cursor polling is per-platform** in `lib.rs`: Win32 `GetCursorPos` (physical px) on
  Windows, `CGEvent` (logical points) on macOS — both normalized to window-local logical
  coords in `cursor_local()`. No special OS permissions needed for either.
- **`macOSPrivateApi: true`** in `tauri.conf.json` is required for window transparency but is
  banned from the Mac App Store. Decision made: we skip MAS entirely (see plan), so this flag
  stays. Notarization (malware scan only) does not care about it.
- The charm hangs from its top-center at the rope tip (`transform-origin: 50% 0`); ritual
  overlays and hover-lean use charm CENTER (`charmPos.y + sizePx/2`). Keep that distinction.
- Hit points sent to Rust = all 7 rope points + charm center (charm mode). In companion mode
  BirdCompanion sends its own set (seat: 9 points over anchors/cords/seat/model; hang: anchor
  + cord + 5 points spaced down the dangling model) and App's charm rAF effect early-returns
  — never let both run at once.
- **DevTools/context menu**: the window config sets `"devtools": false` and main.tsx
  preventDefaults `contextmenu` globally — WKWebView's Inspect Element embeds itself unusably
  into a transparent click-through overlay. Temporarily flip the config flag when debugging
  is genuinely needed. Our picker right-click works because its handlers run on the target
  before the document listener.
- `public/dev-viewer.html` is a dev-only three.js model viewer (open
  `http://localhost:1420/dev-viewer.html?model=<name>` while `tauri dev` runs) for checking
  optimized GLBs and measuring aspect/focus fractions for registry entries.
- macOS runs with `ActivationPolicy::Accessory` (no Dock icon; tray + Shift+Alt+K only).
- **Spaces/fullscreen pinning**: `"visibleOnAllWorkspaces": true` in `tauri.conf.json` sets
  CanJoinAllSpaces at creation; `apply_macos_overlay_behavior` in `lib.rs` then raw-sets the
  FULL `NSWindowCollectionBehavior` mask via objc2 (CanJoinAllSpaces | FullScreenAuxiliary |
  Stationary | IgnoresCycle) after `show()` and re-asserts it in `toggle_charm`'s show branch.
  FullScreenAuxiliary (public AppKit API, notarization-safe) keeps the overlay over fullscreen
  Spaces. NEVER call tao's `set_visible_on_all_workspaces` at runtime — it rewrites the
  bitmask and clobbers the extra flags. Escalation if QA finds it hidden behind fullscreen
  content: `setLevel(NSPopUpMenuWindowLevel)` via the same objc2 path (do not ship by default).
- **Windows caveat**: workspace pinning is a no-op on Windows (tao doesn't implement
  virtual-desktop pinning; "pin to all desktops" needs the undocumented
  IVirtualDesktopPinnedApps COM interface). Accepted for v1 — the overlay stays on the desktop
  where it was shown and Shift+Alt+K re-summons it.
- **Asset regeneration**: `public/companions/bluebird.glb` (620KB, ~61k tris, meshopt
  EXT_meshopt_compression + webp EXT_texture_webp 1024px) is produced from `3ds/Blue_bird.glb`
  by `scripts/optimize-bird.sh` (gltf-transform pipeline) — rerun that script when tuning
  simplification, never hand-edit the output.

## Product plan (agreed 2026-09-12)

**Distribution:** Skip the Mac App Store permanently. Ship: (1) notarized DMG from own site,
(2) Steam (Win + Mac), (3) optionally itch.io. Steam is non-exclusive; own-site sales are
allowed alongside. Keep Tauri stack — no native rewrite needed.

**Monetization:** Free core + one-time unlocks, no subscription. The 10 culturally-rooted
charms stay FREE forever (never sell religious/cultural symbols — review/PR/brand risk).
Paid: original "cute" packs (kawaii toys, seasonal, retro, companions) at ~$1.99–2.99, or a
lifetime everything-unlock ~$6.99–9.99. Off-store payments via Lemon Squeezy or Paddle
(merchant of record); Steam handles its own.

### Phase 0 — make it run on macOS + fix & polish (current)
1. cfg-gate Win32 cursor polling, add macOS implementation.
2. Fix rope→charm attachment point (per-charm offset; thread ties to top of glyph).
3. Hit-test the whole rope, not just tip + anchor.
4. Charm size setting: small/medium/large, DEFAULT SMALL (~24px) — "never in the way".
5. Idle animation toggle + wind intensity setting.
6. Persist anchor X position across restarts (rope always starts from top edge).
7. Settings persistence (localStorage), simple settings UI in the right-click menu.

### Phase 1 — companion engine (flagship: bird on a swing)
- Original cute bird (NOT Tweety — WB IP) sitting on a swing hung from the top edge; head/eyes
  track the global cursor (cursor position already polled in Rust — feed it to frontend).
- Reactions: flutter when cursor near, peck on idle, chirp on click, swing physics on flick.
- Rendering: Meshy AI–generated rigged GLB via three.js, transparent WebGL canvas,
  ON-DEMAND rendering (render only on movement, cap ~30fps, sleep idle) for battery.
  Fallback if battery cost too high: bake sprite sheets.
- Charm PACK data model (pack = charms + animations + sounds) — packs are the monetization unit.

### Phase 2 — first revenue (direct)
Landing page, notarized DMG, Lemon Squeezy/Paddle license-key unlock, Product Hunt +
short-video launch (GIF-ability is the growth loop).

### Phase 3 — Steam
Steamworks setup ($100 Steam Direct), Windows + Mac builds, store page assets.

## Conventions

- `main` is protected — all changes via PR.
- Dev: `npm install`, then `npm run tauri dev`. Build: `npm run tauri build`.
