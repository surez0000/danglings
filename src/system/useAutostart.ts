import { useCallback, useEffect, useState } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";

/* Launch at login, via tauri-plugin-autostart (LaunchAgent on macOS, HKCU Run
   key on Windows). On mount the OS state is read and, in a packaged build,
   brought in line with the saved setting — so the default "on" takes effect on
   first launch without a prompt. In `tauri dev` the registered binary would be
   target/debug, so the automatic sync is skipped; `apply` (the user's explicit
   toggle) always acts. */

export function useAutostart(wanted: boolean): { actual: boolean | null; apply: (on: boolean) => Promise<void> } {
  const [actual, setActual] = useState<boolean | null>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const en = await isEnabled();
        if (dead) return;
        if (import.meta.env.DEV) {
          setActual(en);
          return;
        }
        if (wanted) {
          // Always (re)enable: the plugin rewrites the LaunchAgent plist / Run
          // key with the CURRENT executable path, so an app that was first
          // run from Downloads and then moved to /Applications self-heals.
          await enable();
          if (!dead) setActual(true);
        } else {
          if (en) await disable();
          if (!dead) setActual(false);
        }
      } catch {
        // Not running inside Tauri (plain-browser dev) — nothing to mirror.
        if (!dead) setActual(null);
      }
    })();
    return () => {
      dead = true;
    };
    // Mount-only: later changes go through `apply`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = useCallback(async (on: boolean) => {
    try {
      if (on) await enable();
      else await disable();
      setActual(on);
    } catch {
      setActual(null);
    }
  }, []);

  return { actual, apply };
}
