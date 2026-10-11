import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { Correction } from "../../shared/records";
import { clozeFront, type AnkiCardDraft } from "../../shared/stage2";
import type { ModelRef } from "../../shared/types";
import { SayfernApp } from "../app";
import { FileCredentialStore } from "../credential-file-store";
import { parseSituations } from "./cards";
import { sentenceAndRevision } from "./list";

// ---------------------------------------------------------------- fake AnkiConnect

interface FakeNote {
  id: number;
  deckName: string;
  modelName: string;
  fields: Record<string, string>;
  tags: string[];
}

interface FakeAnkiOptions {
  /** Older AnkiConnect: no canAddNotesWithErrorDetail. */
  noErrorDetail?: boolean;
  /** addNotes rejects the whole batch (forces the per-note fallback). */
  addNotesFails?: boolean;
}

/** In-memory AnkiConnect with the note-creation actions the review export uses. */
function fakeAnki(opts: FakeAnkiOptions = {}) {
  const state = {
    down: false,
    calls: [] as string[],
    models: new Map<string, { fields: string[]; isCloze: boolean }>([["Basic", { fields: ["Front", "Back"], isCloze: false }]]),
    decks: new Set<string>(["Default"]),
    notes: [] as FakeNote[],
  };
  let nextId = 1_700_000_000_000;
  const firstField = (modelName: string, fields: Record<string, string>) => fields[state.models.get(modelName)?.fields[0] ?? ""] ?? "";
  const problem = (n: Omit<FakeNote, "id">): string | null => {
    const model = state.models.get(n.modelName);
    if (!model) return "model was not found: " + n.modelName;
    if (!state.decks.has(n.deckName)) return "deck was not found: " + n.deckName;
    const first = firstField(n.modelName, n.fields);
    if (!first.trim()) return "cannot create note because it is empty";
    if (state.notes.some((x) => x.modelName === n.modelName && firstField(x.modelName, x.fields) === first)) return "cannot create note because it is a duplicate";
    return null;
  };
  const add = (n: Omit<FakeNote, "id">): number => {
    const p = problem(n);
    if (p) throw new Error(p);
    const id = nextId++;
    state.notes.push({ ...n, id });
    return id;
  };
  const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
    if (state.down) throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
    const req = JSON.parse(String(init?.body)) as { action: string; params?: Record<string, unknown> };
    state.calls.push(req.action);
    const p = req.params ?? {};
    const notes = (p.notes ?? []) as Omit<FakeNote, "id">[];
    const ok = (result: unknown) => new Response(JSON.stringify({ result, error: null }));
    const fail = (error: string) => new Response(JSON.stringify({ result: null, error }));
    switch (req.action) {
      case "version":
        return ok(6);
      case "deckNames":
        return ok([...state.decks]);
      case "createDeck":
        state.decks.add(String(p.deck));
        return ok(1);
      case "modelNames":
        return ok([...state.models.keys()]);
      case "createModel":
        if (state.models.has(String(p.modelName))) return fail("Model name already exists");
        state.models.set(String(p.modelName), { fields: p.inOrderFields as string[], isCloze: p.isCloze === true });
        return ok({});
      case "canAddNotesWithErrorDetail":
        if (opts.noErrorDetail) return fail("unsupported action");
        return ok(notes.map((n) => (problem(n) ? { canAdd: false, error: problem(n) } : { canAdd: true })));
      case "canAddNotes":
        return ok(notes.map((n) => !problem(n)));
      case "addNotes":
        if (opts.addNotesFails) return fail("['cannot create note because it is a duplicate']");
        return ok(
          notes.map((n) => {
            try {
              return add(n);
            } catch {
              return null;
            }
          }),
        );
      case "addNote":
        try {
          return ok(add(p.note as Omit<FakeNote, "id">));
        } catch (err) {
          return fail((err as Error).message);
        }
      default:
        return fail("unsupported action");
    }
  }) as typeof fetch;
  return { fetch: fetchFn, state };
}

// ---------------------------------------------------------------- app with seeded corrections

