import { cleanParagraph, type ParsedDoc } from "./text";

/**
 * Plain text: paragraphs are separated by blank lines. A file without any
 * blank line is treated as one paragraph per non-empty line.
 */
export function parseTxt(input: string): ParsedDoc {
  const text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const hasBlankLine = /\n[ \t　]*\n/.test(text.trim());
  const blocks = hasBlankLine ? text.split(/\n[ \t　]*\n/) : text.split("\n");
  const paragraphs = blocks.map(cleanParagraph).filter((t) => t.length > 0).map((t) => ({ text: t }));
  return { paragraphs, warnings: [] };
}
