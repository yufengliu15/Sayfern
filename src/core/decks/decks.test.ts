import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createModels, fauxAssistantMessage, fauxProvider, type Api, type Model } from "@earendil-works/pi-ai";
import type { DictEntry } from "../../shared/lang";
import type { AnkiCard, Language } from "../../shared/records";
import type { DeckSpec } from "../../shared/stage2";
import { sharedDecksUrl, suggestDeckName } from "../../shared/stage2";
import { FakeAnki } from "../agent/testkit";
import type { AnkiConnectService } from "../anki";
import { SettingsStore } from "../app/settings";
import type { AnkiAddResult, AnkiNoteInput, AnkiNoteType } from "../contracts";
import { FileCredentialStore } from "../credential-file-store";
import type { FileExtensionHost } from "../extensions";
import { DefaultLanguageService } from "../lang";
import { FileLibraryService } from "../library";
import { JsonRecordsStore } from "../records";
import type { Stage2Deps } from "../stage2";
import { checkCard, noteFor, normReading, rubyHtml, type CardContext } from "./cards";
import { DeckService, sanitizeDeckSpec } from "./index";
import { wordsSystemPrompt } from "./prompts";
import { edgeTts, elevenTts, secMsGec, TtsError, type WsFactory, type WsLike } from "./tts";

// ---------------------------------------------------------------- fakes

/** Answers every SSML request with one binary audio frame, then turn.end. */
function fakeEdge(): { factory: WsFactory; requests: { url: string; headers: Record<string, string>; sent: string[] }[] } {
  const requests: { url: string; headers: Record<string, string>; sent: string[] }[] = [];
  const factory: WsFactory = (url, headers) => {
    const req = { url, headers, sent: [] as string[] };
    requests.push(req);
    const ws: WsLike = {
      binaryType: "blob",
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      send(data) {
        req.sent.push(data);
        if (!data.includes("Path:ssml")) return;
        const text = /<prosody[^>]*>(.*)<\/prosody>/.exec(data)?.[1] ?? "";
        const head = Buffer.from("X-RequestId:1\r\nContent-Type:audio/mpeg\r\nPath:audio\r\n");
        const len = Buffer.alloc(2);
        len.writeUInt16BE(head.length);
        const frame = Buffer.concat([len, head, Buffer.from(`MP3:${text}`)]);
        setTimeout(() => {
          ws.onmessage?.({ data: frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.length) });
          ws.onmessage?.({ data: "X-RequestId:1\r\nPath:turn.end\r\n\r\n{}" });
        }, 1);
      },
      close() {},
    };
    setTimeout(() => ws.onopen?.({}), 1);
    return ws;
  };
  return { factory, requests };
}

class RecordingAnki extends FakeAnki {
  connected = true;
  notes: AnkiNoteInput[] = [];
  media = new Map<string, string>();
  noteTypes: string[] = [];
  decks: string[] = [];
  private nextId = 1000;
  override async ping() {
    return { connected: this.connected };
  }
  override async ensureNoteType(t: AnkiNoteType) {
    this.noteTypes.push(t.name);
    return true;
  }
  override async ensureDeck(deck: string) {
    this.decks.push(deck);
  }
  override async storeMedia(filename: string, base64: string) {
    this.media.set(filename, base64);
    return filename;
  }
  override async addNotes(notes: AnkiNoteInput[]): Promise<AnkiAddResult[]> {
    const out: AnkiAddResult[] = [];
    for (const n of notes) {
      if (this.notes.some((x) => x.fields.Word === n.fields.Word)) out.push({ status: "duplicate" });
      else {
        this.notes.push(n);
        out.push({ status: "added", noteId: this.nextId++ });
      }
    }
    return out;
  }
}

const card = (word: string): AnkiCard => ({
  cardId: word.length,
  noteId: 1,
  deck: "Mine",
  word,
  interval: 30,
  ease: 2500,
  lapses: 0,
  reps: 10,
  status: "review",
});

