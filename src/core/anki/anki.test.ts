import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { AnkiConfig } from "../../shared/records";
import type { AnkiSnapshot } from "../../shared/records";
import { AnkiConnectService, cleanField, deckQuery, furiganaReading } from "./index";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 30, 12);

interface FakeReview {
  /** Review time, ms epoch. */
  id: number;
  /** Button 1..4 (0 = manual reschedule). */
  ease: number;
  /** Answer time, ms. */
  ms?: number;
  /** 0 learn, 1 review, 2 relearn, 3 filtered, 4 manual. */
  type?: number;
}

interface FakeCard {
  cardId: number;
  note: number;
  deckName: string;
  fields: Record<string, string>;
  interval: number;
  factor: number;
  lapses: number;
  reps: number;
  /** Default: 0 when reps is 0, 1 when interval < 0, else 2. */
  type?: number;
  /** Default: same as type (relearning → 1). */
  queue?: number;
  due?: number;
  tags?: string[];
  reviews: FakeReview[];
}

interface FakeOptions {
  down?: boolean;
  /** AnkiConnect without cardReviews (older add-on). */
  noCardReviews?: boolean;
  /** Neither cardReviews nor getReviewsOfCards. */
  noHistory?: boolean;
  /** cardsInfo without type/queue/due (very old add-on). */
  oldCardsInfo?: boolean;
}

const typeOf = (c: FakeCard) => c.type ?? (c.reps === 0 ? 0 : c.interval < 0 ? 1 : 2);

/** In-memory AnkiConnect implementing the actions the service uses. */
function fakeAnki(cards: FakeCard[], opts: FakeOptions = {}) {
  const state = { down: opts.down ?? false, calls: [] as string[], queries: [] as string[] };
  const search = (q: string) => {
    const deck = /deck:"((?:\\.|[^"])*)"/.exec(q)?.[1]?.replace(/\\(.)/g, "$1") ?? "";
    let list = cards.filter((c) => c.deckName === deck || c.deckName.startsWith(`${deck}::`));
    const rated = /rated:(\d+)/.exec(q);
    if (rated) {
      const days = Number(rated[1]);
      const since = rated[1] === "1" ? NOW - 6 * 3_600_000 : NOW - days * DAY;
      list = list.filter((c) => c.reviews.some((r) => r.id >= since && r.ease > 0));
    }
    const tag = /tag:(\S+)/.exec(q);
    if (tag) list = list.filter((c) => (c.tags ?? []).includes(tag[1]));
    return list;
  };
  const fieldsOf = (c: FakeCard) => Object.fromEntries(Object.entries(c.fields).map(([k, v], order) => [k, { value: v, order }]));
  const fetchFn: typeof fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    if (state.down) throw new TypeError("fetch failed");
    const req = JSON.parse(String(init?.body)) as { action: string; version: number; params?: Record<string, unknown> };
    assert.equal(req.version, 6);
    state.calls.push(req.action);
    const p = req.params ?? {};
    let result: unknown;
    switch (req.action) {
      case "version":
        result = 6;
        break;
      case "deckNames":
        result = [...new Set(cards.map((c) => c.deckName))];
        break;
      case "findNotes":
        result = [...new Set(search(String(p.query)).map((c) => c.note))];
        break;
      case "notesInfo":
        result = (p.notes as number[]).map((id) => {
          const c = cards.find((x) => x.note === id)!;
          return { noteId: id, fields: fieldsOf(c), tags: c.tags ?? [] };
        });
        break;
      case "findCards":
        state.queries.push(String(p.query));
        result = search(String(p.query)).map((c) => c.cardId);
        break;
      case "cardsInfo":
        assert.ok((p.cards as number[]).length <= 500);
        result = (p.cards as number[]).map((id) => {
          const c = cards.find((x) => x.cardId === id)!;
          const info: Record<string, unknown> = {
            cardId: c.cardId,
            note: c.note,
            deckName: c.deckName,
            fields: fieldsOf(c),
            interval: c.interval,
            factor: c.factor,
            lapses: c.lapses,
            reps: c.reps,
          };
          if (!opts.oldCardsInfo) {
            const type = typeOf(c);
            info.type = type;
            info.queue = c.queue ?? (type === 3 ? 1 : type);
            info.due = c.due ?? (type === 0 ? c.cardId : 20_000);
          }
          return info;
        });
        break;
      case "cardReviews": {
        if (opts.noCardReviews || opts.noHistory) return new Response(JSON.stringify({ result: null, error: "unsupported action" }));
        const startID = Number(p.startID);
        // Like AnkiConnect: exact deck only (did = deck id), reviews after startID.
        result = cards
          .filter((c) => c.deckName === p.deck)
          .flatMap((c) =>
            c.reviews
              .filter((r) => r.id > startID)
              .map((r) => [r.id, c.cardId, -1, r.ease, c.interval, 1, c.factor, r.ms ?? 5000, r.type ?? 1]),
          );
        break;
      }
      case "getReviewsOfCards":
        if (opts.noHistory) return new Response(JSON.stringify({ result: null, error: "unsupported action" }));
        result = Object.fromEntries(
          (p.cards as number[]).map((id) => [
            String(id),
            cards.find((x) => x.cardId === id)!.reviews.map((r) => ({ id: r.id, ease: r.ease, time: r.ms ?? 5000, type: r.type ?? 1 })),
          ]),
        );
        break;
      default:
        return new Response(JSON.stringify({ result: null, error: "unsupported action" }));
    }
    return new Response(JSON.stringify({ result, error: null }));
  }) as typeof fetch;
  return { fetch: fetchFn, state };
}

