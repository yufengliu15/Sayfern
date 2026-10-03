// Dependencies shared by the tutor's parts (prompt, tools, turn loop, retries).
import type { Api, Model, MutableModels } from "@earendil-works/pi-ai";
import { translator, type Translator } from "../../shared/i18n";
import type { AnkiService, ExtensionHost, LanguageService, LibraryService, RecordsStore } from "../contracts";

export interface TutorDeps {
  models: MutableModels;
  records: RecordsStore;
  lang: LanguageService;
  library: LibraryService;
  anki: AnkiService;
  extensions?: ExtensionHost;
  now: () => number;
  newId: () => string;
  /** Whether Anki targets should be selected (config.enabled). */
  ankiEnabled: () => Promise<boolean>;
  /** The language the tutor explains in (the interface language), as prompts name it: "German". */
  explanationLanguage: () => Promise<string>;
  /** Translator for learner-visible lines the tutor's tools write (tool activity). */
  translator: () => Promise<Translator>;
  /** Whether a turn that skipped record_evidence gets a second, tool-only request. Default: needsEvidencePass. */
  evidencePass?: (model: Model<Api>) => boolean;
}

export type TutorOptions = Omit<TutorDeps, "now" | "newId" | "ankiEnabled" | "explanationLanguage" | "translator"> & {
  now?: () => number;
  newId?: () => string;
  ankiEnabled?: () => Promise<boolean>;
  explanationLanguage?: () => Promise<string>;
  translator?: () => Promise<Translator>;
};

/** Translator from the deps, English when unavailable. */
export async function translatorOf(deps: Partial<Pick<TutorDeps, "translator">>): Promise<Translator> {
  try {
    return deps.translator ? await deps.translator() : translator("en");
  } catch {
    return translator("en");
  }
}

/** Explanation language, falling back to English when the settings can't be read. */
export async function explainIn(deps: Pick<TutorDeps, "explanationLanguage">): Promise<string> {
  return (await deps.explanationLanguage().catch(() => "")) || "English";
}
