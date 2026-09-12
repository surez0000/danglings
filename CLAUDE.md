# Danglings — project guide

Repo: https://github.com/surez0000/danglings (renamed from DeskCharm on 2026-09-12).
Push directly to `main` — no branch protection on this repo.

A Tauri 2 + React 19/TS/Vite desktop overlay: a lucky charm hangs on a physics-simulated
thread from the top edge of the screen. Transparent, always-on-top, full-monitor window
that is click-through except near the charm. Tray menu + Shift+Alt+K toggle.

## Architecture

- `src/App.tsx` — main component: rAF loop steps rope physics, drag/click/ritual handling,
  right-click charm picker + settings. localStorage: `danglings.charm`, `danglings.settings`
  (size small/medium/large, windEnabled, windIntensity, anchorRatio).
- `src/useRope.ts` — Verlet rope: 7 points, 16px segments, 6 constraint iterations.
- `src/charms.ts` — charm roster data (id, emoji, ritual type, region, description).
- `src/charmArt.tsx` — glyph renderer (custom SVG art per charm id, emoji fallback).
- `src/sound.ts` — Web Audio synthesized ritual sounds + generated convolution reverb.
- `src-tauri/src/lib.rs` — the core trick: window starts `set_ignore_cursor_events(true)`;
  frontend sends charm/anchor coords via `update_hit_points` every other frame; a 16ms Rust
  thread polls the global cursor and flips interactivity when the cursor is within 42px of a
  hit point (58px hysteresis to leave). `set_force_interactive` pins it during drags/menu.

## Gotchas

- **Cursor polling is per-platform** in `lib.rs`: Win32 `GetCursorPos` (physical px) on
  Windows, `CGEvent` (logical points) on macOS — both normalized to window-local logical
  coords in `cursor_local()`. No special OS permissions needed for either.
- **`macOSPrivateApi: true`** in `tauri.conf.json` is required for window transparency but is
  banned from the Mac App Store. Decision made: we skip MAS entirely (see plan), so this flag
  stays. Notarization (malware scan only) does not care about it.
- The charm hangs from its top-center at the rope tip (`transform-origin: 50% 0`); ritual
  overlays and hover-lean use charm CENTER (`charmPos.y + sizePx/2`). Keep that distinction.
- Hit points sent to Rust = all 7 rope points + charm center.
- macOS runs with `ActivationPolicy::Accessory` (no Dock icon; tray + Shift+Alt+K only).

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
