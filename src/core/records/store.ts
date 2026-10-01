// JSON-file RecordsStore (docs/stage1.md: records/).
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import type {
  AnkiSnapshot,
  ChatMessage,
  Correction,
  GrammarObservation,
  GrammarPoint,
  GrammarSummary,
  Language,
  LearnerProfile,
  LevelEstimate,
  PracticeTarget,
  ProgressRange,
  ProgressStats,
  SavedWord,
  SessionMeta,
  Skill,
  TargetStatus,
  Verdict,
  WordUsage,
} from "../../shared/records";
import { LANGUAGES } from "../../shared/records";
import type {
  CorrectionInput,
  GrammarPointInput,
  NewSessionInput,
  ObservationInput,
  RecordsStore,
} from "../contracts";
import { localDate } from "./dates";
import {
  type ActivityEntry,
  DEFAULT_TITLES,
  type SessionFile,
  titleFrom,
  wordUsageCodec,
  type WritingRow,
} from "./files";
import { compareSummaries, mergeGrammarPoint, newGrammarPoint, stubGrammarPoint, summarizeGrammar } from "./grammar";
import { correctionId, observationId } from "./ids";
import { JsonFile } from "./io";
import { legacyToSessionFile, readLegacySessions } from "./legacy";
import { computeProgress } from "./stats";

export interface JsonRecordsStoreOptions {
  dataDir: string;
  now?: () => number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TARGET_RANK: Record<TargetStatus, number> = { pending: 0, asked: 1, used: 2 };

const clone = <T>(v: T): T => structuredClone(v);

function missingSession(id: string): never {
  throw new Error(`Session not found: ${id}`);
}

export class JsonRecordsStore implements RecordsStore {
  readonly dataDir: string;
  private readonly now: () => number;

  private readonly correctionsFile: JsonFile<Correction[]>;
  private readonly grammarFile: JsonFile<GrammarPoint[]>;
  private readonly observationsFile: JsonFile<GrammarObservation[]>;
  private readonly savedWordsFile: JsonFile<SavedWord[]>;
  private readonly activityFile: JsonFile<ActivityEntry[]>;
  private readonly levelsFile: JsonFile<LevelEstimate[]>;
  private readonly profileFile: JsonFile<LearnerProfile>;
  private readonly usageFiles = new Map<Language, JsonFile<Map<string, WordUsage>>>();
  private readonly writingFiles = new Map<Language, JsonFile<WritingRow[]>>();

  private sessionIndex: Promise<Map<string, JsonFile<SessionFile>>> | null = null;

  constructor(opts: JsonRecordsStoreOptions) {
    this.dataDir = opts.dataDir;
    this.now = opts.now ?? Date.now;
    const f = (name: string) => join(this.dataDir, name);
    this.correctionsFile = new JsonFile(f("corrections.json"), () => []);
    this.grammarFile = new JsonFile(f("grammar.json"), () => []);
    this.observationsFile = new JsonFile(f("observations.json"), () => []);
    this.savedWordsFile = new JsonFile(f("saved-words.json"), () => []);
    this.activityFile = new JsonFile(f("activity.json"), () => []);
    this.levelsFile = new JsonFile(f("levels.json"), () => []);
    this.profileFile = new JsonFile(f("profile.json"), () => ({ about: "", goals: {} }));
  }

  // ============================================================ files

  private usageFile(language: Language): JsonFile<Map<string, WordUsage>> {
    let file = this.usageFiles.get(language);
    if (!file) {
      file = new JsonFile(join(this.dataDir, `word-usage-${language}.json`), () => new Map(), wordUsageCodec);
      this.usageFiles.set(language, file);
    }
    return file;
  }

  private writingFile(language: Language): JsonFile<WritingRow[]> {
    let file = this.writingFiles.get(language);
    if (!file) {
      file = new JsonFile(join(this.dataDir, `writing-${language}.json`), () => []);
      this.writingFiles.set(language, file);
    }
    return file;
  }

