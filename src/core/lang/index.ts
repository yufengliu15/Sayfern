// LanguageService: language packs (segmentation, readings, lemmas) + dictionaries (lookup).
// Dictionaries are chosen per learning language and interface language: a German interface gets
// JMdict with German glosses for Japanese and WikDict Spanish–German for Spanish, falling back to
// English glosses when no dictionary exists for the pair (or the preferred one isn't installed).
import path from "node:path";
import type { DictionaryProgress, DictionaryStatus, LanguageInfo, LookupResult, Token } from "../../shared/lang";
import { LANGUAGE_META } from "../../shared/languages";
import { localeLanguage, uiLocaleInfo, type UiLocale } from "../../shared/locales";
import { LANGUAGES, type AnkiCard, type Language } from "../../shared/records";
import type { DictionaryProvider, LanguagePack, LanguageService } from "../contracts";
import { CedictProvider } from "./cedict";
import { COMMON_WORDS } from "./common-words";
import type { FetchFn } from "./dictionary";
import { JapanesePack } from "./ja";
import { JMDICT_GLOSS, JmdictProvider } from "./jmdict";
import { KoreanPack, SpacedPack, VietnamesePack, type WordIndex } from "./spaced";
import { Lru } from "./text";
import { KAIKKI_VI_URL, KaikkiProvider, KengdicProvider, OewnProvider, WIKDICT_LANGS, WikdictProvider } from "./wordlists";
import { ChinesePack } from "./zh";
import { msg } from "../../shared/i18n";

export { CedictProvider, parseCedict, parseCedictLine, CEDICT_URL } from "./cedict";
export { JmdictProvider, parseJmdict, JMDICT_RELEASE_API } from "./jmdict";
export { ChinesePack, ZH_INFO } from "./zh";
export { JapanesePack, JA_INFO } from "./ja";
export { KoreanPack, SpacedPack, VietnamesePack } from "./spaced";
export { lemmatize } from "./lemma";
export { numberedToMarks, toneMark } from "./pinyin";

export interface LanguageServiceOptions {
  /** Dictionaries go in <dataDir>/<lang> (English glosses) and <dataDir>/<lang>@<gloss>. */
  dataDir: string;
  fetch?: FetchFn;
  wordUsage?: (lang: Language, word: string) => Promise<{ firstUsedAt: number } | null>;
  ankiCard?: (lang: Language, word: string) => Promise<AnkiCard | null>;
  /** Override the kuromoji dictionary directory (e.g. when packaged). */
  kuromojiDicPath?: string;
  /** The interface language, which decides the dictionaries' gloss language. Default English. */
  glossLocale?: () => Promise<UiLocale> | UiLocale;
}

type Dict = DictionaryProvider & {
  hasIndex?(): boolean;
  has?(word: string): boolean;
  load?(): Promise<unknown>;
  glossWord?(word: string): boolean;
  glossWordsOf?(word: string): string[];
  /** Base code of the language the glosses are written in. */
  glossLanguage?: string;
};

/** One dictionary a language can use: where it lives and how to make it. */
interface DictChoice {
  key: string;
  make(): Dict;
}

const SPACED: readonly Language[] = ["en", "es", "fr", "de", "it", "pt", "ru"];

const CACHE_SIZE = 500;

export class DefaultLanguageService implements LanguageService {
  private readonly packs = new Map<string, LanguagePack>();
  /** Dictionaries registered by extensions (registerPack): always used for their language. */
  private readonly fixed = new Map<string, DictionaryProvider | null>();
  /** Built dictionaries by key ("zh", "ja", "ja@de", "es@en"). */
  private readonly built = new Map<string, Dict>();
  /** The dictionary each language used last (sync view for segmentation). */
  private readonly active = new Map<string, Dict>();
  private readonly cache = new Lru<Token[]>(CACHE_SIZE);

  constructor(private readonly opts: LanguageServiceOptions) {
    const cedict = this.dict({ key: "zh", make: () => new CedictProvider({ dir: path.join(opts.dataDir, "zh"), fetch: opts.fetch }) }) as CedictProvider;
    // In LANGUAGES order (the picker's order).
    for (const l of LANGUAGES) {
      if (l === "zh") this.packs.set(l, new ChinesePack({ dictionary: cedict }));
      else if (l === "ja") this.packs.set(l, new JapanesePack({ dicPath: opts.kuromojiDicPath }));
      else if (l === "ko") this.packs.set(l, new KoreanPack(this.wordIndex(l)));
      else if (l === "vi") this.packs.set(l, new VietnamesePack(this.wordIndex(l)));
      else if (SPACED.includes(l)) this.packs.set(l, new SpacedPack(l, this.wordIndex(l)));
    }
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
    this.fixed.set(pack.info.id, dictionary ?? null);
    this.cache.clear();
  }

  // ------------------------------------------------------------ dictionary choice

  private dict(choice: DictChoice): Dict {
    let d = this.built.get(choice.key);
    if (!d) this.built.set(choice.key, (d = choice.make()));
    return d;
  }

  private async locale(): Promise<UiLocale> {
    try {
      return (await this.opts.glossLocale?.()) ?? "en";
    } catch {
      return "en";
    }
  }

