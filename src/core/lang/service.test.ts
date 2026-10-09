import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import JSZip from "jszip";
import type { DictionaryProgress } from "../../shared/lang";
import type { AnkiCard } from "../../shared/records";
import { CEDICT_URL, DefaultLanguageService, JMDICT_RELEASE_API } from "./index";
import { readTarFile } from "./jmdict";
import { OEWN_URL } from "./wordlists";
import type { UiLocale } from "../../shared/locales";
import { assertCovers } from "./testutil";

const CEDICT_FIXTURE = [
  "# CC-CEDICT test fixture",
  "#! version=1",
  "#! date=2026-09-29T09:16:04Z",
  "北京 北京 [Bei3 jing1] /Beijing/",
  "烤鴨 烤鸭 [kao3 ya1] /roast duck/",
  "北京烤鴨 北京烤鸭 [Bei3 jing1 kao3 ya1] /Peking duck/",
  "吃 吃 [chi1] /to eat/",
  "了 了 [le5] /(completed action marker)/",
  "了 了 [liao3] /to finish/",
  "除了 除了 [chu2 le5] /besides/apart from/",
  "我 我 [wo3] /I/me/",
  "綠 绿 [lu:4] /green/",
  "書 书 [shu1] /book/CL:本[ben3]/",
  "",
].join("\n");

const JMDICT_FIXTURE = {
  version: "3.6.1",
  languages: ["eng"],
  commonOnly: true,
  dictDate: "2026-09-28",
  tags: {},
  words: [
    {
      id: "1",
      kanji: [{ common: true, text: "食べる", tags: [] }, { common: false, text: "喰べる", tags: [] }],
      kana: [{ common: true, text: "たべる", tags: [], appliesToKanji: ["*"] }],
      sense: [{ partOfSpeech: ["v1", "vt"], misc: [], gloss: [{ lang: "eng", text: "to eat" }] }],
    },
    {
      id: "2",
      kanji: [{ common: true, text: "桃", tags: [] }],
      kana: [{ common: true, text: "もも", tags: [], appliesToKanji: ["*"] }],
      sense: [{ partOfSpeech: ["n"], misc: [], gloss: [{ lang: "eng", text: "peach" }, { lang: "eng", text: "Prunus persica" }] }],
    },
    {
      id: "3",
      kanji: [],
      kana: [{ common: true, text: "こんにちは", tags: [], appliesToKanji: ["*"] }],
      sense: [{ partOfSpeech: ["int"], misc: [], gloss: [{ lang: "eng", text: "hello" }] }],
    },
  ],
};

const TAG = "3.6.1+20260928000000";
const ZIP_NAME = `jmdict-eng-common-${TAG}.json.zip`;
const TGZ_NAME = `jmdict-eng-common-${TAG}.json.tgz`;

/** Tiny ustar writer for the .tgz path. */
function tar(name: string, data: Uint8Array): Uint8Array {
  const header = new Uint8Array(512);
  const enc = new TextEncoder();
  const put = (s: string, off: number) => header.set(enc.encode(s), off);
  put(name, 0);
  put("0000644\0", 100);
  put("0000000\0", 108);
  put("0000000\0", 116);
  put(data.length.toString(8).padStart(11, "0") + "\0", 124);
  put("00000000000\0", 136);
  put("        ", 148);
  header[156] = "0".charCodeAt(0);
  put("ustar\0" + "00", 257);
  const sum = header.reduce((a, b) => a + b, 0);
  put(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  const body = new Uint8Array(Math.ceil(data.length / 512) * 512);
  body.set(data);
  const out = new Uint8Array(512 + body.length + 1024);
  out.set(header);
  out.set(body, 512);
  return out;
}

async function fixtures(format: "zip" | "tgz") {
  const json = JSON.stringify(JMDICT_FIXTURE);
  const zip = new JSZip();
  zip.file(`jmdict-eng-common-${TAG}.json`, json);
  const zipBytes = await zip.generateAsync({ type: "uint8array" });
  const tgzBytes = gzipSync(tar(`jmdict-eng-common-${TAG}.json`, new TextEncoder().encode(json)));
  const assets = [
    { name: `jmdict-eng-${TAG}.json.zip`, browser_download_url: "https://example.test/full.zip" },
    ...(format === "zip" ? [{ name: ZIP_NAME, browser_download_url: `https://example.test/${ZIP_NAME}` }] : []),
    { name: TGZ_NAME, browser_download_url: `https://example.test/${TGZ_NAME}` },
  ];
  const files: Record<string, Uint8Array | string> = {
    [CEDICT_URL]: gzipSync(Buffer.from(CEDICT_FIXTURE, "utf8")),
    [JMDICT_RELEASE_API]: JSON.stringify({ tag_name: TAG, assets }),
    [`https://example.test/${ZIP_NAME}`]: zipBytes,
    [`https://example.test/${TGZ_NAME}`]: tgzBytes,
  };
  const calls: string[] = [];
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const body = files[url];
    if (body === undefined) return new Response("not found", { status: 404 });
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
    return new Response(bytes, { status: 200, headers: { "content-length": String(bytes.length) } });
  }) as typeof fetch;
  return { fakeFetch, calls };
}

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sayfern-lang-"));
}

