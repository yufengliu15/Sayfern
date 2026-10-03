import type { SayfernApi } from "../../shared/api";
import { t } from "./i18n";

/**
 * The backend. Resolved lazily so the dev mock (installed in main.tsx before the app
 * module loads) and the real preload bridge work the same way.
 */
export const api: SayfernApi = new Proxy({} as SayfernApi, {
  get(_target, key: string) {
    const impl = window.sayfern as unknown as Record<string, unknown>;
    const v = impl[key];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(impl) : v;
  },
});

/**
 * Electron wraps thrown errors: "Error invoking remote method 'ipc:x': Error: msg". Core errors are
 * English; fixed ones are in the catalogs (the extractor collects `new Error("…")` literals), so
 * they are translated here. Anything else (provider messages, file paths) passes through.
 */
export function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return t(raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
}
