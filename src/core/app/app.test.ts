import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { test } from "node:test";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { ChatEvent } from "../../shared/api";
import type { ModelRef } from "../../shared/types";
import { FileCredentialStore } from "../credential-file-store";
import { CEDICT_URL } from "../lang";
import { OEWN_URL } from "../lang/wordlists";
import { JsonRecordsStore } from "../records";
import { SayfernApp, type AppEventChannel } from "./index";

interface Setup {
  dir?: string;
  tokensPerSecond?: number;
  /** Register the faux provider (default true). */
  withModel?: boolean;
  beforeInit?: (dir: string) => void;
  ankiFetch?: typeof fetch;
  fetch?: typeof fetch;
}

async function makeApp(setup: Setup = {}) {
  const dir = setup.dir ?? mkdtempSync(join(tmpdir(), "sayfern-app-"));
  const credentials = new FileCredentialStore(join(dir, "credentials.json"));
  const models = createModels({ credentials });
  const faux = fauxProvider(setup.tokensPerSecond ? { tokensPerSecond: setup.tokensPerSecond } : {});
  if (setup.withModel !== false) models.setProvider(faux.provider);
  const events: { channel: AppEventChannel; payload: unknown }[] = [];
  const clock = { t: new Date(2026, 8, 30, 15, 0).getTime() };
  const offline = (async () => {
    throw new Error("offline");
  }) as unknown as typeof fetch;
  setup.beforeInit?.(dir);
  const app = new SayfernApp({
    dataDir: dir,
    models,
    credentials,
    fetch: setup.fetch ?? offline,
    ...(setup.ankiFetch ? { ankiFetch: setup.ankiFetch } : {}),
    now: () => clock.t,
    emit: (channel, payload) => events.push({ channel, payload }),
  });
  await app.init();
  const m = faux.getModel();
  const ref: ModelRef = { provider: m.provider, id: m.id };
  const chat = (sessionId?: string) =>
    events
      .filter((e) => e.channel === "chat")
      .map((e) => e.payload as ChatEvent)
      .filter((e) => !sessionId || e.sessionId === sessionId);
  return { dir, app, faux, ref, events, chat, clock };
}

const evidence = (args: Record<string, unknown>) => fauxToolCall("record_evidence", args as never);

test("send: streams user_saved, deltas, tool, correction, then done with a fresh view", async () => {
  const { app, faux, ref, chat } = await makeApp();
  const view = await app.newSession({ language: "zh" });
  assert.equal(view.meta.kind, "chat");
  assert.equal(view.messages.length, 0);

  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxText("听起来很好玩！你和谁一起去的？"),
        evidence({
          corrections: [
            { original: "我去了北京昨天", corrected: "我昨天去了北京", explanation: "Time words come before the verb.", kind: "grammar", grammar_id: "zh:time-before-verb" },
          ],
          observations: [
            { grammar_id: "zh:time-before-verb", pattern: "Subj + time + V", name: "time before verb", span: "我去了北京昨天", verdict: "incorrect", assistance: "independent" },
          ],
        }),
      ],
      { stopReason: "toolUse" },
    ),
  ]);
  const { requestId } = await app.send(view.meta.id, { text: "我去了北京昨天。" }, ref);
  await app.whenIdle();

  const evs = chat(view.meta.id);
  assert.ok(evs.every((e) => e.requestId === requestId));
  const types = evs.map((e) => e.type);
  assert.equal(types[0], "user_saved");
  assert.ok(types.includes("delta"));
  assert.ok(types.includes("tool"));
  assert.ok(types.includes("correction"));
  assert.equal(types.at(-1), "done");
  const done = evs.at(-1) as Extract<ChatEvent, { type: "done" }>;
  assert.equal(done.message.text, "听起来很好玩！你和谁一起去的？");
  assert.equal(done.view.messages.length, 2);
  assert.equal(done.view.corrections.length, 1);
  assert.deepEqual(done.view.grammarInPlay.map((g) => g.point.id), ["zh:time-before-verb"]);

  // getSession matches the done view
  const again = await app.getSession(view.meta.id);
  assert.deepEqual(again, done.view);

  // grammar detail, home follow-ups, resume
  const detail = await app.getGrammar("zh:time-before-verb");
  assert.equal(detail?.observations.length, 1);
  assert.equal(detail?.corrections.length, 1);
  assert.deepEqual(detail?.sessions.map((s) => s.id), [view.meta.id]);
  const home = await app.getHome("zh");
  assert.equal(home.resume?.session.id, view.meta.id);
  assert.equal(home.resume?.lastTutorLine, "听起来很好玩！你和谁一起去的？");
  assert.deepEqual(home.followUps.map((g) => g.point.id), ["zh:time-before-verb"]);
  assert.equal(home.recent[0].id, view.meta.id);
  assert.ok(home.week.wordsWritten > 0);
  assert.equal(home.week.daily.length, 7);
  assert.equal(home.needsPlacement, true);
  assert.deepEqual(home.targets, []);

  // dispute → detail back
  const disputed = await app.disputeObservation(detail!.observations[0].id, "correct", "It was a typo");
  assert.equal(disputed?.observations[0].verdict, "correct");

  // end summary
  const summary = await app.endSession(view.meta.id);
  assert.ok(summary.session.endedAt);
  assert.equal((await app.getHome("zh")).resume, undefined);
});

