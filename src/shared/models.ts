import type { ModelInfo } from "./types";

/** Pick a sensible default: a mid-size, fast chat model from whatever is connected. */
export function pickDefaultModel(list: ModelInfo[]): ModelInfo | undefined {
  const prefs: RegExp[] = [/sonnet/i, /^gpt-5(\.\d+)?$/i, /^gpt-5(\.\d+)?-mini$/i, /^gpt-5/i, /gemini.*flash/i, /deepseek-chat/i];
  for (const re of prefs) {
    const hits = list.filter((m) => re.test(m.id));
    // Catalogs list newer models later; prefer the newest match.
    if (hits.length) return hits[hits.length - 1];
  }
  return list[0];
}
