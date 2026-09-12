import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createRope, stepRope, type RopePoint } from "./useRope";
import { DEFAULT_CHARMS, ritualFor, type Charm, type RitualType } from "./charms";
import { playRitualSound } from "./sound";
import { CharmGlyph } from "./charmArt";
// Bundle boundary: App may statically import only types/companionStore/BirdGlyph
// from src/companion — BirdCompanion (and through it three.js) stays lazy.
import { COMPANIONS, type CompanionSelection } from "./companion/types";
import { loadCompanion, saveCompanion } from "./companion/companionStore";
import { BirdGlyph } from "./companion/BirdGlyph";
import "./App.css";

const BirdCompanion = lazy(() => import("./companion/BirdCompanion"));

const MAX_TILT_DEG = 22;

/* Fallback until get_stage_size reports the real top inset: on macOS the
   overlay window extends under the menu bar (which always draws above it), so
   everything hangs from below that hidden strip. */
const ANCHOR_Y = 0;
const CHARM_INDEX = 6;
const MARGIN = 26;

export type CharmSize = "small" | "medium" | "large";

const SIZE_PX: Record<CharmSize, number> = { small: 24, medium: 40, large: 56 };

type Settings = {
  size: CharmSize;
  windEnabled: boolean;
  windIntensity: number;
  anchorRatio: number;
};

const DEFAULT_SETTINGS: Settings = {
  size: "small",
  windEnabled: true,
  windIntensity: 1,
  anchorRatio: 0.5,
};

function loadCharm(): Charm {
  try {
    const saved = localStorage.getItem("danglings.charm");
    if (saved) return JSON.parse(saved);
  } catch {
    // ignore corrupt storage
  }
  return DEFAULT_CHARMS[0];
}

function loadSettings(): Settings {
  try {
    const saved = localStorage.getItem("danglings.settings");
    if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
  } catch {
    // ignore corrupt storage
  }
  return DEFAULT_SETTINGS;
}

