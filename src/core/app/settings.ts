// settings.json (same file and shape as v0.1: language, model, deviceId, ...).
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { translator, type Translator } from "../../shared/i18n";
import { effectiveLocale, uiLocaleInfo, type UiLocale } from "../../shared/locales";
import type { Language } from "../../shared/records";
import type { Settings } from "../../shared/types";

/** Languages for settings files written before the learner picked any (v0.1 had exactly these). */
const LEGACY_LANGUAGES: Language[] = ["zh", "ja"];

export const DEFAULT_SETTINGS: Settings = { language: "zh", languages: [...LEGACY_LANGUAGES] };

export class SettingsStore {
  private cache: Settings | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  /** `systemLocales`: the OS's preferred languages in order (main passes app.getPreferredSystemLanguages). */
  constructor(
    readonly path: string,
    private readonly systemLocales: () => readonly string[] = () => [],
  ) {}

  /** The locale matched from the system's preferred languages. */
  systemLocale(): UiLocale {
    return effectiveLocale(undefined, this.safeSystemLocales());
  }

  /** The interface locale in effect: the learner's choice, else the system's. */
  async locale(): Promise<UiLocale> {
    return effectiveLocale((await this.get()).uiLocale, this.safeSystemLocales());
  }

  /** Translator for learner-visible text built in core (labels, notices, errors). */
  async translator(): Promise<Translator> {
    return translator(await this.locale().catch((): UiLocale => "en"));
  }

  /** How prompts name the language the tutor explains in ("Brazilian Portuguese"). */
  async explanationLanguage(): Promise<string> {
    return uiLocaleInfo(await this.locale()).promptName;
  }

  private safeSystemLocales(): readonly string[] {
    try {
      return this.systemLocales();
    } catch {
      return [];
    }
  }

  async get(): Promise<Settings> {
    if (!this.cache) {
      let stored: Partial<Settings> = {};
      try {
        const raw: unknown = JSON.parse(await readFile(this.path, "utf8"));
        if (raw && typeof raw === "object" && !Array.isArray(raw)) stored = raw as Partial<Settings>;
      } catch {
        // Missing or unreadable: defaults.
      }
      this.cache = { ...DEFAULT_SETTINGS, ...stored };
      if (!this.cache.languages?.length) this.cache.languages = [...LEGACY_LANGUAGES];
    }
    return structuredClone(this.cache);
  }

  /** Shallow merge; `undefined` values in the patch are ignored. Serialized. */
  update(patch: Partial<Settings>): Promise<Settings> {
    const task = async () => {
      const next: Settings = await this.get();
      for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) (next as unknown as Record<string, unknown>)[k] = structuredClone(v);
      }
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, JSON.stringify(next, null, 2));
      await rename(tmp, this.path);
      this.cache = next;
      return structuredClone(next);
    };
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => undefined);
    return run;
  }
}
