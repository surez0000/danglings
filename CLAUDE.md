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
    look-at math, pose smoothing, doze vignettes. `APPROACH_STARTLE = false` gates the
    watch→flutter transition off (approach jerk); flip it to bring the startle back.
  - `birdScene.ts` — three.js ortho scene + GLTF/meshopt/webp loader, context-loss recovery.
    The ONLY file that statically imports three; only ever loaded via dynamic import.
    Rigged GLBs are auto-detected (Meshy bones are anonymous: heuristics by normalized
    position, overridden by per-model/per-VARIANT `boneHints` from the offline pipeline
    — Meshy re-rigs each color variant so bone names differ between variants!) and
    driven procedurally via RigPose: head-only cursor tracking, wing flap, tail wag,
    ear wiggle. Models with baked clips run an AnimationMixer (path kept but DORMANT: the
    mia/riko humanoids that used it were retired in 1.1 as buggy; a saved mia/riko
    selection falls back to bluebird in companionStore): first clip loops as idle, `clips`
    URLs hold one-shot reactions retargeted by bone name; bone offsets premultiply ON TOP.
    Rigged asset pipeline: scripts/analyze-rig.mjs reports bones/positions/animations
    (NOTE: its normalized positions are degenerate on meshopt-quantized outputs —
    classify roles from the RAW export, verify counts on the output). The whole fleet
    (bluebird + 11 rigged families, 19 models) lives in public/companions/; raw exports
    in "Rigged models/" are gitignored.
  - `BirdCompanion.tsx` — bird-mode owner: fixed-timestep physics accumulator, render tiers,
    sleep/wake gates, hit-point sends, click/context-menu surfaces, glyph fallback. Companions
    do NOT drag since 1.1 (pull-and-release stretched the cords and read as rubbery): a press
    is a click; the swing moves via the menu. `dragRef` stays null (code path kept).
  - `BirdGlyph.tsx` — flat-cute SVG bird: picker thumbnail, GLB-loading placeholder, and
    permanent fallback when WebGL/GLB fail. Must never import three.
- `src/reminders/` — desk-time reminders (water / move / eye rest / custom), added 2026-09-14:
  - `types.ts` — Reminder/Schedule model, defaults (water 45 min ON, move 50 min ON, eyes 20
    min OFF), localStorage `danglings.reminders` (config) + `danglings.reminders.state`
    (counters/snoozes/water-today). Built-ins merge by id so new defaults reach old users.
  - `engine.ts` — pure scheduler. Time counts only while idle < 120 s; idle ≥ awayAfterMin
    (5 min) = away → clocks pause, and `resetOnAway` ones (move, eyes) restart on return;
    nothing fires in the first 60 s back. Fixed-time slots fire only within 15 min of their
    time (missed slots are skipped, never delivered late). One bubble at a time (`presented`).
  - `useReminders.ts` — 5 s `setInterval` (never the rAF loop) that invokes `get_idle_seconds`,
    steps the engine, plays `playReminderChime`, exposes `active` + acknowledge/snooze/preview.
  - `ReminderBubble.tsx` — the speech bubble beside the character (click = primary,
    right-click = snooze/later); reports its rect so App registers it via
    `update_extra_hit_points` (the overlay is click-through everywhere else).
  - `RemindersPanel.tsx` — the menu's "reminders" tab (toggles, −/+ interval steppers,
    water count, custom interval/fixed-time reminders with weekday chips, ▶ preview).
- `src/updater/useUpdater.ts` — tauri-plugin-updater + plugin-process. Auto-check 20 s after
  launch then every 6 h (skipped in `tauri dev`), manual "Check for updates" in settings; an
  available update is offered by the CHARACTER as a bubble ("Update now" / "Later" = 24 h).
  Feed: `plugins.updater.endpoints` in tauri.conf.json → GitHub Releases `latest.json`
  (built by `scripts/make-latest-json.mjs` after `tauri build`). Signing key:
  `~/.tauri/danglings.key` (+ `.pub` pasted as `pubkey`); builds must set
  `TAURI_SIGNING_PRIVATE_KEY_PATH`. Losing the key = no more updates for shipped users.
- `src/system/useAutostart.ts` — tauri-plugin-autostart (LaunchAgent / HKCU Run). Setting
  `launchAtLogin` defaults ON and is synced to the OS on launch in packaged builds only
  (in `tauri dev` the registered binary would be target/debug — the explicit toggle still acts).
- The right-click menu now has three tabs: look (companions/charms/emoji) · reminders · settings
  (size, sway, move, launch at login, version + update check).
