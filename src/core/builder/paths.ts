// Pure path and URL rules for feature packages: what the builder may write, and how
// sayfern-feature:// URLs map to files. No I/O here, so every rule is unit-tested.
import { FEATURE_SCHEME } from "../../shared/stage2";

/** Feature ids are generated ("f-" + 8 hex) but any lowercase slug is accepted (URL hosts are lowercased). */
export const FEATURE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Text files a feature may contain. No binaries, no build output. */
export const ALLOWED_EXTENSIONS = [".js", ".mjs", ".html", ".css", ".json", ".md", ".txt", ".svg"] as const;

export const PACKAGE_LIMITS = {
  fileBytes: 200 * 1024,
  totalBytes: 1024 * 1024,
  files: 40,
  pathLength: 160,
  depth: 5,
} as const;

const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;
/** Top-level names served by Sayfern itself (SDK, test page). */
const RESERVED = ["_sdk", "_test"];

export class FeaturePathError extends Error {}

/**
 * Normalizes a path inside a feature folder ("./ui/index.html" → "ui/index.html").
 * Throws a readable FeaturePathError for absolute paths, "..", hidden or odd names, and other extensions.
 */
export function normalizeFeaturePath(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) throw new FeaturePathError("A file path is required.");
  const p = raw.trim();
  if (p.length > PACKAGE_LIMITS.pathLength) throw new FeaturePathError(`Path too long: ${p.slice(0, 40)}…`);
  if (p.includes("\\")) throw new FeaturePathError(`Use forward slashes: ${p}`);
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.includes("\0")) throw new FeaturePathError(`Paths must be relative to the feature folder: ${p}`);
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  if (parts.length === 0) throw new FeaturePathError("A file path is required.");
  if (parts.length > PACKAGE_LIMITS.depth) throw new FeaturePathError(`Too many folders in ${p} (max ${PACKAGE_LIMITS.depth}).`);
  for (const s of parts) {
    if (s === "..") throw new FeaturePathError(`Paths can't leave the feature folder: ${p}`);
    if (!SEGMENT.test(s)) throw new FeaturePathError(`Unsupported file or folder name "${s}" (letters, digits, . _ - only; no leading dot).`);
  }
  if (RESERVED.includes(parts[0])) throw new FeaturePathError(`"${parts[0]}" is reserved for Sayfern. Use another folder name.`);
  const path = parts.join("/");
  const ext = extensionOf(path);
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new FeaturePathError(`Unsupported file type ${ext || "(none)"} for ${path}. Allowed: ${ALLOWED_EXTENSIONS.join(" ")}.`);
  }
  return path;
}

export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export function contentTypeOf(path: string): string {
  return CONTENT_TYPES[extensionOf(path)] ?? "application/octet-stream";
}

/** Resolves a relative module specifier from `from` ("ui/main.js" + "./drill.js" → "ui/drill.js"). null when it leaves the folder or isn't relative. */
export function resolveRelative(from: string, specifier: string): string | null {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
  const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")).split("/") : [];
  for (const s of specifier.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") {
      if (dir.length === 0) return null;
      dir.pop();
    } else dir.push(s);
  }
  return dir.join("/") || null;
}

/** Static and dynamic import specifiers in a JS module (string literals only). */
export function importSpecifiers(source: string): string[] {
  const out = new Set<string>();
  const re = /(?:\bimport\s*(?:[\w*{}\s,$]+\s*from\s*)?|\bexport\s*[\w*{}\s,$]*\s*from\s*|\bimport\s*\(\s*)(["'])([^"'\n]+)\1/g;
  for (const m of source.matchAll(re)) out.add(m[2]);
  return [...out];
}

// ---------------------------------------------------------------- sayfern-feature:// URLs

export type FeatureUrlTarget =
  | { kind: "sdk"; id: string; file: "sayfern-sdk.js" | "sayfern.css" }
  | { kind: "test"; id: string; version: number; file: "index.html" | "harness.js" | "run.js" }
  | { kind: "file"; id: string; version: number; path: string }
  | { kind: "invalid"; status: 400 | 404; reason: string };

/** `sayfern-feature://<id>/v<n>/<path>` (feature files) or `sayfern-feature://<id>/_sdk/<file>` (SDK). */
export function parseFeatureUrl(raw: string): FeatureUrlTarget {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { kind: "invalid", status: 400, reason: "Bad URL" };
  }
  if (u.protocol !== `${FEATURE_SCHEME}:`) return { kind: "invalid", status: 400, reason: "Wrong scheme" };
  const id = u.hostname.toLowerCase();
  if (!FEATURE_ID.test(id)) return { kind: "invalid", status: 404, reason: "Unknown feature" };
  let pathname: string;
  try {
    pathname = decodeURIComponent(u.pathname);
  } catch {
    return { kind: "invalid", status: 400, reason: "Bad path" };
  }
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "_sdk" && parts.length === 2 && (parts[1] === "sayfern-sdk.js" || parts[1] === "sayfern.css")) {
    return { kind: "sdk", id, file: parts[1] };
  }
  const v = /^v(\d{1,6})$/.exec(parts[0] ?? "");
  if (!v) return { kind: "invalid", status: 404, reason: "Unknown version" };
  if (parts[1] === "_test") {
    const file = parts[2];
    if (parts.length === 3 && (file === "index.html" || file === "harness.js" || file === "run.js")) return { kind: "test", id, version: Number(v[1]), file };
    return { kind: "invalid", status: 404, reason: "Unknown test file" };
  }
  try {
    // Encoded "%2E%2E" segments survive URL parsing; normalizeFeaturePath refuses them.
    const path = normalizeFeaturePath(parts.slice(1).join("/"));
    return { kind: "file", id, version: Number(v[1]), path };
  } catch (err) {
    return { kind: "invalid", status: 404, reason: err instanceof Error ? err.message : "Bad path" };
  }
}

/** The version's test page (loaded by the app's sandboxed test runner). */
export function featureTestUrl(id: string, version: number): string {
  return `${FEATURE_SCHEME}://${id}/v${version}/_test/index.html`;
}

export function featureUrl(id: string, version: number, path: string): string {
  return `${FEATURE_SCHEME}://${id}/v${version}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** Response headers for everything served to a sandboxed feature frame. No network, scripts only from the feature. */
export function featureHeaders(id: string, contentType: string): Record<string, string> {
  const self = `${FEATURE_SCHEME}://${id}`;
  return {
    "Content-Type": contentType,
    "Content-Security-Policy": [
      "default-src 'none'",
      `script-src ${self}`,
      `style-src ${self} 'unsafe-inline'`,
      `img-src ${self} data:`,
      `font-src ${self} data:`,
      "connect-src 'none'",
      "media-src 'none'",
      "frame-src 'none'",
      "worker-src 'none'",
      "object-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    // Module scripts in a sandboxed (opaque-origin) frame are CORS requests.
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  };
}
