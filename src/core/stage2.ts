// Shared wiring for the Stage 2 services (review, quiz, builder, decks). SayfernApp builds one
// Stage2Deps, constructs each service with it, and binds the service's slot methods
// (src/shared/stage2/*) onto itself so main's IPC loop finds them like any other method.
import type { Api, CredentialStore, Model, MutableModels } from "@earendil-works/pi-ai";
import type { AnkiConnectService } from "./anki";
import type { FileExtensionHost } from "./extensions";
import type { DefaultLanguageService } from "./lang";
import type { FileLibraryService } from "./library";
import type { JsonRecordsStore } from "./records";
import type { SettingsStore } from "./app/settings";
import type { ElevenLabsAccounts } from "./voice/accounts";
import type { EVENT_CHANNELS } from "../shared/api";
import type { ModelRef } from "../shared/types";

export interface Stage2Deps {
  /** Electron userData (or the smoke/test data dir). Each service keeps its own sub-folder. */
  dataDir: string;
  models: MutableModels;
  records: JsonRecordsStore;
  anki: AnkiConnectService;
  library: FileLibraryService;
  lang: DefaultLanguageService;
  extensions: FileExtensionHost;
  settings: SettingsStore;
  /** Throws a learner-readable error when the model isn't available or signed in. */
  resolveModel(ref: ModelRef): Model<Api>;
  emit(channel: keyof typeof EVENT_CHANNELS, payload: unknown): void;
  now(): number;
  newId(): string;
  fetch?: typeof fetch;
  /** The model sign-ins store (credentials.json); ElevenLabs keys are kept here too. */
  credentials?: CredentialStore;
  /** The learner's ElevenLabs accounts, shared by deck audio and voice (Stage 3). Built from `credentials` when absent. */
  eleven?: ElevenLabsAccounts;
}

/** Copies `methods` of `service` onto `target`, bound, so IPC can call them by name. */
export function bindSlot<S extends object>(target: object, service: S, methods: Record<string, true>): void {
  for (const name of Object.keys(methods)) {
    const fn = (service as Record<string, unknown>)[name];
    if (typeof fn !== "function") throw new Error(`Stage 2 slot method missing: ${name}`);
    Object.defineProperty(target, name, { value: (fn as (...a: unknown[]) => unknown).bind(service), enumerable: false, configurable: true });
  }
}

/** Translator for learner-visible text; English when the settings aren't available (tests). */
export async function translatorFor(deps: Pick<Stage2Deps, "settings">): Promise<import("../shared/i18n").Translator> {
  const { translator } = await import("../shared/i18n");
  try {
    return deps.settings ? await deps.settings.translator() : translator("en");
  } catch {
    return translator("en");
  }
}

/** The interface language prompts name ("German"); English when settings aren't available. */
export async function explanationFor(deps: Pick<Stage2Deps, "settings">): Promise<string> {
  try {
    return (deps.settings && (await deps.settings.explanationLanguage())) || "English";
  } catch {
    return "English";
  }
}
