// Every interface string is translated into every locale (full parity), with the same placeholders.
// When this fails after a UI change: `npx tsx scripts/i18n-keys.ts missing` lists what to add.
// I18N_LOCALE=de limits the run to one catalog.
import assert from "node:assert/strict";
import test from "node:test";
import { extractKeys, placeholders } from "../../scripts/i18n-keys";
import { CATALOGS, type PluralForms } from "../shared/i18n";

const keys = extractKeys();
const only = process.env.I18N_LOCALE;

/** Plural categories integers can hit in a locale (fr/es/it/pt "many" only applies to millions: optional). */
function neededCategories(locale: string): Intl.LDMLPluralRule[] {
  const r = new Intl.PluralRules(locale);
  const seen = new Set<Intl.LDMLPluralRule>(["other"]);
  for (let n = 0; n <= 1000; n++) seen.add(r.select(n));
  return [...seen];
}

test("i18n: the extractor finds the interface strings", () => {
  assert.ok(keys.size > 1000, `only ${keys.size} keys found`);
  assert.ok(keys.has("Settings"));
  assert.ok([...keys.values()].some((k) => k.one), "no plural keys found");
  assert.ok(keys.has("card side\u0004Back"), "context keys (tc) are collected");
});

for (const [locale, catalog] of Object.entries(CATALOGS)) {
  if (only && only !== locale) continue;
  test(`i18n: ${locale} catalog is complete and consistent`, () => {
    const problems: string[] = [];
    const cats = neededCategories(locale);
    for (const { key, one } of keys.values()) {
      const entry = catalog[key];
      if (entry === undefined) {
        problems.push(`missing: ${JSON.stringify(key)}`);
        continue;
      }
      const want = placeholders(key);
      const forms: [string, string][] = typeof entry === "string" ? [["text", entry]] : Object.entries(entry as PluralForms).filter((f): f is [string, string] => typeof f[1] === "string");
      if (typeof entry !== "string") {
        if (!one) problems.push(`plural forms for a plain key: ${JSON.stringify(key)}`);
        for (const c of cats) if (!(c in entry)) problems.push(`${JSON.stringify(key)} lacks the "${c}" form`);
      } else if (one && cats.length > 1) {
        problems.push(`needs plural forms (${cats.join(", ")}): ${JSON.stringify(key)}`);
      }
      for (const [form, text] of forms) {
        const got = placeholders(text);
        const extra = got.filter((p) => !want.includes(p));
        const lost = want.filter((p) => !got.includes(p));
        if (extra.length || lost.length) problems.push(`placeholders differ in ${JSON.stringify(key)} (${form}): ${JSON.stringify(text)}`);
        if (text.includes("—")) problems.push(`em dash in ${JSON.stringify(key)}: ${JSON.stringify(text)}`);
        if (!text.trim()) problems.push(`empty translation: ${JSON.stringify(key)}`);
      }
    }
    for (const k of Object.keys(catalog)) if (!keys.has(k)) problems.push(`unused (no longer in the source): ${JSON.stringify(k)}`);
    assert.deepEqual(problems.slice(0, 40), [], `${problems.length} problems in ${locale}`);
  });
}
