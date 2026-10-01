// v0.1 session format (src/core/sessions.ts `StoredSession`), for one-time import.
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import type { ChatMessage, Language, UsageTotals } from "../../shared/records";
import { LANGUAGES } from "../../shared/records";
import { DEFAULT_TITLES, type SessionFile } from "./files";

/** Copied here so the records module does not depend on the legacy store. */
export interface LegacyDisplayMessage {
  role: "user" | "tutor";
  text: string;
  model?: string;
  error?: string;
  at: number;
}

export interface LegacyStoredSession {
  v: 1;
  id: string;
  title: string;
  language: Language;
  createdAt: number;
  updatedAt: number;
  transcript: Message[];
  display: LegacyDisplayMessage[];
  usage: UsageTotals;
}

function isLegacy(v: unknown): v is LegacyStoredSession {
  const s = v as LegacyStoredSession;
  return (
    typeof s === "object" &&
    s !== null &&
    typeof s.id === "string" &&
    s.id !== "" &&
    LANGUAGES.includes(s.language) &&
    Array.isArray(s.display)
  );
}

/** Reads every parseable v0.1 session in `dir` (missing dir → []). */
export async function readLegacySessions(dir: string): Promise<LegacyStoredSession[]> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const out: LegacyStoredSession[] = [];
  for (const n of names.sort()) {
    try {
      const raw: unknown = JSON.parse(await readFile(join(dir, n), "utf8"));
      if (isLegacy(raw)) out.push(raw);
    } catch {
      // Unreadable legacy file: skip it, never block the import.
    }
  }
  return out;
}

export function legacyToSessionFile(s: LegacyStoredSession): SessionFile {
  const createdAt = typeof s.createdAt === "number" ? s.createdAt : Date.now();
  const messages: ChatMessage[] = s.display.map((d) => {
    const m: ChatMessage = {
      id: randomUUID(),
      sessionId: s.id,
      role: d.role === "user" ? "user" : "tutor",
      text: String(d.text ?? ""),
      at: typeof d.at === "number" ? d.at : createdAt,
    };
    if (m.role === "tutor") {
      if (d.model) m.model = d.model;
      if (d.error) m.error = d.error;
    }
    return m;
  });
  const usage = s.usage ?? { input: 0, output: 0, cost: 0 };
  return {
    meta: {
      id: s.id,
      language: s.language,
      kind: "chat",
      title: typeof s.title === "string" && s.title ? s.title : DEFAULT_TITLES[s.language],
      createdAt,
      updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : createdAt,
      feedbackMode: "inline",
      activeMs: 0,
      usage: { input: usage.input ?? 0, output: usage.output ?? 0, cost: usage.cost ?? 0 },
    },
    messages,
    transcript: Array.isArray(s.transcript) ? s.transcript : [],
    targets: [],
  };
}
