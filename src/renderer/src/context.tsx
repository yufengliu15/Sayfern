// App-wide state: settings, languages, models, sessions and Anki status.
// Screens read it with useApp(); they receive only { language, navigate } as props.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AnkiStatus, NewSessionOptions } from "../../shared/api";
import type { LanguageInfo } from "../../shared/lang";
import { languageInfo } from "../../shared/languages";
import { effectiveLocale, matchLocale, type UiLocale } from "../../shared/locales";
import { pickDefaultModel } from "../../shared/models";
import type { Language, SessionMeta } from "../../shared/records";
import type { ModelInfo, ModelRef, ProviderInfo, Settings } from "../../shared/types";
import { api } from "./api";
import { setLocale } from "./i18n";
import { applyTheme } from "./lib/theme";
import { startChatStream } from "./lib/chatStream";
import { currentRoute, navigate, parseRoute, replaceRoute, sessionRoute } from "./router";

export interface AppContextValue {
  settings: Settings;
  /** Interface language in effect (the learner's choice, else the system's). */
  locale: UiLocale;
  /** The locale matched from the system's preferred languages. */
  systemLocale: UiLocale;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  /** Languages the learner opted into, in picker order. */
  languages: LanguageInfo[];
  allLanguages: LanguageInfo[];
  language: Language;
  lang: LanguageInfo;
  setLanguage(l: Language): void;
  providers: ProviderInfo[];
  models: ModelInfo[];
  model?: ModelRef;
  modelInfo?: ModelInfo;
  setModel(m: ModelRef): void;
  refreshAuth(): Promise<void>;
  /** Sessions per language, newest first. */
  sessionsByLang: Partial<Record<Language, SessionMeta[]>>;
  sessions: SessionMeta[];
  refreshSessions(): Promise<void>;
  anki: AnkiStatus | null;
  refreshAnki(): Promise<void>;
  /** Create a session and open it. */
  startSession(opts?: Partial<NewSessionOptions>): Promise<void>;
}

const Ctx = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}

const FALLBACK_LANG = (id: Language): LanguageInfo => languageInfo(id);

/** The browser's languages, for the dev mock and if the backend can't answer. */
const browserLocale = (): UiLocale => matchLocale(typeof navigator === "undefined" ? [] : [...(navigator.languages ?? [navigator.language])]);

export function AppProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [allLanguages, setAllLanguages] = useState<LanguageInfo[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModelState] = useState<ModelRef | undefined>();
  const [sessionsByLang, setSessionsByLang] = useState<Partial<Record<Language, SessionMeta[]>>>({});
  const [anki, setAnki] = useState<AnkiStatus | null>(null);
  const [systemLocale, setSystemLocale] = useState<UiLocale>(browserLocale);

  const refreshAuth = useCallback(async () => {
    const [prov, list, s] = await Promise.all([api.listProviders(), api.listModels(), api.getSettings()]);
    setProviders(prov);
    setModels(list);
    const saved = s.model && list.find((m) => m.provider === s.model!.provider && m.id === s.model!.id);
    const chosen = saved ?? pickDefaultModel(list);
    setModelState(chosen ? { provider: chosen.provider, id: chosen.id } : undefined);
  }, []);

  const loadSessions = useCallback(async (langs: Language[]) => {
    const lists = await Promise.all(langs.map((l) => api.listSessions(l).catch(() => [] as SessionMeta[])));
    const next: Partial<Record<Language, SessionMeta[]>> = {};
    langs.forEach((l, i) => (next[l] = [...lists[i]].sort((a, b) => b.updatedAt - a.updatedAt)));
    setSessionsByLang(next);
  }, []);

  const refreshAnki = useCallback(async () => {
    setAnki(await api.ankiStatus().catch(() => null));
  }, []);

  useEffect(() => {
    if (settings) applyTheme(settings.theme);
  }, [settings?.theme]);

  // Boot
  useEffect(() => {
    startChatStream();
    void (async () => {
      const [s, langs, sys] = await Promise.all([api.getSettings(), api.listLanguages(), api.systemLocale().catch(() => browserLocale())]);
      setAllLanguages(langs);
      setSystemLocale(sys);
      setLocale(effectiveLocale(s.uiLocale, [sys]));
      setSettings(s);
      await Promise.all([refreshAuth(), loadSessions(s.languages ?? langs.map((l) => l.id)), refreshAnki()]);
      const route = parseRoute(currentRoute());
      if (!s.onboarded) replaceRoute("onboarding");
      else if (!location.hash) replaceRoute("today");
      else if (route.name === "onboarding" && s.onboarded) replaceRoute("today");
    })();
  }, [refreshAuth, loadSessions, refreshAnki]);

  const value = useMemo<AppContextValue | null>(() => {
    if (!settings) return null;
    const enabled = settings.languages?.length ? settings.languages : allLanguages.map((l) => l.id);
    const languages = enabled.map((id) => allLanguages.find((l) => l.id === id) ?? FALLBACK_LANG(id));
    const language = enabled.includes(settings.language) ? settings.language : (enabled[0] ?? "zh");
    const lang = languages.find((l) => l.id === language) ?? FALLBACK_LANG(language);
    const locale = effectiveLocale(settings.uiLocale, [systemLocale]);
    // Before any child renders: t() reads the module-level locale.
    setLocale(locale);
    const modelInfo = model && models.find((m) => m.provider === model.provider && m.id === model.id);

    const updateSettings = async (patch: Partial<Settings>) => {
      setSettings((cur) => (cur ? { ...cur, ...patch } : cur));
      const next = await api.setSettings(patch);
      setSettings(next);
    };

    return {
      settings,
      locale,
      systemLocale,
      updateSettings,
      languages,
      allLanguages,
      language,
      lang,
      setLanguage(l) {
        if (l === language) return;
        void updateSettings({ language: l });
        const r = parseRoute(currentRoute());
        // Session and reader views belong to one language; go home instead of showing a mismatch.
        if (r.name === "session" || r.name === "reader" || (r.name === "grammar" && r.grammarId)) navigate("today");
      },
      providers,
      models,
      model,
      modelInfo,
      setModel(m) {
        setModelState(m);
        void updateSettings({ model: m });
      },
      refreshAuth,
      sessionsByLang,
      sessions: sessionsByLang[language] ?? [],
      refreshSessions: () => loadSessions(enabled),
      anki,
      refreshAnki,
      async startSession(opts) {
        const view = await api.newSession({ language, kind: "chat", ...opts });
        await loadSessions(enabled);
        navigate(sessionRoute(view.meta.id));
      },
    };
  }, [settings, systemLocale, allLanguages, providers, models, model, sessionsByLang, anki, refreshAuth, loadSessions, refreshAnki]);

  if (!value) return <>{fallback}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