function harness() {
  const dir = mkdtempSync(join(tmpdir(), "sayfern-decks-"));
  const now = () => new Date(2026, 9, 1, 10, 0).getTime();
  const records = new JsonRecordsStore({ dataDir: join(dir, "records"), now });
  const lang = new DefaultLanguageService({ dataDir: join(dir, "dict") });
  const anki = new RecordingAnki();
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const model = faux.getModel() as Model<Api>;
  const credentials = new FileCredentialStore(join(dir, "credentials.json"));
  const settings = new SettingsStore(join(dir, "settings.json"));
  const fetches: { url: string; init?: RequestInit }[] = [];
  let elevenMode: "ok" | "quota" = "ok";
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    fetches.push({ url: u, init });
    if (u.endsWith("/v1/voices"))
      return Response.json({
        voices: [
          { voice_id: "cloned1", name: "Me", category: "cloned" },
          { voice_id: "v1", name: "Rachel", category: "premade" },
        ],
      });
    if (u.endsWith("/v1/user/subscription"))
      return Response.json({ tier: "free", character_count: 1200, character_limit: 10000, next_character_count_reset_unix: 1790000000 });
    if (u.includes("/v1/text-to-speech/")) {
      if (elevenMode === "quota") return Response.json({ detail: { status: "quota_exceeded", message: "quota" } }, { status: 401 });
      return new Response(new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]));
    }
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
  const edge = fakeEdge();
  let n = 0;
  const deps: Stage2Deps = {
    dataDir: dir,
    models,
    records,
    anki: anki as unknown as AnkiConnectService,
    library: new FileLibraryService({ dataDir: join(dir, "library"), now }),
    lang,
    extensions: null as unknown as FileExtensionHost,
    settings,
    resolveModel: (r) => {
      if (r.provider !== model.provider || r.id !== model.id) throw new Error("Sign in to that model first.");
      return model;
    },
    emit: () => undefined,
    now,
    newId: () => `deck${++n}`,
    fetch: fetchImpl,
    credentials,
  };
  const decks = new DeckService(deps, { ws: edge.factory });
  const ref = { provider: model.provider, id: model.id };
  return { dir, deps, anki, faux, model, ref, decks, edge, fetches, credentials, settings, setEleven: (m: "ok" | "quota") => (elevenMode = m) };
}

const ZH_WORDS = ["银行", "觉得", "特别", "旅行", "护照", "机场", "酒店", "地图"];
const ZH_CARDS: Record<string, { reading: string; definition: string; sentence: string; translation: string }> = {
  银行: { reading: "yínxíng", definition: "bank", sentence: "我下午要去银行换钱。", translation: "I'm going to the bank this afternoon to change money." },
  觉得: { reading: "juéde", definition: "to think, to feel", sentence: "我觉得这个城市很漂亮。", translation: "I think this city is beautiful." },
  特别: { reading: "tèbié", definition: "especially, special", sentence: "这里的菜特别好吃。", translation: "The food here is especially good." },
  旅行: { reading: "lǚxíng", definition: "to travel, trip", sentence: "我们明年去日本旅行。", translation: "We're traveling to Japan next year." },
  护照: { reading: "hùzhào", definition: "passport", sentence: "请给我看一下你的护照。", translation: "Please show me your passport." },
  机场: { reading: "jīchǎng", definition: "airport", sentence: "我们八点到机场。", translation: "We arrive at the airport at eight." },
  酒店: { reading: "jiǔdiàn", definition: "hotel", sentence: "这家酒店离车站很近。", translation: "This hotel is close to the station." },
  地图: { reading: "dìtú", definition: "map", sentence: "你有这个城市的地图吗？", translation: "Do you have a map of this city?" },
};
const cardsFor = (words: string[]) => ({ cards: words.map((w) => ({ word: w, ...ZH_CARDS[w] })) });
const wordsFrom = (prompt: string): string[] => [...prompt.matchAll(/^\d+\. (\S+)/gm)].map((m) => m[1]);

