import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { playReminderChime } from "../sound";
import { ReminderEngine, TICK_MS } from "./engine";
import { loadConfig, loadRuntime, saveConfig, saveRuntime, type Reminder, type RemindersConfig } from "./types";

/* React owner of the reminder engine: a 5s timer (NOT the rAF loop — the
   battery gates stay untouched) asks Rust how long the user has been idle,
   steps the engine, and surfaces at most one due reminder as `active`. */

export type ActiveReminder = { reminder: Reminder; firedAt: number; preview: boolean };

export type RemindersApi = {
  config: RemindersConfig;
  updateConfig: (fn: (c: RemindersConfig) => RemindersConfig) => void;
  active: ActiveReminder | null;
  /* Done / "drank one" — resets the clock (and logs a glass for water). */
  acknowledge: () => void;
  /* Come back in 10 minutes. */
  snooze: () => void;
  /* Show the bubble now without touching the clocks (menu "preview"). */
  preview: (r: Reminder) => void;
  logWater: () => void;
  waterCount: number;
  away: boolean;
  minutesUntil: (r: Reminder) => number | null;
  /* Increments every tick so the menu's "in N min" lines stay fresh. */
  tickCount: number;
};

async function readIdleSeconds(): Promise<number> {
  try {
    return await invoke<number>("get_idle_seconds");
  } catch {
    // Plain-browser dev (vite without Tauri): always at the desk.
    return 0;
  }
}

export function useReminders(canDeliver: boolean): RemindersApi {
  const [config, setConfig] = useState<RemindersConfig>(loadConfig);
  const engineRef = useRef<ReminderEngine | null>(null);
  if (!engineRef.current) engineRef.current = new ReminderEngine(config, loadRuntime());
  const engine = engineRef.current;

  const [active, setActive] = useState<ActiveReminder | null>(null);
  const [waterCount, setWaterCount] = useState(engine.runtime.water.count);
  const [away, setAway] = useState(false);
  const [tickCount, setTickCount] = useState(0);

  const canDeliverRef = useRef(canDeliver);
  canDeliverRef.current = canDeliver;
  const activeRef = useRef(active);
  activeRef.current = active;
  const lastTickRef = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;
    let inflight = false;
    const timer = window.setInterval(async () => {
      if (inflight) return;
      inflight = true;
      const idle = await readIdleSeconds();
      inflight = false;
      if (cancelled) return;
      const now = Date.now();
      const dt = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      const out = engine.tick({ now, dt, idle, canDeliver: canDeliverRef.current });
      if (out.changed) saveRuntime(engine.runtime);
      setAway(out.away);
      setWaterCount(engine.runtime.water.count);
      if (out.due && !activeRef.current) {
        setActive({ reminder: out.due, firedAt: now, preview: false });
        playReminderChime();
      }
      setTickCount((n) => n + 1);
    }, TICK_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [engine]);

  const updateConfig = useCallback(
    (fn: (c: RemindersConfig) => RemindersConfig) => {
      const next = fn(engine.config);
      engine.setConfig(next);
      saveConfig(next);
      setConfig(next);
      // A bubble for a reminder that just got switched off goes away.
      const a = activeRef.current;
      if (a && !(next.enabled && next.reminders.some((r) => r.id === a.reminder.id && r.enabled))) {
        engine.clearPresented();
        setActive(null);
      }
    },
    [engine],
  );

  const acknowledge = useCallback(() => {
    const a = activeRef.current;
    if (!a) return;
    if (a.preview) {
      engine.clearPresented();
    } else {
      engine.acknowledge(a.reminder.id);
      if (a.reminder.kind === "water") engine.logWater(Date.now());
      saveRuntime(engine.runtime);
      setWaterCount(engine.runtime.water.count);
    }
    setActive(null);
  }, [engine]);

  const snooze = useCallback(() => {
    const a = activeRef.current;
    if (!a) return;
    if (a.preview) {
      engine.clearPresented();
    } else {
      engine.snooze(a.reminder.id, Date.now());
      saveRuntime(engine.runtime);
    }
    setActive(null);
  }, [engine]);

  const preview = useCallback(
    (r: Reminder) => {
      engine.presented = r.id;
      setActive({ reminder: r, firedAt: Date.now(), preview: true });
      playReminderChime();
    },
    [engine],
  );

  const logWater = useCallback(() => {
    engine.logWater(Date.now());
    saveRuntime(engine.runtime);
    setWaterCount(engine.runtime.water.count);
  }, [engine]);

  const minutesUntil = useCallback((r: Reminder) => engine.minutesUntil(r, Date.now()), [engine]);

  return { config, updateConfig, active, acknowledge, snooze, preview, logWater, waterCount, away, minutesUntil, tickCount };
}