test("send: a failed reply emits error with a view instead of done", async () => {
  const { app, faux, ref, chat } = await makeApp();
  const { meta } = await app.newSession({ language: "zh" });
  faux.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "Rate limited" })]);
  await app.send(meta.id, { text: "你好" }, ref);
  await app.whenIdle();
  const last = chat(meta.id).at(-1) as Extract<ChatEvent, { type: "error" }>;
  assert.equal(last.type, "error");
  assert.match(last.message, /Rate limited/);
  assert.equal(last.aborted, false);
  assert.ok(last.view, "error carries a view");
  assert.equal(last.view!.messages.at(-1)?.error, "Rate limited");
  assert.ok(!chat(meta.id).some((e) => e.type === "done"));
});

test("abort: emits error aborted=true with a view", async () => {
  const { app, faux, ref, chat } = await makeApp({ tokensPerSecond: 20 });
  const { meta } = await app.newSession({ language: "zh" });
  faux.setResponses([fauxAssistantMessage("这是一个很长很长的回答，".repeat(20))]);
  const { requestId } = await app.send(meta.id, { text: "你好" }, ref);
  while (!chat(meta.id).some((e) => e.type === "delta")) await new Promise((r) => setTimeout(r, 5));
  await app.abort(requestId);
  await app.whenIdle();
  const last = chat(meta.id).at(-1) as Extract<ChatEvent, { type: "error" }>;
  assert.equal(last.type, "error");
  assert.equal(last.aborted, true);
  assert.ok(last.view);
});

test("send: rejects unknown models and missing sessions up front", async () => {
  const { app, ref } = await makeApp();
  const { meta } = await app.newSession({ language: "zh" });
  await assert.rejects(app.send(meta.id, { text: "你好" }, { provider: "nope", id: "x" }), /Unknown model/);
  await assert.rejects(app.send("missing", { text: "你好" }, ref), /no longer exists/);
});

