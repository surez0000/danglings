import { useLayoutEffect, useRef } from "react";

/* Speech bubble beside the character — the delivery surface for reminders and
   update prompts. Left-click anywhere = primary action, right-click =
   secondary (snooze / later); the explicit buttons exist for discoverability.
   It reports its on-screen rect so App can register it with the Rust hit-test
   (the overlay is click-through everywhere else). */

export type BubbleAction = { label: string; onClick: () => void };

export type BubbleProps = {
  /* Attach point (the character's side) in stage px. */
  x: number;
  y: number;
  /* Which side of the attach point the bubble sits on. */
  side: "left" | "right";
  emoji: string;
  title: string;
  message: string;
  primary?: BubbleAction;
  secondary?: BubbleAction;
  /* undefined = no bar; null = indeterminate; 0..1 = determinate. */
  progress?: number | null;
  /* No clicks while installing. */
  busy?: boolean;
  onRect: (rect: DOMRect | null) => void;
};

export function ReminderBubble(p: BubbleProps) {
  const ref = useRef<HTMLDivElement>(null);
  const onRectRef = useRef(p.onRect);
  onRectRef.current = p.onRect;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    onRectRef.current(el.getBoundingClientRect());
    return () => onRectRef.current(null);
  }, [p.x, p.y, p.side, p.title, p.message, p.busy]);

  const style: React.CSSProperties =
    p.side === "right" ? { left: p.x + 14, top: p.y } : { left: p.x - 14, top: p.y };

  return (
    <div
      ref={ref}
      className={`bubble ${p.side} ${p.busy ? "busy" : ""}`}
      style={style}
      role="button"
      onClick={() => !p.busy && p.primary?.onClick()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!p.busy) p.secondary?.onClick();
      }}
    >
      <span className="bubble-tail" />
      <span className="bubble-emoji">{p.emoji}</span>
      <div className="bubble-body">
        <span className="bubble-title">{p.title}</span>
        <span className="bubble-msg">{p.message}</span>
        {p.progress !== undefined && (
          <span className={`bubble-progress ${p.progress === null ? "indeterminate" : ""}`}>
            <span style={p.progress === null ? undefined : { width: `${Math.round(p.progress * 100)}%` }} />
          </span>
        )}
        {!p.busy && (p.primary || p.secondary) && (
          <span className="bubble-actions">
            {p.primary && (
              <button
                className="bubble-btn primary"
                onClick={(e) => {
                  e.stopPropagation();
                  p.primary!.onClick();
                }}
              >
                {p.primary.label}
              </button>
            )}
            {p.secondary && (
              <button
                className="bubble-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  p.secondary!.onClick();
                }}
              >
                {p.secondary.label}
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