export default function App() {
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null);
  const [anchorX, setAnchorX] = useState(400);
  const [anchorY, setAnchorY] = useState(ANCHOR_Y);
  const [charm, setCharm] = useState<Charm>(loadCharm);
  const [companion, setCompanion] = useState<CompanionSelection>(loadCompanion);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [moving, setMoving] = useState(false);
  const [customEmoji, setCustomEmoji] = useState("");
  const [activeRitual, setActiveRitual] = useState<RitualType | null>(null);
  const [charmPos, setCharmPos] = useState({ x: 400, y: ANCHOR_Y + CHARM_INDEX * 16 });
  const [tilt, setTilt] = useState(0);
  const [lean, setLean] = useState({ x: 0, y: 0 });

  const pointsRef = useRef<RopePoint[]>(createRope(anchorX, ANCHOR_Y));
  const anchorXRef = useRef(anchorX);
  const settingsRef = useRef(settings);
  const dragIndexRef = useRef<number | null>(null);
  const dragPosRef = useRef<{ x: number; y: number } | null>(null);
  const anchorDraggingRef = useRef(false);
  const menuOpenRef = useRef(false);
  const downRef = useRef<{ x: number; y: number } | null>(null);
  const timeRef = useRef(0);
  const frameCountRef = useRef(0);

  const sizePx = SIZE_PX[settings.size];

  useEffect(() => {
    settingsRef.current = settings;
    localStorage.setItem("danglings.settings", JSON.stringify(settings));
  }, [settings]);

  // The menu (and move mode) must keep the window interactive for the whole
  // screen, no matter what the pointer handlers around them did.
  useEffect(() => {
    menuOpenRef.current = menuOpen;
    invoke("set_force_interactive", { active: menuOpen || moving }).catch(() => {});
  }, [menuOpen, moving]);

  useEffect(() => {
    invoke<[number, number, number]>("get_stage_size").then(([w, h, topInset]) => {
      const x = Math.min(Math.max(settingsRef.current.anchorRatio * w, MARGIN), w - MARGIN);
      anchorXRef.current = x;
      setAnchorX(x);
      setAnchorY(topInset);
      pointsRef.current = createRope(x, topInset);
      setStage({ width: w, height: h });
    });
  }, []);

  useEffect(() => {
    localStorage.setItem("danglings.charm", JSON.stringify(charm));
  }, [charm]);

  useEffect(() => {
    saveCompanion(companion);
  }, [companion]);

  useEffect(() => {
    // In bird mode BirdCompanion owns the only loop (and hit-point sends).
    if (!stage || companion.kind !== "charm") return;
    let raf = 0;
    const bounds = { width: stage.width, height: stage.height, margin: MARGIN };
    const tick = () => {
      // Freeze the physics while the picker is open — selecting a card on a
      // swinging target is miserable, and the menu is anchored to the charm.
      if (menuOpenRef.current) {
        raf = requestAnimationFrame(tick);
        return;
      }
      timeRef.current += 1;
      frameCountRef.current += 1;
      const { windEnabled, windIntensity, size } = settingsRef.current;
      const wind = windEnabled ? Math.sin(timeRef.current * 0.02) * 0.06 * windIntensity : 0;
      stepRope(pointsRef.current, anchorXRef.current, anchorY, wind, dragIndexRef.current, dragPosRef.current, bounds);
      const tip = pointsRef.current[CHARM_INDEX];
      setCharmPos({ x: tip.x, y: tip.y });

      const velocityX = tip.x - tip.px;
      const swingTilt = Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, velocityX * 3.2));
      setTilt(swingTilt);

      if (frameCountRef.current % 2 === 0) {
        const points = pointsRef.current.map((p) => [p.x, p.y] as [number, number]);
        points.push([tip.x, tip.y + SIZE_PX[size] / 2]);
        invoke("update_hit_points", { points }).catch(() => {});
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stage, anchorY, companion.kind]);

  useEffect(() => {
    const unlisten = listen("recenter", () => {
      if (!stage) return;
      const x = stage.width / 2;
      anchorXRef.current = x;
      setAnchorX(x);
      setSettings((s) => ({ ...s, anchorRatio: 0.5 }));
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [stage]);

  const setForceInteractive = (active: boolean) => {
    invoke("set_force_interactive", { active }).catch(() => {});
  };

  const onCharmPointerDown = (e: React.PointerEvent) => {
    // Only the left button drags — a right-click must not start a drag, and its
    // release must not reset force-interactive while the menu it opened is up
    // (that made the window click-through and sent clicks to the app behind).
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragIndexRef.current = CHARM_INDEX;
    dragPosRef.current = { x: e.clientX, y: e.clientY };
    downRef.current = { x: e.clientX, y: e.clientY };
    setForceInteractive(true);
    setMenuOpen(false);
  };

  const onCharmPointerMove = (e: React.PointerEvent) => {
    if (dragIndexRef.current !== null) {
      dragPosRef.current = { x: e.clientX, y: e.clientY };
      return;
    }
    const dx = e.clientX - charmPos.x;
    const dy = e.clientY - (charmPos.y + sizePx / 2);
    const dist = Math.hypot(dx, dy) || 1;
    const pull = Math.min(dist / 60, 1) * 7;
    setLean({ x: -(dx / dist) * pull, y: -(dy / dist) * pull * 0.4 });
  };

  const onCharmPointerLeave = () => {
    setLean({ x: 0, y: 0 });
  };

  const triggerRitual = (ritual: RitualType) => {
    setActiveRitual(ritual);
    playRitualSound(ritual);
    setTimeout(() => setActiveRitual(null), 900);
  };

  const onCharmPointerUp = (e: React.PointerEvent) => {
    if (dragIndexRef.current === null) return;
    dragIndexRef.current = null;
    dragPosRef.current = null;
    setForceInteractive(false);
    const down = downRef.current;
    if (down) {
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved < 4) {
        triggerRitual(ritualFor(charm));
      }
    }
    downRef.current = null;
  };

  const onCharmContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenuOpen((v) => {
      const next = !v;
      setForceInteractive(next);
      return next;
    });
  };

  const onAnchorPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    anchorDraggingRef.current = true;
    setForceInteractive(true);
  };

  const onAnchorPointerMove = (e: React.PointerEvent) => {
    if (!anchorDraggingRef.current || !stage) return;
    const x = Math.min(Math.max(e.clientX, MARGIN), stage.width - MARGIN);
    anchorXRef.current = x;
    setAnchorX(x);
  };

  const onAnchorPointerUp = () => {
    anchorDraggingRef.current = false;
    setForceInteractive(false);
    if (stage) {
      setSettings((s) => ({ ...s, anchorRatio: anchorXRef.current / stage.width }));
    }
  };

  const chooseCharm = (c: Charm) => {
    setCharm(c);
    setCompanion({ kind: "charm" });
    setMenuOpen(false);
    setForceInteractive(false);
  };

  const chooseCompanion = (c: CompanionSelection) => {
    setCompanion(c);
    setMenuOpen(false);
    setForceInteractive(false);
  };

  const applyCustomEmoji = () => {
    const trimmed = customEmoji.trim();
    if (!trimmed) return;
    setCharm({
      id: "custom",
      emoji: trimmed,
      name: "Custom",
      ritual: "sparkle",
      region: "Your own",
      description: "A charm of your own choosing, hung on the same thread as the rest.",
      actionLabel: "Give it a shake",
    });
    setCompanion({ kind: "charm" });
    setCustomEmoji("");
    setMenuOpen(false);
    setForceInteractive(false);
  };

  const closeMenu = () => {
    setMenuOpen(false);
    setForceInteractive(false);
  };

  // Move mode: a full-screen capture layer follows the pointer with the anchor
  // (the rope/swing tracks it live) until a click places it.
  const beginMove = () => {
    setMenuOpen(false);
    setMoving(true);
  };

  const onMoveMove = (e: React.PointerEvent) => {
    if (!stage) return;
    const x = Math.min(Math.max(e.clientX, MARGIN), stage.width - MARGIN);
    anchorXRef.current = x;
    setAnchorX(x);
  };

  const onMoveConfirm = () => {
    setMoving(false);
    if (stage) {
      setSettings((s) => ({ ...s, anchorRatio: anchorXRef.current / stage.width }));
    }
  };

  if (!stage) return null;

  const rope = pointsRef.current;
  const points = rope.map((p) => `${p.x},${p.y}`).join(" ");
  const charmCenterY = charmPos.y + sizePx / 2;
  const birdMode = companion.kind === "companion";
  // Menu anchor: companion mode uses the coords BirdCompanion passes to
  // onRequestMenu (already offset below the model); charm mode keeps the
  // existing charm math.
  const menuAnchorX = birdMode && menuPos ? menuPos.x : charmPos.x;
  const menuTopRaw = birdMode && menuPos ? menuPos.y : charmPos.y + sizePx + 18;
  const menuLeft = Math.min(Math.max(menuAnchorX - 145, 12), stage.width - 302);
  // The menu scrolls within a capped height and always fits on screen (32 =
  // .menu vertical padding, content-box).
  const menuMaxH = Math.min(640, Math.round(stage.height * 0.8));
  const menuTop = Math.max(12, Math.min(menuTopRaw, stage.height - menuMaxH - 48));

  return (
    <div
      className="stage"
      style={{ width: stage.width, height: stage.height }}
      onPointerDown={() => menuOpen && closeMenu()}
    >
      {!birdMode && (
        <svg className="thread" width={stage.width} height={stage.height}>
          <polyline points={points} fill="none" stroke="rgba(20,16,12,0.55)" strokeWidth={3.2} strokeLinecap="round" />
          <polyline points={points} fill="none" stroke="rgba(255,250,240,0.85)" strokeWidth={1.1} strokeLinecap="round" />
          <circle cx={charmPos.x} cy={charmPos.y} r={2.6} fill="rgba(20,16,12,0.8)" />
          <circle cx={charmPos.x} cy={charmPos.y} r={1.2} fill="rgba(255,250,240,0.9)" />
        </svg>
      )}

      <div
        className="anchor-handle"
        style={{ left: anchorX, top: anchorY }}
        onPointerDown={onAnchorPointerDown}
        onPointerMove={onAnchorPointerMove}
        onPointerUp={onAnchorPointerUp}
        title="Drag to move along the top"
      />

      {!birdMode && activeRitual === "sparkle" && (
        <div className="sparkle-burst" style={{ left: charmPos.x, top: charmCenterY }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="spark" style={{ "--i": i } as React.CSSProperties} />
          ))}
        </div>
      )}
      {!birdMode && activeRitual === "chime" && (
        <div className="chime-rings" style={{ left: charmPos.x, top: charmCenterY }}>
          <span className="ring" />
          <span className="ring ring-delay" />
        </div>
      )}

      {!birdMode && (
        <div
          data-charm
          className="charm"
          style={{
            left: charmPos.x,
            top: charmPos.y,
            transform: `translate(-50%, -2px) translate(${lean.x}px, ${lean.y}px) rotateZ(${(tilt + lean.x * 0.6).toFixed(2)}deg) rotateY(${(tilt * 1.3).toFixed(2)}deg)`,
          }}
          onPointerDown={onCharmPointerDown}
          onPointerMove={onCharmPointerMove}
          onPointerUp={onCharmPointerUp}
          onPointerLeave={onCharmPointerLeave}
          onContextMenu={onCharmContextMenu}
          title={`${charm.name} — click for a ritual, right-click to change`}
        >
          <span className={`charm-inner ${activeRitual ? `ritual-${activeRitual}` : "idle"}`}>
            <CharmGlyph charm={charm} size={sizePx} />
          </span>
        </div>
      )}

      {companion.kind === "companion" && (
        <Suspense fallback={null}>
          <BirdCompanion
            stage={stage}
            anchorX={anchorX}
            anchorY={anchorY}
            companionId={companion.id}
            size={settings.size}
            paused={menuOpen}
            windEnabled={settings.windEnabled}
            windIntensity={settings.windIntensity}
            onRequestMenu={(x, y) => {
              setMenuPos({ x, y });
              setMenuOpen(true);
              setForceInteractive(true);
            }}
            setForceInteractive={setForceInteractive}
          />
        </Suspense>
      )}

      {moving && (
        <div className="move-capture" onPointerMove={onMoveMove} onPointerDown={onMoveConfirm}>
          <div className="move-marker" style={{ left: anchorX, top: anchorY }}>
            <span className="move-bead" />
            <span className="move-hint">click to place</span>
          </div>
        </div>
      )}

      {menuOpen && (
        <div
          className="menu"
          style={{
            left: menuLeft,
            top: menuTop,
            maxHeight: menuMaxH,
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="menu-arrow" style={{ left: Math.min(133, menuAnchorX - Math.max(menuAnchorX - 145, 12) - 8) }} />
          <p className="menu-label">companions</p>
          <div className="companion-row">
            <button
              className={`companion-card ${companion.kind === "charm" ? "active" : ""}`}
              onClick={() => chooseCompanion({ kind: "charm" })}
            >
              <span className="companion-thumb">
                <CharmGlyph charm={charm} size={30} />
              </span>
              <span className="companion-name">Classic charm</span>
              <span className="companion-desc">Your lucky charm on its thread, right where you left it.</span>
              <span className="companion-action">Hang it up</span>
            </button>
            {COMPANIONS.map((c) => (
              <button
                key={c.id}
                className={`companion-card ${companion.kind === "companion" && companion.id === c.id ? "active" : ""}`}
                onClick={() => chooseCompanion({ kind: "companion", id: c.id })}
              >
                <span className="companion-thumb">
                  {c.id === "bluebird" ? <BirdGlyph size={30} /> : <span className="companion-emoji">{c.emoji}</span>}
                </span>
                <span className="companion-name">{c.name}</span>
                <span className="companion-desc">{c.description}</span>
                <span className="companion-action">{c.actionLabel}</span>
              </button>
            ))}
          </div>
          <div className="menu-divider" />
          <p className="menu-label">choose a charm</p>
          <div className="roster">
            {DEFAULT_CHARMS.map((c) => (
              <button
                key={c.id}
                className={`roster-card ${c.id === charm.id ? "active" : ""}`}
                onClick={() => chooseCharm(c)}
              >
                <span className="roster-glyph">
                  <span className="roster-cord" />
                  <span className="roster-bead" />
                  <span className="roster-emoji">
                    <CharmGlyph charm={c} size={30} />
                  </span>
                </span>
                <span className="roster-name">{c.name}</span>
                <span className="roster-tag">{c.region}</span>
                <span className="roster-desc">{c.description}</span>
                <span className="roster-action">{c.actionLabel}</span>
              </button>
            ))}
          </div>
          <div className="menu-divider" />
          <p className="menu-label">or type your own</p>
          <div className="menu-custom">
            <input
              value={customEmoji}
              placeholder="😀"
              maxLength={4}
              onChange={(e) => setCustomEmoji(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyCustomEmoji()}
            />
            <button className="menu-set" onClick={applyCustomEmoji}>
              Set
            </button>
          </div>
          <div className="menu-divider" />
          <p className="menu-label">settings</p>
          <div className="menu-settings">
            <div className="setting-row">
              <span className="setting-name">Size</span>
              <div className="size-options">
                {(Object.keys(SIZE_PX) as CharmSize[]).map((s) => (
                  <button
                    key={s}
                    className={`size-btn ${settings.size === s ? "active" : ""}`}
                    title={s}
                    onClick={() => setSettings((prev) => ({ ...prev, size: s }))}
                  >
                    {s.charAt(0).toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="setting-row">
              <span className="setting-name">Idle sway</span>
              <button
                className={`toggle ${settings.windEnabled ? "on" : ""}`}
                aria-pressed={settings.windEnabled}
                onClick={() => setSettings((prev) => ({ ...prev, windEnabled: !prev.windEnabled }))}
              >
                <span className="toggle-knob" />
              </button>
            </div>
            <div className={`setting-row ${settings.windEnabled ? "" : "dimmed"}`}>
              <span className="setting-name">Sway strength</span>
              <input
                type="range"
                min={0.2}
                max={2}
                step={0.1}
                value={settings.windIntensity}
                disabled={!settings.windEnabled}
                onChange={(e) => setSettings((prev) => ({ ...prev, windIntensity: Number(e.target.value) }))}
              />
            </div>
            <button className="menu-move" onClick={beginMove}>
              Move hanging spot
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
