import {
  localDateKey,
  type Reminder,
  type RemindersConfig,
  type RemindersRuntime,
} from "./types";

/* Desk-time reminder scheduler. Pure: fed (now, dt, idle) by a 5s timer in
   useReminders and never touches the DOM. Time only counts while you are AT
   the desk (some input within ACTIVE_IDLE_MAX_S); an away spell pauses every
   clock and restarts the ones where leaving already did the job (move, eyes).

   Delivery is one bubble at a time: `presented` holds the id on screen and the
   engine stays quiet until acknowledge/snooze clears it. */

export const TICK_MS = 5000;
/* Idle seconds under which you still count as present (reading, thinking). */
export const ACTIVE_IDLE_MAX_S = 120;
/* No reminder in the first minute back at the desk. */
export const RETURN_GRACE_S = 60;
export const SNOOZE_MINUTES = 10;
/* A fixed-time slot fires only within this window after its time; a slot
   missed because the laptop was shut is skipped, not delivered at 6pm. */
export const FIXED_TIME_WINDOW_MIN = 15;
/* A tick after a long sleep must not credit the whole gap as desk time. */
export const MAX_TICK_DT_S = 15;

export type TickInput = {
  now: number; // epoch ms (Date.now)
  dt: number; // seconds since the previous tick
  idle: number; // seconds since the user's last input, from the OS
  canDeliver: boolean; // overlay visible and not paused by the menu
};

export type TickOutput = {
  due: Reminder | null;
  away: boolean;
  /* True when counters/snoozes/water changed — caller persists. */
  changed: boolean;
};

function intervalSeconds(r: Reminder): number {
  return r.schedule.type === "interval" ? r.schedule.minutes * 60 : Infinity;
}

