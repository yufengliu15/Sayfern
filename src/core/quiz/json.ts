// Robust JSON extraction from model replies: code fences, prose around the JSON, and replies cut
// off mid-array (the complete items before the cut are kept).

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** Index of the bracket that closes the one at `start`, or -1 (string-aware). */
function matchingClose(s: string, start: number): number {
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return i;
  }
  return -1;
}

/**
 * Salvage complete objects from a truncated `[ {...}, {...}, {..` array: every top-level object
 * in the first array that closes is kept.
 */
function salvageArray(s: string): unknown[] | undefined {
  const at = s.indexOf("[");
  if (at < 0) return undefined;
  const out: unknown[] = [];
  let i = at + 1;
  while (i < s.length) {
    const next = s.indexOf("{", i);
    if (next < 0) break;
    const end = matchingClose(s, next);
    if (end < 0) break;
    const v = tryParse(s.slice(next, end + 1));
    if (v !== undefined) out.push(v);
    i = end + 1;
  }
  return out.length ? out : undefined;
}

/** The JSON value in a model reply, or null. A truncated items array comes back as `{ items: [...] }`. */
export function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
  const whole = tryParse(cleaned);
  if (whole !== undefined) return whole;
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (c !== "{" && c !== "[") continue;
    const end = matchingClose(cleaned, i);
    if (end > i) {
      const v = tryParse(cleaned.slice(i, end + 1));
      if (v !== undefined) return v;
    }
    break;
  }
  const salvaged = salvageArray(cleaned);
  return salvaged ? { items: salvaged } : null;
}