  private get sessionsDir(): string {
    return join(this.dataDir, "sessions");
  }

  private sessionPath(id: string): string {
    return join(this.sessionsDir, `${id}.json`);
  }

  private sessions(): Promise<Map<string, JsonFile<SessionFile>>> {
    if (!this.sessionIndex) {
      this.sessionIndex = (async () => {
        const map = new Map<string, JsonFile<SessionFile>>();
        let names: string[] = [];
        try {
          names = await readdir(this.sessionsDir);
        } catch {
          // No sessions yet.
        }
        for (const n of names) {
          if (!n.endsWith(".json")) continue;
          const id = n.slice(0, -5);
          map.set(
            id,
            new JsonFile<SessionFile>(this.sessionPath(id), () => {
              throw new Error(`Session file disappeared: ${id}`);
            }),
          );
        }
        return map;
      })();
    }
    return this.sessionIndex;
  }

  private async sessionFile(id: string): Promise<JsonFile<SessionFile> | null> {
    return (await this.sessions()).get(id) ?? null;
  }

  private async readSession(id: string): Promise<SessionFile | null> {
    const file = await this.sessionFile(id);
    if (!file) return null;
    try {
      return await file.get();
    } catch {
      return null;
    }
  }

  private async updateSessionFile<R>(id: string, fn: (s: SessionFile) => R): Promise<R> {
    const file = await this.sessionFile(id);
    if (!file) missingSession(id);
    return file.update(fn);
  }

  private async allSessions(): Promise<SessionFile[]> {
    const out: SessionFile[] = [];
    for (const id of (await this.sessions()).keys()) {
      const s = await this.readSession(id);
      if (s) out.push(s);
    }
    return out;
  }

  /** Register a new session file and write it (queued before any later update). */
  private async addSessionFile(data: SessionFile): Promise<void> {
    const index = await this.sessions();
    const file = new JsonFile<SessionFile>(this.sessionPath(data.meta.id), () => data);
    index.set(data.meta.id, file);
    await file.update(() => undefined);
  }

  // ============================================================ sessions & messages

  async createSession(input: NewSessionInput): Promise<SessionMeta> {
    const now = this.now();
    const meta: SessionMeta = {
      id: randomUUID(),
      language: input.language,
      kind: input.kind,
      title: input.title?.trim() ? input.title : DEFAULT_TITLES[input.language],
      createdAt: now,
      updatedAt: now,
      feedbackMode: input.feedbackMode,
      activeMs: 0,
      usage: { input: 0, output: 0, cost: 0 },
    };
    if (input.focusGrammarId) meta.focusGrammarId = input.focusGrammarId;
    if (input.openWith) meta.openWith = input.openWith;
    if (input.docId) meta.docId = input.docId;
    await this.addSessionFile({ meta, messages: [], transcript: [], targets: [] });
    return clone(meta);
  }

  async getSession(id: string): Promise<SessionMeta | null> {
    const s = await this.readSession(id);
    return s ? clone(s.meta) : null;
  }

  async listSessions(language: Language): Promise<SessionMeta[]> {
    const cutoff = this.now() - DAY_MS;
    return (await this.allSessions())
      .filter((s) => s.meta.language === language && (s.messages.length > 0 || s.meta.createdAt >= cutoff))
      .map((s) => clone(s.meta))
      .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
  }

  async updateSession(
    id: string,
    patch: Partial<Omit<SessionMeta, "id" | "language" | "createdAt">>,
  ): Promise<SessionMeta> {
    const clean = clone(patch) as Partial<SessionMeta>;
    delete clean.id;
    delete clean.language;
    delete clean.createdAt;
    return this.updateSessionFile(id, (s) => {
      Object.assign(s.meta, clean);
      return clone(s.meta);
    });
  }

