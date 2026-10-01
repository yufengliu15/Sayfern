// Small pure text helpers used by the tutor.
import type { Language } from "../../shared/records";

/** Remove pasted spans so only the learner's own writing counts (S1-23). */
export function stripPasted(text: string, spans: readonly string[] | undefined): string {
  let out = text;
  for (const span of spans ?? []) {
    if (span) out = out.split(span).join("\n");
  }
  return out;
}

/**
 * Find `needle` in `haystack`, exactly or after normalization, and return the
 * exact substring of `haystack` it corresponds to (or null).
 * `normalize` is applied per code point so offsets map back to the original.
 */
export function findOriginal(haystack: string, needle: string, normalize: (s: string) => string): string | null {
  if (!needle) return null;
  if (haystack.includes(needle)) return needle;
  const trimmed = needle.trim();
  if (trimmed && haystack.includes(trimmed)) return trimmed;
  const target = normalize(needle);
  if (!target) return null;
  let norm = "";
  // For each UTF-16 index of `norm`, the [start, end) of the source code point.
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  for (const ch of haystack) {
    const n = normalize(ch);
    for (let k = 0; k < n.length; k++) {
      starts.push(i);
      ends.push(i + ch.length);
    }
    norm += n;
    i += ch.length;
  }
  const at = norm.indexOf(target);
  if (at < 0) return null;
  const from = starts[at];
  const to = ends[at + target.length - 1];
  const found = haystack.slice(from, to).trim();
  return found || null;
}

/** ASCII slug: "Besides A, also B" → "besides-a-also-b". */
export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

/**
 * Canonical grammar id "<lang>:<ascii-slug>". Accepts ids with or without the
 * language prefix; falls back to a slug of `fallback` (e.g. the English name).
 */
export function canonicalGrammarId(raw: unknown, language: Language, fallback?: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  const body = s.replace(/^[a-z]{2,3}:/i, "");
  let slug = slugify(body);
  if (!slug && typeof fallback === "string") slug = slugify(fallback);
  return slug ? `${language}:${slug}` : null;
}

export function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v.trim()) ? (v.trim() as T) : fallback;
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function truncate(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join("")}…`;
}