/** Replies to every request from its prompt: word lists and cards for the words asked. */
function autoReply(h: ReturnType<typeof harness>, opts: { words?: string[] } = {}) {
  const prompts: string[] = [];
  const respond = (context: { messages: { content: unknown }[]; systemPrompt?: string }) => {
    const user = String(context.messages.at(-1)?.content ?? "");
    prompts.push(`${context.systemPrompt}\n---\n${user}`);
    if (/Give exactly \d+ new items/.test(user))
      return fauxAssistantMessage(JSON.stringify({ words: (opts.words ?? ZH_WORDS).map((w) => ({ word: w, hint: "x" })) }));
    return fauxAssistantMessage(JSON.stringify(cardsFor(wordsFrom(user))));
  };
  h.faux.setResponses(Array.from({ length: 40 }, () => respond));
  return prompts;
}

const spec = (over: Partial<DeckSpec> = {}): DeckSpec => ({
  language: "zh",
  level: "HSK 3",
  request: "travel",
  size: 8,
  order: "frequency",
  deckName: "",
  skipKnown: true,
  audio: "edge",
  ...over,
});

// ---------------------------------------------------------------- unit

describe("deck cards", () => {
  const lang = new DefaultLanguageService({ dataDir: mkdtempSync(join(tmpdir(), "sayfern-deckdict-")) });
  const dict: Record<string, DictEntry[]> = {
    银行: [{ headword: "银行", reading: "yínháng", senses: [{ glosses: ["bank"] }], source: "CC-CEDICT" }],
    食べる: [{ headword: "食べる", reading: "たべる", senses: [{ glosses: ["to eat"] }], source: "JMdict" }],
  };
  const ctx = (language: Language, dictionary: string | null): CardContext => ({
    language,
    dictionary,
    lang: {
      annotate: (l, t) => lang.annotate(l, t),
      lookup: async (_l, w) => ({ query: w, entries: dict[w] ?? [] }),
    },
  });

  it("fixes a wrong 多音字 reading with the dictionary and builds per-character ruby", async () => {
    await lang.pack("zh").ready();
    const res = await checkCard(
      { word: "银行", reading: "yínxíng", definition: "bank", sentence: "我下午要去银行换钱。", translation: "I'm going to the bank.", notes: "" },
      ctx("zh", "CC-CEDICT"),
    );
    assert.ok(res.ok);
    assert.equal(res.card.reading, "yínháng");
    assert.match(res.card.checks[0], /fixed with CC-CEDICT \(model wrote yínxíng\)/);
    assert.deepEqual(res.card.wordRuby, [
      { text: "银", rt: "yín" },
      { text: "行", rt: "háng" },
    ]);
    const target = res.card.sentenceRuby.filter((s) => s.target).map((s) => `${s.text}:${s.rt}`);
    assert.deepEqual(target, ["银:yín", "行:háng"]);
    const html = rubyHtml(res.card.sentenceRuby, { ruby: false });
    assert.equal(html, "我下午要去<b>银行</b>换钱。");
  });

  it("finds a conjugated Japanese word in the sentence and keeps okurigana outside the ruby", async () => {
    await lang.pack("ja").ready();
    const res = await checkCard(
      {
        word: "食べる",
        reading: "たべる",
        definition: "to eat",
        sentence: "昨日、友達とラーメンを食べました。",
        translation: "Yesterday I ate ramen with a friend.",
        notes: "",
      },
      ctx("ja", "JMdict"),
    );
    assert.ok(res.ok);
    assert.equal(res.card.checks[0], "Reading checked in JMdict");
    assert.deepEqual(res.card.wordRuby, [{ text: "食", rt: "た" }, { text: "べる" }]);
    assert.equal(rubyHtml(res.card.sentenceRuby, { ruby: false }), "昨日、友達とラーメンを<b>食べました</b>。");
    assert.match(rubyHtml(res.card.sentenceRuby, { ruby: true }), /<ruby>昨日<rt>きのう<\/rt><\/ruby>/);
  });

  it("drops cards that can't be used", async () => {
    const base = { reading: "", definition: "x", translation: "x", notes: "" };
    const miss = await checkCard({ ...base, word: "护照", sentence: "我们八点到机场。" }, ctx("zh", null));
    assert.deepEqual(miss, { ok: false, problem: "the sentence doesn't use the word" });
    const latin = await checkCard({ ...base, word: "bank", sentence: "银行" }, ctx("zh", null));
    assert.equal(latin.ok, false);
  });

  it("accepts sayings and set phrases, with ruby word by word", async () => {
    const res = await checkCard(
      {
        word: "一分耕耘，一分收获",
        reading: "",
        definition: "you reap what you sow",
        sentence: "老师常说一分耕耘，一分收获。",
        translation: "The teacher often says you reap what you sow.",
        notes: "",
      },
      ctx("zh", null),
    );
    assert.ok(res.ok, res.ok ? "" : res.problem);
    assert.match(res.card.reading, /gēngyún .*shōuhuò/, "pinyin with a space between words");
    assert.ok(res.card.wordRuby.some((s) => s.text === "，" && !s.rt));
    assert.equal(rubyHtml(res.card.sentenceRuby, { ruby: false }), "老师常说<b>一分耕耘，一分收获</b>。");
    const sentence = await checkCard({ word: "我很好。", reading: "", definition: "x", sentence: "我很好。", translation: "x", notes: "" }, ctx("zh", null));
    assert.equal(sentence.ok, false);
  });

  it("uses the reader's reading without a dictionary and says to install one", async () => {
    const res = await checkCard(
      { word: "特别", reading: "", definition: "special", sentence: "这里的菜特别好吃。", translation: "x", notes: "" },
      ctx("zh", null),
    );
    assert.ok(res.ok);
    assert.equal(res.card.reading, "tèbié");
    assert.deepEqual(res.card.checks, ["Install the dictionary to check readings"]);
  });

  it("escapes HTML and writes the Sayfern Vocab note with sound fields", async () => {
    const res = await checkCard(
      { word: "觉得", reading: "juéde", definition: "to think <feel>", sentence: "我觉得很好。", translation: "I think it's good.", notes: "" },
      ctx("zh", null),
    );
    assert.ok(res.ok);
    const note = noteFor({ ...res.card, audio: { word: "sayfern-a.mp3" } }, "Sayfern::Chinese HSK 3", ["sayfern"]);
    assert.equal(note.modelName, "Sayfern Vocab");
    assert.equal(note.fields.Definition, "to think &lt;feel&gt;");
    assert.equal(note.fields.WordAudio, "[sound:sayfern-a.mp3]");
    assert.equal(note.fields.SentenceAudio, "");
    assert.match(note.fields.SentenceRuby, /<b><ruby>觉<rt>jué<\/rt><\/ruby><ruby>得<rt>de<\/rt><\/ruby><\/b>/);
  });

  it("normalizes readings for comparison", () => {
    assert.equal(normReading("zh", "Yín Háng"), "yínháng");
    assert.equal(normReading("ja", "タベル"), "たべる");
  });

  it("cleans specs and suggests names and links", () => {
    const s = sanitizeDeckSpec({ ...spec(), level: "HSK 99", size: 99999, deckName: "  ", audio: "x" as never }, ["HSK 1", "HSK 3"]);
    assert.equal(s.level, "beginner");
    assert.equal(s.size, 2000);
    assert.equal(s.audio, "edge");
    assert.equal(s.deckName, "Sayfern::Chinese beginner travel");
    assert.equal(suggestDeckName("ja", "N4", ""), "Sayfern::Japanese N4");
    assert.equal(
      suggestDeckName("zh", "HSK 2", "the 1,500 most common words according to SUBTLEX-CH"),
      "Sayfern::Chinese HSK 2",
      "long requests stay out of the name",
    );
    assert.equal(suggestDeckName("zh", "HSK 2", "common foods"), "Sayfern::Chinese HSK 2 common foods");
    const long = sanitizeDeckSpec({ ...spec(), request: `  top   1500\nwords ${"x".repeat(600)}` }, ["HSK 3"]);
    assert.equal(long.request.length, 500);
    assert.ok(long.request.startsWith("top 1500 words"));
    assert.equal(sharedDecksUrl("ja"), "https://ankiweb.net/shared/decks?search=japanese");
  });
});