  async deleteSession(id: string): Promise<void> {
    const index = await this.sessions();
    const file = index.get(id);
    if (!file) return;
    index.delete(id);
    await file.remove();
    await this.correctionsFile.update((list) => removeWhere(list, (c) => c.sessionId === id));
    await this.observationsFile.update((list) => removeWhere(list, (o) => o.sessionId === id));
    for (const lang of LANGUAGES) {
      await this.writingFile(lang).update((rows) => removeWhere(rows, (r) => r.sessionId === id));
    }
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const s = await this.readSession(sessionId);
    return s ? clone(s.messages) : [];
  }

  async appendMessage(message: ChatMessage): Promise<void> {
    const msg = clone(message);
    const now = this.now();
    await this.updateSessionFile(msg.sessionId, (s) => {
      const existing = s.messages.findIndex((m) => m.id === msg.id);
      const hadUserMessage = s.messages.some((m) => m.role === "user");
      if (existing >= 0) s.messages[existing] = msg;
      else s.messages.push(msg);
      s.meta.updatedAt = now;
      if (msg.role === "user" && !hadUserMessage && s.meta.title === DEFAULT_TITLES[s.meta.language]) {
        const title = titleFrom(msg.text);
        if (title) s.meta.title = title;
      }
    });
  }

  async updateMessage(sessionId: string, messageId: string, patch: Partial<ChatMessage>): Promise<ChatMessage> {
    const p = clone(patch);
    return this.updateSessionFile(sessionId, (s) => {
      const msg = s.messages.find((m) => m.id === messageId);
      if (!msg) throw new Error(`Message not found: ${messageId}`);
      Object.assign(msg, p, { id: messageId, sessionId });
      return clone(msg);
    });
  }

  async getTranscript(sessionId: string): Promise<Message[]> {
    const s = await this.readSession(sessionId);
    return s ? clone(s.transcript) : [];
  }

  async setTranscript(sessionId: string, transcript: Message[]): Promise<void> {
    const t = clone(transcript);
    await this.updateSessionFile(sessionId, (s) => {
      s.transcript = t;
    });
  }

  async addUsage(sessionId: string, usage: { input: number; output: number; cost: number }): Promise<void> {
    await this.updateSessionFile(sessionId, (s) => {
      s.meta.usage.input += usage.input || 0;
      s.meta.usage.output += usage.output || 0;
      s.meta.usage.cost += usage.cost || 0;
    });
  }

  async addActiveTime(sessionId: string, ms: number, at?: number): Promise<void> {
    if (!Number.isFinite(ms) || ms <= 0) return;
    const file = await this.sessionFile(sessionId);
    if (!file) return; // Late activity ping for a deleted session: nothing to record.
    const language = await file.update((s) => {
      s.meta.activeMs += ms;
      return s.meta.language;
    });
    const date = localDate(at ?? this.now());
    await this.activityFile.update((log) => {
      const entry = log.find((e) => e.date === date && e.sessionId === sessionId);
      if (entry) entry.ms += ms;
      else log.push({ date, language, sessionId, ms });
    });
  }

  // ============================================================ corrections

  async addCorrection(input: CorrectionInput): Promise<Correction> {
    const session = await this.getSession(input.sessionId);
    if (!session) missingSession(input.sessionId);
    const id = correctionId(input.messageId, input.original);
    const now = this.now();
    return this.correctionsFile.update((list) => {
      const existing = list.find((c) => c.id === id);
      if (existing) return clone(existing);
      const c: Correction = {
        id,
        language: session.language,
        sessionId: input.sessionId,
        messageId: input.messageId,
        original: input.original,
        corrected: input.corrected,
        explanation: input.explanation,
        kind: input.kind,
        createdAt: now,
        status: "open",
        retries: [],
      };
      if (input.grammarId) c.grammarId = input.grammarId;
      list.push(c);
      return clone(c);
    });
  }

  async getCorrection(id: string): Promise<Correction | null> {
    const c = (await this.correctionsFile.get()).find((x) => x.id === id);
    return c ? clone(c) : null;
  }