async function makeApp(anki = fakeAnki()) {
  const dir = mkdtempSync(join(tmpdir(), "sayfern-review-"));
  const credentials = new FileCredentialStore(join(dir, "credentials.json"));
  const models = createModels({ credentials });
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  const clock = { t: new Date(2026, 8, 29, 15, 0).getTime() };
  const app = new SayfernApp({
    dataDir: dir,
    models,
    credentials,
    fetch: (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch,
    ankiFetch: anki.fetch,
    now: () => clock.t,
    emit: () => undefined,
  });
  await app.init();
  await app.ankiSetConfig({ enabled: true, url: "http://127.0.0.1:8765", decks: [] });
  const m = faux.getModel();
  const ref: ModelRef = { provider: m.provider, id: m.id };

  const r = app.records;
  await r.upsertGrammarPoint({ id: "zh:le-completion", language: "zh", pattern: "了", name: "completed action" });
  await r.upsertGrammarPoint({ id: "zh:chule-hai", language: "zh", pattern: "除了…还…", name: "besides A, also B" });

  const session = async (title: string, text: string) => {
    const meta = await r.createSession({ language: "zh", kind: "chat", feedbackMode: "inline", title });
    const messageId = `${meta.id}-m1`;
    await r.appendMessage({ id: messageId, sessionId: meta.id, role: "user", text, at: clock.t });
    return { sessionId: meta.id, messageId };
  };
  const correct = async (where: { sessionId: string; messageId: string }, c: Omit<Correction, "id" | "language" | "sessionId" | "messageId" | "createdAt" | "status" | "retries">) => {
    clock.t += 60_000;
    return r.addCorrection({ ...where, ...c });
  };

  const weekend = await session("周末计划", "我们昨天去了爬山！除了爬山，我们还吃了烤鸭。");
  const uni = await session("我的大学生活", "除了中文课，还我有三门课。");
  const film = await session("最喜欢的电影", "我很兴奋看这部电影。这家饭馆的菜很好吃的。");

  const c = {
    le: await correct(weekend, { original: "去了爬山", corrected: "去爬山了", explanation: "With 去 plus an activity, 了 closes the whole phrase: 去爬山了.", kind: "grammar", grammarId: "zh:le-completion" }),
    hai: await correct(uni, { original: "还我有", corrected: "我还有", explanation: "还 goes after the subject.", kind: "grammar", grammarId: "zh:chule-hai" }),
    vocab: await correct(film, { original: "兴奋", corrected: "期待", explanation: "For looking forward to something, use 期待.", kind: "grammar" }),
    style: await correct(film, { original: "很好吃的", corrected: "很好吃", explanation: "The final 的 sounds heavy here.", kind: "typo" }),
  };
  await r.updateCorrection(c.hai.id, { status: "retried_ok", retries: [{ text: "除了中文课，我还有三门课。", ok: true, at: clock.t }] });
  // A Japanese correction must never show up in the Chinese list.
  const ja = await r.createSession({ language: "ja", kind: "chat", feedbackMode: "inline", title: "週末" });
  await r.appendMessage({ id: "ja-m1", sessionId: ja.id, role: "user", text: "とても楽しいでした。", at: clock.t });
  await r.addCorrection({ sessionId: ja.id, messageId: "ja-m1", original: "楽しいでした", corrected: "楽しかったです", explanation: "い-adjectives take the past themselves.", kind: "grammar" });

  return { app, faux, ref, clock, c, anki, weekend };
}

// ---------------------------------------------------------------- list, filters, counts

test("sentenceAndRevision: the learner sentence and the same sentence with the fix", () => {
  const r = sentenceAndRevision({ original: "去了爬山", corrected: "去爬山了" }, "你好。我们昨天去了爬山！然后回家。");
  assert.equal(r.sentence, "我们昨天去了爬山！");
  assert.deepEqual(r.revised, { before: "我们昨天", fixed: "去爬山了", after: "！" });
  assert.deepEqual(sentenceAndRevision({ original: "x", corrected: "y" }, undefined), { sentence: "x", revised: { before: "", fixed: "y", after: "" } });
});

test("listReviewCorrections: newest first, context, chip counts, filters", async () => {
  const { app, c } = await makeApp();
  const all = await app.listReviewCorrections({ language: "zh" });
  assert.equal(all.total, 4);
  assert.deepEqual(all.counts, { all: 4, grammar: 3, typo: 1, speaking: 0 });
  assert.deepEqual(all.items.map((i) => i.correction.id), [c.style.id, c.vocab.id, c.hai.id, c.le.id]);
  const le = all.items.find((i) => i.correction.id === c.le.id)!;
  assert.equal(le.sentence, "我们昨天去了爬山！");
  assert.deepEqual(le.revised, { before: "我们昨天", fixed: "去爬山了", after: "！" });
  assert.equal(le.session?.title, "周末计划");
  assert.deepEqual(le.grammar, { id: "zh:le-completion", pattern: "了", name: "completed action" });
  assert.deepEqual(all.grammarPoints.map((g) => [g.id, g.count]), [["zh:chule-hai", 1], ["zh:le-completion", 1]]);

  const typos = await app.listReviewCorrections({ language: "zh", kind: "typo" });
  assert.deepEqual(typos.items.map((i) => i.correction.kind), ["typo"]);
  assert.equal(typos.counts.all, 4, "chip counts ignore the kind filter");

  const practise = await app.listReviewCorrections({ language: "zh", status: "practise" });
  assert.deepEqual(practise.counts, { all: 3, grammar: 2, typo: 1, speaking: 0 }, "fixed-on-retry is not 'to practise'");
  assert.equal((await app.listReviewCorrections({ language: "zh", status: "fixed" })).items[0].correction.id, c.hai.id);

  assert.deepEqual((await app.listReviewCorrections({ language: "zh", grammarId: "zh:le-completion" })).items.map((i) => i.correction.id), [c.le.id]);
  assert.deepEqual((await app.listReviewCorrections({ language: "zh", search: "电影" })).items.map((i) => i.correction.id), [c.style.id, c.vocab.id], "matches the session title");
  assert.deepEqual((await app.listReviewCorrections({ language: "zh", search: "Looking Forward" })).items.map((i) => i.correction.id), [c.vocab.id], "matches the explanation, any case");

  await app.disputeCorrection(c.vocab.id, "My teacher says 兴奋 works.");
  const disputed = await app.listReviewCorrections({ language: "zh" });
  assert.equal(disputed.items.find((i) => i.correction.id === c.vocab.id)?.correction.status, "disputed", "disputed stays visible");
  assert.equal((await app.listReviewCorrections({ language: "zh", status: "not_exported" })).counts.all, 3, "disputed ones are not offered for export");
  assert.equal((await app.listReviewCorrections({ language: "ja" })).total, 1);
});

// ---------------------------------------------------------------- drafts

test("draftAnkiCards cloze: local, the fix in the gap, never the wrong version on the answer side; disputed skipped", async () => {
  const { app, faux, c } = await makeApp();
  await app.disputeCorrection(c.vocab.id, "fine");
  const r = await app.draftAnkiCards({ language: "zh", correctionIds: [c.le.id, c.vocab.id, c.style.id], style: "cloze" });
  assert.equal(faux.state.callCount, 0, "cloze needs no model");
  assert.deepEqual(r.skipped.map((s) => s.correctionId), [c.vocab.id]);
  assert.equal(r.cards.length, 2);
  const [le, style] = r.cards;
  assert.equal(le.back, "我们昨天去爬山了！");
  assert.equal(le.gap, "去爬山了");
  assert.equal(le.hint, "completed action", "grammar corrections hint with the pattern's name");
  assert.equal(le.front, "我们昨天 ___ (completed action) ！");
  assert.equal(le.front, clozeFront(le.back, le.gap, le.hint));
  assert.equal(le.source, "周末计划 · Sep 29, 2026");
  assert.deepEqual(le.tags, ["sayfern", "sayfern::grammar", "zh:le-completion"]);
  assert.equal(style.back, "这家饭馆的菜很好吃。");
  assert.equal(style.hint, "more natural wording");
  for (const card of r.cards) {
    const wrong = [c.le, c.style].find((x) => x.id === card.correctionId)!.original;
    assert.ok(!card.back.includes(wrong), "answer side never has the learner's wrong version");
    assert.ok(!card.front.includes(card.gap), "front never gives the answer away");
  }
});

test("draftAnkiCards situation: one batched model call; fallback without a model or when it fails", async () => {
  const { app, faux, ref, c } = await makeApp();
  let prompt = "";
  faux.setResponses([
    (ctx) => {
      prompt = JSON.stringify(ctx);
      return fauxAssistantMessage(
        '```json\n{"cards":[{"id":"c1","situation":"Tell a friend you went hiking yesterday."},{"id":"c2","situation":"告诉朋友你的课。"}]}\n```',
      );
    },
  ]);
  const r = await app.draftAnkiCards({ language: "zh", correctionIds: [c.le.id, c.hai.id], style: "situation" }, ref);
  assert.equal(faux.state.callCount, 1, "one call for all cards");
  assert.match(prompt, /我们昨天去爬山了！/);
  assert.doesNotMatch(prompt, /去了爬山/, "the wrong version is not sent as a target");
  assert.equal(r.cards[0].front, "Tell a friend you went hiking yesterday.");
  assert.equal(r.cards[0].fallback, undefined);
  assert.equal(r.cards[0].back, "我们昨天去爬山了！");
  assert.equal(r.cards[1].fallback, true, "a situation with Chinese in it is rejected");
  assert.match(r.notice ?? "", /explanations/);

  const noModel = await app.draftAnkiCards({ language: "zh", correctionIds: [c.le.id], style: "situation" });
  assert.equal(faux.state.callCount, 1);
  assert.equal(noModel.cards[0].fallback, true);
  assert.match(noModel.cards[0].front, /^Say it in Chinese, using completed action \(from "周末计划"\)\./);
  assert.ok(!noModel.cards[0].front.includes("去爬山了"), "the fallback masks the answer in the explanation");
  assert.match(noModel.notice ?? "", /Pick a model/);

  faux.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "Rate limited" })]);
  const failed = await app.draftAnkiCards({ language: "zh", correctionIds: [c.le.id], style: "situation" }, ref);
  assert.equal(failed.cards[0].fallback, true);
  assert.match(failed.notice ?? "", /Rate limited/);
});

