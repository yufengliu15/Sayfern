// Real downloads. Skipped unless LIVE=1 (Node's fetch needs NODE_USE_ENV_PROXY=1 behind a proxy).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DefaultLanguageService } from "./index";

const live = process.env.LIVE === "1";

function dirSize(dir: string): number {
  return fs.readdirSync(dir).reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
}

for (const lang of ["zh", "ja"] as const) {
  test(`live: install ${lang} dictionary`, { skip: !live && "set LIVE=1 to download real dictionaries", timeout: 300_000 }, async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sayfern-live-"));
    const svc = new DefaultLanguageService({ dataDir });
    let last = "";
    const t0 = Date.now();
    const st = await svc.installDictionary(lang, (p) => {
      if (p.phase !== "download" && p.message !== last) console.log(`  [${lang}] ${p.phase} ${p.message ?? ""}`);
      last = p.message ?? "";
    });
    console.log(`  [${lang}] ${st.name} version=${st.version} entries=${st.entries} stored=${(dirSize(path.join(dataDir, lang)) / 1e6).toFixed(1)}MB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    assert.equal(st.installed, true);
    assert.ok((st.entries ?? 0) > 1000);
    const fresh = new DefaultLanguageService({ dataDir });
    const t1 = Date.now();
    const r = await fresh.lookup(lang, lang === "zh" ? "烤鸭" : "食べる");
    console.log(`  [${lang}] cold lookup ${Date.now() - t1}ms: ${JSON.stringify(r.entries[0])}`);
    assert.ok(r.entries.length > 0);
    if (lang === "zh") {
      const tokens = await fresh.annotate("zh", "我们今天在北京吃了烤鸭，味道好极了。");
      console.log(`  [zh] ${tokens.map((t) => t.text + (t.reading ? `(${t.reading})` : "")).join(" ")}`);
    }
  });
}