test("openings: practice, reading and placement sessions stream the tutor's first line; chat does not", async () => {
  const { app, faux, chat, ref } = await makeApp();
  await app.setSettings({ model: ref });
  faux.setResponses([
    fauxAssistantMessage("我们来练习吧！"),
    fauxAssistantMessage("我们从第一段开始读吧。"),
    fauxAssistantMessage("我们先聊五分钟。"),
  ]);

  await app.records.upsertGrammarPoint({ id: "zh:chule-hai", language: "zh", pattern: "除了…还…", name: "besides A, also B" });
  const practice = await app.practiseGrammar("zh:chule-hai");
  await app.whenIdle();
  assert.equal(practice.meta.kind, "practice");
  assert.equal(practice.meta.title, "练习 除了…还…");
  assert.deepEqual(practice.grammarInPlay.map((g) => g.point.id), ["zh:chule-hai"]);
  let evs = chat(practice.meta.id);
  assert.deepEqual(evs[0], { requestId: evs[0].requestId, sessionId: practice.meta.id, type: "delta", text: "" }, "opening announces itself at once");
  assert.ok(evs.some((e) => e.type === "delta" && e.text));
  const pDone = evs.at(-1) as Extract<ChatEvent, { type: "done" }>;
  assert.equal(pDone.type, "done");
  assert.equal(pDone.message.text, "我们来练习吧！");
  assert.deepEqual(pDone.view.messages.map((m) => m.role), ["tutor"]);

  const file = join(app.dataDir, "story.txt");
  writeFileSync(file, "第一段。小明去了商店。\n\n第二段。他买了苹果。\n\n第三段。然后他回家了。");
  const [doc] = await app.importFiles("zh", "reader", [file]);
  const reading = await app.openReading(doc.id);
  await app.whenIdle();
  assert.equal(reading.meta.kind, "reading");
  assert.equal(reading.doc?.id, doc.id);
  evs = chat(reading.meta.id);
  assert.equal(evs.at(-1)?.type, "done");

  const placement = await app.startPlacement("zh");
  await assert.rejects(app.send(placement.meta.id, { text: "你好" }, ref), /still starting/);
  await app.whenIdle();
  assert.equal(placement.meta.kind, "placement");
  assert.equal(chat(placement.meta.id).at(-1)?.type, "done");

  const plain = await app.newSession({ language: "zh", kind: "chat" });
  await app.whenIdle();
  assert.equal(chat(plain.meta.id).length, 0);
  assert.equal(faux.state.callCount, 3);

  // Reopening a reading session reuses it and does not start another opening.
  const reopened = await app.openReading(doc.id);
  await app.whenIdle();
  assert.equal(reopened.meta.id, reading.meta.id);
  assert.equal(faux.state.callCount, 3);
});

test("Explain again: the request rides in the opening, so no send is rejected (v0.2.1 bug)", async () => {
  const { app, faux, chat, ref } = await makeApp();
  await app.setSettings({ model: ref });
  let seen = "";
  faux.setResponses([
    (ctx) => {
      seen = JSON.stringify(ctx);
      return fauxAssistantMessage("「除了…还…」表示 besides A, also B。比如：除了茶，我还喝咖啡。你呢？");
    },
  ]);
  await app.records.upsertGrammarPoint({ id: "zh:chule-hai", language: "zh", pattern: "除了…还…", name: "besides A, also B" });
  const v = await app.practiseGrammar("zh:chule-hai", { explain: true });
  await app.whenIdle();
  assert.equal(v.meta.openWith, "explain");
  assert.match(seen, /explain and practise/, "system prompt switches to explain mode");
  assert.match(seen, /explain the focus pattern again/, "hidden kickoff asks for the explanation");
  const done = chat(v.meta.id).at(-1) as Extract<ChatEvent, { type: "done" }>;
  assert.equal(done.type, "done");
  assert.deepEqual(done.view.messages.map((m) => m.role), ["tutor"], "no learner message, nothing rejected");
  assert.equal(faux.state.callCount, 1);

  const plain = await app.practiseGrammar("zh:chule-hai");
  assert.equal(plain.meta.openWith, undefined);
});