test("service: languages, packs, unknown language", () => {
  const svc = new DefaultLanguageService({ dataDir: tmp() });
  assert.deepEqual(svc.languages().map((l) => l.id), ["zh", "ja", "ko", "en", "es", "fr", "de", "it", "pt", "ru", "vi"]);
  assert.equal(svc.pack("zh").info.readingName, "Pinyin");
  assert.equal(svc.pack("es").info.levels[0], "A1");
  assert.throws(() => svc.pack("tl" as never), /No language pack/);
});

test("service: lookup before install says needsDictionary; status reports not installed", async () => {
  const { fakeFetch, calls } = await fixtures("zip");
  const svc = new DefaultLanguageService({ dataDir: tmp(), fetch: fakeFetch });
  for (const lang of ["zh", "ja"] as const) {
    const r = await svc.lookup(lang, lang === "zh" ? "烤鸭" : "桃");
    assert.equal(r.needsDictionary, true);
    assert.deepEqual(r.entries, []);
    const st = await svc.dictionaryStatus(lang);
    assert.equal(st.installed, false);
    assert.ok(st.downloadMb > 0);
  }
  assert.equal((await svc.dictionaryStatus("zh")).name, "CC-CEDICT");
  assert.equal((await svc.dictionaryStatus("ja")).license, "CC BY-SA 4.0 (EDRDG)");
  assert.deepEqual(calls, []);
});

test("service: install both dictionaries, progress, idempotent, shared promise, persisted", async () => {
  const dataDir = tmp();
  const { fakeFetch, calls } = await fixtures("zip");
  const svc = new DefaultLanguageService({ dataDir, fetch: fakeFetch });

  const phases: DictionaryProgress[] = [];
  const [a, b] = [svc.installDictionary("zh", (p) => phases.push(p)), svc.installDictionary("zh", () => {})];
  assert.equal((await svc.dictionaryStatus("zh")).installing, true);
  const [zh, zh2] = await Promise.all([a, b]);
  assert.deepEqual(zh2, zh);
  assert.equal(zh.installed, true);
  assert.equal(zh.entries, 10);
  assert.equal(zh.version, "2026-09-29T09:16:04Z");
  assert.equal(zh.installing, undefined);
  const seen = phases.map((p) => p.phase);
  for (const ph of ["download", "parse", "index", "done"] as const) assert.ok(seen.includes(ph), ph);
  assert.ok(phases.some((p) => p.phase === "download" && p.fraction === 1), "download fraction reported");
  assert.equal(calls.filter((c) => c === CEDICT_URL).length, 1, "concurrent installs share one download");

  // Idempotent: second install does not download again.
  const again: DictionaryProgress[] = [];
  await svc.installDictionary("zh", (p) => again.push(p));
  assert.equal(calls.filter((c) => c === CEDICT_URL).length, 1);
  assert.deepEqual(again.map((p) => p.phase), ["done"]);

  const ja = await svc.installDictionary("ja", () => {});
  assert.equal(ja.installed, true);
  assert.equal(ja.entries, 3);
  assert.ok(calls.includes(`https://example.test/${ZIP_NAME}`), "prefers the zip asset");
  assert.ok(!calls.includes("https://example.test/full.zip"), "uses the common-words asset");

  // Fresh instance reads from disk, no network.
  const n = calls.length;
  const fresh = new DefaultLanguageService({ dataDir, fetch: fakeFetch });
  assert.equal((await fresh.dictionaryStatus("zh")).entries, 10);

  const duck = await fresh.lookup("zh", "烤鸭");
  assert.equal(duck.needsDictionary, undefined);
  assert.deepEqual(duck.entries, [{ headword: "烤鸭", variants: ["烤鴨"], reading: "kǎoyā", senses: [{ glosses: ["roast duck"] }], source: "CC-CEDICT" }]);
  assert.equal((await fresh.lookup("zh", "烤鴨")).entries[0]?.headword, "烤鸭", "traditional is indexed");
  assert.deepEqual((await fresh.lookup("zh", "了")).entries.map((e) => e.reading), ["le", "liǎo"]);
  assert.equal((await fresh.lookup("zh", "绿")).entries[0].reading, "lǜ");
  assert.deepEqual((await fresh.lookup("zh", "书")).entries[0].senses[1], { glosses: ["CL:本[běn]"], tags: ["classifier"] });
  // Per-character fallback.
  assert.deepEqual((await fresh.lookup("zh", "吃我")).entries.map((e) => e.headword), ["吃", "我"]);
  assert.deepEqual((await fresh.lookup("zh", "猫")).entries, []);

  const peach = await fresh.lookup("ja", "桃");
  assert.equal(peach.entries[0].reading, "もも");
  assert.deepEqual(peach.entries[0].senses, [{ glosses: ["peach", "Prunus persica"], tags: ["n"] }]);
  assert.equal(peach.entries[0].common, true);
  const eat = await fresh.lookup("ja", "たべる");
  assert.equal(eat.entries[0].headword, "食べる");
  assert.deepEqual(eat.entries[0].variants, ["喰べる"]);
  assert.equal((await fresh.lookup("ja", "喰べる")).entries[0].headword, "食べる");
  assert.equal((await fresh.lookup("ja", "食べました")).entries[0]?.headword, "食べる", "lemma fallback");
  assert.equal((await fresh.lookup("ja", "コンニチハ")).entries[0]?.headword, "こんにちは");
  assert.equal(calls.length, n, "no network after install");

  // Dictionary-backed segmentation after install.
  const tokens = await fresh.annotate("zh", "我吃了北京烤鸭。");
  assert.deepEqual(tokens.map((t) => t.text), ["我", "吃", "了", "北京烤鸭", "。"]);
  assert.equal(tokens[2].reading, "le");
  assert.equal(tokens[3].reading, "běijīngkǎoyā");
});

