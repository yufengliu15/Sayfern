// Test helpers (not part of the runtime module).
import assert from "node:assert/strict";
import type { Token } from "../../shared/lang";

export const SAMPLES = [
  "",
  "我今天吃了北京烤鸭。",
  "除了烤鸭，我还喜欢饺子！",
  "Hello 世界 123, how are you?",
  "我爱😀emoji👨‍👩‍👧和🇨🇳旗子",
  "  前后有空格\n换行\t制表  ",
  "大きな桃が流れてきました。",
  "私は 食べたくない😀 ABC 123\n東京へ行った",
  "「こんにちは」と言って、コーヒーを飲んでいます。",
  "日本語とEnglishのmixed文章、全角ＡＢＣ１２３も。",
  "𠀀𠀁 rare ext-B 汉字",
  "!!!...???",
];

export function assertCovers(text: string, tokens: Token[]): void {
  assert.equal(tokens.map((t) => t.text).join(""), text, `tokens must reproduce ${JSON.stringify(text)}`);
  let pos = 0;
  for (const t of tokens) {
    assert.equal(t.start, pos, `token ${JSON.stringify(t.text)} starts at ${pos}`);
    assert.equal(t.end, t.start + t.text.length);
    assert.equal(text.slice(t.start, t.end), t.text);
    assert.ok(t.text.length > 0, "no empty tokens");
    pos = t.end;
  }
  assert.equal(pos, text.length);
}
