import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { playUpdateChime } from "../sound";

/* One-click updates. The updater plugin fetches the signed latest.json named
   in tauri.conf.json (GitHub Releases), compares versions, and on install
   swaps the app bundle (macOS) or runs the NSIS installer passively
   (Windows); the process plugin relaunches. The character does the asking:
   App renders `state` as a bubble ("Danglings 0.2.0 is ready · Update now"). */

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "restarting"
  | "upToDate"
  | "error";

export type UpdaterState = {
  phase: UpdatePhase;
  version?: string;
  notes?: string;
  /* null = size unknown (indeterminate). */
  progress?: number | null;
  error?: string;
  /* Set when the error came from an install the user started. */
  fromInstall?: boolean;
  checkedAt?: number;
};

const LATER_KEY = "danglings.update.laterUntil";
const LATER_VERSION_KEY = "danglings.update.laterVersion";
const FIRST_CHECK_DELAY_MS = 20_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const LATER_MS = 24 * 60 * 60 * 1000;

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/fetch|network|dns|timed? ?out|resolve|connect|offline/i.test(msg)) return "Couldn't reach the update server.";
  if (/json|release|404|not found/i.test(msg)) return "No release published yet.";
  return msg.length > 90 ? `${msg.slice(0, 87)}…` : msg;
}

export function useUpdater(autoCheck: boolean) {
  const [state, setState] = useState<UpdaterState>({ phase: "idle" });
  const [currentVersion, setCurrentVersion] = useState<string>(__APP_VERSION__);
  const updateRef = useRef<Update | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    getVersion()
      .then(setCurrentVersion)
      .catch(() => {});
  }, []);

  const checkNow = useCallback(async (manual: boolean) => {
    const busy = ["downloading", "installing", "restarting"].includes(stateRef.current.phase);
    if (busy) return;
    setState({ phase: "checking" });
    try {
      const u = await check({ timeout: 15_000 });
      if (!u) {
        updateRef.current = null;
        setState({ phase: "upToDate", checkedAt: Date.now() });
        return;
      }
      updateRef.current = u;
      let postponed = false;
      try {
        postponed =
          !manual &&
          Date.now() < Number(localStorage.getItem(LATER_KEY) ?? 0) &&
          localStorage.getItem(LATER_VERSION_KEY) === u.version;
      } catch {
        // ignore storage
      }
      if (postponed) {
        setState({ phase: "idle", checkedAt: Date.now() });
        return;
      }
      setState({ phase: "available", version: u.version, notes: u.body ?? undefined, checkedAt: Date.now() });
      playUpdateChime();
    } catch (e) {
      setState({ phase: "error", error: friendlyError(e), checkedAt: Date.now() });
    }
  }, []);

  const install = useCallback(async () => {
    const u = updateRef.current;
    if (!u) {
      setState({ phase: "error", error: "No update loaded.", fromInstall: true });
      return;
    }
    let total = 0;
    let got = 0;
    setState({ phase: "downloading", version: u.version, progress: null });
    try {
      await u.downloadAndInstall((ev) => {
        if (ev.event === "Started") {
          total = ev.data.contentLength ?? 0;
        } else if (ev.event === "Progress") {
          got += ev.data.chunkLength;
          setState({
            phase: "downloading",
            version: u.version,
            progress: total > 0 ? Math.min(1, got / total) : null,
          });
        } else if (ev.event === "Finished") {
          setState({ phase: "installing", version: u.version, progress: 1 });
        }
      });
      setState({ phase: "restarting", version: u.version, progress: 1 });
      await relaunch();
    } catch (e) {
      setState({ phase: "error", error: friendlyError(e), version: u.version, fromInstall: true });
    }
  }, []);

  /* "Later": stay quiet about this version for a day. */
  const later = useCallback(() => {
    const u = updateRef.current;
    try {
      localStorage.setItem(LATER_KEY, String(Date.now() + LATER_MS));
      if (u) localStorage.setItem(LATER_VERSION_KEY, u.version);
    } catch {
      // ignore storage
    }
    setState({ phase: "idle" });
  }, []);

  const dismiss = useCallback(() => setState({ phase: "idle" }), []);

  /* Dev only: fake an available update so the bubble can be styled/tested
     without a published release. */
  const devMock = useCallback((version = "0.2.0") => {
    if (!import.meta.env.DEV) return;
    updateRef.current = null;
    setState({ phase: "available", version, notes: "Mock update for UI testing." });
  }, []);

  // Auto-check: 20s after launch, then every 6h. Skipped in dev (no release feed).
  useEffect(() => {
    if (!autoCheck || import.meta.env.DEV) return;
    const t = window.setTimeout(() => checkNow(false), FIRST_CHECK_DELAY_MS);
    const i = window.setInterval(() => checkNow(false), CHECK_INTERVAL_MS);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(i);
    };
  }, [autoCheck, checkNow]);

  return { state, currentVersion, checkNow, install, later, dismiss, devMock };
}