  /** Dictionaries for `language`, best first, for the interface language `locale`. */
  choices(language: Language, locale: UiLocale): DictChoice[] {
    const { dataDir, fetch } = this.opts;
    const dir = (key: string) => path.join(dataDir, key);
    const gloss = localeLanguage(locale);
    const glossName = uiLocaleInfo(locale).englishName.replace(/ \(.*\)$/, "");
    switch (language) {
      case "zh":
        return [{ key: "zh", make: () => new CedictProvider({ dir: dir("zh"), fetch }) }];
      case "ja": {
        const code = JMDICT_GLOSS[gloss];
        const eng: DictChoice = { key: "ja", make: () => new JmdictProvider({ dir: dir("ja"), fetch }) };
        if (!code || code === "eng") return [eng];
        return [{ key: `ja@${gloss}`, make: () => new JmdictProvider({ dir: dir(`ja@${gloss}`), fetch, gloss: code, glossName }) }, eng];
      }
      case "ko":
        return [{ key: "ko", make: () => new KengdicProvider({ dir: dir("ko"), fetch }) }];
      case "vi":
        return [{ key: "vi", make: () => new KaikkiProvider({ dir: dir("vi"), language: "vi", name: "Wiktionary (Vietnamese–English)", url: KAIKKI_VI_URL, downloadMb: 13, fetch }) }];
      default: {
        if (!WIKDICT_LANGS.has(language)) return [];
        const target = LANGUAGE_META[language].name;
        const pair = (g: string, name: string): DictChoice => ({
          key: `${language}@${g}`,
          make: () => new WikdictProvider({ dir: dir(`${language}@${g}`), language, gloss: g, glossName: name, targetName: target, fetch }),
        });
        const out: DictChoice[] = [];
        // WikDict also has English–Chinese (simplified and traditional mixed), but no other pairs with Chinese.
        if (gloss !== language && (WIKDICT_LANGS.has(gloss) || (language === "en" && gloss === "zh"))) out.push(pair(gloss, glossName));
        if (language !== "en" && gloss !== "en") out.push(pair("en", "English"));
        // English always has a dictionary: English definitions when no pair exists (en, ko, vi interfaces) or as the fallback.
        if (language === "en") out.push({ key: "en", make: () => new OewnProvider({ dir: dir("en"), fetch }) });
        return out;
      }
    }
  }

  /**
   * The dictionary to show and install (the preferred one for the interface language) and the one
   * to look words up in (the preferred one if installed, else any installed fallback).
   */
  private async resolve(language: Language): Promise<{ preferred: Dict | null; usable: Dict | null }> {
    if (this.fixed.has(language)) {
      const d = this.fixed.get(language) ?? null;
      return { preferred: d, usable: d };
    }
    const dicts = this.choices(language, await this.locale()).map((c) => this.dict(c));
    if (!dicts.length) return { preferred: null, usable: null };
    let usable: Dict | null = null;
    for (const d of dicts) {
      if ((await d.status()).installed) {
        usable = d;
        break;
      }
    }
    this.active.set(language, usable ?? dicts[0]);
    return { preferred: dicts[0], usable };
  }

  /**
   * Sync word index for the packs: whatever dictionary the language resolved to last. The learner's own
   * language is the interface language (its common words) and the dictionary's gloss language.
   */
  private wordIndex(language: Language): WordIndex {
    let own: string | undefined;
    const loaded = () => {
      const d = this.active.get(language);
      return d?.hasIndex?.() ? d : undefined;
    };
    return {
      hasIndex: () => !!this.active.get(language)?.hasIndex?.(),
      has: (w) => !!this.active.get(language)?.has?.(w),
      load: async () => {
        const base = localeLanguage(await this.locale());
        own = base === language ? undefined : base;
        const { usable } = await this.resolve(language);
        await usable?.load?.();
      },
      // Gloss words are own-language words only when the glosses are in the learner's own language
      // (not in English–English WordNet for an English learner with a Korean interface).
      ownWord: (w) => {
        if (!own) return false;
        const d = loaded();
        return !!COMMON_WORDS[own]?.has(w) || (d?.glossLanguage === own && !!d.glossWord?.(w));
      },
      // Same-meaning check: only for bilingual dictionaries.
      glossWordsOf: (w) => {
        const d = loaded();
        return d && d.glossLanguage !== language ? (d.glossWordsOf?.(w) ?? []) : [];
      },
      ownLanguage: () => own,
    };
  }

  // ------------------------------------------------------------ packs and lookups

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
    const query = word.trim();
    const result: LookupResult = { query, entries: [] };
    const { preferred, usable } = await this.resolve(language);
    if (preferred || usable) {
      if (!usable) result.needsDictionary = true;
      else {
        result.entries = await usable.lookup(query);
        if (!result.entries.length) {
          // Lemma fallback: 食べた → 食べる, hablé → hablar.
          await pack.ready();
          const words = pack.segment(query).filter((t) => t.isWord);
          const lemma = words.length === 1 ? words[0].lemma : undefined;
          if (lemma && lemma !== query) result.entries = await usable.lookup(lemma);
        }
        // The preferred dictionary (in the interface language) isn't installed yet: say so.
        if (preferred && preferred !== usable) result.needsDictionary = true;
      }
    } else if (!this.fixed.has(language)) {
      result.noDictionary = true;
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
    const { preferred } = await this.resolve(language);
    if (!preferred) {
      const info = this.pack(language).info;
      return { language, name: `${info.name} dictionary`, license: "", installed: false, downloadMb: 0, error: msg("No dictionary available") };
    }
    return preferred.status();
  }

  async installDictionary(language: Language, onProgress: (p: DictionaryProgress) => void): Promise<DictionaryStatus> {
    const { preferred } = await this.resolve(language);
    if (!preferred) throw new Error(`No dictionary available for "${language}"`);
    const status = await preferred.install(onProgress);
    this.active.set(language, preferred);
    // Segmentation and lemmas may improve with the dictionary: drop cached annotations.
    this.cache.clear();
    return status;
  }
}
