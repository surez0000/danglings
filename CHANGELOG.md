# Changelog

## 1.0.1 — 2026-09-15

**New look**
- New app icon: the Danglings mark (a star charm dangling from the D) replaces the temporary logo on both platforms.
- macOS menu-bar icon is now a proper template silhouette, so it follows light and dark menu bars.

**Menu bar / tray**
- "Check for Updates…" in the right-click menu, plus a status line that shows the installed version, "up to date", download progress, or "Update to x.y.z now" (click it to install). Checking from the tray also brings the overlay back if it was hidden.

**Companions**
- Companions no longer drag: pull-and-release stretched the swing cords and felt rubbery. Click still says hi, right-click still opens the menu, the swing still sways and settles on its own. "Move hanging spot" lives in the menu.
- Mia and Riko retired (they were buggy). If one was selected, the Blue Bird takes over. Download is 3.4 MB smaller.

**Website**
- The landing page now renders the tabby kitten live with the app's own three.js scene and shows real renders of every companion.

## 1.0.0 — 2026-09-14

First public release.

**Companions & charms**
- 10 culturally-rooted lucky charms plus any emoji of your own, each with a click ritual and sound.
- 14 3D companion families (23 models) on a physics swing — they watch your cursor, chirp when clicked, and doze while you work.
- The approach "startle" hop is switched off for now (it read as a jerk); it may return as an option.

**Reminders that count desk time**
- Water (every 45 min, on), Move (after 50 min of continuous desk time, on), Eye rest 20-20-20 (every 20 min, off), and custom reminders on an interval or at fixed times on chosen weekdays.
- Clocks run only while you're at the desk (seconds since your last input, from the OS — no permissions). Away for 5 minutes pauses everything; Move and Eye rest restart when you come back; nothing fires in your first minute back.
- Delivered as a speech bubble beside the character with a soft chime. Click = done (Water logs a glass toward a daily 8), right-click = snooze 10 min. Preview any reminder from the menu.

**Always there, always current**
- Launch at login (on by default, toggle in settings).
- One-click updates: the companion offers new versions in a bubble; installing restarts the app. Manifests are minisign-signed and served from GitHub Releases.

**Known limitations**
- macOS build is ad-hoc signed, not notarized: right-click → Open on first launch (see README).
- Windows installer is not code-signed: SmartScreen "More info → Run anyway".
- Overlay covers the primary monitor only.