test("service: JMdict .tgz asset when no zip exists", async () => {
  const { fakeFetch, calls } = await fixtures("tgz");
  const svc = new DefaultLanguageService({ dataDir: tmp(), fetch: fakeFetch });
  const st = await svc.installDictionary("ja", () => {});
  assert.equal(st.entries, 3);
  assert.ok(calls.includes(`https://example.test/${TGZ_NAME}`));
  assert.equal((await svc.lookup("ja", "こんにちは")).entries[0].senses[0].glosses[0], "hello");
});

test("tar reader finds a file and ignores others", () => {
  const data = new TextEncoder().encode("{}");
  assert.deepEqual(readTarFile(tar("dir/a.json", data), (n) => n.endsWith(".json")), data);
  assert.equal(readTarFile(tar("a.txt", data), (n) => n.endsWith(".json")), null);
});

test("service: install failure reports error phase and status.error, can retry", async () => {
  const { fakeFetch } = await fixtures("zip");
  let fail = true;
  const flaky = (async (...args: Parameters<typeof fetch>) =>
    fail ? new Response("nope", { status: 503, statusText: "Service Unavailable" }) : fakeFetch(...args)) as typeof fetch;
  const svc = new DefaultLanguageService({ dataDir: tmp(), fetch: flaky });
  const phases: DictionaryProgress[] = [];
  await assert.rejects(svc.installDictionary("zh", (p) => phases.push(p)), /503/);
  assert.equal(phases.at(-1)?.phase, "error");
  const st = await svc.dictionaryStatus("zh");
  assert.equal(st.installed, false);
  assert.match(st.error ?? "", /503/);
  fail = false;
  const ok = await svc.installDictionary("zh", () => {});
  assert.equal(ok.installed, true);
  assert.equal(ok.error, undefined);
});

