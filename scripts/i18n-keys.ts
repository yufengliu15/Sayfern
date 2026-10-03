// Collects the English UI strings that need translations (the catalog keys) from the source:
//   t("…"), tr.t("…"), tj("…"), msg("…")                 → a plain key
//   tn(n, "{count} word", "{count} words"), tr.tn(…)       → a plural key ("other" form; "one" kept for context)
//   tc("card side", "Back")                                → "card side\u0004Back"
//   new Error("…") in src/core (sentences only)            → errors the renderer shows through errorText()
// Used by src/core/i18n-catalogs.test.ts and the CLI below.
//
//   npx tsx scripts/i18n-keys.ts            list every key as JSON
//   npx tsx scripts/i18n-keys.ts missing    keys missing from each catalog
//   npx tsx scripts/i18n-keys.ts unused     catalog keys no longer in the source
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export interface I18nKey {
  key: string;
  /** Singular English form, for plural keys. */
  one?: string;
  files: string[];
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = ["src/renderer/src", "src/core", "src/shared"];
const SKIP = /(\.test\.tsx?$|testkit\.ts$|[\\/]dev[\\/]|[\\/]i18n[\\/](?!index\.ts))/;
const CALLS = new Set(["t", "tj", "msg"]);

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !SKIP.test(p)) out.push(p);
  }
}

function literal(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

function calleeName(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return undefined;
}

export function extractKeys(root = ROOT): Map<string, I18nKey> {
  const files: string[] = [];
  for (const d of DIRS) walk(path.join(root, d), files);
  const keys = new Map<string, I18nKey>();
  const add = (key: string, file: string, one?: string) => {
    if (!key.trim()) return;
    const cur = keys.get(key);
    if (cur) {
      if (!cur.files.includes(file)) cur.files.push(file);
      if (one && !cur.one) cur.one = one;
    } else keys.set(key, { key, ...(one ? { one } : {}), files: [file] });
  };
  for (const file of files) {
    const rel = path.relative(root, file);
    const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const core = rel.startsWith(`src${path.sep}core`);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const name = calleeName(node.expression);
        // `t as tr` in renderer files that also use `t` as a variable name.
        const isT = name && (CALLS.has(name) || (name === "tr" && ts.isIdentifier(node.expression)));
        if (isT) {
          const s = literal(node.arguments[0]);
          if (s !== undefined) add(s, rel);
        } else if (name === "tc") {
          const ctx = literal(node.arguments[0]);
          const s = literal(node.arguments[1]);
          if (ctx !== undefined && s !== undefined) add(`${ctx}\u0004${s}`, rel);
        } else if (name === "tn") {
          const one = literal(node.arguments[1]);
          const other = literal(node.arguments[2]);
          if (other !== undefined) add(other, rel, one);
        }
      } else if (core && ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Error") {
        const s = literal(node.arguments?.[0]);
        // Sentences only: "Pick a level." is shown to learners; "not a file" is for developers.
        if (s && /^[A-Z]/.test(s) && /[.!?]$/.test(s)) add(s, rel);
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
  return keys;
}

/** Placeholder names in a string: "{count} of {total}" → ["count", "total"]. */
export function placeholders(s: string): string[] {
  return [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
}

async function main() {
  const mode = process.argv[2] ?? "list";
  const keys = extractKeys();
  if (mode === "list") {
    console.log(JSON.stringify([...keys.values()].map(({ key, one }) => (one ? { key, one } : { key })), null, 1));
    return;
  }
  const { CATALOGS } = await import("../src/shared/i18n/index");
  for (const [locale, cat] of Object.entries(CATALOGS)) {
    const list = mode === "unused" ? Object.keys(cat).filter((k) => !keys.has(k)) : [...keys.keys()].filter((k) => !(k in cat));
    console.log(`${locale}: ${list.length}`);
    for (const k of list.slice(0, 20)) console.log(`  ${JSON.stringify(k)}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
