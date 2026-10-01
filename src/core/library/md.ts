import { decodeEntities } from "./html";
import { cleanParagraph, type ParsedDoc, type ParsedParagraph } from "./text";

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const ATX = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/;
const LIST = /^\s*([-*+]|\d{1,9}[.)])\s+(.*)$/;
const REF_DEF = /^\s{0,3}\[[^\]]+\]:\s*\S+/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** Strips inline markdown: images removed, links to text, emphasis, code spans, HTML tags. */
export function stripInline(s: string): string {
  let t = s;
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ""); // images
  t = t.replace(/!\[[^\]]*\]\[[^\]]*\]/g, "");
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"); // inline links
  t = t.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1"); // reference links
  t = t.replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1"); // autolinks
  t = t.replace(/<\/?[A-Za-z][^>]*>/g, ""); // inline HTML
  t = t.replace(/(`+)(.+?)\1/g, (_m, _ticks: string, code: string) => code.trim());
  t = t.replace(/(\*\*\*|___)(?=\S)(.+?)(?<=\S)\1/g, "$2");
  t = t.replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "$2");
  t = t.replace(/\*(?=\S)(.+?)(?<=\S)\*/g, "$1");
  t = t.replace(/(^|[^\p{L}\p{N}_])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}_])/gu, "$1$2");
  t = t.replace(/~~(?=\S)(.+?)(?<=\S)~~/g, "$1");
  t = t.replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, "$1"); // escapes
  return decodeEntities(t);
}

/** Markdown → paragraphs. Headings become heading context, list items become paragraphs. */
export function parseMarkdown(input: string): ParsedDoc {
  const lines = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const paragraphs: ParsedParagraph[] = [];
  let heading: string | undefined;
  let title: string | undefined;
  let buf: string[] = [];

  const flush = () => {
    if (buf.length === 0) return;
    const text = cleanParagraph(buf.map(stripInline).join("\n"));
    buf = [];
    if (text) paragraphs.push(heading ? { text, heading } : { text });
  };
  const setHeading = (raw: string) => {
    flush();
    const h = cleanParagraph(stripInline(raw));
    if (!h) return;
    heading = h;
    title ??= h;
  };

  let i = 0;
  // YAML front matter
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, k) => k > 0 && /^(---|\.\.\.)\s*$/.test(l));
    if (end > 0) {
      const fmTitle = lines.slice(1, end).map((l) => /^title:\s*(.+)$/i.exec(l)?.[1]).find(Boolean);
      if (fmTitle) title = fmTitle.replace(/^["']|["']$/g, "").trim();
      i = end + 1;
    }
  }

  let inItem = false;
  for (; i < lines.length; i++) {
    const line = lines[i];

    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      inItem = false;
      const marker = fence[1];
      const code: string[] = [];
      for (i++; i < lines.length; i++) {
        if (lines[i].trimStart().startsWith(marker[0].repeat(marker.length))) break;
        code.push(lines[i].replace(/\s+$/, ""));
      }
      const text = code.join("\n").replace(/^\n+|\n+$/g, "");
      if (text.trim()) paragraphs.push(heading ? { text, heading } : { text });
      continue;
    }

    if (!line.trim()) {
      flush();
      inItem = false;
      continue;
    }

    const atx = ATX.exec(line);
    if (atx) {
      inItem = false;
      setHeading(atx[2]);
      continue;
    }

    // Setext heading: one buffered line followed by === or ---
    if (/^\s{0,3}(=+|-+)\s*$/.test(line) && buf.length === 1 && !inItem) {
      const raw = buf[0];
      buf = [];
      setHeading(raw);
      continue;
    }

    if (RULE.test(line)) {
      flush();
      inItem = false;
      continue;
    }

    if (REF_DEF.test(line)) continue;
    if (TABLE_SEP.test(line) && line.includes("-") && line.includes("|")) continue;

    let content = line;
    // Blockquote markers
    content = content.replace(/^\s{0,3}(>\s?)+/, "");

    const item = LIST.exec(content);
    if (item) {
      flush();
      inItem = true;
      content = item[2];
      // Task list checkbox
      content = content.replace(/^\[[ xX]\]\s+/, "");
    }

    // Table row: cells separated by pipes
    if (/^\s*\|.*\|\s*$/.test(content)) {
      flush();
      const cells = content.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).filter(Boolean);
      buf.push(cells.join("  "));
      flush();
      continue;
    }

    buf.push(content);
  }
  flush();
  return { title, paragraphs, warnings: [] };
}
