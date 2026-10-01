import type { SayfernApi } from "../../shared/api";

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

/** Electron wraps thrown errors: "Error invoking remote method 'ipc:x': Error: msg". */
export function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}