test("service: annotate covers text, caches results, fills anki and firstUsedAt", async () => {
  const card: AnkiCard = { cardId: 1, noteId: 2, deck: "zh", word: "烤鸭", interval: 3, ease: 2500, lapses: 0, reps: 4 };
  let segCalls = 0;
  const svc = new DefaultLanguageService({
    dataDir: tmp(),
    ankiCard: async (_l, w) => (w === "烤鸭" ? card : null),
    wordUsage: async (_l, w) => (w === "烤鸭" ? { firstUsedAt: 1234 } : null),
  });
  const zh = svc.pack("zh");
  const orig = zh.segment.bind(zh);
  zh.segment = (t: string) => {
    segCalls++;
    return orig(t);
  };
  for (const [lang, text] of [
    ["zh", "我今天吃了北京烤鸭 😀 ok!"],
    ["ja", "大きな桃が流れてきました。"],
  ] as const) {
    assertCovers(text, await svc.annotate(lang, text));
  }
  const first = await svc.annotate("zh", "我今天吃了北京烤鸭 😀 ok!");
  assert.equal(segCalls, 1, "second annotate served from cache");
  assert.ok(first.some((t) => t.reading));
  const ja = await svc.annotate("ja", "大きな桃が流れてきました。");
  assert.equal(ja.find((t) => t.text === "流れてきました")?.lemma, "流れる");

  const r = await svc.lookup("zh", "烤鸭");
  assert.deepEqual(r.anki, card);
  assert.equal(r.firstUsedAt, 1234);
  assert.equal(r.needsDictionary, true);
});

test("service: registerPack adds a language", async () => {
  const svc = new DefaultLanguageService({ dataDir: tmp() });
  const zh = svc.pack("zh");
  svc.registerPack({ ...zh, info: { ...zh.info, id: "yue" as never, name: "Cantonese" }, ready: async () => {}, segment: (t: string) => [{ text: t, start: 0, end: t.length, isWord: true }] } as never);
  assert.equal(svc.languages().length, 12);
  assert.deepEqual(await svc.annotate("yue" as never, "你好"), [{ text: "你好", start: 0, end: 2, isWord: true }]);
  const r = await svc.lookup("yue" as never, "你好");
  assert.deepEqual(r, { query: "你好", entries: [] });
});

/** A tiny Open English WordNet JSON release: synset files plus word entries. */
async function oewnZip(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("verb.motion.json", JSON.stringify({ "1-v": { definition: ["move fast on foot"], members: ["run"], partOfSpeech: "v" } }));
  zip.file("noun.act.json", JSON.stringify({ "2-n": { definition: ["the act of running"], members: ["run"], partOfSpeech: "n" } }));
  zip.file("noun.artifact.json", JSON.stringify({ "3-n": { definition: ["an airfield for planes"], members: ["airport"], partOfSpeech: "n" } }));
  zip.file("entries-r.json", JSON.stringify({ run: { n: { sense: [{ synset: "2-n" }] }, v: { sense: [{ synset: "1-v" }, { synset: "1-v" }] } } }));
  zip.file("entries-a.json", JSON.stringify({ airport: { n: { sense: [{ synset: "3-n" }] } } }));
  zip.file("frames.json", JSON.stringify({}));
  return zip.generateAsync({ type: "uint8array" });
}

test("service: English always has a dictionary; WordNet's English glosses never mark English words as own-language", async () => {
  const bytes = await oewnZip();
  const fetch = (async (input: string | URL | Request) =>
    String(input) === OEWN_URL ? new Response(bytes, { headers: { "content-length": String(bytes.length) } }) : new Response("no", { status: 404 })) as typeof globalThis.fetch;
  const status = (locale: UiLocale) => new DefaultLanguageService({ dataDir: tmp(), glossLocale: () => locale, fetch }).dictionaryStatus("en");
  assert.equal((await status("en")).name, "Open English WordNet");
  assert.equal((await status("ko")).name, "Open English WordNet");
  assert.equal((await status("vi")).name, "Open English WordNet");
  assert.equal((await status("zh-Hans")).name, "WikDict English–Chinese");
  assert.equal((await status("es")).name, "WikDict English–Spanish");

  const dir = tmp();
  const svc = new DefaultLanguageService({ dataDir: dir, glossLocale: () => "ko", fetch });
  const s = await svc.installDictionary("en", () => undefined);
  assert.equal(s.entries, 2);
  const run = (await svc.lookup("en", "run")).entries[0];
  assert.deepEqual(run.senses.map((x) => [x.tags?.[0], x.glosses[0]]), [["verb", "move fast on foot"], ["noun", "the act of running"]], "most senses first, one per synset");
  // "act", "fast" and "planes" are in WordNet's glosses, but those are English, the language learned.
  const pack = new DefaultLanguageService({ dataDir: dir, glossLocale: () => "ko" }).pack("en");
  await pack.ready();
  assert.deepEqual(pack.learnerWords("I run fast to the airport, 그리고 커피를 마셨어요."), ["i", "run", "fast", "to", "the", "airport"]);
});
