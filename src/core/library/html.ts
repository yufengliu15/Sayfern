import { cleanParagraph, collapseWhitespace, type ParsedDoc, type ParsedParagraph } from "./text";

// ---------------------------------------------------------------- entities

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  zwj: "", zwnj: "", shy: "", lrm: "", rlm: "",
  mdash: "—", ndash: "–", hellip: "…", middot: "·", bull: "•", prime: "′", Prime: "″",
  lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„", laquo: "«", raquo: "»",
  lsaquo: "‹", rsaquo: "›", copy: "©", reg: "®", trade: "™", deg: "°", plusmn: "±", times: "×",
  divide: "÷", micro: "µ", para: "¶", sect: "§", cent: "¢", pound: "£", yen: "¥", euro: "€",
  iexcl: "¡", iquest: "¿", frac12: "½", frac14: "¼", frac34: "¾", sup2: "²", sup3: "³",
  larr: "←", rarr: "→", uarr: "↑", darr: "↓", harr: "↔", hearts: "♥", star: "☆",
  agrave: "à", aacute: "á", acirc: "â", auml: "ä", atilde: "ã", aring: "å", ccedil: "ç",
  egrave: "è", eacute: "é", ecirc: "ê", euml: "ë", igrave: "ì", iacute: "í", icirc: "î", iuml: "ï",
  ntilde: "ñ", ograve: "ò", oacute: "ó", ocirc: "ô", ouml: "ö", otilde: "õ", oslash: "ø",
  ugrave: "ù", uacute: "ú", ucirc: "û", uuml: "ü", yacute: "ý", yuml: "ÿ", szlig: "ß",
  Agrave: "À", Aacute: "Á", Acirc: "Â", Auml: "Ä", Eacute: "É", Ouml: "Ö", Uuml: "Ü", Ccedil: "Ç",
};

/** Decodes named (common set) and numeric character references. Unknown names are left as is. */
export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);?/g, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�";
      return String.fromCodePoint(code);
    }
    const hit = NAMED[body] ?? NAMED[body.toLowerCase()];
    return hit ?? m;
  });
}

// ---------------------------------------------------------------- tag scanner

export type HtmlToken =
  | { type: "text"; text: string }
  | { type: "open"; name: string; attrs: Record<string, string>; selfClosing: boolean }
  | { type: "close"; name: string };

const RAW_TEXT = new Set(["script", "style", "textarea", "title", "xmp"]);

/**
 * Tolerant HTML/XML tokenizer: never throws, treats stray "<" as text, skips
 * comments/doctypes/processing instructions, keeps CDATA as text, and
 * returns the raw contents of script/style/title as a single text token.
 * Tag and attribute names are lowercased.
 */
export function tokenize(src: string): HtmlToken[] {
  const out: HtmlToken[] = [];
  let i = 0;
  let text = "";
  const pushText = () => {
    if (text) out.push({ type: "text", text });
    text = "";
  };
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      text += src.slice(i);
      break;
    }
    text += src.slice(i, lt);
    i = lt;
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", i)) {
      const end = src.indexOf("]]>", i + 9);
      text += src.slice(i + 9, end < 0 ? src.length : end).replace(/&/g, "&amp;");
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src[i + 1] === "!" || src[i + 1] === "?") {
      const end = src.indexOf(">", i);
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    const m = /^<(\/?)([A-Za-z][\w:.-]*)/.exec(src.slice(i, i + 64));
    if (!m) {
      text += "<";
      i++;
      continue;
    }
    // Scan to the closing ">", respecting quoted attribute values.
    let j = i + m[0].length;
    let quote = "";
    for (; j < src.length; j++) {
      const c = src[j];
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
    }
    const inner = src.slice(i + m[0].length, j);
    i = Math.min(j + 1, src.length);
    const name = m[2].toLowerCase();
    pushText();
    if (m[1]) {
      out.push({ type: "close", name });
      continue;
    }
    const selfClosing = /\/\s*$/.test(inner);
    out.push({ type: "open", name, attrs: parseAttrs(inner), selfClosing });
    if (!selfClosing && RAW_TEXT.has(localName(name))) {
      const closeRe = new RegExp(`</${name.replace(/[.]/g, "\\.")}\\s*>`, "i");
      const rest = src.slice(i);
      const cm = closeRe.exec(rest);
      const body = cm ? rest.slice(0, cm.index) : rest;
      if (body) out.push({ type: "text", text: body });
      out.push({ type: "close", name });
      i = cm ? i + cm.index + cm[0].length : src.length;
    }
  }
  pushText();
  return out;
}