test("parseSituations tolerates fences, bare arrays and junk", () => {
  assert.equal(parseSituations('Sure!\n{"cards":[{"id":"c1","situation":" Ask for the menu. "}]}').get("c1"), "Ask for the menu.");
  assert.equal(parseSituations('[{"id":"c2","situation":"Say sorry."}]').get("c2"), "Say sorry.");
  assert.equal(parseSituations("no json here").size, 0);
});

// ---------------------------------------------------------------- export

async function drafts(app: SayfernApp, ids: string[], style: "cloze" | "situation" = "cloze"): Promise<AnkiCardDraft[]> {
  return (await app.draftAnkiCards({ language: "zh", correctionIds: ids, style })).cards;
}

test("exportAnkiCards: creates the Sayfern note type once, adds notes, skips duplicates, marks corrections exported", async () => {
  const { app, c, anki, clock } = await makeApp();
  const cards = await drafts(app, [c.le.id, c.hai.id]);
  const deck = "Chinese::Sayfern corrections";
  const first = await app.exportAnkiCards({ language: "zh", deck, cards });
  assert.deepEqual([first.added, first.duplicates, first.failed], [2, 0, 0]);
  assert.ok(anki.state.decks.has(deck), "deck created");
  assert.equal(anki.state.calls.filter((a) => a === "createModel").length, 1, "only the cloze type is needed");
  assert.equal(anki.state.models.get("Sayfern Cloze")?.isCloze, true);
  const note = anki.state.notes[0];
  assert.equal(note.modelName, "Sayfern Cloze");
  assert.equal(note.fields.Text, "我们昨天{{c1::去爬山了::completed action}}！");
  assert.equal(note.fields.Source, "周末计划 · Sep 29, 2026");
  assert.deepEqual(note.tags, ["sayfern", "sayfern::grammar", "zh:le-completion"]);

  const stored = await app.records.getCorrection(c.le.id);
  assert.equal(stored?.exportedAt, clock.t);
  assert.deepEqual(stored?.ankiNoteIds, [note.id]);
  assert.equal((await app.ankiStatus()).config.exportDecks?.zh, deck, "the deck is remembered per language");
  assert.equal((await app.listReviewCorrections({ language: "zh", status: "not_exported" })).counts.all, 2);

  // Again, plus a situation card (second note type, created once).
  const situation = await drafts(app, [c.vocab.id], "situation");
  const second = await app.exportAnkiCards({ language: "zh", deck, cards: [...cards, ...situation] });
  assert.deepEqual([second.added, second.duplicates, second.failed], [1, 2, 0]);
  assert.deepEqual(second.results.map((r) => r.status), ["duplicate", "duplicate", "added"]);
  assert.equal(anki.state.calls.filter((a) => a === "createModel").length, 2);
  assert.equal(anki.state.notes.length, 3);
  const recall = anki.state.notes[2];
  assert.equal(recall.modelName, "Sayfern Recall");
  assert.equal(recall.fields.Sentence, "我很<b>期待</b>看这部电影。");
  assert.ok(!Object.values(recall.fields).join(" ").includes("兴奋"), "the wrong word is nowhere on the card");
  assert.deepEqual((await app.records.getCorrection(c.le.id))?.ankiNoteIds, [note.id], "duplicates keep their note ids");

  const third = await app.exportAnkiCards({ language: "zh", deck, cards: situation });
  assert.equal(third.duplicates, 1);
  assert.equal(anki.state.calls.filter((a) => a === "createModel").length, 2, "note types are reused");
});

