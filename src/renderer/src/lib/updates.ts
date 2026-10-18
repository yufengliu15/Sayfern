// Automatic update check: once at startup, then once a day while Sayfern stays open. Quiet: a failed check
// shows nothing. The sidebar shows a notice when GitHub has a newer release, until the learner dismisses that version.
// Settings > Preferences > Updates reads and writes the same status.
import { useSyncExternalStore } from "react";
import type { UpdateStatus } from "../../../shared/api";
import { api } from "../api";

const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const DISMISSED_KEY = "sayfern.updates.dismissed";

let status: UpdateStatus | null = null;
let notice: UpdateStatus | null = null;
let dismissed = readDismissed();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function readDismissed() {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function publish() {
  notice = status?.available && status.latest !== dismissed ? status : null;
  listeners.forEach((l) => l());
}

export function setUpdateStatus(next: UpdateStatus): void {
  status = next;
  publish();
}

/** Starts the automatic checks. Safe to call more than once. */
export function startUpdateChecks(): void {
  if (timer) return;
  const check = () => void api.checkForUpdates().then(setUpdateStatus, () => undefined);
  check();
  timer = setInterval(check, CHECK_EVERY_MS);
}

/** Hides the notice for this version. A newer release shows it again. */
export function dismissUpdate(version: string): void {
  dismissed = version;
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    // Not saved: the notice comes back on the next start.
  }
  publish();
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/** The newest check, automatic or from Settings. Null until one succeeds. */
export function useUpdateStatus() {
  return useSyncExternalStore(subscribe, () => status);
}

/** The status when a newer version is out and not dismissed, else null. */
export function useUpdateNotice() {
  return useSyncExternalStore(subscribe, () => notice);
}
