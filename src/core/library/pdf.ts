import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { isCjk, joinLines, SENTENCE_END, type ParsedDoc, type ParsedParagraph } from "./text";

export const NO_TEXT_LAYER_WARNING = "No text layer found: scanned PDFs need OCR, which isn't supported yet.";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsPromise: Promise<{ pdfjs: PdfJs; assets: { cMapUrl?: string; standardFontDataUrl?: string } }> | null = null;

/**
 * Loads the legacy (Node-compatible) pdf.js build. There is no worker thread in
 * Node: registering the worker module on globalThis makes pdf.js run it
 * in-process ("fake worker") without trying to resolve a worker file path,
 * which also survives bundling.
 */
function loadPdfJs() {
  pdfjsPromise ??= (async () => {
    const g = globalThis as { pdfjsWorker?: unknown };
    if (!g.pdfjsWorker) g.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const assets: { cMapUrl?: string; standardFontDataUrl?: string } = {};
    try {
      // CMaps are needed to extract text from many CJK PDFs (CID fonts). Node's pdf.js reads plain paths.
      const root = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
      assets.cMapUrl = join(root, "cmaps") + "/";
      assets.standardFontDataUrl = join(root, "standard_fonts") + "/";
    } catch {
      // Without them, Latin text still works.
    }
    return { pdfjs, assets };
  })();
  return pdfjsPromise;
}

interface Item {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  eol: boolean;
}

interface Line {
  text: string;
  x: number;
  right: number;
  y: number;
  h: number;
}

/** PDF with a text layer → paragraphs. Scanned (image-only) PDFs import empty with a warning. */
export async function parsePdf(bytes: Uint8Array): Promise<ParsedDoc> {
  const { pdfjs, assets } = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes), // pdf.js takes ownership of the buffer
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
    cMapPacked: true,
    ...assets,
  });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (err) {
    await task.destroy().catch(() => undefined);
    const name = (err as { name?: string })?.name;
    if (name === "PasswordException") throw new Error("This PDF is password-protected, so it can't be imported.");
    throw new Error("This PDF couldn't be opened. It may be damaged.");
  }
  try {
    let title: string | undefined;
    try {
      const meta = await doc.getMetadata();
      const info = meta.info as { Title?: unknown } | undefined;
      const t = typeof info?.Title === "string" ? info.Title.trim() : "";
      const dc = meta.metadata?.get("dc:title");
      title = t || (typeof dc === "string" ? dc.trim() : "") || undefined;
    } catch {
      // no metadata
    }

    const pages: Line[][] = [];
    let nonSpace = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items: Item[] = [];
      for (const raw of content.items) {
        if (!("str" in raw)) continue;
        const tr = raw.transform as number[];
        const h = Math.abs(raw.height) || Math.hypot(tr[2], tr[3]) || 10;
        items.push({ str: raw.str, x: tr[4], y: tr[5], w: raw.width, h, eol: raw.hasEOL });
        nonSpace += raw.str.replace(/\s+/g, "").length;
      }
      pages.push(toLines(items));
      page.cleanup();
    }

    const warnings: string[] = [];
    if (doc.numPages === 0 || nonSpace / doc.numPages < 10) warnings.push(NO_TEXT_LAYER_WARNING);
    return { title, paragraphs: toParagraphs(pages), warnings };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

/** Groups text items into lines by baseline. Items keep content-stream order. */
function toLines(items: Item[]): Line[] {
  const lines: Line[] = [];
  let cur: Line | null = null;
  let prev: Item | null = null;
  for (const it of items) {
    if (!it.str && !it.eol) continue;
    const sameLine = cur && prev && !prev.eol && Math.abs(it.y - cur.y) <= Math.max(cur.h, it.h) * 0.5;
    if (!cur || !sameLine) {
      if (cur && cur.text.trim()) lines.push(cur);
      cur = { text: it.str, x: it.x, right: it.x + it.w, y: it.y, h: it.h };
    } else {
      const gap = it.x - cur.right;
      const needsSpace =
        !/\s$/.test(cur.text) && !/^\s/.test(it.str) && gap > it.h * 0.15 && !(isCjk(cur.text.slice(-1)) && isCjk(it.str[0]));
      cur.text += (needsSpace ? " " : "") + it.str;
      cur.right = Math.max(cur.right, it.x + it.w);
      cur.h = Math.max(cur.h, it.h);
    }
    prev = it; // an item with hasEOL ends the line: the next item starts a new one
  }
  if (cur && cur.text.trim()) lines.push(cur);
  return lines
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() }))
    .filter((l) => l.text && !/^[-–—\s]*\d{1,4}[-–—\s]*$/.test(l.text)); // drop bare page numbers
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Lines → paragraphs. A new paragraph starts on a large vertical gap, a font
 * size jump, or after a sentence-ending line that is short or followed by an
 * indented line. Paragraphs continue across page breaks when the page ended
 * mid-sentence. Large short lines become headings.
 */
function toParagraphs(pages: Line[][]): ParsedParagraph[] {
  const bodyH = median(pages.flat().map((l) => l.h)) || 10;
  const out: ParsedParagraph[] = [];
  let heading: string | undefined;
  let buf = "";
  let bufEndsPage = false;

  const flush = () => {
    const text = buf.trim();
    buf = "";
    if (text) out.push(heading ? { text, heading } : { text });
  };

  for (const lines of pages) {
    if (lines.length === 0) continue;
    const gaps: number[] = [];
    for (let k = 1; k < lines.length; k++) {
      const g = lines[k - 1].y - lines[k].y;
      if (g > 0) gaps.push(g);
    }
    const lineGap = median(gaps) || bodyH * 1.2;
    const left = Math.min(...lines.map((l) => l.x));
    const right = Math.max(...lines.map((l) => l.right));

    for (let k = 0; k < lines.length; k++) {
      const line = lines[k];
      const prev = k > 0 ? lines[k - 1] : null;
      const isHeading = line.h >= bodyH * 1.3 && Array.from(line.text).length <= 60;
      if (isHeading) {
        flush();
        heading = line.text;
        bufEndsPage = false;
        continue;
      }
      let breakBefore = false;
      const indented = line.x > left + line.h * 0.9;
      if (prev) {
        const gap = prev.y - line.y;
        const endsSentence = SENTENCE_END.test(prev.text);
        const short = prev.right < right - prev.h * 2;
        if (gap > lineGap * 1.4 || gap < -prev.h) breakBefore = true;
        else if (Math.abs(line.h - prev.h) > bodyH * 0.25) breakBefore = true;
        else if (endsSentence && (short || indented)) breakBefore = true;
      } else if (bufEndsPage) {
        // First line of a page: continue the previous paragraph unless it ended a sentence or this line is indented.
        if (SENTENCE_END.test(buf) || indented) breakBefore = true;
      }
      if (breakBefore) flush();
      buf = joinLines(buf, line.text);
      bufEndsPage = false;
    }
    bufEndsPage = true;
  }
  flush();
  return out;
}
