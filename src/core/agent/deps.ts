// Dependencies shared by the tutor's parts (prompt, tools, turn loop, retries).
import type { MutableModels } from "@earendil-works/pi-ai";
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
}

export type TutorOptions = Omit<TutorDeps, "now" | "newId" | "ankiEnabled"> & {
  now?: () => number;
  newId?: () => string;
  ankiEnabled?: () => Promise<boolean>;
};