function hm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function minutesOfDay(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export class ReminderEngine {
  config: RemindersConfig;
  runtime: RemindersRuntime;
  away = false;
  returnedAt = 0;
  presented: string | null = null;

  constructor(config: RemindersConfig, runtime: RemindersRuntime) {
    this.config = config;
    this.runtime = runtime;
  }

  setConfig(config: RemindersConfig): void {
    this.config = config;
    const ids = new Set(config.reminders.map((r) => r.id));
    for (const key of Object.keys(this.runtime.counters)) if (!ids.has(key)) delete this.runtime.counters[key];
    for (const key of Object.keys(this.runtime.snoozedUntil)) if (!ids.has(key)) delete this.runtime.snoozedUntil[key];
    if (this.presented && !ids.has(this.presented)) this.presented = null;
  }

  tick(input: TickInput): TickOutput {
    const { now, idle, canDeliver } = input;
    const dt = Math.max(0, Math.min(input.dt, MAX_TICK_DT_S));
    const rt = this.runtime;
    const cfg = this.config;
    let changed = false;

    const active = idle < ACTIVE_IDLE_MAX_S;

    // Away / return detection.
    if (!this.away && idle >= cfg.awayAfterMin * 60) {
      this.away = true;
    } else if (this.away && active) {
      this.away = false;
      this.returnedAt = now;
      for (const r of cfg.reminders) {
        if (r.resetOnAway && r.schedule.type === "interval" && rt.counters[r.id]) {
          rt.counters[r.id] = 0;
          changed = true;
        }
      }
    }

    // Water counter rolls over at local midnight.
    const today = localDateKey(new Date(now));
    if (rt.water.date !== today) {
      rt.water = { date: today, count: 0 };
      changed = true;
    }

    // Accumulate desk time.
    if (cfg.enabled && active && !this.away && dt > 0) {
      for (const r of cfg.reminders) {
        if (!r.enabled || r.schedule.type !== "interval") continue;
        const cap = intervalSeconds(r) * 2;
        const next = Math.min((rt.counters[r.id] ?? 0) + dt, cap);
        if (next !== rt.counters[r.id]) {
          rt.counters[r.id] = next;
          changed = true;
        }
      }
    }

    let due: Reminder | null = null;
    const graceOver = now - this.returnedAt >= RETURN_GRACE_S * 1000;
    const mayDeliver = cfg.enabled && canDeliver && this.presented === null && !this.away && graceOver;

    if (mayDeliver) {
      // 1) Snoozes that have elapsed come back first.
      for (const r of cfg.reminders) {
        const until = rt.snoozedUntil[r.id];
        if (until !== undefined && now >= until) {
          delete rt.snoozedUntil[r.id];
          changed = true;
          if (r.enabled) {
            due = r;
            break;
          }
        }
      }
      // 2) Interval reminders whose desk clock ran out.
      if (!due) {
        for (const r of cfg.reminders) {
          if (!r.enabled || r.schedule.type !== "interval") continue;
          if (rt.snoozedUntil[r.id] !== undefined) continue;
          if ((rt.counters[r.id] ?? 0) >= intervalSeconds(r)) {
            due = r;
            break;
          }
        }
      }
    }

    // 3) Fixed-time slots (evaluated even when delivery is blocked, so a slot
    //    that passes while away is marked skipped rather than firing late).
    const d = new Date(now);
    const nowMin = minutesOfDay(hm(d));
    const weekday = d.getDay();
    for (const r of cfg.reminders) {
      if (r.schedule.type !== "times") continue;
      if (!r.schedule.days.includes(weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6)) continue;
      for (const t of r.schedule.times) {
        const slotMin = minutesOfDay(t);
        if (nowMin < slotMin) continue;
        const key = `${today} ${t}`;
        if (rt.lastFired[r.id] === key) continue;
        // Slots are checked in list order; a slot fired/skipped earlier today
        // has a smaller key than a later one only if times are sorted, so
        // compare on the exact slot instead of ordering.
        if (nowMin >= slotMin + FIXED_TIME_WINDOW_MIN) {
          if (!this.slotSeen(r.id, key)) {
            this.markSlot(r.id, key);
            changed = true;
          }
          continue;
        }
        if (this.slotSeen(r.id, key)) continue;
        if (!due && mayDeliver && r.enabled && rt.snoozedUntil[r.id] === undefined) {
          due = r;
          this.markSlot(r.id, key);
          changed = true;
        }
      }
    }

    if (due) this.presented = due.id;
    return { due, away: this.away, changed };
  }

  /* lastFired stores one key per reminder, but several slots can pass within
     one day; keep a small per-day set encoded in the string. */
  private slotSeen(id: string, key: string): boolean {
    const v = this.runtime.lastFired[id];
    return v !== undefined && v.split("|").includes(key);
  }

  private markSlot(id: string, key: string): void {
    const v = this.runtime.lastFired[id];
    const day = key.slice(0, 10);
    const keep = v ? v.split("|").filter((k) => k.startsWith(day)) : [];
    keep.push(key);
    this.runtime.lastFired[id] = keep.join("|");
  }

  acknowledge(id: string): void {
    this.runtime.counters[id] = 0;
    delete this.runtime.snoozedUntil[id];
    if (this.presented === id) this.presented = null;
  }

  snooze(id: string, now: number, minutes = SNOOZE_MINUTES): void {
    this.runtime.snoozedUntil[id] = now + minutes * 60_000;
    if (this.presented === id) this.presented = null;
  }

  /* Bubble went away without a verdict (e.g. reminders disabled mid-flight). */
  clearPresented(): void {
    this.presented = null;
  }

  logWater(now: number): number {
    const today = localDateKey(new Date(now));
    if (this.runtime.water.date !== today) this.runtime.water = { date: today, count: 0 };
    this.runtime.water.count += 1;
    return this.runtime.water.count;
  }

  /* Minutes until a reminder is next due, for the menu's "in 32 min" line.
     null when it cannot be predicted (disabled, no matching day). */
  minutesUntil(r: Reminder, now: number): number | null {
    if (!r.enabled || !this.config.enabled) return null;
    const snoozed = this.runtime.snoozedUntil[r.id];
    if (snoozed !== undefined) return Math.max(0, Math.ceil((snoozed - now) / 60_000));
    if (r.schedule.type === "interval") {
      const left = intervalSeconds(r) - (this.runtime.counters[r.id] ?? 0);
      return Math.max(0, Math.ceil(left / 60));
    }
    if (r.schedule.days.length === 0 || r.schedule.times.length === 0) return null;
    const d = new Date(now);
    const nowMin = minutesOfDay(hm(d));
    for (let offset = 0; offset < 8; offset++) {
      const day = ((d.getDay() + offset) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
      if (!r.schedule.days.includes(day)) continue;
      const slots = [...r.schedule.times].map(minutesOfDay).sort((a, b) => a - b);
      for (const s of slots) {
        const delta = offset * 1440 + s - nowMin;
        if (delta >= 0) return delta;
      }
    }
    return null;
  }
}
