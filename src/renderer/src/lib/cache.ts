// Small promise caches for per-text / per-word backend calls. Keeps hover lookups instant
// on the second pass and avoids re-annotating every message on re-render.
import type { LookupResult, Token } from "../../../shared/lang";
import type { Language } from "../../../shared/records";
import type { ModelRef } from "../../../shared/types";
import { api } from "../api";

const annotations = new Map<string, Promise<Token[]>>();
const annotationValues = new Map<string, Token[]>();
const lookups = new Map<string, Promise<LookupResult>>();
const translations = new Map<string, Promise<string>>();

const key = (language: Language, s: string) => `${language}\u0000${s}`;

export function annotateCached(language: Language, text: string): Promise<Token[]> {
  const k = key(language, text);
  let p = annotations.get(k);
  if (!p) {
    p = api.annotate(language, text).then((tokens) => {
      annotationValues.set(k, tokens);
      return tokens;
    });
    p.catch(() => annotations.delete(k));
    annotations.set(k, p);
  }
  return p;
}

/** Synchronous peek so re-mounted messages render annotated on the first frame. */
export function peekAnnotation(language: Language, text: string): Token[] | undefined {
  return annotationValues.get(key(language, text));
}

export function lookupCached(language: Language, word: string): Promise<LookupResult> {
  const k = key(language, word);
  let p = lookups.get(k);
  if (!p) {
    p = api.lookup(language, word);
    p.catch(() => lookups.delete(k));
    lookups.set(k, p);
  }
  return p;
}

/** Call after a dictionary install or a vocabulary change. */
export function clearLookups(language?: Language): void {
  if (!language) return lookups.clear();
  for (const k of [...lookups.keys()]) if (k.startsWith(`${language}\u0000`)) lookups.delete(k);
}

export function translateCached(messageId: string, model: ModelRef): Promise<string> {
  let p = translations.get(messageId);
  if (!p) {
    p = api.translate(messageId, model);
    p.catch(() => translations.delete(messageId));
    translations.set(messageId, p);
  }
  return p;
}
