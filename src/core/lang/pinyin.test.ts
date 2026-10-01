import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCedict, parseCedictLine } from "./cedict";
import { numberedToMarks, toneMark } from "./pinyin";

test("tone mark placement: a/e/o priority, iu/ui, ü, neutral, syllabic", () => {
  assert.equal(toneMark("kao3"), "kǎo"); // a beats o
  assert.equal(toneMark("mei2"), "méi"); // e beats i
  assert.equal(toneMark("lou2"), "lóu"); // ou → o
  assert.equal(toneMark("liu2"), "liú"); // iu → u
  assert.equal(toneMark("gui4"), "guì"); // ui → i
  assert.equal(toneMark("xue2"), "xué");
  assert.equal(toneMark("lu:4"), "lǜ");
  assert.equal(toneMark("nu:3"), "nǚ");
  assert.equal(toneMark("lv4"), "lǜ");
  assert.equal(toneMark("le5"), "le");
  assert.equal(toneMark("r5"), "r");
  assert.equal(toneMark("Bei3"), "Běi");
  assert.equal(toneMark("er4"), "èr");
  assert.equal(toneMark("m2"), "ḿ");
  assert.equal(toneMark("ng4"), "ǹg");
  assert.equal(toneMark("xx5"), "xx");
  assert.equal(toneMark("A"), "A");
});

test("numbered pinyin → joined display pinyin", () => {
  assert.equal(numberedToMarks("kao3 ya1"), "kǎoyā");
  assert.equal(numberedToMarks("Bei3 jing1"), "Běijīng");
  assert.equal(numberedToMarks("Xi1 an1"), "Xī'ān");
  assert.equal(numberedToMarks("lu:4 se4"), "lǜsè");
  assert.equal(numberedToMarks("yi1 dian3 r5"), "yīdiǎnr");
  assert.equal(numberedToMarks("A A zhi4"), "A A zhì");
  assert.equal(numberedToMarks("yi1 lao2 , yong3 yi4"), "yīláo, yǒngyì");
});

test("CEDICT line parser", () => {
  assert.equal(parseCedictLine("# comment"), null);
  assert.equal(parseCedictLine(""), null);
  assert.equal(parseCedictLine("garbage line"), null);
  const p = parseCedictLine("烤鴨 烤鸭 [kao3 ya1] /roast duck/");
  assert.deepEqual(p, { traditional: "烤鴨", simplified: "烤鸭", pinyinNumbered: "kao3 ya1", reading: "kǎoyā", glosses: ["roast duck"] });
  const lu = parseCedictLine("綠 绿 [lu:4] /green/");
  assert.equal(lu?.reading, "lǜ");
  const le = parseCedictLine("了 了 [le5] /(completed action marker)/");
  assert.equal(le?.reading, "le");
  const cl = parseCedictLine("書 书 [shu1] /book/letter/CL:本[ben3],冊|册[ce4],部[bu4]/");
  assert.deepEqual(cl?.glosses, ["book", "letter", "CL:本[běn],冊|册[cè],部[bù]"]);
  const er = parseCedictLine("一點兒 一点儿 [yi1 dian3 r5] /a bit/");
  assert.equal(er?.reading, "yīdiǎnr");
});

test("CEDICT grouping per headword and reading, traditional as variant", () => {
  const { version, rows } = parseCedict(
    [
      "#! version=1",
      "#! date=2026-09-29T09:16:04Z",
      "乾 干 [gan1] /dry/",
      "幹 干 [gan4] /to do/",
      "干 干 [gan1] /to concern/",
      "幹 干 [gan4] /trunk/",
      "了 了 [le5] /particle/",
      "了 了 [liao3] /to finish/",
    ].join("\n"),
  );
  assert.equal(version, "2026-09-29T09:16:04Z");
  assert.deepEqual(rows, [
    ["干", "乾", "gān", ["dry", "to concern"]],
    ["干", "幹", "gàn", ["to do", "trunk"]],
    ["了", "", "le", ["particle"]],
    ["了", "", "liǎo", ["to finish"]],
  ]);
});
