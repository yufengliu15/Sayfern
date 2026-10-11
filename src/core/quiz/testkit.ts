// Test harness for the quiz service (not a test file itself): real records, language and library
// services on temp dirs, the agent tests' FakeAnki, pi-ai's faux provider.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels, fauxAssistantMessage, fauxProvider, type Api, type Model } from "@earendil-works/pi-ai";
import type { ModelRef } from "../../shared/types";
import { FakeAnki } from "../agent/testkit";
import type { AnkiConnectService } from "../anki";
import type { SettingsStore } from "../app/settings";
import { DefaultLanguageService } from "../lang";
import { FileLibraryService } from "../library";
import { JsonRecordsStore } from "../records";
import type { Stage2Deps } from "../stage2";
import { QuizService } from "./index";

export function makeQuizHarness() {
  const dir = mkdtempSync(join(tmpdir(), "sayfern-quiz-"));
  const clock = { t: new Date(2026, 8, 30, 15, 0).getTime() };
  const now = () => clock.t;
  const records = new JsonRecordsStore({ dataDir: join(dir, "records"), now });
  const lang = new DefaultLanguageService({ dataDir: join(dir, "dict") });
  const library = new FileLibraryService({ dataDir: join(dir, "library"), now });
  const anki = new FakeAnki();
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const model = faux.getModel() as Model<Api>;
  const ref: ModelRef = { provider: model.provider, id: model.id };
  let n = 0;
  const deps: Stage2Deps = {
    dataDir: dir,
    models,
    records,
    anki: anki as unknown as AnkiConnectService,
    library,
    lang,
    settings: null as unknown as SettingsStore,
    resolveModel: (r) => {
      if (r.provider !== model.provider || r.id !== model.id) throw new Error("Sign in to that model first.");
      return model;
    },
    emit: () => undefined,
    now,
    newId: () => `quiz${++n}`,
  };
  const quizzes = new QuizService(deps);
  /** Queue model replies (JSON is stringified). */
  const reply = (...bodies: unknown[]) => faux.setResponses(bodies.map((b) => fauxAssistantMessage(typeof b === "string" ? b : JSON.stringify(b))));
  return { dir, clock, records, lang, library, anki, faux, models, model, ref, deps, quizzes, reply };
}

export type QuizHarness = ReturnType<typeof makeQuizHarness>;

/** A chat session with one correction linked to a grammar point, plus the point itself. */
export async function seedChinese(h: QuizHarness) {
  const s = await h.records.createSession({ language: "zh", kind: "chat", feedbackMode: "inline" });
  await h.records.upsertGrammarPoint({ id: "zh:chule-hai", language: "zh", pattern: "除了…还…", name: "besides A, also B", level: "HSK 3", introduced: true });
  await h.records.upsertGrammarPoint({ id: "zh:bi-comparison", language: "zh", pattern: "A 比 B + adj", name: "comparisons with 比", level: "HSK 2" });
  const c = await h.records.addCorrection({
    sessionId: s.id,
    messageId: "m1",
    original: "除了中文课，还我有三门课",
    corrected: "除了中文课，我还有三门课",
    explanation: "还 goes after the subject.",
    kind: "grammar",
    grammarId: "zh:chule-hai",
  });
  return { session: s, correction: c };
}
