// Tiny hash-backed router. Routes are plain strings so they can be stored, logged and
// deep-linked (e.g. `#/session/abc` in the mock dev server).
import { useSyncExternalStore } from "react";

export type Route =
  | "today"
  | `session/${string}`
  | "library"
  | `reader/${string}`
  | "grammar"
  | `grammar/${string}`
  | "progress"
  | "settings"
  | `settings/${string}`
  | "onboarding"
  | "customize";

export type ParsedRoute =
  | { name: "today" }
  | { name: "session"; id: string }
  | { name: "library" }
  | { name: "reader"; docId: string; paragraph?: number }
  | { name: "grammar"; grammarId?: string }
  | { name: "progress" }
  | { name: "settings"; tab?: string }
  | { name: "onboarding" }
  | { name: "customize" };

export type Navigate = (route: Route) => void;

export const sessionRoute = (id: string): Route => `session/${encodeURIComponent(id)}`;
/** Reader for a document, optionally scrolled to a paragraph (0-based). */
export const readerRoute = (docId: string, paragraph?: number): Route =>
  `reader/${encodeURIComponent(docId)}${paragraph != null && paragraph >= 0 ? `/${paragraph}` : ""}`;
export const settingsRoute = (tab?: string): Route => (tab ? `settings/${encodeURIComponent(tab)}` : "settings");
export const grammarRoute = (id: string): Route => `grammar/${encodeURIComponent(id)}`;

const SIMPLE = new Set(["today", "library", "grammar", "progress", "settings", "onboarding", "customize"]);

export function parseRoute(raw: string): ParsedRoute {
  const s = raw.replace(/^#?\/?/, "");
  const slash = s.indexOf("/");
  const head = slash === -1 ? s : s.slice(0, slash);
  const rawArg = slash === -1 ? "" : s.slice(slash + 1);
  const arg = decodeURIComponent(rawArg);
  if (head === "session" && arg) return { name: "session", id: arg };
  if (head === "reader" && rawArg) {
    // reader/<encoded docId>[/<paragraph>]
    const [id, p] = rawArg.split("/");
    const n = p != null && /^\d+$/.test(p) ? Number(p) : undefined;
    return n == null ? { name: "reader", docId: decodeURIComponent(id) } : { name: "reader", docId: decodeURIComponent(id), paragraph: n };
  }
  if (head === "settings") return arg ? { name: "settings", tab: arg } : { name: "settings" };
  if (head === "grammar") return arg ? { name: "grammar", grammarId: arg } : { name: "grammar" };
  if (SIMPLE.has(head)) return { name: head } as ParsedRoute;
  return { name: "today" };
}

function normalize(raw: string): Route {
  const p = parseRoute(raw);
  switch (p.name) {
    case "session":
      return sessionRoute(p.id);
    case "reader":
      return readerRoute(p.docId, p.paragraph);
    case "settings":
      return settingsRoute(p.tab);
    case "grammar":
      return p.grammarId ? grammarRoute(p.grammarId) : "grammar";
    default:
      return p.name;
  }
}

const listeners = new Set<() => void>();
let current: Route = normalize(typeof location === "undefined" ? "" : location.hash);

function emit() {
  for (const l of listeners) l();
}

if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    const next = normalize(location.hash);
    if (next !== current) {
      current = next;
      emit();
    }
  });
}

/** Go to a route. Pushes a history entry so Back works. */
export function navigate(route: Route): void {
  if (route === current) return;
  current = route;
  const hash = `#/${route}`;
  if (location.hash !== hash) location.hash = hash;
  emit();
}

/** Replace the current route without a new history entry. */
export function replaceRoute(route: Route): void {
  current = route;
  history.replaceState(null, "", `#/${route}`);
  emit();
}

export function currentRoute(): Route {
  return current;
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