test("startUnit: the learner's choice of a grammar overview is saved on the session and reaches the opening", async () => {
  const { app, faux, ref } = await makeApp();
  await app.setSettings({ model: ref });
  let seen = "";
  faux.setResponses([
    (ctx) => {
      seen = JSON.stringify(ctx);
      return fauxAssistantMessage("A 比 B + Adj：比较两样东西。比如：今天比昨天冷。你和你朋友谁高？");
    },
    fauxAssistantMessage("你和你朋友谁高？"),
  ]);
  const v = await app.startUnit("zh-hsk30-1-08", { explain: true });
  await app.whenIdle();
  assert.equal(v.meta.openWith, "explain");
  assert.equal(v.meta.unitId, "zh-hsk30-1-08");
  assert.match(seen, /quick overview of this unit's grammar/);

  const plain = await app.startUnit("zh-hsk30-1-08");
  await app.whenIdle();
  assert.equal(plain.meta.openWith, undefined);
});

test("role-play: a scenario chat is titled after it, carries the scene into the prompt and opens in role", async () => {
  const { app, faux, chat, ref } = await makeApp();
  await app.setSettings({ model: ref });
  let seen = "";
  faux.setResponses([
    (ctx) => {
      seen = JSON.stringify(ctx);
      return fauxAssistantMessage("欢迎光临！请问几位？");
    },
  ]);
  const v = await app.newSession({ language: "zh", kind: "chat", scenarioId: "restaurant" });
  await app.whenIdle();
  assert.equal(v.meta.kind, "chat");
  assert.equal(v.meta.scenarioId, "restaurant");
  assert.equal(v.meta.title, "Order at a restaurant");
  assert.match(seen, /# Session: role-play/);
  assert.match(seen, /You are the server/);
  assert.match(seen, /picked a role-play/);
  assert.equal((chat(v.meta.id).at(-1) as Extract<ChatEvent, { type: "done" }>).message.text, "欢迎光临！请问几位？");
});

test("eraseData: stops a running turn, deletes learner data, keeps dictionaries; sign-ins optional", async () => {
  for (const keepSignIns of [true, false]) {
    const { dir, app, faux, ref } = await makeApp({ tokensPerSecond: 5 });
    await app.setApiKey("openai", "sk-test");
    await app.setSettings({ model: ref, onboarded: true });
    const deviceId = await app.getDeviceId();
    const s = await app.newSession({ language: "zh" });
    faux.setResponses([fauxAssistantMessage("很长很长的一个回答，慢慢地一个字一个字地出来。")]);
    await app.send(s.meta.id, { text: "你好" }, ref); // still streaming when the erase starts
    const file = join(dir, "story.txt");
    writeFileSync(file, "第一段。");
    await app.importFiles("zh", "reader", [file]);
    mkdirSync(join(dir, "dict", "zh"), { recursive: true });
    writeFileSync(join(dir, "dict", "zh", "keep.txt"), "x");

    await app.eraseData({ keepSignIns });

    for (const gone of ["records", "library", "anki"]) assert.equal(existsSync(join(dir, gone)), false, `${gone} erased`);
    assert.ok(existsSync(join(dir, "dict", "zh", "keep.txt")), "dictionaries kept");
    assert.equal(existsSync(join(dir, "credentials.json")), keepSignIns);

    // A new instance on the same folder is a first run.
    const fresh = await makeApp({ dir });
    const settings = await fresh.app.getSettings();
    assert.equal(settings.onboarded, undefined);
    assert.equal(settings.model, undefined);
    assert.equal(settings.deviceId, keepSignIns ? deviceId : undefined, "device id travels with the sign-ins");
    assert.deepEqual(await fresh.app.records.listSessions("zh"), []);
    assert.deepEqual(await fresh.app.listDocs("zh"), []);
    assert.deepEqual((await fresh.app.credentials.list()).map((c) => c.providerId), keepSignIns ? ["openai"] : []);
  }
});

test("openings: skipped when no model is available", async () => {
  const { app, chat } = await makeApp({ withModel: false });
  const v = await app.startPlacement("ja");
  await app.whenIdle();
  assert.equal(v.meta.kind, "placement");
  assert.equal(v.meta.levelBand, undefined);
  assert.equal(chat().length, 0);
  const b = await app.startPlacement("ja", "beginner");
  assert.equal(b.meta.levelBand, "beginner", "the picked band is saved on the session");
});

test("startup recounts learner words once: the learner's own language stops counting", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sayfern-app-"));
  // Records from before the filter: every word of an English sentence counted as Spanish.
  const old = new JsonRecordsStore({ dataDir: join(dir, "records") });
  const s = await old.createSession({ language: "es", kind: "chat", feedbackMode: "inline" });
  const text = "How do I say that I want coffee? Quiero café.";
  await old.appendMessage({ id: "u1", sessionId: s.id, role: "user", text, at: 1 });
  await old.recordLearnerWords({ language: "es", sessionId: s.id, messageId: "u1", sentence: text, words: ["how", "want", "coffee", "querer", "café"], at: 1 });

  const { app } = await makeApp({ dir });
  await app.whenIdle();
  const records = new JsonRecordsStore({ dataDir: join(dir, "records") });
  assert.equal(await records.getWordUsage("es", "want"), null);
  assert.equal(await records.getWordUsage("es", "coffee"), null);
  assert.equal((await records.getWordUsage("es", "querer"))?.count, 1);
  assert.equal((await records.getWordUsage("es", "café"))?.firstSentence, text);
});

test("dictionaries download by themselves for the learner's languages, once, after onboarding", async () => {
  const cedict = gzipSync(Buffer.from("#! version=1\n北京 北京 [Bei3 jing1] /Beijing/\n", "utf8"));
  const calls: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return String(input) === CEDICT_URL ? new Response(cedict, { headers: { "content-length": String(cedict.length) } }) : new Response("no", { status: 404 });
  }) as typeof globalThis.fetch;
  const { app } = await makeApp({ fetch });
  await app.whenDictionariesReady();
  assert.deepEqual(calls, [], "nothing before onboarding");
  // English (WordNet) fails here (404): the error stays on its status, and the next check tries it again.
  await app.setSettings({ onboarded: true, languages: ["zh", "en"], language: "zh" });
  await app.whenDictionariesReady();
  assert.equal((await app.dictionaryStatus("zh")).installed, true);
  assert.deepEqual(calls, [CEDICT_URL, OEWN_URL]);
  assert.ok((await app.dictionaryStatus("en")).error);
  await app.setSettings({ language: "en" });
  await app.whenDictionariesReady();
  assert.deepEqual(calls, [CEDICT_URL, OEWN_URL, OEWN_URL], "an installed dictionary is not downloaded again; a failed one is");
});