test("exportAnkiCards: older AnkiConnect and a rejected batch still sort added from duplicates", async () => {
  const anki = fakeAnki({ noErrorDetail: true, addNotesFails: true });
  const { app, c } = await makeApp(anki);
  const cards = await drafts(app, [c.le.id, c.hai.id]);
  await app.exportAnkiCards({ language: "zh", deck: "Default", cards: cards.slice(0, 1) });
  const r = await app.exportAnkiCards({ language: "zh", deck: "Default", cards });
  assert.deepEqual(r.results.map((x) => x.status), ["duplicate", "added"]);
  assert.ok(anki.state.calls.includes("canAddNotes"));
  assert.ok(anki.state.calls.includes("addNote"));
});

test("exportAnkiCards: invalid drafts fail alone; offline and disabled Anki give readable errors and change nothing", async () => {
  const { app, c, anki } = await makeApp();
  const [card] = await drafts(app, [c.le.id]);
  const broken = { ...card, gap: "不在句子里" };
  const r = await app.exportAnkiCards({ language: "zh", deck: "Default", cards: [broken, card] });
  assert.deepEqual(r.results.map((x) => x.status), ["failed", "added"]);
  assert.match(r.results[0].error ?? "", /hidden part/);

  const [other] = await drafts(app, [c.hai.id]);
  anki.state.down = true;
  await assert.rejects(app.exportAnkiCards({ language: "zh", deck: "Default", cards: [other] }), /Open Anki/);
  assert.equal((await app.records.getCorrection(c.hai.id))?.exportedAt, undefined);

  anki.state.down = false;
  await app.ankiSetConfig({ ...(await app.ankiStatus()).config, enabled: false });
  await assert.rejects(app.exportAnkiCards({ language: "zh", deck: "Default", cards: [other] }), /Anki is turned off/);
  await assert.rejects(app.exportAnkiCards({ language: "zh", deck: " ", cards: [other] }), /Choose a deck/);
});
