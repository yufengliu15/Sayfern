// LanguageService: language packs (segmentation, readings) + dictionaries (lookup).
import path from "node:path";
import type { DictionaryProgress, DictionaryStatus, LanguageInfo, LookupResult, Token } from "../../shared/lang";
import type { AnkiCard, Language } from "../../shared/records";
import type { DictionaryProvider, LanguagePack, LanguageService } from "../contracts";
import { CedictProvider } from "./cedict";
import type { FetchFn } from "./dictionary";
import { JapanesePack } from "./ja";
import { JmdictProvider } from "./jmdict";
import { Lru } from "./text";
import { ChinesePack } from "./zh";

export { CedictProvider, parseCedict, parseCedictLine, CEDICT_URL } from "./cedict";
export { JmdictProvider, parseJmdict, JMDICT_RELEASE_API } from "./jmdict";
export { ChinesePack, ZH_INFO } from "./zh";
export { JapanesePack, JA_INFO } from "./ja";
export { numberedToMarks, toneMark } from "./pinyin";

export interface LanguageServiceOptions {
  /** Dictionaries go in <dataDir>/zh and <dataDir>/ja. */
  dataDir: string;
  fetch?: FetchFn;
  wordUsage?: (lang: Language, word: string) => Promise<{ firstUsedAt: number } | null>;
  ankiCard?: (lang: Language, word: string) => Promise<AnkiCard | null>;
  /** Override the kuromoji dictionary directory (e.g. when packaged). */
  kuromojiDicPath?: string;
}

const CACHE_SIZE = 500;

export class DefaultLanguageService implements LanguageService {
  private readonly packs = new Map<string, LanguagePack>();
  private readonly dictionaries = new Map<string, DictionaryProvider>();
  private readonly cache = new Lru<Token[]>(CACHE_SIZE);

  constructor(private readonly opts: LanguageServiceOptions) {
    const cedict = new CedictProvider({ dir: path.join(opts.dataDir, "zh"), fetch: opts.fetch });
    const jmdict = new JmdictProvider({ dir: path.join(opts.dataDir, "ja"), fetch: opts.fetch });
    this.registerPack(new ChinesePack({ dictionary: cedict }), cedict);
    this.registerPack(new JapanesePack({ dicPath: opts.kuromojiDicPath }), jmdict);
  }

  languages(): LanguageInfo[] {
    return [...this.packs.values()].map((p) => p.info);
  }

  pack(language: Language): LanguagePack {
    const p = this.packs.get(language);
    if (!p) throw new Error(`No language pack for "${language}"`);
    return p;
  }

  registerPack(pack: LanguagePack, dictionary?: DictionaryProvider): void {
    this.packs.set(pack.info.id, pack);
    if (dictionary) this.dictionaries.set(pack.info.id, dictionary);
    else this.dictionaries.delete(pack.info.id);
    this.cache.clear();
  }

  async annotate(language: Language, text: string): Promise<Token[]> {
    const key = `${language}:${text}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const pack = this.pack(language);
    await pack.ready();
    const tokens = pack.segment(text);
    this.cache.set(key, tokens);
    return tokens;
  }

  async lookup(language: Language, word: string): Promise<LookupResult> {
    const pack = this.pack(language);
    const dict = this.dictionaries.get(language);
    const query = word.trim();
    const result: LookupResult = { query, entries: [] };
    if (dict) {
      const status = await dict.status();
      if (!status.installed) result.needsDictionary = true;
      else {
        result.entries = await dict.lookup(query);
        if (!result.entries.length) {
          // Lemma fallback: 食べた → 食べる.
          await pack.ready();
          const words = pack.segment(query).filter((t) => t.isWord);
          const lemma = words.length === 1 ? words[0].lemma : undefined;
          if (lemma && lemma !== query) result.entries = await dict.lookup(lemma);
        }
      }
    }
    const [anki, usage] = await Promise.all([
      this.opts.ankiCard?.(language, query).catch(() => null),
      this.opts.wordUsage?.(language, query).catch(() => null),
    ]);
    if (anki) result.anki = anki;
    if (usage) result.firstUsedAt = usage.firstUsedAt;
    return result;
  }

  async dictionaryStatus(language: Language): Promise<DictionaryStatus> {
    const dict = this.dictionaries.get(language);
    if (!dict) {
      const info = this.pack(language).info;
      return { language, name: `${info.name} dictionary`, license: "", installed: false, downloadMb: 0, error: "No dictionary available" };
    }
    return dict.status();
  }

  async installDictionary(language: Language, onProgress: (p: DictionaryProgress) => void): Promise<DictionaryStatus> {
    const dict = this.dictionaries.get(language);
    if (!dict) throw new Error(`No dictionary available for "${language}"`);
    const status = await dict.install(onProgress);
    // Segmentation may improve with the dictionary (zh): drop cached annotations for this language.
    this.cache.clear();
    return status;
  }
}
