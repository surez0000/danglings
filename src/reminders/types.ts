/* Reminder data model + persistence. Pure data — no React, no Tauri. */

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // Sunday = 0, like Date#getDay

export type Schedule =
  | { type: "interval"; minutes: number }
  | { type: "times"; times: string[]; days: Weekday[] }; // "HH:MM" 24h

export type ReminderKind = "water" | "move" | "eyes" | "custom";

export type Reminder = {
  id: string;
  kind: ReminderKind;
  name: string;
  emoji: string;
  message: string;
  enabled: boolean;
  schedule: Schedule;
  /* Interval reminders only: a spell away from the desk (idle past
     awayAfterMin) restarts the clock — you already moved / looked away. */
  resetOnAway: boolean;
};

export type RemindersConfig = {
  version: 1;
  enabled: boolean;
  reminders: Reminder[];
  waterTarget: number;
  /* Idle minutes after which you count as away (timers pause; some reset). */
  awayAfterMin: number;
};

/* Runtime counters, persisted so a restart doesn't forget how long you've sat. */
export type RemindersRuntime = {
  /* Active desk seconds accumulated per interval reminder. */
  counters: Record<string, number>;
  /* Epoch ms at which a snoozed reminder comes back. */
  snoozedUntil: Record<string, number>;
  /* Fixed-time reminders: "<date> <HH:MM>" of the last fired/skipped slot. */
  lastFired: Record<string, string>;
  water: { date: string; count: number };
};

export const REMINDERS_CONFIG_KEY = "danglings.reminders";
export const REMINDERS_RUNTIME_KEY = "danglings.reminders.state";

export const WEEKDAY_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;
export const WORKDAYS: Weekday[] = [1, 2, 3, 4, 5];

export const DEFAULT_REMINDERS: Reminder[] = [
  {
    id: "water",
    kind: "water",
    name: "Water",
    emoji: "💧",
    message: "Time for a glass of water.",
    enabled: true,
    schedule: { type: "interval", minutes: 45 },
    resetOnAway: false,
  },
  {
    id: "move",
    kind: "move",
    name: "Move",
    emoji: "🚶",
    message: "You've been sitting a while. Stand up, stretch, walk a little.",
    enabled: true,
    schedule: { type: "interval", minutes: 50 },
    resetOnAway: true,
  },
  {
    id: "eyes",
    kind: "eyes",
    name: "Eye rest",
    emoji: "👀",
    message: "Look at something 20 feet away for 20 seconds.",
    enabled: false,
    schedule: { type: "interval", minutes: 20 },
    resetOnAway: true,
  },
];

export function defaultConfig(): RemindersConfig {
  return {
    version: 1,
    enabled: true,
    reminders: DEFAULT_REMINDERS.map((r) => ({ ...r, schedule: { ...r.schedule } })),
    waterTarget: 8,
    awayAfterMin: 5,
  };
}

export function defaultRuntime(): RemindersRuntime {
  return { counters: {}, snoozedUntil: {}, lastFired: {}, water: { date: localDateKey(new Date()), count: 0 } };
}

export function localDateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function loadConfig(): RemindersConfig {
  const base = defaultConfig();
  try {
    const raw = localStorage.getItem(REMINDERS_CONFIG_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<RemindersConfig>;
    const savedList = Array.isArray(saved.reminders) ? saved.reminders : [];
    // Built-ins are matched by id so a future default (new builtin) still
    // appears for existing users; user edits to a builtin win over defaults.
    const merged: Reminder[] = base.reminders.map((d) => {
      const s = savedList.find((r) => r && r.id === d.id);
      return s ? { ...d, ...s, schedule: { ...d.schedule, ...s.schedule } } : d;
    });
    for (const r of savedList) {
      if (r && r.kind === "custom" && r.id && !merged.some((m) => m.id === r.id)) merged.push(r);
    }
    return {
      version: 1,
      enabled: saved.enabled ?? base.enabled,
      reminders: merged,
      waterTarget: typeof saved.waterTarget === "number" ? saved.waterTarget : base.waterTarget,
      awayAfterMin: typeof saved.awayAfterMin === "number" ? saved.awayAfterMin : base.awayAfterMin,
    };
  } catch {
    return base;
  }
}

export function saveConfig(c: RemindersConfig): void {
  try {
    localStorage.setItem(REMINDERS_CONFIG_KEY, JSON.stringify(c));
  } catch {
    // storage unavailable — reminders still work for this session
  }
}

export function loadRuntime(): RemindersRuntime {
  const base = defaultRuntime();
  try {
    const raw = localStorage.getItem(REMINDERS_RUNTIME_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<RemindersRuntime>;
    return {
      counters: saved.counters ?? {},
      snoozedUntil: saved.snoozedUntil ?? {},
      lastFired: saved.lastFired ?? {},
      water: saved.water && typeof saved.water.count === "number" ? saved.water : base.water,
    };
  } catch {
    return base;
  }
}

export function saveRuntime(r: RemindersRuntime): void {
  try {
    localStorage.setItem(REMINDERS_RUNTIME_KEY, JSON.stringify(r));
  } catch {
    // ignore
  }
}

export function newCustomId(): string {
  return `c-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

export function describeSchedule(s: Schedule): string {
  if (s.type === "interval") {
    if (s.minutes % 60 === 0) return `every ${s.minutes / 60} h`;
    return `every ${s.minutes} min`;
  }
  const days = [...s.days].sort();
  let dayText: string;
  if (days.length === 7) dayText = "daily";
  else if (days.length === 5 && WORKDAYS.every((d) => days.includes(d))) dayText = "Mon–Fri";
  else if (days.length === 0) dayText = "no days";
  else dayText = days.map((d) => WEEKDAY_SHORT[d]).join(" ");
  return `${s.times.join(", ")} · ${dayText}`;
}

/* "9:5" / "09:05" / "9.05" -> "09:05"; null when unparseable. */
export function normalizeTime(input: string): string | null {
  const m = input.trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}
