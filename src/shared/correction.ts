// The tutor prompt asks for an optional final line starting with "✎ ".
/** Split a tutor reply into the conversational part and an optional correction line. */
export function splitCorrection(text: string): { reply: string; correction?: string } {
  const lines = text.trimEnd().split("\n");
  const idx = lines.findIndex((l) => l.trimStart().startsWith("✎"));
  if (idx === -1) return { reply: text };
  const correction = lines.slice(idx).join("\n").replace(/^\s*✎\s*/, "");
  return { reply: lines.slice(0, idx).join("\n").trimEnd(), correction };
}
