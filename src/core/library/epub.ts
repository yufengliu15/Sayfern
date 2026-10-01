import JSZip from "jszip";
import { decodeEntities, localName, parseHtml, tokenize } from "./html";
import { cleanParagraph, collapseWhitespace, decodeText, type ParsedDoc, type ParsedParagraph } from "./text";

/** Resolves `href` relative to the directory of `base` (zip paths, "/"-separated). */
function resolvePath(base: string, href: string): string {
  const clean = safeDecode(href.split("#")[0]);
  if (clean.startsWith("/")) return clean.slice(1);
  const parts = base.split("/");
  parts.pop();
  for (const seg of clean.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

async function readZipText(zip: JSZip, path: string, language?: string): Promise<string | null> {
  const file = zip.file(path) ?? zip.file(new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"))[0];
  if (!file) return null;
  return decodeText(await file.async("uint8array"), language);
}

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string;
}

/** EPUB 2/3 → paragraphs in spine order. Titles from dc:title, headings from h1-h3 or the table of contents. */
export async function parseEpub(bytes: Uint8Array, language?: string): Promise<ParsedDoc> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error("This EPUB file couldn't be opened. It may be damaged.");
  }
  const container = await readZipText(zip, "META-INF/container.xml");
  let opfPath: string | undefined;
  if (container) {
    const root = tokenize(container).find((t) => t.type === "open" && localName(t.name) === "rootfile");
    if (root && root.type === "open") opfPath = root.attrs["full-path"];
  }
  opfPath ??= Object.keys(zip.files).find((p) => p.toLowerCase().endsWith(".opf"));
  if (!opfPath) throw new Error("This EPUB file has no package document (OPF), so it can't be read.");
  const opf = await readZipText(zip, opfPath, language);
  if (!opf) throw new Error("This EPUB file is missing its package document, so it can't be read.");

  const manifest = new Map<string, ManifestItem>();
  const spine: string[] = [];
  let title: string | undefined;
  let tocId: string | undefined;
  const tokens = tokenize(opf);
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type !== "open") continue;
    const name = t.name;
    if (name === "dc:title" || (localName(name) === "title" && name !== "title")) {
      const next = tokens[k + 1];
      if (!title && next?.type === "text") title = cleanParagraph(collapseWhitespace(decodeEntities(next.text))) || undefined;
    } else if (localName(name) === "item") {
      const id = t.attrs.id;
      if (id && t.attrs.href) {
        manifest.set(id, {
          id,
          href: resolvePath(opfPath, t.attrs.href),
          mediaType: t.attrs["media-type"] ?? "",
          properties: t.attrs.properties ?? "",
        });
      }
    } else if (localName(name) === "spine") {
      tocId = t.attrs.toc;
    } else if (localName(name) === "itemref") {
      if (t.attrs.idref && t.attrs.linear !== "no") spine.push(t.attrs.idref);
    }
  }

  const tocTitles = await readToc(zip, manifest, tocId, language);

  const paragraphs: ParsedParagraph[] = [];
  let heading: string | undefined;
  for (const idref of spine) {
    const item = manifest.get(idref);
    if (!item) continue;
    if (item.mediaType && !/html|xml/i.test(item.mediaType)) continue;
    const html = await readZipText(zip, item.href, language);
    if (html === null) continue;
    const tocTitle = tocTitles.get(item.href);
    const parsed = parseHtml(html, { heading: tocTitle ?? heading });
    paragraphs.push(...parsed.paragraphs);
    heading = parsed.lastHeading;
  }
  const warnings: string[] = [];
  if (spine.length === 0) warnings.push("This EPUB has no reading order (spine), so no text was imported.");
  return { title, paragraphs, warnings };
}

/** Maps chapter file path → first table-of-contents title that points at it (EPUB 3 nav or EPUB 2 NCX). */
async function readToc(
  zip: JSZip,
  manifest: Map<string, ManifestItem>,
  tocId: string | undefined,
  language?: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const nav = [...manifest.values()].find((m) => m.properties.split(/\s+/).includes("nav"));
    if (nav) {
      const src = await readZipText(zip, nav.href, language);
      if (src) {
        const tokens = tokenize(src);
        let href: string | undefined;
        let text = "";
        for (const t of tokens) {
          if (t.type === "open" && localName(t.name) === "a") {
            href = t.attrs.href;
            text = "";
          } else if (t.type === "text" && href !== undefined) text += t.text;
          else if (t.type === "close" && localName(t.name) === "a" && href !== undefined) {
            const label = cleanParagraph(collapseWhitespace(decodeEntities(text)));
            const path = resolvePath(nav.href, href);
            if (label && !out.has(path)) out.set(path, label);
            href = undefined;
          }
        }
        if (out.size > 0) return out;
      }
    }
    const ncx = (tocId && manifest.get(tocId)) || [...manifest.values()].find((m) => /ncx/i.test(m.mediaType));
    if (ncx) {
      const src = await readZipText(zip, ncx.href, language);
      if (src) {
        let label = "";
        let inText = false;
        for (const t of tokenize(src)) {
          if (t.type === "open" && localName(t.name) === "navpoint") label = "";
          else if (t.type === "open" && localName(t.name) === "text") inText = true;
          else if (t.type === "close" && localName(t.name) === "text") inText = false;
          else if (t.type === "text" && inText && !label) label = cleanParagraph(collapseWhitespace(decodeEntities(t.text)));
          else if (t.type === "open" && localName(t.name) === "content" && t.attrs.src) {
            const path = resolvePath(ncx.href, t.attrs.src);
            if (label && !out.has(path)) out.set(path, label);
          }
        }
      }
    }
  } catch {
    // A broken table of contents only costs us chapter titles.
  }
  return out;
}
