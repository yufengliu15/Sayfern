import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { parseEpub } from "./epub";
import { decodeEntities, parseHtml } from "./html";
import { parseMarkdown } from "./md";
import { parseTxt } from "./txt";

describe("txt parser", () => {
  it("splits on blank lines, normalizes CRLF, joins wrapped lines", () => {
    const doc = parseTxt("第一段第一行\r\n第一段第二行\r\n\r\n  Second   paragraph\r\nwraps here.  \r\n\r\n\r\n第三段");
    assert.deepEqual(
      doc.paragraphs.map((p) => p.text),
      ["第一段第一行第一段第二行", "Second paragraph wraps here.", "第三段"],
    );
  });

  it("uses one paragraph per line when there are no blank lines", () => {
    const doc = parseTxt("　今日は晴れです。\r\n明日は雨です。\nThird   line\n");
    assert.deepEqual(
      doc.paragraphs.map((p) => p.text),
      ["今日は晴れです。", "明日は雨です。", "Third line"],
    );
  });

  it("keeps full-width spaces inside CJK text", () => {
    const doc = parseTxt("東京　大阪");
    assert.equal(doc.paragraphs[0].text, "東京　大阪");
  });
});

describe("markdown parser", () => {
  it("strips syntax, keeps headings as context, lists as items, code as text", () => {
    const md = [
      "# 我的书",
      "",
      "这是**重要**的 *句子*，见[链接](http://x.com)。![图](a.png)",
      "",
      "## 第二节",
      "",
      "- 第一项",
      "- 第二项 with `code`",
      "  continued",
      "1. numbered",
      "",
      "```js",
      "const a = 1;",
      "console.log(a);",
      "```",
      "",
      "> quoted _text_ here",
      "",
      "---",
      "",
      "Setext Title",
      "============",
      "",
      "after setext",
    ].join("\n");
    const doc = parseMarkdown(md);
    assert.equal(doc.title, "我的书");
    assert.deepEqual(
      doc.paragraphs.map((p) => [p.heading, p.text]),
      [
        ["我的书", "这是重要的 句子，见链接。"],
        ["第二节", "第一项"],
        ["第二节", "第二项 with code continued"],
        ["第二节", "numbered"],
        ["第二节", "const a = 1;\nconsole.log(a);"],
        ["第二节", "quoted text here"],
        ["Setext Title", "after setext"],
      ],
    );
  });
});

describe("html parser", () => {
  it("decodes entities and handles nested tags, scripts, ruby, br", () => {
    const html = `<!DOCTYPE html><html><head><title>Test &amp; Title</title>
      <style>p { color: red }</style><script>var x = "<p>no</p>";</script></head>
      <body>
        <h1>第一章 <small>開始</small></h1>
        <div><p>Tom &amp; Jerry &lt;3 &#x4E2D;&#25991; &nbsp;<b>bold <i>nested</i></b> text</p>
        <p><ruby>漢<rp>(</rp><rt>かん</rt><rp>)</rp></ruby><ruby>字<rt>じ</rt></ruby>を
        読む。</p></div>
        <ul><li>one</li><li>two<br>three</li></ul>
        <h4>Minor heading</h4>
        <!-- <p>comment</p> -->
        <p class="x" data-a='a > b'>attr with gt</p>
        <h2>Second</h2><p>last &unknown; &copy</p>
      </body></html>`;
    const doc = parseHtml(html);
    assert.equal(doc.title, "Test & Title");
    assert.deepEqual(
      doc.paragraphs.map((p) => [p.heading, p.text]),
      [
        ["第一章 開始", "Tom & Jerry <3 中文 bold nested text"],
        ["第一章 開始", "漢字を読む。"],
        ["第一章 開始", "one"],
        ["第一章 開始", "two"],
        ["第一章 開始", "three"],
        ["第一章 開始", "Minor heading"],
        ["第一章 開始", "attr with gt"],
        ["Second", "last &unknown; ©"],
      ],
    );
  });

  it("survives malformed markup", () => {
    const doc = parseHtml("<p>a < b and <unclosed <p>next<div>deep</p>");
    assert.deepEqual(
      doc.paragraphs.map((p) => p.text),
      ["a < b and next", "deep"],
    );
  });

  it("decodes numeric entities", () => {
    assert.equal(decodeEntities("&#65;&#x42;&lt;&bogus;"), "AB<&bogus;");
  });
});

describe("epub parser", () => {
  it("reads spine order, dc:title, h1 and nav headings", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip");
    zip.file(
      "META-INF/container.xml",
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    );
    zip.file(
      "OEBPS/content.opf",
      `<?xml version="1.0" encoding="UTF-8"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>小王子</dc:title></metadata>
        <manifest>
          <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
          <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
          <item id="c2" href="text/ch%202.xhtml" media-type="application/xhtml+xml"/>
          <item id="img" href="cover.png" media-type="image/png"/>
        </manifest>
        <spine><itemref idref="c2"/><itemref idref="c1"/><itemref idref="nav" linear="no"/></spine>
      </package>`,
    );
    zip.file(
      "OEBPS/nav.xhtml",
      `<html xmlns="http://www.w3.org/1999/xhtml"><body><nav epub:type="toc"><ol>
        <li><a href="text/ch1.xhtml">第一章</a></li><li><a href="text/ch%202.xhtml#start">序言</a></li>
      </ol></nav></body></html>`,
    );
    zip.file(
      "OEBPS/text/ch1.xhtml",
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>ch1</title></head>
      <body><h1>第一章　蛇</h1><p>我六岁的时候，
      看到一幅画。</p><p>第二段。</p></body></html>`,
    );
    zip.file(
      "OEBPS/text/ch 2.xhtml",
      `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>献给莱昂·维尔特。</p></body></html>`,
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const doc = await parseEpub(bytes);
    assert.equal(doc.title, "小王子");
    assert.deepEqual(
      doc.paragraphs.map((p) => [p.heading, p.text]),
      [
        ["序言", "献给莱昂·维尔特。"],
        ["第一章　蛇", "我六岁的时候，看到一幅画。"],
        ["第一章　蛇", "第二段。"],
      ],
    );
  });

  it("rejects a non-zip file with a friendly error", async () => {
    await assert.rejects(parseEpub(new TextEncoder().encode("not a zip")), /couldn't be opened/);
  });
});