  async updateCorrection(id: string, patch: Partial<Correction>): Promise<Correction> {
    const p = clone(patch);
    return this.correctionsFile.update((list) => {
      const c = list.find((x) => x.id === id);
      if (!c) throw new Error(`Correction not found: ${id}`);
      Object.assign(c, p, { id });
      return clone(c);
    });
  }

  async listCorrections(filter: { language: Language; sessionId?: string; grammarId?: string }): Promise<Correction[]> {
    return (await this.correctionsFile.get())
      .filter(
        (c) =>
          c.language === filter.language &&
          (filter.sessionId === undefined || c.sessionId === filter.sessionId) &&
          (filter.grammarId === undefined || c.grammarId === filter.grammarId),
      )
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(clone);
  }

  // ============================================================ grammar

  async upsertGrammarPoint(input: GrammarPointInput): Promise<GrammarPoint> {
    const now = this.now();
    return this.grammarFile.update((list) => {
      const existing = list.find((p) => p.id === input.id);
      if (existing) {
        mergeGrammarPoint(existing, input, now);
        return clone(existing);
      }
      const p = newGrammarPoint(input, now);
      list.push(p);
      return clone(p);
    });
  }

  async getGrammarPoint(id: string): Promise<GrammarPoint | null> {
    const p = (await this.grammarFile.get()).find((x) => x.id === id);
    return p ? clone(p) : null;
  }

  async recordObservations(language: Language, inputs: ObservationInput[]): Promise<GrammarObservation[]> {
    const now = this.now();
    const grammarIds = [...new Set(inputs.map((i) => i.grammarId))];
    // Stub unknown points first so observations are never orphaned.
    await this.grammarFile.update((list) => {
      for (const gid of grammarIds) {
        if (!list.some((p) => p.id === gid)) list.push(stubGrammarPoint(gid, language, now));
      }
    });
    return this.observationsFile.update((list) => {
      const seen = new Set(list.map((o) => o.id));
      const added: GrammarObservation[] = [];
      for (const input of inputs) {
        const id = observationId(input.messageId, input.grammarId, input.span);
        if (seen.has(id)) continue;
        seen.add(id);
        const o: GrammarObservation = {
          id,
          grammarId: input.grammarId,
          language,
          sessionId: input.sessionId,
          messageId: input.messageId,
          span: input.span,
          verdict: input.verdict,
          assistance: input.assistance,
          at: input.at ?? now,
        };
        if (input.note) o.note = input.note;
        list.push(o);
        added.push(o);
      }
      return clone(added);
    });
  }

  async listObservations(filter: {
    language: Language;
    grammarId?: string;
    sessionId?: string;
  }): Promise<GrammarObservation[]> {
    return (await this.observationsFile.get())
      .filter(
        (o) =>
          o.language === filter.language &&
          (filter.grammarId === undefined || o.grammarId === filter.grammarId) &&
          (filter.sessionId === undefined || o.sessionId === filter.sessionId),
      )
      .sort((a, b) => a.at - b.at)
      .map(clone);
  }

  async disputeObservation(id: string, verdict: Verdict, note: string): Promise<GrammarObservation> {
    const now = this.now();
    return this.observationsFile.update((list) => {
      const o = list.find((x) => x.id === id);
      if (!o) throw new Error(`Observation not found: ${id}`);
      o.disputed = { note, at: now, originalVerdict: o.disputed?.originalVerdict ?? o.verdict };
      o.verdict = verdict;
      return clone(o);
    });
  }

  async listGrammar(language: Language): Promise<GrammarSummary[]> {
    const points = (await this.grammarFile.get()).filter((p) => p.language === language);
    const byPoint = new Map<string, GrammarObservation[]>();
    for (const o of await this.observationsFile.get()) {
      const arr = byPoint.get(o.grammarId);
      if (arr) arr.push(o);
      else byPoint.set(o.grammarId, [o]);
    }
    return points
      .map((p) => clone(summarizeGrammar(p, byPoint.get(p.id) ?? [])))
      .sort(compareSummaries);
  }

