// Test harness for the agent (not a test file itself): real records, language
// and library services on temp dirs, a fake Anki service, pi-ai's faux provider.
import { translator } from "../../shared/i18n";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels, fauxProvider, type Api, type Model } from "@earendil-works/pi-ai";
import type { AnkiCard, AnkiConfig, AnkiSnapshot, AnkiWordFilter, Language, PracticeTarget, SessionKind } from "../../shared/records";
import { aggregateWords, buildOverview, checkWordsIn, wordPage } from "../anki/words";
import type { AnkiAddResult, AnkiNoteInput, AnkiNoteType, AnkiService, TutorEvent } from "../contracts";
import { JsonRecordsStore } from "../records";
import { DefaultLanguageService } from "../lang";
import { FileLibraryService } from "../library";
import { SayfernTutor } from "./index";
import type { TutorDeps } from "./deps";

/** Anki stand-in: a settable card list; word queries use the real pure functions (anki/words.ts). */
export class FakeAnki implements AnkiService {
  config: AnkiConfig = { enabled: true, url: "http://localhost:8765", decks: [] };
  cards: AnkiCard[] = [];
  targets: PracticeTarget[] = [];
  /** false: behaves as never synced. */
  synced = true;
  syncedAt = 0;
  selectCalls = 0;
  freshCalls: { language: Language; maxAgeMs: number }[] = [];
  async getConfig() {
    return this.config;
  }
  async setConfig(c: AnkiConfig) {
    this.config = c;
    return c;
  }
  async ping() {
    return { connected: false };
  }
  async deckNames() {
    return [];
  }
  async fieldNames() {
    return [];
  }
  async sync(language: Language): Promise<AnkiSnapshot> {
    return { language, syncedAt: this.syncedAt, cards: this.cards, reviewedToday: 0, reviewsLast7d: 0, matureCount: 0 };
  }
  async snapshot(language: Language) {
    return this.synced ? this.sync(language) : null;
  }
  async ensureFresh(language: Language, maxAgeMs: number) {
    this.freshCalls.push({ language, maxAgeMs });
    return this.snapshot(language);
  }
  async findCard(_language: Language, word: string) {
    return this.cards.find((c) => c.word === word) ?? null;
  }
  private async all(language: Language) {
    const snap = await this.snapshot(language);
    return { snap, words: aggregateWords(snap) };
  }
  async words(language: Language, filter: AnkiWordFilter = {}) {
    const { snap, words } = await this.all(language);
    return wordPage(snap, words, filter);
  }
  async struggling(language: Language, limit = 20, opts: { deck?: string } = {}) {
    return (await this.words(language, { status: "struggling", limit, deck: opts.deck })).items;
  }
  async checkWords(language: Language, words: string[]) {
    return checkWordsIn((await this.all(language)).words, words);
  }
  async overview(language: Language) {
    const { snap, words } = await this.all(language);
    return snap ? buildOverview(snap, words) : null;
  }
  async selectTargets(_language: Language, count: number) {
    this.selectCalls++;
    return this.targets.slice(0, count).map((t) => ({ ...t }));
  }
  async ensureNoteType(_type: AnkiNoteType): Promise<boolean> {
    return false;
  }
  async ensureDeck(_deck: string): Promise<void> {}
  async addNotes(_notes: AnkiNoteInput[]): Promise<AnkiAddResult[]> {
    throw new Error("FakeAnki can't add notes");
  }
  async storeMedia(filename: string, _base64: string): Promise<string> {
    return filename;
  }
}

export interface Harness {
  dir: string;
  clock: { t: number };
  records: JsonRecordsStore;
  lang: DefaultLanguageService;
  library: FileLibraryService;
  anki: FakeAnki;
  faux: ReturnType<typeof fauxProvider>;
  model: Model<Api>;
  tutor: SayfernTutor;
  deps: TutorDeps;
  ankiOn: { value: boolean };
  newSession(kind?: SessionKind, extra?: { focusGrammarId?: string; docId?: string }): Promise<string>;
  /** Collects events of a turn. */
  events(): { list: TutorEvent[]; onEvent: (e: TutorEvent) => void; deltas: () => string };
}

export function makeHarness(opts: { tokensPerSecond?: number } = {}): Harness {
  const dir = mkdtempSync(join(tmpdir(), "sayfern-agent-"));
  const clock = { t: new Date(2026, 8, 30, 15, 0).getTime() };
  const now = () => clock.t;
  const records = new JsonRecordsStore({ dataDir: join(dir, "records"), now });
  const lang = new DefaultLanguageService({ dataDir: join(dir, "dict") });
  const library = new FileLibraryService({ dataDir: join(dir, "library"), now });
  const anki = new FakeAnki();
  const faux = fauxProvider(opts.tokensPerSecond ? { tokensPerSecond: opts.tokensPerSecond } : {});
  const models = createModels();
  models.setProvider(faux.provider);
  const model = faux.getModel() as Model<Api>;
  const ankiOn = { value: false };
  let n = 0;
  const newId = () => `id${++n}`;
  const deps: TutorDeps = { models, records, lang, library, anki, now, newId, ankiEnabled: async () => ankiOn.value, explanationLanguage: async () => "English", translator: async () => translator("en"), evidencePass: () => false };
  const tutor = new SayfernTutor(deps);
  return {
    dir,
    clock,
    records,
    lang,
    library,
    anki,
    faux,
    model,
    tutor,
    deps,
    ankiOn,
    async newSession(kind = "chat", extra = {}) {
      const s = await records.createSession({ language: "zh", kind, feedbackMode: "inline", ...extra });
      return s.id;
    },
    events() {
      const list: TutorEvent[] = [];
      return {
        list,
        onEvent: (e) => list.push(e),
        deltas: () =>
          list
            .filter((e): e is Extract<TutorEvent, { type: "delta" }> => e.type === "delta")
            .map((e) => e.text)
            .join(""),
      };
    },
  };
}