describe("text to speech", () => {
  it("computes Sec-MS-GEC like edge-tts", () => {
    assert.equal(secMsGec(1_790_000_000_000), "CA99F0B37F2EAC6F5D719AE4BA7C98978842B3F335D9F42979070A8DB149F0A5");
  });

  it("speaks through Edge's read-aloud socket", async () => {
    const edge = fakeEdge();
    const mp3 = await edgeTts("我<你>", "zh-CN-XiaoxiaoNeural", { ws: edge.factory });
    assert.equal(mp3.toString(), "MP3:我&lt;你&gt;");
    const req = edge.requests[0];
    assert.match(req.url, /TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4&ConnectionId=\w{32}&Sec-MS-GEC=[0-9A-F]{64}&Sec-MS-GEC-Version=1-/);
    assert.equal(req.headers.Origin, "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold");
    assert.match(req.sent[0], /Path:speech.config/);
    assert.match(req.sent[1], /<voice name='zh-CN-XiaoxiaoNeural'>/);
  });

  it("turns ElevenLabs quota errors into a quota TtsError", async () => {
    const f = (async () =>
      Response.json({ detail: { status: "quota_exceeded", message: "This request exceeds your quota." } }, { status: 401 })) as unknown as typeof fetch;
    await assert.rejects(elevenTts(f, "k", { text: "你好", voiceId: "v", language: "zh" }), (e: unknown) => e instanceof TtsError && e.kind === "quota");
    const bad = (async () => Response.json({ detail: { status: "invalid_api_key", message: "Invalid API key" } }, { status: 401 })) as unknown as typeof fetch;
    await assert.rejects(elevenTts(bad, "k", { text: "你好", voiceId: "v", language: "zh" }), (e: unknown) => e instanceof TtsError && e.kind === "auth");
  });
});