  async getGrammarSummary(id: string): Promise<GrammarSummary | null> {
    const p = (await this.grammarFile.get()).find((x) => x.id === id);
    if (!p) return null;
    const obs = (await this.observationsFile.get()).filter((o) => o.grammarId === id);
    return clone(summarizeGrammar(p, obs));
  }

  // ============================================================ vocabulary & usage

  async saveWord(input: Omit<SavedWord, "id" | "createdAt">): Promise<SavedWord> {
    const now = this.now();
    const data = clone(input);
    return this.savedWordsFile.update((list) => {
      const existing = list.find(
        (w) => w.language === data.language && w.word === data.word && w.sentence === data.sentence,
      );
      if (existing) return clone(existing);
      const w: SavedWord = { ...data, id: randomUUID(), createdAt: now };
      list.push(w);
      return clone(w);
    });
  }

  async listSavedWords(language: Language): Promise<SavedWord[]> {
    return (await this.savedWordsFile.get())
      .filter((w) => w.language === language)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(clone);
  }

  async deleteSavedWord(id: string): Promise<void> {
    await this.savedWordsFile.update((list) => removeWhere(list, (w) => w.id === id));
  }

  async recordLearnerWords(input: {
    language: Language;
    sessionId: string;
    messageId: string;
    sentence: string;
    words: string[];
    at: number;
  }): Promise<WordUsage[]> {
    const words = input.words.map((w) => w.trim()).filter((w) => w !== "");
    // One row per learner message: a repeated call for the same message is a no-op.
    const isNew = await this.writingFile(input.language).update((rows) => {
      if (rows.some((r) => r.messageId === input.messageId && r.sessionId === input.sessionId)) return false;
      rows.push({ at: input.at, sessionId: input.sessionId, messageId: input.messageId, words });
      return true;
    });
    if (!isNew) return [];
    return this.usageFile(input.language).update((usage) => {
      const fresh: WordUsage[] = [];
      for (const word of words) {
        const u = usage.get(word);
        if (u) {
          u.count++;
          continue;
        }
        const created: WordUsage = {
          word,
          language: input.language,
          count: 1,
          firstUsedAt: input.at,
          firstSessionId: input.sessionId,
          firstMessageId: input.messageId,
          firstSentence: input.sentence,
        };
        usage.set(word, created);
        fresh.push(created);
      }
      return clone(fresh);
    });
  }

  async getWordUsage(language: Language, word: string): Promise<WordUsage | null> {
    const u = (await this.usageFile(language).get()).get(word);
    return u ? clone(u) : null;
  }

  // ============================================================ practice targets

  async getTargets(sessionId: string): Promise<PracticeTarget[]> {
    const s = await this.readSession(sessionId);
    return s ? clone(s.targets ?? []) : [];
  }

  async setTargets(sessionId: string, targets: PracticeTarget[]): Promise<void> {
    const t = clone(targets);
    await this.updateSessionFile(sessionId, (s) => {
      s.targets = t;
    });
  }

  async markTargets(sessionId: string, words: string[], status: TargetStatus): Promise<PracticeTarget[]> {
    const wanted = new Set(words);
    return this.updateSessionFile(sessionId, (s) => {
      s.targets ??= [];
      for (const t of s.targets) {
        if (wanted.has(t.word) && TARGET_RANK[status] > TARGET_RANK[t.status]) t.status = status;
      }
      return clone(s.targets);
    });
  }

  // ============================================================ level & profile

  async recordLevel(estimate: LevelEstimate): Promise<void> {
    const e = clone(estimate);
    await this.levelsFile.update((list) => {
      list.push(e);
    });
  }

  async getLevels(
    language: Language,
  ): Promise<{ current: Partial<Record<Skill, LevelEstimate>>; history: LevelEstimate[] }> {
    // Stable sort keeps insertion order for equal timestamps, so the later record wins.
    const history = (await this.levelsFile.get()).filter((e) => e.language === language).sort((a, b) => a.at - b.at);
    const current: Partial<Record<Skill, LevelEstimate>> = {};
    for (const e of history) current[e.skill] = e;
    return clone({ current, history });
  }

