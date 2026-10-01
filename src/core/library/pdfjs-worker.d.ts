// pdf.js ships no types for its worker entry; we only need it to exist.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