let nextId = 1;
function card(word: string, extra: Partial<FakeCard> & { reading?: string; meaning?: string } = {}): FakeCard {
  const id = nextId++;
  const { reading, meaning, ...rest } = extra;
  return {
    cardId: 1000 + id,
    note: 5000 + id,
    deckName: "中文",
    fields: { Hanzi: word, Pinyin: reading ?? "", English: meaning ?? "" },
    interval: 5,
    factor: 2500,
    lapses: 0,
    reps: 3,
    reviews: [],
    ...rest,
  };
}

/** n answers, `fails` of them "again", spread over the last n days. */
function answers(n: number, fails: number, ms = 5000): FakeReview[] {
  return Array.from({ length: n }, (_, i) => ({ id: NOW - (i + 1) * DAY + 1000, ease: i < fails ? 1 : 3, ms }));
}

const ZH_CONFIG: AnkiConfig = {
  enabled: true,
  url: "http://127.0.0.1:8765",
  decks: [{ language: "zh", deck: "中文", wordField: "Hanzi", readingField: "Pinyin", meaningField: "English" }],
};

function setup(cards: FakeCard[], opts: FakeOptions = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "sayfern-anki-"));
  const fake = fakeAnki(cards, opts);
  const clock = { t: NOW };
  const anki = new AnkiConnectService({ dataDir, fetch: fake.fetch, now: () => clock.t });
  return { dataDir, anki, fake, clock };
}

describe("field cleaning", () => {
  it("strips HTML, entities, sound tags and furigana", () => {
    assert.equal(cleanField("<b>你好</b>&nbsp;<br>[sound:a.mp3]"), "你好");
    assert.equal(cleanField(" 日本[にほん] 語[ご]"), "日本語");
    assert.equal(cleanField("食[た]べる"), "食べる");
    assert.equal(cleanField("<div>to eat [colloquial]</div>"), "to eat [colloquial]");
    assert.equal(cleanField("<ruby>漢字<rt>かんじ</rt></ruby>"), "漢字");
    assert.equal(furiganaReading("日本[にほん] 語[ご]"), "にほんご");
    assert.equal(furiganaReading("食[た]べる"), "たべる");
    assert.equal(furiganaReading("你好[nǐ hǎo]"), "nǐ hǎo");
    assert.equal(furiganaReading("plain"), undefined);
  });

  it("escapes deck names in queries", () => {
    assert.equal(deckQuery('a "b"_c*'), 'deck:"a \\"b\\"\\_c\\*"');
  });
});