function parseAttrs(s: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return attrs;
}

export function localName(name: string): string {
  const k = name.lastIndexOf(":");
  return k < 0 ? name : name.slice(k + 1);
}

// ---------------------------------------------------------------- html → paragraphs

const BLOCK = new Set([
  "p", "div", "li", "ul", "ol", "dl", "dt", "dd", "br", "hr", "section", "article", "header", "footer",
  "blockquote", "pre", "table", "thead", "tbody", "tfoot", "tr", "caption", "figure", "figcaption",
  "aside", "nav", "main", "body", "address", "h4", "h5", "h6", "center", "details", "summary", "form",
  "fieldset", "legend", "option", "html",
]);
const HEADINGS = new Set(["h1", "h2", "h3"]);
const SKIP = new Set(["script", "style", "noscript", "template", "rt", "rp", "svg", "math", "object", "iframe", "select", "button"]);

export interface HtmlParseOptions {
  /** Heading in effect before this document (epub chapters carry it over). */
  heading?: string;
}

export interface HtmlParseResult extends ParsedDoc {
  /** Heading in effect at the end of the document. */
  lastHeading?: string;
  /** First h1-h3 found, if any. */
  firstHeading?: string;
}

/**
 * HTML/XHTML → paragraphs. Block elements (and <br>) end paragraphs, h1-h3
 * set the heading context, script/style and ruby annotations are dropped.
 */
export function parseHtml(src: string, opts: HtmlParseOptions = {}): HtmlParseResult {
  const tokens = tokenize(src.replace(/^﻿/, ""));
  const paragraphs: ParsedParagraph[] = [];
  let heading = opts.heading;
  let firstHeading: string | undefined;
  let title: string | undefined;
  let buf = "";
  let skipDepth = 0;
  let skipName = "";
  let headingDepth = 0;
  let headingBuf = "";
  let preDepth = 0;
  let inTitle = false;

  const flush = () => {
    const raw = buf;
    buf = "";
    const text = preDepth > 0 ? raw.replace(/\r\n?/g, "\n").replace(/^\n+|\s+$/g, "") : cleanParagraph(collapseWhitespace(raw));
    if (text.trim()) paragraphs.push(heading ? { text, heading } : { text });
  };

  for (const t of tokens) {
    if (skipDepth > 0) {
      if (t.type === "open" && !t.selfClosing && localName(t.name) === skipName) skipDepth++;
      else if (t.type === "close" && localName(t.name) === skipName) skipDepth--;
      continue;
    }
    if (t.type === "text") {
      if (inTitle) {
        title = cleanParagraph(collapseWhitespace(decodeEntities(t.text))) || title;
        continue;
      }
      const decoded = decodeEntities(t.text);
      if (headingDepth > 0) headingBuf += decoded;
      else buf += decoded;
      continue;
    }
    const name = localName(t.name);
    if (t.type === "open") {
      if (name === "title") {
        inTitle = !t.selfClosing;
        continue;
      }
      if (SKIP.has(name) && !t.selfClosing) {
        skipDepth = 1;
        skipName = name;
        continue;
      }
      if (HEADINGS.has(name) && !t.selfClosing) {
        flush();
        headingDepth++;
        continue;
      }
      if (name === "img") {
        continue;
      }
      if (name === "td" || name === "th") {
        if (buf && !/\s$/.test(buf)) buf += " ";
        continue;
      }
      if (BLOCK.has(name)) {
        if (headingDepth > 0) {
          headingBuf += " ";
          continue;
        }
        flush();
        if (name === "pre" && !t.selfClosing) preDepth++;
      }
      continue;
    }
    // close
    if (name === "title") {
      inTitle = false;
      continue;
    }
    if (HEADINGS.has(name) && headingDepth > 0) {
      headingDepth--;
      if (headingDepth === 0) {
        const h = cleanParagraph(collapseWhitespace(headingBuf));
        headingBuf = "";
        if (h) {
          heading = h;
          firstHeading ??= h;
        }
      }
      continue;
    }
    if (BLOCK.has(name)) {
      if (headingDepth > 0) {
        headingBuf += " ";
        continue;
      }
      flush();
      if (name === "pre" && preDepth > 0) preDepth--;
    }
  }
  if (headingDepth > 0) {
    const h = cleanParagraph(collapseWhitespace(headingBuf));
    if (h) {
      heading = h;
      firstHeading ??= h;
    }
  }
  flush();
  return { title, paragraphs, warnings: [], lastHeading: heading, firstHeading };
}
