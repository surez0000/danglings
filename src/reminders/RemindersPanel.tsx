import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { RemindersApi } from "./useReminders";
import {
  WEEKDAY_SHORT,
  WORKDAYS,
  describeSchedule,
  newCustomId,
  normalizeTime,
  type Reminder,
  type Weekday,
} from "./types";

/* The "reminders" tab of the right-click menu. Same aurora-glass vocabulary
   as the rest of the menu (.toggle, .setting-row, .menu-label). */

const INTERVAL_PRESETS: Record<string, number[]> = {
  water: [30, 45, 60, 90],
  move: [30, 45, 50, 60, 90],
  eyes: [15, 20, 30, 45],
  custom: [15, 20, 30, 45, 60, 90, 120, 180],
};

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button className={`toggle ${on ? "on" : ""}`} aria-pressed={on} onClick={onClick}>
      <span className="toggle-knob" />
    </button>
  );
}

function stepPreset(kind: string, minutes: number, dir: -1 | 1): number {
  const presets = INTERVAL_PRESETS[kind] ?? INTERVAL_PRESETS.custom;
  // Nearest preset, then one step in the requested direction.
  let idx = 0;
  let best = Infinity;
  presets.forEach((p, i) => {
    const d = Math.abs(p - minutes);
    if (d < best) {
      best = d;
      idx = i;
    }
  });
  if (presets[idx] !== minutes) {
    // Between presets: step to the neighbour on that side.
    idx = dir > 0 ? presets.findIndex((p) => p > minutes) : presets.length - 1 - [...presets].reverse().findIndex((p) => p < minutes);
    if (idx < 0 || idx >= presets.length) return minutes;
    return presets[idx];
  }
  const next = Math.min(Math.max(idx + dir, 0), presets.length - 1);
  return presets[next];
}

function ReminderRow({ r, api }: { r: Reminder; api: RemindersApi }) {
  const due = api.minutesUntil(r);
  const live = r.enabled && api.config.enabled;
  const patch = (fn: (x: Reminder) => Reminder) =>
    api.updateConfig((c) => ({ ...c, reminders: c.reminders.map((x) => (x.id === r.id ? fn(x) : x)) }));
  const setMinutes = (minutes: number) => patch((x) => ({ ...x, schedule: { type: "interval", minutes } }));
  const remove = () => api.updateConfig((c) => ({ ...c, reminders: c.reminders.filter((x) => x.id !== r.id) }));

  let dueText = "";
  if (live && due !== null) {
    if (r.schedule.type === "interval") dueText = due === 0 ? "· due" : `· in ${due} min`;
    else dueText = due < 60 ? `· in ${due} min` : due < 1440 ? `· in ${Math.round(due / 60)} h` : `· in ${Math.round(due / 1440)} d`;
  }

  return (
    <div className={`rem-row ${r.enabled ? "" : "dimmed"}`}>
      <span className="rem-emoji">{r.emoji}</span>
      <div className="rem-main">
        <span className="rem-name">{r.name}</span>
        {r.schedule.type === "interval" ? (
          <span className="rem-sub">
            {r.kind === "move" ? "after" : "every"}
            <span className="stepper">
              <button title="Less often" onClick={() => setMinutes(stepPreset(r.kind, r.schedule.type === "interval" ? r.schedule.minutes : 60, -1))}>
                −
              </button>
              <b>{r.schedule.minutes}</b>
              <button title="More often" onClick={() => setMinutes(stepPreset(r.kind, r.schedule.type === "interval" ? r.schedule.minutes : 60, 1))}>
                +
              </button>
            </span>
            min {dueText}
          </span>
        ) : (
          <span className="rem-sub">
            {describeSchedule(r.schedule)} {dueText}
          </span>
        )}
      </div>
      <div className="rem-ctl">
        <button className="icon-btn" title="Preview this reminder" onClick={() => api.preview(r)}>
          ▶
        </button>
        {r.kind === "custom" && (
          <button className="icon-btn danger" title="Delete" onClick={remove}>
            ×
          </button>
        )}
        <Toggle on={r.enabled} onClick={() => patch((x) => ({ ...x, enabled: !x.enabled }))} />
      </div>
    </div>
  );
}