// ---------------------------------------------------------------- service

describe("DeckService", () => {
  it("plans words, writes samples with audio, then adds batches to a new Anki deck", async () => {
    const h = harness();
    h.anki.cards = [card("地图")]; // already in the learner's Anki
    const prompts = autoReply(h);
    const started = await h.decks.startDeckProject(spec(), h.ref);
    assert.equal(started.status, "planning");
    const preview = (await h.decks.whenIdle(started.id))!;
    assert.equal(preview.status, "preview", preview.error);
    assert.equal(preview.samples.length, 5);
    assert.equal(preview.progress.planned, 7, "地图 is left out: it's already in Anki");
    assert.equal(preview.progress.skipped, 1);
    assert.match(preview.samples[0].audio?.word ?? "", /^data:audio\/mpeg;base64,/);
    assert.equal(preview.samples[0].audioBy, "edge");
    assert.equal(h.anki.notes.length, 0, "nothing reaches Anki before approval");
    assert.match(prompts[0], /HSK 3/);
    assert.match(prompts[0], /What the learner wants \(this decides which items go in the deck.*\): travel/);
    assert.match(prompts[0], /地图/, "known words go on the avoid list");

    await assert.rejects(h.decks.runDeckBatch(started.id), /Approve the sample cards first/);
    const approved = await h.decks.approveDeckSamples(started.id);
    assert.equal(approved.status, "ready");
    const cardRequests = prompts.length;

    await h.decks.runDeckBatch(started.id);
    const done = (await h.decks.whenIdle(started.id))!;
    assert.equal(done.progress.added, 7);
    assert.equal(done.batches.length, 1);
    assert.equal(done.batches[0].added, 7);
    // Samples were reused: one more model request for the 2 other words (+ one to top up the word list).
    assert.ok(prompts.length - cardRequests <= 2, `requests: ${prompts.length - cardRequests}`);
    assert.deepEqual([...new Set(h.anki.decks)], ["Sayfern::Chinese HSK 3 travel"]);
    assert.ok(h.anki.noteTypes.includes("Sayfern Vocab"));
    const bank = h.anki.notes.find((n) => n.fields.Word === "银行")!;
    assert.match(bank.fields.WordAudio, /^\[sound:sayfern-[a-f0-9]{32}\.mp3\]$/);
    assert.ok(h.anki.media.size >= 14, "word + sentence clip per card");
    assert.deepEqual(bank.tags, ["sayfern", "sayfern::deck", "HSK3"]);
    // Sayfern now follows the deck so the tutor can practise its words.
    const cfg = await h.anki.getConfig();
    assert.deepEqual(cfg.decks.at(-1), {
      language: "zh",
      deck: "Sayfern::Chinese HSK 3 travel",
      wordField: "Word",
      readingField: "Reading",
      meaningField: "Definition",
    });
    // The model ran out of new words (only 7 left after 地图): the deck ends there.
    assert.equal(done.status, "done");
    assert.equal(done.progress.remaining, 0);
  });

  it("runs batch after batch in continuous mode and reuses cached audio", async () => {
    const h = harness();
    const many = Array.from({ length: 60 }, (_, i) => `词${String.fromCharCode(0x4e00 + i * 7)}`);
    // Every word gets a card built from a template sentence that contains it.
    const prompts: string[] = [];
    h.faux.setResponses(
      Array.from({ length: 40 }, () => (context: { messages: { content: unknown }[]; systemPrompt?: string }) => {
        const user = String(context.messages.at(-1)?.content ?? "");
        prompts.push(user);
        if (/Give exactly \d+ new items/.test(user)) {
          const taken = new Set(user.match(/词./g) ?? []);
          return fauxAssistantMessage(
            JSON.stringify({
              words: many
                .filter((w) => !taken.has(w))
                .slice(0, 40)
                .map((word) => ({ word })),
            }),
          );
        }
        return fauxAssistantMessage(
          JSON.stringify({
            cards: wordsFrom(user).map((w) => ({
              word: w,
              reading: "",
              definition: "a word",
              sentence: `我们今天学${w}。`,
              translation: "We learn it today.",
            })),
          }),
        );
      }),
    );
    const started = await h.decks.startDeckProject(spec({ size: 50, request: "" }), h.ref);
    await h.decks.whenIdle(started.id);
    await h.decks.approveDeckSamples(started.id);
    await h.decks.runDeckBatch(started.id, undefined, { continuous: true });
    const done = (await h.decks.whenIdle(started.id))!;
    assert.equal(done.status, "done", done.lastError);
    assert.equal(done.progress.added, 50);
    assert.equal(done.batches.length, 2);
    assert.equal(h.anki.notes.length, 50);
    const sockets = h.edge.requests.length;
    assert.equal(sockets, 100, "one clip per word and sentence, sample clips reused from the cache");
  });

  it("stops before spending tokens when Anki isn't open", async () => {
    const h = harness();
    autoReply(h);
    const p = await h.decks.startDeckProject(spec(), h.ref);
    await h.decks.whenIdle(p.id);
    await h.decks.approveDeckSamples(p.id);
    h.anki.connected = false;
    const before = h.faux.state.callCount;
    await h.decks.runDeckBatch(p.id);
    const v = (await h.decks.whenIdle(p.id))!;
    assert.equal(v.status, "ready");
    assert.match(v.lastError ?? "", /Can't reach Anki|Anki/);
    assert.equal(h.faux.state.callCount, before);
  });

  it("connects ElevenLabs, uses it for audio and falls back to the free voices when credits run out", async () => {
    const h = harness();
    await assert.rejects(h.decks.startDeckProject(spec({ audio: "elevenlabs" }), h.ref), /Connect ElevenLabs first/);
    const status = await h.decks.connectElevenLabs("  sk_test  ");
    assert.equal(status.connected, true);
    assert.equal(status.voiceId, "v1", "a premade voice by default");
    assert.equal(status.creditsLeft, 8800);
    assert.equal(status.tier, "free");
    assert.deepEqual(await h.credentials.read("elevenlabs"), { type: "api_key", key: "sk_test" });

    const est = await h.decks.estimateDeck(spec({ audio: "elevenlabs", size: 100 }));
    assert.deepEqual({ batches: est.batches, chars: est.audioCharacters, after: est.creditsAfter }, { batches: 4, chars: 1600, after: 7200 });

    autoReply(h);
    const p = await h.decks.startDeckProject(spec({ audio: "elevenlabs" }), h.ref);
    const preview = (await h.decks.whenIdle(p.id))!;
    assert.equal(preview.samples[0].audioBy, "elevenlabs");
    const tts = h.fetches.filter((f) => f.url.includes("/v1/text-to-speech/v1"));
    assert.ok(tts.length >= 10);
    assert.equal(JSON.parse(String(tts[0].init?.body)).model_id, "eleven_flash_v2_5");

    await h.decks.approveDeckSamples(p.id);
    h.setEleven("quota");
    await h.decks.runDeckBatch(p.id);
    const v = (await h.decks.whenIdle(p.id))!;
    assert.equal(v.progress.added, 8);
    assert.match(v.lastError ?? "", /credits for this month are used up.*free voices/);
    assert.ok((v.batches[0].audioFallbacks ?? 0) > 0);
    assert.ok(h.edge.requests.length > 0);

    const off = await h.decks.disconnectElevenLabs();
    assert.equal(off.connected, false);
    assert.equal(await h.credentials.read("elevenlabs"), undefined);
  });

  it("follows the learner's request and continues a ranked list across requests", async () => {
    const h = harness();
    const prompts = autoReply(h, { words: ZH_WORDS.slice(0, 3) });
    const p = await h.decks.startDeckProject(spec({ request: "The 1,500 most common words according to SUBTLEX-CH", size: 10, skipKnown: false }), h.ref);
    const v = (await h.decks.whenIdle(p.id))!;
    assert.equal(v.spec.deckName, "Sayfern::Chinese HSK 3");
    assert.match(prompts[0], /What the learner wants .*: The 1,500 most common words according to SUBTLEX-CH/);
    assert.match(wordsSystemPrompt("zh"), /follow it as closely as you know it, in its order/);
    assert.match(prompts[0], /The learner's level: HSK 3\. Use it for anything the request leaves open/);
    assert.doesNotMatch(prompts[0], /Choose words that belong at HSK 3/);
    assert.doesNotMatch(prompts[0], /Continue from item/);
    assert.match(prompts[1], /Items 1 to 3 of this list are already taken.*Continue from item 4\./);
    const cardPrompt = prompts.find((x) => x.includes("Words:"))!;
    assert.match(cardPrompt, /What the learner asked this deck to cover: The 1,500 most common words/);
  });

  it("redoes samples with the learner's notes and sends them with every request", async () => {
    const h = harness();
    const prompts = autoReply(h);
    const p = await h.decks.startDeckProject(spec(), h.ref);
    await h.decks.whenIdle(p.id);
    await h.decks.redoDeckSamples(p.id, "Shorter sentences please");
    const v = (await h.decks.whenIdle(p.id))!;
    assert.equal(v.status, "preview");
    assert.equal(v.guidance, "Shorter sentences please");
    assert.match(prompts.at(-1)!, /Shorter sentences please/);
  });

  it("recovers a project left mid-batch by a restart", async () => {
    const h = harness();
    autoReply(h);
    const p = await h.decks.startDeckProject(spec(), h.ref);
    await h.decks.whenIdle(p.id);
    await h.decks.approveDeckSamples(p.id);
    await h.decks.store.update(p.id, (f) => {
      f.status = "generating";
    });
    const v = (await h.decks.getDeckProject(p.id))!;
    assert.equal(v.status, "ready");
    assert.match(v.lastError ?? "", /closed during a batch/);
    const list = await h.decks.listDeckProjects("zh");
    assert.equal(list[0].deckName, "Sayfern::Chinese HSK 3 travel");
    await h.decks.deleteDeckProject(p.id);
    assert.equal(await h.decks.getDeckProject(p.id), null);
  });
});