- `src-tauri/src/lib.rs` — the core trick: window starts `set_ignore_cursor_events(true)`;
  frontend sends charm/anchor coords via `update_hit_points` every other frame; a 16ms Rust
  thread polls the global cursor and flips interactivity when the cursor is within 42px of a
  hit point (58px hysteresis to leave). `set_force_interactive` pins it during drags/menu. `update_extra_hit_points` adds the
  bubble's points (a second set, so neither mode's wholesale `points` replace clobbers it);
  `get_idle_seconds` returns OS seconds-since-last-input (CGEventSourceSecondsSinceLastEventType /
  GetLastInputInfo, permission-free) for the reminders' desk clock.
  The same thread powers the opt-in `cursor-moved` event stream (see Gotchas), and
  `toggle_charm` emits `overlay-visibility` (bool) on both hide/show branches. Tray menu:
  Show/Hide · Move to Top Center · "Check for Updates…" (emits `check-updates`, showing the
  overlay first) · a status `MenuItem` kept in managed state (`UpdateStatusItem`) that the
  frontend rewrites via `set_update_status {text, actionable}` (clicking it when actionable
  emits `install-update`) · Quit. macOS uses `brand/tray-template@2x.png` as a template icon.

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
- **Audio without a gesture is fine**: wry sets `WKAudiovisualMediaTypes::None` on macOS and
  tauri.conf.json passes `--autoplay-policy=no-user-gesture-required` to WebView2, so reminder
  chimes may create the AudioContext themselves. (`playPeck`'s gate predates this check.)
- Dev demo hooks (DEV builds only): `http://localhost:1420/?demo=reminder` previews the water
  bubble, `?demo=update` fakes an available update — for styling the bubble in a plain browser.
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
- Reactions: peck on idle, chirp on click, swing physics on flick. The approach-startle
  flutter is built but gated OFF via `APPROACH_STARTLE` in birdBehavior.ts (it read as a
  jerk when the cursor simply moved toward the companion) — re-enable in a later update.
- Rendering: Meshy AI–generated rigged GLB via three.js, transparent WebGL canvas,
  ON-DEMAND rendering (render only on movement, cap ~30fps, sleep idle) for battery.
  Fallback if battery cost too high: bake sprite sheets.
- Charm PACK data model (pack = charms + animations + sounds) — packs are the monetization unit.

### Phase 2 — first revenue (direct)
Landing page, notarized DMG, Lemon Squeezy/Paddle license-key unlock, Product Hunt +
short-video launch (GIF-ability is the growth loop).

### Phase 3 — Steam
Steamworks setup ($100 Steam Direct), Windows + Mac builds, store page assets.

## Website

Source: `site/` (own Vite build, `vite.site.config.ts`, `base: "./"`, `publicDir: site/public`)
→ output committed in `docs/` for GitHub Pages (`main:/docs`, https://surez0000.github.io/danglings/).
Build: `npx vite build -c vite.site.config.ts`. The hero is the REAL renderer: `site/main.ts`
imports the app's `birdScene.ts`, `useSwing.ts`, `birdBehavior.ts` and `types.ts` (browser
stand-in for BirdCompanion — cursor from pointermove, no Tauri) and hangs the tabby kitten
(`site/public/companions/kitten-tabby.glb`, a copy) from the top edge; the still portrait is the
poster/fallback. Companion cards use real renders in `site/public/portraits/*.png`, produced
by `site/portrait.html?model=<file>&save=1[&zoom=1.4]` opened through the APP dev server
(`http://localhost:1420/site/portrait.html…`, which serves every GLB); `?save=1` POSTs the PNG to
the dev-only `/__portrait` sink plugin in `vite.config.ts`. Re-render when a model changes.
Static download links point at the v1.0.0 assets; a progressive fetch of the GitHub "latest
release" API rewrites version/size/links (and enables the Windows button once a `-setup.exe`
asset exists). The reminders section shows the menu and bubble at real proportions built from
App.css values. `docs/index.html` is generated — edit `site/index.html`. The build EMPTIES docs/, so nothing
hand-written may live there; long-form design notes go in `design/` (bird-companion-design.md).

## Release checklist (auto-update depends on it)

No Apple Developer ID (decision 2026-09-14: not paying the $99/yr for now) → the macOS app is
**ad-hoc signed** (`bundle.macOS.signingIdentity: "-"`), not notarized. Users right-click → Open
once (README documents `xattr -cr`). The updater is unaffected: it verifies OUR minisign
signature, and a self-downloaded bundle carries no quarantine flag. Windows NSIS is unsigned
too (SmartScreen "More info → Run anyway"). Revisit both when revenue justifies certificates.

1. Bump `version` in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `package.json`
   (`npm version x.y.z --no-git-tag-version` does package.json + lock).
2. macOS (this Mac), universal so one DMG serves Intel + Apple silicon
   (`rustup target add x86_64-apple-darwin` once). NOTE: `tauri build` reads the key CONTENT
   from `TAURI_SIGNING_PRIVATE_KEY` — the `_PATH` variable is only understood by
   `tauri signer sign` (learned the hard way on 1.0.0; the unsigned build's tarball was then
   signed by hand with `npx tauri signer sign --private-key-path ~/.tauri/danglings.key -p "" <tgz>`):
   `TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/danglings.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
   npm run tauri build -- --target universal-apple-darwin`
   → `src-tauri/target/universal-apple-darwin/release/bundle/{dmg,macos}/`.
3. Windows (Windows machine, PowerShell): copy `~/.tauri/danglings.key` to
   `%USERPROFILE%\.tauri\danglings.key`, then
   `$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\danglings.key" -Raw`,
   `$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""`, `npm run tauri build`
   → `src-tauri/target/release/bundle/nsis/Danglings_x.y.z_x64-setup.exe(.sig)`.
4. `node scripts/make-latest-json.mjs --notes "…"` on each machine → `dist-release/latest.json`.
   It MERGES with an existing `dist-release/latest.json` of the same version, so copy the
   macOS one to the Windows machine first (or vice versa) to get both platforms in one file.
5. Commit, tag `v<version>`, create the GitHub release and upload: the .dmg, the -setup.exe,
   `Danglings.app.tar.gz` + `.sig`, `…-setup.exe.sig`, and `latest.json`. Shipped apps fetch
   `releases/latest/download/latest.json`, so the release must be marked "latest".

## Conventions

- `main` is protected — all changes via PR.
- Dev: `npm install`, then `npm run tauri dev`. Build: `npm run tauri build`.
