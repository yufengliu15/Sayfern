import { useEffect, useRef, useState, type RefObject } from "react";
import { api } from "../api";

/** Close on Escape or on a pointer-down outside `ref` (and any `also` elements). */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
  also: RefObject<HTMLElement | null>[] = [],
): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (also.some((r) => r.current?.contains(t))) return;
      close.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ref]);
}

const IDLE_AFTER_MS = 60_000;
const REPORT_EVERY_MS = 15_000;

/**
 * S1-24: counts practice time only while the window is focused, the page is visible and
 * there was keyboard, mouse or scroll input in the last minute. Reports increments via
 * trackActivity every 15 s and on unmount. Returns ms tracked since mount (for display).
 */
export function useActivityTracker(sessionId: string, enabled = true): number {
  const [tracked, setTracked] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let lastInput = Date.now();
    let lastTick = Date.now();
    let pending = 0;
    let total = 0;
    let alive = true;
    const mark = () => {
      lastInput = Date.now();
    };
    const events: (keyof WindowEventMap)[] = ["keydown", "pointermove", "pointerdown", "wheel", "input"];
    for (const ev of events) window.addEventListener(ev, mark, { passive: true, capture: true });
    document.addEventListener("scroll", mark, { passive: true, capture: true });

    const tick = window.setInterval(() => {
      const now = Date.now();
      const dt = Math.min(now - lastTick, 5_000);
      lastTick = now;
      const active = document.hasFocus() && document.visibilityState === "visible" && now - lastInput < IDLE_AFTER_MS;
      if (active) pending += dt;
    }, 1_000);

    const flush = () => {
      if (pending <= 0) return;
      const ms = Math.round(pending);
      pending = 0;
      total += ms;
      if (alive) setTracked(total);
      void api.trackActivity(sessionId, ms).catch(() => {});
    };
    const reporter = window.setInterval(flush, REPORT_EVERY_MS);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      alive = false;
      window.clearInterval(tick);
      window.clearInterval(reporter);
      for (const ev of events) window.removeEventListener(ev, mark, { capture: true });
      document.removeEventListener("scroll", mark, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [sessionId, enabled]);
  return tracked;
}

/** A flag in localStorage that follows `fallback` until the learner sets it. The key may change between renders. */
export function useStoredChoice(key: string, fallback: boolean): [boolean, (v: boolean) => void] {
  const [set, setSet] = useState<Record<string, boolean>>({});
  let stored: boolean | undefined;
  try {
    const raw = localStorage.getItem(key);
    if (raw != null) stored = raw === "1";
  } catch {
    // no storage: follow the fallback
  }
  const save = (v: boolean) => {
    try {
      localStorage.setItem(key, v ? "1" : "0");
    } catch {
      // kept for this screen only
    }
    setSet((cur) => ({ ...cur, [key]: v }));
  };
  return [set[key] ?? stored ?? fallback, save];
}

/** Persist a small UI preference (inspector open, etc.). Never throws. */
export function useStoredFlag(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? initial : raw === "1";
    } catch {
      return initial;
    }
  });
  const set = (next: boolean) => {
    setV(next);
    try {
      localStorage.setItem(key, next ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  };
  return [v, set];
}
