// Leaked tool calls. GPT models (seen with gpt-6.1-sol over the ChatGPT sign-in) sometimes write
// a tool call into the reply text in their internal chat format instead of calling the tool:
//   北京不错！你在北京吃了什么？
//    ك<|assistant to=functions.record_evidence ... {"corrections":[...]} ... commentary ...Recorded.
// Everything from the marker on is noise for the learner. The JSON is usually a valid call, so we
// salvage it and run it as if the model had called the tool.

/** Start of a leaked call: a chat-format token (`<|assistant`, `<|channel|>`, ...) or `to=functions.<name>`. */
const LEAK_RE = /<\|\s*(?:assistant|channel|message|call|constrain|start|end|im_start|im_end|return|tool)\b|\bto=functions\.[A-Za-z_]/;

/** Index where leaked tool-call text begins, or -1. */
export function leakStart(text: string): number {
  const m = LEAK_RE.exec(text);
  return m ? m.index : -1;
}

/** How many trailing characters could be the start of a marker still being streamed (hold them back). */
export function pendingTail(text: string): number {
  const tail = text.slice(-16);
  const lt = tail.lastIndexOf("<");
  if (lt >= 0) return tail.length - lt;
  const word = "to=functions.";
  for (let k = Math.min(word.length, text.length); k > 0; k--) {
    if (text.endsWith(word.slice(0, k))) return k;
  }
  return 0;
}

/**
 * The reply without leaked tool-call text. Cuts at the marker; if the marker's line holds only one or
 * two stray characters before it (" ك<|assistant"), they go too.
 */
export function stripLeak(text: string): string {
  const at = leakStart(text);
  if (at < 0) return text;
  let cut = at;
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  if ([...text.slice(lineStart, at).trim()].length <= 2) cut = lineStart;
  return text.slice(0, cut).trimEnd();
}

export interface LeakedCall {
  name: string;
  args: Record<string, unknown>;
}

/** Tool calls written as text: `to=functions.<name>` followed (soon) by a JSON object. */
export function leakedCalls(text: string): LeakedCall[] {
  const out: LeakedCall[] = [];
  const re = /to=functions\.([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const brace = text.indexOf("{", m.index + m[0].length);
    // The JSON follows within a short header ("jsonStringify", "<|constrain|>json<|message|>", ...).
    if (brace < 0 || brace - (m.index + m[0].length) > 60) continue;
    const json = balancedObject(text, brace);
    if (!json) continue;
    try {
      const args = JSON.parse(json);
      if (args && typeof args === "object" && !Array.isArray(args)) out.push({ name: m[1], args });
    } catch {
      // not JSON after all
    }
    re.lastIndex = brace + json.length;
  }
  return out;
}

/** The `{...}` starting at `from`, with nested braces and strings respected, or null if unbalanced. */
function balancedObject(text: string, from: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(from, i + 1);
    }
  }
  return null;
}