test("setSelfLevel records all three skills; home no longer asks for placement", async () => {
  const { app } = await makeApp();
  await app.setSelfLevel("zh", "HSK 3");
  const { current, history } = await app.getLevels("zh");
  assert.deepEqual(Object.keys(current).sort(), ["reading", "recognition", "writing"]);
  assert.ok(Object.values(current).every((e) => e!.level === "HSK 3" && e!.by === "self" && e!.confidence === "medium" && e!.evidence === "Self-rated"));
  assert.equal(history.length, 3);
  const home = await app.getHome("zh");
  assert.equal(home.needsPlacement, false);
  assert.equal(home.levels.writing?.level, "HSK 3");
  assert.equal((await app.getHome("ja")).needsPlacement, true);
});

test("import + reading spot on Today + bad files fail with a clear message", async () => {
  const { app } = await makeApp();
  const file = join(app.dataDir, "story.md");
  writeFileSync(file, "# 故事\n\n第一段。\n\n第二段在这里。\n\n第三段。");
  const [doc] = await app.importFiles("zh", "reader", [file]);
  assert.equal(doc.format, "md");
  assert.equal((await app.listDocs("zh")).length, 1);
  await app.setCheckpoint(doc.id, 1, 0);
  const home = await app.getHome("zh");
  assert.equal(home.reading?.doc.id, doc.id);
  assert.equal(home.reading?.paragraph, 1);
  assert.equal(home.reading?.preview, "第二段在这里。");

  const bad = join(app.dataDir, "notes.docx");
  writeFileSync(bad, "x");
  await assert.rejects(app.importFiles("zh", "reader", [bad]), /can't import/);
  await assert.rejects(app.importFiles("zh", "reader", [file, bad]), /^Error: Added 故事\. /);
});

test("exportTo writes one JSON file with records, library and settings but no device id", async () => {
  const { app, faux, ref } = await makeApp();
  await app.getDeviceId();
  await app.setProfile({ about: "I like hiking." });
  const { meta } = await app.newSession({ language: "zh" });
  faux.setResponses([fauxAssistantMessage("好的！")]);
  await app.send(meta.id, { text: "你好" }, ref);
  await app.whenIdle();
  await app.library.importText({ title: "Notes", text: "你好。", language: "zh", kind: "personal" });

  const path = join(app.dataDir, "out", app.exportFileName());
  assert.match(path, /sayfern-export-2026-09-30\.json$/);
  const res = await app.exportTo(path);
  assert.equal(res.path, path);
  const data = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(data.app, "Sayfern");
  assert.equal(data.records.sessions.length, 1);
  assert.equal(data.records.sessions[0].messages.length, 2);
  assert.equal(data.records.profile.about, "I like hiking.");
  assert.equal(data.library.length, 1);
  assert.equal(data.settings.language, "zh");
  assert.equal(data.settings.deviceId, undefined);
  assert.ok(!JSON.stringify(data).includes("credentials"));
});

test("settings merge with defaults; legacy v0.1 sessions import exactly once", async () => {
  const legacy = {
    v: 1,
    id: "legacy-1",
    title: "旧对话",
    language: "zh",
    createdAt: new Date(2026, 8, 1).getTime(),
    updatedAt: new Date(2026, 8, 1).getTime(),
    transcript: [],
    display: [
      { role: "user", text: "你好", at: new Date(2026, 8, 1).getTime() },
      { role: "tutor", text: "你好！", at: new Date(2026, 8, 1).getTime() },
    ],
    usage: { input: 1, output: 2, cost: 0 },
  };
  const { app } = await makeApp({
    beforeInit: (dir) => {
      mkdirSync(join(dir, "sessions"), { recursive: true });
      writeFileSync(join(dir, "sessions", "legacy-1.json"), JSON.stringify(legacy));
      writeFileSync(join(dir, "settings.json"), JSON.stringify({ language: "ja", deviceId: "dev-1" }));
    },
  });
  const s = await app.getSettings();
  assert.equal(s.language, "ja");
  assert.equal(s.deviceId, "dev-1");
  assert.deepEqual(s.languages, ["zh", "ja"]);
  assert.equal(s.legacyImported, true);
  assert.equal(await app.getDeviceId(), "dev-1");

  const merged = await app.setSettings({ theme: "ink" });
  await app.setSettings({ autoTranslate: true });
  const onDisk = JSON.parse(readFileSync(join(app.dataDir, "settings.json"), "utf8"));
  assert.equal(merged.theme, "ink");
  assert.equal(onDisk.theme, "ink");
  assert.equal(onDisk.autoTranslate, true);
  assert.equal(onDisk.language, "ja");
  assert.equal(onDisk.deviceId, "dev-1");

  const sessions = await app.listSessions("zh");
  assert.deepEqual(sessions.map((x) => x.id), ["legacy-1"]);
  assert.equal((await app.getSession("legacy-1"))?.messages.length, 2);

  // Deleted after import: a restart must not bring it back.
  await app.deleteSession("legacy-1");
  const { app: restarted } = await makeApp({ dir: app.dataDir });
  assert.deepEqual(await restarted.listSessions("zh"), []);

  // New chat sessions always show corrections inline.
  const v = await restarted.newSession({ language: "zh" });
  assert.equal(v.meta.feedbackMode, "inline");
});

test("translate finds the message's session by id; anki status works offline", async () => {
  const { app, faux, ref } = await makeApp();
  const { meta } = await app.newSession({ language: "zh" });
  faux.setResponses([fauxAssistantMessage("你好！"), fauxAssistantMessage("Hello!")]);
  await app.send(meta.id, { text: "你好" }, ref);
  await app.whenIdle();
  const tutorMsg = (await app.getSession(meta.id))!.messages.find((m) => m.role === "tutor")!;
  // A fresh app has no id cache: exercise the scan.
  const { app: fresh, faux: faux2, ref: ref2 } = await makeApp({ dir: app.dataDir });
  faux2.setResponses([fauxAssistantMessage("Hello!")]);
  assert.equal(await fresh.translate(tutorMsg.id, ref2), "Hello!");
  await assert.rejects(fresh.translate("nope", ref2), /no longer exists/);

  const status = await app.ankiStatus();
  assert.equal(status.connected, false);
  assert.equal(status.config.enabled, false);
  assert.deepEqual(status.snapshots, {});
  assert.deepEqual(await app.getProgress("zh", "week").then((p) => p.anki), undefined);
});

test("anki: background refresh at startup and session start (6 h max age, never blocks); ankiOverview", async () => {
  const calls: string[] = [];
  let gate: Promise<void> = Promise.resolve();
  const ankiFetch = (async (_url: string, init?: RequestInit) => {
    const { action } = JSON.parse(String(init?.body)) as { action: string };
    calls.push(action);
    await gate;
    const result =
      action === "findCards"
        ? [1, 2]
        : action === "cardsInfo"
          ? [
              { cardId: 1, note: 1, deckName: "中文", fields: { Hanzi: { value: "猫", order: 0 } }, interval: 30, factor: 2500, lapses: 0, reps: 5, type: 2, queue: 2, due: 1 },
              { cardId: 2, note: 2, deckName: "中文", fields: { Hanzi: { value: "狗", order: 0 } }, interval: 0, factor: 0, lapses: 0, reps: 0, type: 0, queue: 0, due: 3 },
            ]
          : [];
    return new Response(JSON.stringify({ result, error: null }));
  }) as unknown as typeof fetch;
  const config = { enabled: true, url: "http://127.0.0.1:8765", decks: [{ language: "zh", deck: "中文", wordField: "Hanzi" }] };
  const { app, clock } = await makeApp({
    ankiFetch,
    beforeInit: (dir) => {
      mkdirSync(join(dir, "anki"), { recursive: true });
      writeFileSync(join(dir, "anki", "config.json"), JSON.stringify(config));
    },
  });
  await app.whenAnkiFresh();
  assert.ok(calls.includes("cardsInfo"), "synced at startup");
  const o = await app.ankiOverview("zh");
  assert.deepEqual(o?.counts, { known: 1, learning: 0, new: 1, suspended: 0 });
  assert.deepEqual(o?.nextNew.map((w) => w.word), ["狗"]);
  assert.equal(await app.ankiOverview("ja"), null);

  // Fresh snapshot: a new session doesn't sync again.
  const before = calls.length;
  await app.newSession({ language: "zh" });
  await app.whenAnkiFresh();
  assert.equal(calls.length, before);

  // Stale: the session opens without waiting for Anki, which syncs in the background.
  clock.t += 7 * 60 * 60 * 1000;
  let release!: () => void;
  gate = new Promise((r) => (release = r));
  const view = await app.newSession({ language: "zh" });
  assert.equal(view.meta.language, "zh");
  assert.ok(calls.length > before);
  release();
  await app.whenAnkiFresh();
  assert.equal((await app.anki.snapshot("zh"))?.syncedAt, clock.t);
});

test("setDifficulty clamps to -2..2; newTopic streams a tutor turn and blocks send while it runs", async () => {
  const { app, faux, chat, ref } = await makeApp({ tokensPerSecond: 50 });
  const s = await app.newSession({ language: "zh", kind: "chat" });
  assert.equal((await app.setDifficulty(s.meta.id, 7 as never)).difficulty, 2);
  assert.equal((await app.setDifficulty(s.meta.id, -1)).difficulty, -1);
  assert.equal((await app.getSession(s.meta.id))?.meta.difficulty, -1);

  faux.setResponses([fauxAssistantMessage("换个话题吧！你喜欢什么音乐？")]);
  const { requestId } = await app.newTopic(s.meta.id, ref);
  await assert.rejects(app.send(s.meta.id, { text: "你好" }, ref), /still starting/);
  await app.whenIdle();
  const evs = chat(s.meta.id);
  assert.ok(evs.every((e) => e.requestId === requestId));
  const done = evs.at(-1) as Extract<ChatEvent, { type: "done" }>;
  assert.equal(done.type, "done");
  assert.equal(done.message.text, "换个话题吧！你喜欢什么音乐？");
  assert.deepEqual(done.view.messages.map((m) => m.role), ["tutor"]);
  await assert.rejects(app.newTopic("nope", ref), /no longer exists/);
});
