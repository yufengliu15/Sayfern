import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NO_TEXT_LAYER_WARNING, parsePdf } from "./pdf";

interface TextLine {
  x: number;
  y: number;
  size?: number;
  text: string;
}

/** Builds a minimal valid PDF (Helvetica, one content stream per page). */
function makePdf(pages: (TextLine[] | string)[], title?: string): Uint8Array {
  const objs: string[] = [];
  const add = (body: string) => {
    objs.push(body);
    return objs.length;
  };
  const catalog = add("");
  const pagesObj = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids: number[] = [];
  for (const page of pages) {
    const content =
      typeof page === "string"
        ? page
        : page
            .map((l) => `BT /F1 ${l.size ?? 12} Tf ${l.x} ${l.y} Td (${l.text.replace(/[()\\]/g, (c) => `\\${c}`)}) Tj ET`)
            .join("\n");
    const stream = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Contents ${stream} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`,
      ),
    );
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  const info = title ? add(`<< /Title (${title}) >>`) : 0;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R${info ? ` /Info ${info} 0 R` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

describe("pdf parser", () => {
  it("extracts text, groups lines into paragraphs, reads the title and headings", async () => {
    const pdf = makePdf(
      [
        [
          { x: 72, y: 720, size: 20, text: "Chapter One" },
          { x: 72, y: 680, text: "The quick brown fox jumps over the lazy dog and keeps running" },
          { x: 72, y: 666, text: "until it reaches the river." },
          { x: 72, y: 630, text: "A second paragraph starts after a gap." },
          { x: 300, y: 60, text: "1" },
        ],
        [{ x: 72, y: 720, text: "Page two has its own paragraph." }],
      ],
      "Sample Doc",
    );
    const doc = await parsePdf(pdf);
    assert.equal(doc.title, "Sample Doc");
    assert.deepEqual(doc.warnings, []);
    assert.deepEqual(
      doc.paragraphs.map((p) => [p.heading, p.text]),
      [
        ["Chapter One", "The quick brown fox jumps over the lazy dog and keeps running until it reaches the river."],
        ["Chapter One", "A second paragraph starts after a gap."],
        ["Chapter One", "Page two has its own paragraph."],
      ],
    );
  });

  it("warns when there is no text layer", async () => {
    const pdf = makePdf(["0 0 1 rg 72 72 200 300 re f", "10 10 m 100 100 l S"]);
    const doc = await parsePdf(pdf);
    assert.deepEqual(doc.paragraphs, []);
    assert.deepEqual(doc.warnings, [NO_TEXT_LAYER_WARNING]);
    assert.equal(doc.title, undefined);
  });

  it("rejects garbage with a friendly error", async () => {
    await assert.rejects(parsePdf(new TextEncoder().encode("not a pdf at all")), /couldn't be opened/);
  });
});