describe("AnkiConnectService", () => {
  it("persists config with defaults", async () => {
    const { dataDir, anki } = setup([]);
    assert.deepEqual(await anki.getConfig(), { enabled: false, url: "http://127.0.0.1:8765", decks: [] });
    const saved = await anki.setConfig({
      enabled: true,
      url: " http://localhost:8765/ ",
      decks: [
        { language: "zh", deck: "中文", wordField: "Hanzi" },
        { language: "zh", deck: "", wordField: "x" },
      ],
    });
    assert.equal(saved.url, "http://localhost:8765");
    assert.equal(saved.decks.length, 1);
    const again = new AnkiConnectService({ dataDir });
    assert.deepEqual(await again.getConfig(), saved);
    assert.ok(existsSync(join(dataDir, "config.json")));
  });

  it("ping reports connection and never throws", async () => {
    const up = setup([]);
    assert.deepEqual(await up.anki.ping(), { connected: true, version: 6 });
    const down = setup([], { down: true });
    const r = await down.anki.ping();
    assert.equal(r.connected, false);
    assert.match(r.error ?? "", /Anki is running/);
  });

  it("lists decks and field names", async () => {
    const { anki } = setup([card("你好"), card("猫", { deckName: "日本語::N5", fields: { Word: "猫", Reading: "ねこ" } })]);
    assert.deepEqual(await anki.deckNames(), ["中文", "日本語::N5"].sort((a, b) => a.localeCompare(b)));
    assert.deepEqual(await anki.fieldNames("中文"), ["Hanzi", "Pinyin", "English"]);
    assert.deepEqual(await anki.fieldNames("日本語"), ["Word", "Reading"]);
    assert.deepEqual(await anki.fieldNames("empty"), []);
  });

  it("syncs a snapshot with cleaned fields, counts and recent reviews", async () => {
    const cards = [
      card("<b>你好</b>&nbsp;", { reading: "nǐ hǎo", meaning: "hello<br>hi", interval: 30, reviews: [{ id: NOW - 2 * DAY, ease: 3 }, { id: NOW - 3 * 3_600_000, ease: 1 }] }),
      card("谢谢", { interval: 21, reviews: [{ id: NOW - 20 * DAY, ease: 3 }] }),
      card("再见", { interval: -600, factor: 0, reps: 1, reviews: [{ id: NOW - 5 * DAY, ease: 2 }, { id: NOW - 5 * DAY + 1000, ease: 0 }] }),
      card("", { interval: 40 }), // empty word: skipped
      card("学习", { deckName: "中文::HSK1", interval: 3 }),
      card("other", { deckName: "Other" }),
    ];
    const { dataDir, anki } = setup(cards);
    await anki.setConfig(ZH_CONFIG);
    const snap = await anki.sync("zh");
    assert.equal(snap.language, "zh");
    assert.equal(snap.syncedAt, NOW);
    assert.deepEqual(snap.cards.map((c) => c.word).sort(), ["你好", "再见", "学习", "谢谢"].sort());
    const hello = snap.cards.find((c) => c.word === "你好")!;
    assert.equal(hello.reading, "nǐ hǎo");
    assert.equal(hello.meaning, "hello hi");
    assert.equal(hello.lastReviewAt, NOW - 3 * 3_600_000);
    assert.equal(hello.lastEase, 1);
    const bye = snap.cards.find((c) => c.word === "再见")!;
    assert.equal(bye.interval, 0);
    assert.equal(bye.lastReviewAt, NOW - 5 * DAY); // manual (ease 0) entry ignored
    assert.equal(snap.cards.find((c) => c.word === "谢谢")!.lastReviewAt, NOW - 20 * DAY); // 90-day history
    assert.equal(snap.historyDays, 90);
    assert.equal(hello.recentReviews, 2);
    assert.equal(hello.recentFails, 1);
    assert.equal(bye.recentReviews, 1);
    assert.equal(bye.status, "learning");
    assert.equal(snap.matureCount, 2);
    assert.equal(snap.reviewedToday, 1);
    assert.equal(snap.reviewsLast7d, 3);
    assert.deepEqual(JSON.parse(readFileSync(join(dataDir, "snapshot-zh.json"), "utf8")), snap);
    assert.deepEqual(await new AnkiConnectService({ dataDir }).snapshot("zh"), snap);
  });

  it("batches cardsInfo in groups of 500", async () => {
    const many = Array.from({ length: 1203 }, (_, i) => card(`词${i}`));
    const { anki, fake } = setup(many);
    await anki.setConfig(ZH_CONFIG);
    const snap = await anki.sync("zh");
    assert.equal(snap.cards.length, 1203);
    assert.equal(fake.state.calls.filter((c) => c === "cardsInfo").length, 3);
  });

  it("finds cards by word or reading", async () => {
    const { anki } = setup([card("猫", { reading: "māo" }), card("狗")]);
    assert.equal(await anki.findCard("zh", "猫"), null); // no snapshot yet
    await anki.setConfig(ZH_CONFIG);
    await anki.sync("zh");
    assert.equal((await anki.findCard("zh", "猫"))?.reading, "māo");
    assert.equal((await anki.findCard("zh", "māo"))?.word, "猫");
    assert.equal(await anki.findCard("zh", "鸟"), null);
    assert.equal(await anki.findCard("ja", "猫"), null);
  });

  it("selects interleaved recent and difficult targets, skipping overused words", async () => {
    const cards = [
      card("recent1", { reviews: [{ id: NOW - 1 * DAY, ease: 3 }] }),
      card("recent2", { reviews: [{ id: NOW - 2 * DAY, ease: 3 }] }),
      card("recent3", { reviews: [{ id: NOW - 3 * DAY, ease: 3 }] }),
      card("hard1", { lapses: 5 }),
      card("hard2", { lapses: 2 }),
      card("hard3", { factor: 1600 }),
      card("mild", { factor: 2100 }), // struggle .05: below the difficult-target bar
      card("both", { lapses: 4, reviews: [{ id: NOW - 0.5 * DAY, ease: 1 }] }),
      card("used", { lapses: 9 }),
      card("new", { factor: 0, reps: 0 }),
      card("old", { reviews: [{ id: NOW - 30 * DAY, ease: 3 }] }),
    ];
    const { anki } = setup(cards);
    await anki.setConfig(ZH_CONFIG);
    await anki.sync("zh");
    const usage = async (w: string) => (w === "used" ? 3 : w === "hard1" ? 2 : 0);
    const targets = await anki.selectTargets("zh", 10, usage);
    // difficult by struggle: both .30, used .27 (overused), hard1 .21, hard2 .12, hard3 .11
    assert.deepEqual(
      targets.map((t) => [t.word, t.reason]),
      [
        ["both", "recent"],
        ["recent1", "recent"], // "both" came up again as difficult: deduped; "used" is overused
        ["recent2", "recent"],
        ["hard1", "difficult"],
        ["recent3", "recent"],
        ["hard2", "difficult"],
        ["hard3", "difficult"],
      ],
    );
    assert.ok(targets.every((t) => t.status === "pending" && typeof t.cardId === "number"));
    const three = await anki.selectTargets("zh", 3, usage);
    assert.deepEqual(three.map((t) => t.word), ["both", "recent1", "recent2"]);
    assert.deepEqual(await anki.selectTargets("zh", 0, usage), []);
    assert.deepEqual(await anki.selectTargets("ja", 5, usage), []);
  });

  it("throws a friendly error when Anki is unreachable while the cached snapshot keeps working", async () => {
    const cards = [card("你好", { reviews: [{ id: NOW - DAY, ease: 3 }] })];
    const { dataDir, anki, fake } = setup(cards);
    await anki.setConfig(ZH_CONFIG);
    const first = await anki.sync("zh");
    fake.state.down = true;
    await assert.rejects(anki.sync("zh"), /Anki isn't running|Anki is running.*AnkiConnect/);
    assert.deepEqual(await anki.snapshot("zh"), first);
    const fresh = new AnkiConnectService({ dataDir, fetch: fake.fetch, now: () => NOW });
    await assert.rejects(fresh.sync("zh"), /AnkiConnect add-on/);
    assert.deepEqual(await fresh.snapshot("zh"), first);
    assert.equal((await fresh.findCard("zh", "你好"))?.word, "你好");
    assert.equal((await fresh.selectTargets("zh", 2, async () => 0)).length, 1);
  });

  it("requires a deck mapping to sync", async () => {
    const { anki } = setup([]);
    await assert.rejects(anki.sync("ja"), /No Anki deck is linked/);
  });

  it("selectTargets ranks difficult words by struggle score, not lapses alone", async () => {
    // Reviewed 10+ days ago, so none are "recent" picks.
    const old = (n: number, fails: number) => answers(n, fails).map((r) => ({ ...r, id: r.id - 10 * DAY }));
    const { anki } = setup([
      card("lapsey", { lapses: 2, reviews: old(10, 0) }),
      card("failing", { lapses: 0, factor: 1500, reviews: old(8, 6) }),
      card("fine", { reviews: old(5, 0) }),
    ]);
    await anki.setConfig(ZH_CONFIG);
    await anki.sync("zh");
    const t = await anki.selectTargets("zh", 5, async () => 0);
    assert.deepEqual(t.map((x) => [x.word, x.reason]), [
      ["failing", "difficult"],
      ["lapsey", "difficult"],
    ]);
    assert.deepEqual((await anki.struggling("zh", 5)).map((w) => w.word), ["failing"]);
  });
});

describe("snapshot enrichment", () => {
  it("maps card type and queue to status, stage, new position, maturity and leech", async () => {
    const cards = [
      card("新", { type: 0, reps: 0, interval: 0, factor: 0, due: 7 }),
      card("学", { type: 1, interval: -600, factor: 0, reps: 1 }),
      card("复", { type: 3, interval: 1, lapses: 2, reps: 9 }),
      card("熟", { type: 2, interval: 40 }),
      card("停", { type: 2, queue: -1, interval: 30, lapses: 8, tags: ["leech"] }),
      card("埋", { type: 2, queue: -2, interval: 3 }),
      card("埋2", { type: 0, queue: -3, reps: 0, factor: 0, due: 2 }),
    ];
    const { anki } = setup(cards);
    await anki.setConfig(ZH_CONFIG);
    const snap = await anki.sync("zh");
    const by = (w: string) => snap.cards.find((c) => c.word === w)!;
    assert.deepEqual(
      ["新", "学", "复", "熟", "停", "埋", "埋2"].map((w) => [w, by(w).status, by(w).stage]),
      [
        ["新", "new", "new"],
        ["学", "learning", "learning"],
        ["复", "learning", "learning"],
        ["熟", "review", "review"],
        ["停", "suspended", "review"],
        ["埋", "buried", "review"],
        ["埋2", "buried", "new"],
      ],
    );
    assert.equal(by("新").newPosition, 7);
    assert.equal(by("埋2").newPosition, 2);
    assert.equal(by("熟").newPosition, undefined);
    assert.equal(by("复").relearning, true);
    assert.equal(by("熟").mature, true);
    assert.equal(by("埋").mature, false);
    assert.equal(by("停").leech, true);
    assert.equal(by("熟").leech, undefined);
  });

  it("reads 90 days of history per deck (subdecks too), skipping manual entries", async () => {
    const cards = [
      card("甲", { reviews: [...answers(4, 2, 4000), { id: NOW - 100 * DAY, ease: 1 }, { id: NOW - DAY, ease: 0, type: 4 }] }),
      card("乙", { deckName: "中文::HSK2", reviews: [{ id: NOW - 2 * DAY, ease: 3, ms: 120_000 }, { id: NOW - 3 * DAY, ease: 4, ms: 2000 }] }),
    ];
    const { anki, fake } = setup(cards);
    await anki.setConfig(ZH_CONFIG);
    const snap = await anki.sync("zh");
    const a = snap.cards.find((c) => c.word === "甲")!;
    assert.deepEqual([a.recentReviews, a.recentFails, a.avgAnswerMs, a.lastReviewAt, a.lastEase], [4, 2, 4000, NOW - DAY + 1000, 1]);
    const b = snap.cards.find((c) => c.word === "乙")!;
    assert.equal(b.recentReviews, 2);
    assert.equal(b.avgAnswerMs, 31_000); // 120 s capped at 60 s
    assert.equal(fake.state.calls.filter((c) => c === "cardReviews").length, 2);
    assert.ok(!fake.state.calls.includes("getReviewsOfCards"));
    assert.ok(fake.state.queries.some((q) => q.endsWith("tag:leech")));
  });

  it("falls back to getReviewsOfCards, then to no history, without failing the sync", async () => {
    const cards = [card("甲", { reviews: answers(3, 1) }), card("乙", { reviews: [{ id: NOW - 45 * DAY, ease: 1 }] })];
    const old = setup(cards, { noCardReviews: true });
    await old.anki.setConfig(ZH_CONFIG);
    const s1 = await old.anki.sync("zh");
    assert.equal(s1.historyDays, 30);
    assert.equal(s1.cards.find((c) => c.word === "甲")!.recentFails, 1);
    assert.equal(s1.cards.find((c) => c.word === "乙")!.recentReviews, 0); // outside the 30-day window
    assert.ok(old.fake.state.calls.includes("getReviewsOfCards"));

    const none = setup(cards, { noHistory: true, oldCardsInfo: true });
    await none.anki.setConfig(ZH_CONFIG);
    const s2 = await none.anki.sync("zh");
    assert.equal(s2.historyDays, undefined);
    assert.equal(s2.cards[0].recentReviews, undefined);
    assert.equal(s2.cards[0].status, undefined);
    // Words still work from inferred stages.
    assert.deepEqual((await none.anki.checkWords("zh", ["甲"])), { 甲: "known" });
  });
});

describe("word queries", () => {
  const vocab = () => [
    card("猫", { reading: "māo", meaning: "cat", interval: 30, reviews: [{ id: NOW - DAY, ease: 3 }] }),
    card("猫", { reading: "māo", meaning: "cat", interval: 2, type: 3, lapses: 6, factor: 1500, reviews: answers(6, 4) }), // production card
    card("狗", { reading: "gǒu", meaning: "dog", interval: 10, reviews: [{ id: NOW - 3 * DAY, ease: 3 }] }),
    card("鸟", { reading: "niǎo", meaning: "bird", type: 1, interval: -60, factor: 0, reps: 1 }),
    card("鱼", { reading: "yú", meaning: "fish", type: 0, reps: 0, factor: 0, due: 12 }),
    card("马", { reading: "mǎ", meaning: "horse", type: 0, reps: 0, factor: 0, due: 3 }),
    card("牛", { reading: "niú", meaning: "cow", type: 0, reps: 0, factor: 0, due: 8 }),
    card("虎", { reading: "hǔ", meaning: "tiger", type: 2, queue: -1, lapses: 9, tags: ["leech"] }),
    card("羊", { reading: "yáng", meaning: "sheep", interval: 4, reviews: answers(1, 1) }), // one fail of one review
  ];

  async function synced() {
    const env = setup(vocab());
    await env.anki.setConfig(ZH_CONFIG);
    await env.anki.sync("zh");
    return env;
  }

  it("aggregates cards per word and filters, sorts and pages", async () => {
    const { anki } = await synced();
    const all = await anki.words("zh", { status: "all", limit: 100 });
    assert.equal(all.total, 8);
    assert.equal(all.syncedAt, NOW);
    const cat = all.items.find((w) => w.word === "猫")!;
    assert.equal(cat.cards, 2);
    assert.equal(cat.status, "known");
    assert.equal(cat.mature, true);
    assert.equal(cat.lapses, 6);
    assert.equal(cat.recentReviews, 7);
    assert.ok(cat.reasons.includes("relearning now"));

    const known = await anki.words("zh", { status: "known" });
    assert.deepEqual(known.items.map((w) => w.word), ["猫", "羊", "狗"]); // most recently reviewed first
    const next = await anki.words("zh", { status: "new" });
    assert.deepEqual(next.items.map((w) => w.word), ["马", "牛", "鱼"]);
    const page2 = await anki.words("zh", { status: "new", limit: 1, offset: 1 });
    assert.deepEqual([page2.total, page2.items.map((w) => w.word)], [3, ["牛"]]);
    assert.deepEqual((await anki.words("zh", { status: "learning" })).items.map((w) => w.word), ["鸟"]);
    assert.deepEqual((await anki.words("zh", { status: "suspended" })).items.map((w) => w.word), ["虎"]);

    assert.deepEqual((await anki.words("zh", { search: "niu" })).items.map((w) => w.word), ["牛"]); // reading, tones ignored
    assert.deepEqual((await anki.words("zh", { search: "BIRD" })).items.map((w) => w.word), ["鸟"]);
    assert.deepEqual((await anki.words("zh", { search: "狗" })).items.map((w) => w.word), ["狗"]);
    assert.deepEqual(await anki.words("ja", {}), { total: 0, items: [], syncedAt: null });
  });

  it("ranks struggling words: a single failed review is not 'hardest'", async () => {
    const { anki } = await synced();
    const hard = await anki.struggling("zh", 10);
    assert.deepEqual(hard.map((w) => w.word), ["猫"]); // 虎 is suspended; 羊 failed 1 of 1
    assert.match(hard[0].reasons.join(", "), /6 lapses/);
    assert.match(hard[0].reasons.join(", "), /failed 4 of last 7/);
    const sheep = (await anki.words("zh", { search: "羊" })).items[0];
    assert.ok(sheep.struggle > 0 && sheep.struggle < 0.2);
  });

  it("checks words by word or reading", async () => {
    const { anki } = await synced();
    assert.deepEqual(await anki.checkWords("zh", ["猫", "gǒu", "鱼", "鸟", "虎", "龙", " 猫 ", ""]), {
      猫: "known",
      gǒu: "known",
      鱼: "new",
      鸟: "learning",
      虎: "suspended",
      龙: "unknown",
    });
    assert.deepEqual(await anki.checkWords("ja", ["猫"]), { 猫: "unknown" });
  });

  it("builds an overview with counts, next new words in order and top struggling", async () => {
    const { anki } = await synced();
    const o = (await anki.overview("zh"))!;
    assert.deepEqual(o.counts, { known: 3, learning: 1, new: 3, suspended: 1 });
    assert.equal(o.mature, 1);
    assert.equal(o.young, 2);
    assert.equal(o.newRemaining, 3);
    assert.equal(o.struggling, 1);
    assert.deepEqual(o.nextNew.map((w) => w.word), ["马", "牛", "鱼"]);
    assert.deepEqual(o.topStruggling.map((w) => w.word), ["猫"]);
    assert.equal(await anki.overview("ja"), null);
  });

  it("still works on a snapshot cached by 0.1.x (no status, history or positions)", async () => {
    const { dataDir } = setup([]);
    const old: AnkiSnapshot = {
      language: "zh",
      syncedAt: NOW - DAY,
      reviewedToday: 2,
      reviewsLast7d: 9,
      matureCount: 1,
      cards: [
        { cardId: 1, noteId: 1, deck: "中文", word: "山", interval: 30, ease: 2500, lapses: 0, reps: 8, lastReviewAt: NOW - DAY, lastEase: 3 },
        { cardId: 2, noteId: 2, deck: "中文", word: "水", interval: 2, ease: 1400, lapses: 5, reps: 12, lastReviewAt: NOW - DAY, lastEase: 1 },
        { cardId: 3, noteId: 3, deck: "中文", word: "火", interval: 0, ease: 0, lapses: 0, reps: 0 },
        { cardId: 4, noteId: 4, deck: "中文", word: "木", interval: 0, ease: 0, lapses: 0, reps: 2 },
      ],
    };
    writeFileSync(join(dataDir, "snapshot-zh.json"), JSON.stringify(old));
    const anki = new AnkiConnectService({ dataDir, now: () => NOW });
    const o = (await anki.overview("zh"))!;
    assert.deepEqual(o.counts, { known: 2, learning: 1, new: 1, suspended: 0 });
    assert.equal(o.mature, 1);
    assert.deepEqual(o.topStruggling.map((w) => w.word), ["水"]);
    assert.deepEqual(await anki.checkWords("zh", ["火", "木"]), { 火: "new", 木: "learning" });
    assert.equal((await anki.selectTargets("zh", 5, async () => 0)).length, 2);
  });
});

describe("ensureFresh", () => {
  it("syncs only when enabled, mapped and stale; never throws", async () => {
    const { anki, fake, clock } = setup([card("你好", { reviews: answers(1, 0) })]);
    const HOUR = 3_600_000;
    // Disabled: no calls, no snapshot.
    await anki.setConfig({ ...ZH_CONFIG, enabled: false });
    assert.equal(await anki.ensureFresh("zh", 6 * HOUR), null);
    assert.equal(fake.state.calls.length, 0);

    await anki.setConfig(ZH_CONFIG);
    const first = await anki.ensureFresh("zh", 6 * HOUR);
    assert.equal(first?.syncedAt, NOW);
    const calls = fake.state.calls.length;
    clock.t = NOW + 5 * HOUR;
    assert.equal((await anki.ensureFresh("zh", 6 * HOUR))?.syncedAt, NOW); // fresh enough
    assert.equal(fake.state.calls.length, calls);
    assert.equal(await anki.ensureFresh("ja", 6 * HOUR), null); // no deck for ja

    clock.t = NOW + 7 * HOUR;
    fake.state.down = true;
    assert.equal((await anki.ensureFresh("zh", 6 * HOUR))?.syncedAt, NOW); // unreachable: keeps the old snapshot
    fake.state.down = false;
    assert.equal((await anki.ensureFresh("zh", 6 * HOUR))?.syncedAt, NOW + 7 * HOUR);
  });

  it("shares one sync between concurrent callers", async () => {
    const { anki, fake } = setup([card("你好")]);
    await anki.setConfig(ZH_CONFIG);
    const [a, b] = await Promise.all([anki.sync("zh"), anki.ensureFresh("zh", 1)]);
    assert.equal(a, b);
    assert.equal(fake.state.calls.filter((c) => c === "cardsInfo").length, 1);
  });
});
