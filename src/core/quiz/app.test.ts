// Quiz through SayfernApp: slot binding, grammar detail with quiz evidence, export, erase.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { ModelRef } from "../../shared/types";
import { SayfernApp } from "../app";
import { FileCredentialStore } from "../credential-file-store";

test("SayfernApp: quiz methods are bound; quiz evidence shows on the grammar page; export and erase", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sayfern-quiz-app-"));
  const credentials = new FileCredentialStore(join(dir, "credentials.json"));
  const models = createModels({ credentials });
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  const offline = (async () => {
    throw new Error("offline");
  }) as unknown as typeof fetch;
  const app = new SayfernApp({ dataDir: dir, models, credentials, fetch: offline, now: () => new Date(2026, 8, 30, 15).getTime(), emit: () => undefined, extensionLog: () => undefined });
  await app.init();
  const m = faux.getModel();
  const ref: ModelRef = { provider: m.provider, id: m.id };

  await app.records.upsertGrammarPoint({ id: "zh:bi-comparison", language: "zh", pattern: "A 比 B + adj", name: "comparisons", introduced: true });
  faux.setResponses([
    fauxAssistantMessage(
      JSON.stringify({
        items: [1, 2, 3].map((slot) => ({
          slot,
          format: "cloze",
          text: ["北京___上海冷。", "我___他高。", "今天___昨天热。"][slot - 1],
          answer: "比",
          explanation: "比 compares.",
          grammar_id: "zh:bi-comparison",
        })),
      }),
    ),
  ]);
  const started = await app.startQuiz(
    { language: "zh", focus: "grammar", sources: [{ kind: "grammar", grammarIds: ["zh:bi-comparison"] }], level: { kind: "current" }, format: "cloze", length: { questions: 3 } },
    ref,
  );
  const view = (await app.quizzes.whenGenerated(started.id))!;
  assert.equal(view.status, "ready");
  assert.equal(view.title, "Grammar · A 比 B + adj");
  for (const q of view.questions) await app.answerQuestion(view.id, q.id, "比", ref);
  await app.finishQuiz(view.id);

  const detail = (await app.getGrammar("zh:bi-comparison"))!;
  assert.equal(detail.observations.length, 3);
  assert.deepEqual(detail.sessions, [], "quiz: ids resolve to no session, without errors");
  assert.equal(detail.summary.state, "with_help");
  assert.equal(detail.summary.quiz?.counts.correct, 3);

  const out = join(dir, "export.json");
  await app.exportTo(out);
  const data = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(data.quizzes.length, 1);
  assert.equal(data.quizzes[0].items[0].answer, "比");

  assert.ok(existsSync(join(dir, "records", "quizzes", `${view.id}.json`)));
  await app.eraseData({ keepSignIns: true });
  assert.equal(existsSync(join(dir, "records", "quizzes")), false);
});
