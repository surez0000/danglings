import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CURSOR_EVENT } from "./types";

export type CursorState = {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  lastMoveAt: number;
  speed: number;
};

/* Module-level mutable singleton — the master loop reads it by reference, so a
   cursor event never causes a React re-render. Coordinates are window-local
   logical px and may lie outside the stage (cursor on another monitor); the
   look-at math clamps, which makes the bird gaze toward the correct edge.
   lastMoveAt is on the performance.now() timeline (same clock as rAF). */
export const cursorState: CursorState = {
  x: -10000,
  y: -10000,
  prevX: -10000,
  prevY: -10000,
  lastMoveAt: 0,
  speed: 0,
};

export async function startCursorFeed(onWake: () => void): Promise<() => void> {
  await invoke("set_cursor_stream", { active: true }).catch(() => {});
  const unlisten = await listen<[number, number]>(CURSOR_EVENT, (event) => {
    const [x, y] = event.payload;
    const now = performance.now();
    const dtSec = (now - cursorState.lastMoveAt) / 1000;
    cursorState.speed =
      cursorState.lastMoveAt > 0 && dtSec > 0
        ? Math.hypot(x - cursorState.x, y - cursorState.y) / dtSec
        : 0;
    cursorState.prevX = cursorState.x;
    cursorState.prevY = cursorState.y;
    cursorState.x = x;
    cursorState.y = y;
    cursorState.lastMoveAt = now;
    onWake();
  });
  return () => {
    unlisten();
    invoke("set_cursor_stream", { active: false }).catch(() => {});
  };
}
