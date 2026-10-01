import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FileLibraryService } from "./index";

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "sayfern-lib-"));
  let t = 1_000;
  const lib = new FileLibraryService({ dataDir, now: () => ++t });
  return { dataDir, lib };
}

const ZH_TEXT = [
  "今天天气很好，我们去公园散步了。",
  "除了汉语以外，他还会说日语和法语。",
  "我了解了。他来了。你吃了吗？好了好了。",
  "这本书除外，其他的都可以借。",
].join("\n\n");

describe("FileLibraryService", () => {
  it("imports text and stores meta, paragraphs, index and original", async () => {
    const { dataDir, lib } = setup();
    const doc = await lib.importText({ title: "课文", text: ZH_TEXT, language: "zh", kind: "textbook" });
    assert.equal(doc.title, "课文");
    assert.equal(doc.format, "txt");
    assert.equal(doc.paragraphCount, 4);
    assert.equal(doc.charCount, ZH_TEXT.replace(/\n/g, "").length);
    for (const f of ["meta.json", "paragraphs.json", "index.json", "original.txt"]) {
      assert.ok(existsSync(join(dataDir, doc.id, f)), f);
    }
    const paras = await lib.getParagraphs(doc.id, 1, 2);
    assert.deepEqual(
      paras.map((p) => [p.index, p.text]),
      [
        [1, "除了汉语以外，他还会说日语和法语。"],
        [2, "我了解了。他来了。你吃了吗？好了好了。"],
      ],
    );
    assert.deepEqual(await lib.getParagraphs(doc.id, 10, 5), []);
  });

  it("imports files by extension and rejects unknown ones", async () => {
    const { dataDir, lib } = setup();
    const src = mkdtempSync(join(tmpdir(), "sayfern-src-"));
    const md = join(src, "notes.markdown");
    writeFileSync(md, "# 我的笔记\n\n第一段。\n");
    const doc = await lib.importFile(md, "zh", "personal");
    assert.equal(doc.title, "我的笔记");
    assert.equal(doc.format, "md");
    assert.equal(readFileSync(join(dataDir, doc.id, "original.markdown"), "utf8"), "# 我的笔记\n\n第一段。\n");

    const txt = join(src, "story.txt");
    writeFileSync(txt, "one\ntwo");
    const t = await lib.importFile(txt, "zh", "reader");
    assert.equal(t.title, "story");
    assert.equal(t.paragraphCount, 2);

    const html = join(src, "page.HTM");
    writeFileSync(html, "<title>网页</title><p>你好</p>");
    assert.equal((await lib.importFile(html, "zh", "other")).title, "网页");

    const gbk = join(src, "legacy.txt");
    writeFileSync(gbk, Buffer.from([0xc4, 0xe3, 0xba, 0xc3])); // "你好" in GBK
    const legacy = await lib.importFile(gbk, "zh", "reader");
    assert.equal((await lib.getParagraphs(legacy.id, 0, 1))[0].text, "你好");

    const docx = join(src, "file.docx");
    writeFileSync(docx, "x");
    await assert.rejects(lib.importFile(docx, "zh", "other"), /can't import "\.docx" files/);
    await assert.rejects(lib.importFile(join(src, "missing.txt"), "zh", "other"), /Couldn't read/);
  });

  it("ranks the 除了…还… paragraph first for 除了", async () => {
    const { lib } = setup();
    const doc = await lib.importText({ title: "课文", text: ZH_TEXT, language: "zh", kind: "textbook" });
    await lib.importText({ title: "别的", text: "了了了了。除非你来。", language: "zh", kind: "reader" });
    const hits = await lib.search("zh", "除了");
    assert.ok(hits.length >= 2);
    assert.equal(hits[0].docId, doc.id);
    assert.equal(hits[0].paragraph, 1);
    assert.equal(hits[0].title, "课文");
    assert.match(hits[0].text, /除了汉语以外，他还会/);
    assert.ok(hits[0].score > hits[1].score);
    // other language is not searched
    assert.deepEqual(await lib.search("ja", "除了"), []);
  });

  it("searches Japanese and latin text", async () => {
    const { lib } = setup();
    const ja = await lib.importText({
      title: "日本語",
      text: "猫が好きです。\n\n毎日ラーメンを食べています。\n\n食べ物の話をしましょう。\n\nThe Quick Fox",
      language: "ja",
      kind: "reader",
    });
    const hits = await lib.search("ja", "食べています");
    assert.equal(hits[0].paragraph, 1);
    const katakana = await lib.search("ja", "ラーメン");
    assert.equal(katakana[0].paragraph, 1);
    const latin = await lib.search("ja", "quick");
    assert.equal(latin.length, 1);
    assert.equal(latin[0].docId, ja.id);
    assert.equal(latin[0].paragraph, 3);
    assert.deepEqual(await lib.search("ja", "constructor"), []);
    assert.deepEqual(await lib.search("ja", "   "), []);
  });

  it("respects limit and trims long paragraphs around the match", async () => {
    const { lib } = setup();
    const long = "甲".repeat(400) + "目标词" + "乙".repeat(400);
    const text = [long, ...Array.from({ length: 8 }, (_, i) => `第${i}段有目标。`)].join("\n\n");
    await lib.importText({ title: "长", text, language: "zh", kind: "reader" });
    const hits = await lib.search("zh", "目标词", 3);
    assert.equal(hits.length, 3);
    assert.equal(hits[0].paragraph, 0);
    assert.ok(hits[0].text.startsWith("…") && hits[0].text.endsWith("…"));
    assert.ok(hits[0].text.includes("目标词"));
    assert.ok(Array.from(hits[0].text).length <= 302);
    assert.equal((await lib.search("zh", "目标")).length, 5);
  });

  it("validates and stores checkpoints", async () => {
    const { lib } = setup();
    const doc = await lib.importText({ title: "t", text: "abc\n\ndefgh", language: "zh", kind: "reader" });
    const updated = await lib.setCheckpoint(doc.id, 1, 5);
    assert.deepEqual(updated.checkpoint && [updated.checkpoint.paragraph, updated.checkpoint.offset], [1, 5]);
    await assert.rejects(lib.setCheckpoint(doc.id, 2, 0), RangeError);
    await assert.rejects(lib.setCheckpoint(doc.id, 0, 4), RangeError);
    await assert.rejects(lib.setCheckpoint(doc.id, -1, 0), RangeError);
    await assert.rejects(lib.setCheckpoint(doc.id, 0.5, 0), RangeError);
    await assert.rejects(lib.setCheckpoint("nope", 0, 0), /isn't in the library/);
    const renamed = await lib.renameDoc(doc.id, "  New  name ");
    assert.equal(renamed.title, "New name");
    await assert.rejects(lib.renameDoc(doc.id, "  "), /can't be empty/);
  });

  it("deletes documents and their folder", async () => {
    const { dataDir, lib } = setup();
    const doc = await lib.importText({ title: "t", text: "删除我", language: "zh", kind: "reader" });
    assert.equal((await lib.search("zh", "删除")).length, 1);
    await lib.deleteDoc(doc.id);
    assert.equal(existsSync(join(dataDir, doc.id)), false);
    assert.equal(await lib.getDoc(doc.id), null);
    assert.deepEqual(await lib.listDocs("zh"), []);
    assert.deepEqual(await lib.search("zh", "删除"), []);
    await lib.deleteDoc("../../etc"); // ignored, no throw
  });

  it("builds personal context with titles, truncated to maxChars", async () => {
    const { lib } = setup();
    await lib.importText({ title: "关于我", text: "我是学生。\n\n我喜欢机器人。", language: "zh", kind: "personal" });
    await lib.importText({ title: "课本", text: "不是个人的。", language: "zh", kind: "textbook" });
    await lib.importText({ title: "目标", text: "明年去中国。", language: "zh", kind: "personal" });
    await lib.importText({ title: "日本", text: "日本語", language: "ja", kind: "personal" });
    const full = await lib.personalContext("zh", 1000);
    assert.equal(full, "# 关于我\n\n我是学生。\n\n我喜欢机器人。\n\n# 目标\n\n明年去中国。");
    const cut = await lib.personalContext("zh", 12);
    assert.equal(cut.length, 12);
    assert.ok(cut.endsWith("…"));
    assert.ok(full.startsWith(cut.slice(0, -1)));
    assert.equal(await lib.personalContext("zh", 0), "");
  });

  it("persists across instances", async () => {
    const { dataDir, lib } = setup();
    const doc = await lib.importText({ title: "持久", text: "除了他，还有我。\n\n第二段", language: "zh", kind: "reader" });
    await lib.setCheckpoint(doc.id, 1, 2);
    const again = new FileLibraryService({ dataDir });
    const docs = await again.listDocs("zh");
    assert.equal(docs.length, 1);
    assert.equal(docs[0].title, "持久");
    assert.equal(docs[0].checkpoint?.paragraph, 1);
    assert.equal((await again.getParagraphs(doc.id, 0, 1))[0].text, "除了他，还有我。");
    assert.equal((await again.search("zh", "除了"))[0].paragraph, 0);
  });

  it("lists newest first per language", async () => {
    const { lib } = setup();
    const a = await lib.importText({ title: "a", text: "一", language: "zh", kind: "reader" });
    const b = await lib.importText({ title: "b", text: "二", language: "zh", kind: "reader" });
    await lib.importText({ title: "c", text: "三", language: "ja", kind: "reader" });
    assert.deepEqual((await lib.listDocs("zh")).map((d) => d.id), [b.id, a.id]);
  });
});
