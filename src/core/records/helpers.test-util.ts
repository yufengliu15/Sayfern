// Shared test helpers (not a test file itself).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatMessage } from "../../shared/records";
import { JsonRecordsStore } from "./store";

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "sayfern-records-"));
}

/** A store with a settable clock. */
export function makeStore(start = new Date(2026, 8, 30, 15, 0).getTime(), dir = tempDir()) {
  const clock = { t: start };
  const store = new JsonRecordsStore({ dataDir: dir, now: () => clock.t });
  return { store, clock, dir };
}

/** Local time `daysAgo` days before 2026-09-30 at `hour`:00. */
export function day(daysAgo: number, hour = 10): number {
  return new Date(2026, 8, 30 - daysAgo, hour).getTime();
}

let n = 0;
export function msg(sessionId: string, role: ChatMessage["role"], text: string, at: number, id?: string): ChatMessage {
  return { id: id ?? `m${++n}`, sessionId, role, text, at };
}