function AddReminder({ api, onDone }: { api: RemindersApi; onDone: () => void }) {
  const [emoji, setEmoji] = useState("⏰");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"interval" | "times">("interval");
  const [minutes, setMinutes] = useState(60);
  const [times, setTimes] = useState("10:00");
  const [days, setDays] = useState<Weekday[]>(WORKDAYS);
  const [error, setError] = useState<string | null>(null);

  const focus = () => invoke("focus_window").catch(() => {});

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give it a name.");
      return;
    }
    let schedule: Reminder["schedule"];
    if (mode === "interval") {
      schedule = { type: "interval", minutes };
    } else {
      const parsed = times
        .split(",")
        .map((t) => normalizeTime(t))
        .filter((t): t is string => t !== null);
      if (parsed.length === 0) {
        setError("Times look like 10:00, 15:30.");
        return;
      }
      if (days.length === 0) {
        setError("Pick at least one day.");
        return;
      }
      schedule = { type: "times", times: [...new Set(parsed)].sort(), days: [...days].sort() };
    }
    const r: Reminder = {
      id: newCustomId(),
      kind: "custom",
      name: trimmed,
      emoji: emoji.trim() || "⏰",
      message: mode === "interval" ? `${trimmed} — every ${minutes} min.` : `${trimmed}.`,
      enabled: true,
      schedule,
      resetOnAway: false,
    };
    api.updateConfig((c) => ({ ...c, reminders: [...c.reminders, r] }));
    onDone();
  };

  return (
    <div className="rem-add">
      <div className="rem-add-row">
        <input className="emoji" value={emoji} maxLength={4} onPointerDown={focus} onChange={(e) => setEmoji(e.target.value)} />
        <input
          className="grow"
          placeholder="Eye drops, stand-up, call mum…"
          value={name}
          onPointerDown={focus}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
      </div>
      <div className="rem-add-row">
        <span className="seg">
          <button className={mode === "interval" ? "active" : ""} onClick={() => setMode("interval")}>
            every
          </button>
          <button className={mode === "times" ? "active" : ""} onClick={() => setMode("times")}>
            at times
          </button>
        </span>
        {mode === "interval" ? (
          <span className="rem-sub">
            <span className="stepper">
              <button onClick={() => setMinutes((m) => stepPreset("custom", m, -1))}>−</button>
              <b>{minutes}</b>
              <button onClick={() => setMinutes((m) => stepPreset("custom", m, 1))}>+</button>
            </span>
            min
          </span>
        ) : (
          <input
            className="grow"
            placeholder="10:00, 15:30"
            value={times}
            onPointerDown={focus}
            onChange={(e) => {
              setTimes(e.target.value);
              setError(null);
            }}
          />
        )}
      </div>
      {mode === "times" && (
        <div className="day-chips">
          {WEEKDAY_SHORT.map((label, i) => {
            const d = i as Weekday;
            const on = days.includes(d);
            return (
              <button
                key={label}
                className={`day-chip ${on ? "on" : ""}`}
                onClick={() => setDays((prev) => (on ? prev.filter((x) => x !== d) : [...prev, d]))}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      {error && <p className="rem-error">{error}</p>}
      <div className="rem-add-row">
        <button className="menu-set" style={{ padding: "6px 14px" }} onClick={add}>
          Add
        </button>
        <button className="mini-btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function RemindersPanel({ api }: { api: RemindersApi }) {
  const [adding, setAdding] = useState(false);
  const cfg = api.config;
  const builtins = cfg.reminders.filter((r) => r.kind !== "custom");
  const customs = cfg.reminders.filter((r) => r.kind === "custom");
  const waterPct = Math.min(100, Math.round((api.waterCount / Math.max(1, cfg.waterTarget)) * 100));

  return (
    <div className="menu-settings">
      <div className="setting-row">
        <span className="setting-name">Reminders</span>
        <Toggle on={cfg.enabled} onClick={() => api.updateConfig((c) => ({ ...c, enabled: !c.enabled }))} />
      </div>
      <p className="setting-hint">
        {api.away
          ? "You're away — the clocks are paused."
          : `Counted in desk time. Everything pauses when you step away for ${cfg.awayAfterMin} min.`}
      </p>

      <div className={`rem-list ${cfg.enabled ? "" : "dimmed"}`}>
        {builtins.map((r) => (
          <ReminderRow key={r.id} r={r} api={api} />
        ))}
      </div>

      <div className="rem-water">
        <span>💧</span>
        <span className="grow">
          <span>
            <b>{api.waterCount}</b> / {cfg.waterTarget} glasses today
          </span>
          <span className="rem-water-bar">
            <span style={{ width: `${waterPct}%` }} />
          </span>
        </span>
        <button className="mini-btn" onClick={api.logWater}>
          +1 glass
        </button>
      </div>

      <div className="menu-divider" />
      <p className="menu-label">your own</p>
      <div className={`rem-list ${cfg.enabled ? "" : "dimmed"}`}>
        {customs.map((r) => (
          <ReminderRow key={r.id} r={r} api={api} />
        ))}
        {customs.length === 0 && !adding && (
          <p className="setting-hint">Meds, eye drops, the 09:25 stand-up — on an interval or at fixed times.</p>
        )}
      </div>
      {adding ? (
        <AddReminder api={api} onDone={() => setAdding(false)} />
      ) : (
        <button className="menu-move" onClick={() => setAdding(true)}>
          + Add a reminder
        </button>
      )}
    </div>
  );
}