  async getProfile(): Promise<LearnerProfile> {
    const p = await this.profileFile.get();
    return clone({ ...p, about: p.about ?? "", goals: p.goals ?? {} });
  }

  async setProfile(patch: Partial<LearnerProfile>): Promise<LearnerProfile> {
    const p = clone(patch);
    return this.profileFile.update((profile) => {
      if (p.about !== undefined) profile.about = p.about;
      if (p.name !== undefined) {
        if (p.name) profile.name = p.name;
        else delete profile.name;
      }
      if (p.goals) {
        const goals: LearnerProfile["goals"] = { ...(profile.goals ?? {}) };
        for (const lang of Object.keys(p.goals) as Language[]) {
          const g = p.goals[lang];
          if (g) goals[lang] = g;
          else delete goals[lang];
        }
        profile.goals = goals;
      }
      profile.about ??= "";
      profile.goals ??= {};
      return clone(profile);
    });
  }

  // ============================================================ analytics & export

  async getProgress(language: Language, range: ProgressRange, anki?: AnkiSnapshot | null): Promise<ProgressStats> {
    const learnerMessages: { sessionId: string; at: number }[] = [];
    for (const s of await this.allSessions()) {
      if (s.meta.language !== language) continue;
      for (const m of s.messages) if (m.role === "user") learnerMessages.push({ sessionId: s.meta.id, at: m.at });
    }
    return clone(
      computeProgress({
        language,
        range,
        now: this.now(),
        activity: await this.activityFile.get(),
        writing: await this.writingFile(language).get(),
        learnerMessages,
        wordUsage: (await this.usageFile(language).get()).values(),
        grammar: await this.listGrammar(language),
        corrections: (await this.correctionsFile.get()).filter((c) => c.language === language),
        anki,
      }),
    );
  }

  async exportAll(): Promise<Record<string, unknown>> {
    const sessions = (await this.allSessions())
      .sort((a, b) => a.meta.createdAt - b.meta.createdAt)
      .map((s) => ({ meta: s.meta, messages: s.messages, targets: s.targets ?? [] }));
    const wordUsage: Partial<Record<Language, WordUsage[]>> = {};
    const writing: Partial<Record<Language, WritingRow[]>> = {};
    for (const lang of LANGUAGES) {
      wordUsage[lang] = wordUsageCodec.encode(await this.usageFile(lang).get()) as WordUsage[];
      writing[lang] = await this.writingFile(lang).get();
    }
    return clone({
      exportedAt: this.now(),
      version: 1,
      sessions,
      corrections: await this.correctionsFile.get(),
      grammar: await this.grammarFile.get(),
      observations: await this.observationsFile.get(),
      savedWords: await this.savedWordsFile.get(),
      wordUsage,
      writing,
      activity: await this.activityFile.get(),
      levels: await this.levelsFile.get(),
      profile: await this.getProfile(),
    });
  }

  // ============================================================ migration

  /**
   * Imports v0.1 sessions (`<legacyDir>/*.json`, the old SessionStore format).
   * Idempotent: sessions whose id already exists are skipped. Returns the number imported.
   */
  async importLegacySessions(legacyDir: string): Promise<number> {
    const index = await this.sessions();
    let count = 0;
    for (const legacy of await readLegacySessions(legacyDir)) {
      if (index.has(legacy.id)) continue;
      await this.addSessionFile(legacyToSessionFile(legacy));
      count++;
    }
    return count;
  }

  static async migrateLegacy(store: JsonRecordsStore, legacyDir: string): Promise<number> {
    return store.importLegacySessions(legacyDir);
  }
}

/** Remove matching items in place. */
function removeWhere<T>(list: T[], pred: (item: T) => boolean): void {
  let w = 0;
  for (const item of list) if (!pred(item)) list[w++] = item;
  list.length = w;
}
