<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="96" alt="Danglings icon" />

# Danglings

**Tiny lucky charms that dangle from the top of your screen.**

It hangs from a thread at the top of your screen, sways with a little wind, and reacts when you click it. Pick a charm rooted in a real tradition — or hang your own emoji instead.

</div>

---

## What it is

Danglings is a transparent, always-on-top desktop overlay. A single charm hangs on a swinging, physically-simulated thread — drag it, flick it, or just let it sway. Click it to trigger its **ritual** (a small animation + sound), or right-click to open the picker and choose a different charm.

- 🧿 **Nazar Boncuğu** (Turkey & the Levant) — spin it to ward off the evil eye
- 🪬 **Hamsa** (Middle East & North Africa) — flick it away for good fortune
- 🍀 **Four-Leaf Clover** (Ireland) — rub it for luck
- 🐱 **Maneki-neko** (Japan) — tap its paw
- 🪲 **Scarab** (Egypt) — turn it over
- 🐘 **Ganesha** (India) — clear the path
- 福 **Fu** (China) — flip it upside down
- 🌶️🍋 **Nimbu-mirchi** (India) — hang a fresh garland
- 👺 **Drishti bommai** (India) — stare it down
- 🪢 **Pánchángjié** (China) — spin the tassel
- ✨ or type any emoji of your own

The window is click-through everywhere except the charm itself, so it never gets in the way of whatever you're actually doing.

## Companions

Swap the charm for a 3D companion on a swing — a blue bird, a monkey, an elephant, a kitten and more. It watches your cursor, chirps when you click it, and dozes off while you work. Flick the swing; it settles on its own.

## Reminders that count desk time

Right-click → **reminders**. Danglings keeps three gentle clocks that only run while you're actually at the desk (it asks the OS how long since your last keypress or mouse move — no permissions needed):

- 💧 **Water** — every 45 min by default. Click "Drank one" to log a glass toward a daily 8.
- 🚶 **Move** — after 50 min of continuous desk time. Stepping away for 5 minutes resets it.
- 👀 **Eye rest** — every 20 min, off by default: look 20 feet away for 20 seconds.
- ⏰ **Your own** — anything on an interval or at fixed times on chosen weekdays.

Reminders arrive as a small speech bubble beside your charm or companion with a soft chime. Click it to acknowledge, right-click to snooze ten minutes. Everything pauses while you're away.

## Always there, always current

- **Launch at login** is on by default (toggle it in **settings**).
- **Updates** are one click: the companion holds up a little gift when a new version is ready, and installing restarts the app in a few seconds. Danglings checks a few times a day; turn that off in settings if you prefer.

## Tech stack

Built with [Tauri](https://tauri.app/) (Rust) for the desktop shell, [React](https://react.dev/) + TypeScript for the UI, and [Vite](https://vitejs.dev/) for the dev/build tooling. The rope/thread physics are a small custom simulation ([`src/useRope.ts`](src/useRope.ts)).

## Install

Download the latest release from the [Releases](https://github.com/surez0000/danglings/releases) page.

**macOS** — open the `.dmg` and drag Danglings to Applications. The app is not notarized (no paid Apple developer account yet), so the first launch needs one extra step: **right-click Danglings.app → Open**, then confirm. If macOS says the app "is damaged" or "cannot be checked", run once in Terminal:

```bash
xattr -cr /Applications/Danglings.app
```

After that it opens normally, and updates install through the app itself.

**Windows** — run `Danglings_x.y.z_x64-setup.exe`. SmartScreen may show "Windows protected your PC" because the installer isn't code-signed; click **More info → Run anyway**.

Danglings lives in the menu bar / tray (no Dock icon). **Shift+Alt+K** shows or hides it.

## Getting started

**Prerequisites:** [Node.js](https://nodejs.org/), [Rust](https://www.rust-lang.org/tools/install), and the [Tauri system dependencies](https://tauri.app/start/prerequisites/) for your OS.

```bash
# install dependencies
npm install

# run in development mode
npm run tauri dev

# build a release bundle
npm run tauri build
```

## Contributing

Issues and PRs are welcome — new charms, new rituals, and bug fixes especially.

## License

[MIT](LICENSE)
