# Changelog

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
