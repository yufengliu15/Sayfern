// Settings: models, languages and level, profile, Anki, voice, dictionaries, preferences, data.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { AnkiStatus } from "../../../shared/api";
import type { DictionaryProgress, DictionaryStatus, LanguageInfo } from "../../../shared/lang";
import type { AnkiDeckMapping, AnkiOverview, Language, LearnerProfile, LevelBand, LevelEstimate, Skill } from "../../../shared/records";
import { api, errorText } from "../api";
import { Connect } from "../components/Connect";
import { Icon, type IconName } from "../components/icons";
import { Switch } from "../components/ui";
import { useApp } from "../context";
import { clearLookups } from "../lib/cache";
import { cls, fmtAgo, fmtNumber, fmtShortDate, fontOf } from "../lib/format";
import { IS_MAC } from "../lib/platform";
import { deckRoute, replaceRoute, sessionRoute, settingsRoute, type Navigate } from "../router";
import { sharedDecksUrl } from "../../../shared/stage2";
import { uiLocaleInfo } from "../../../shared/locales";
import { LocalePicker } from "../components/LocalePicker";
import { ThemePicker } from "../components/ThemePicker";
import { GOAL_PLACEHOLDER } from "../lib/samples";
import { isBeta } from "../../../shared/course";
import { BetaChip } from "../components/BetaChip";
import { PlacementStart } from "../components/PlacementStart";
import { langName, msg, t, tj } from "../i18n";
import { SpeakButtons } from "../components/Speak";
import { loadVoiceStatus, setVoiceStatus, useVoiceStatus, VOICE_SAMPLES } from "../lib/voice";
import { setUpdateStatus, useUpdateStatus } from "../lib/updates";
import { VOICE_RATES, type VoiceStatus } from "../../../shared/stage3";

export interface SettingsScreenProps {
  language: Language;
  navigate: Navigate;
  tab?: string;
}

type Tab = "models" | "languages" | "about" | "anki" | "voice" | "dictionaries" | "appearance" | "preferences" | "data";
const TABS: { id: Tab; label: string; icon: IconName; title: string; sub: string }[] = [
  { id: "models", label: msg("Models"), icon: "spark", title: msg("Models"), sub: msg("Connect the model you already pay for. Your provider bills you directly.") },
  { id: "languages", label: msg("Language & level"), icon: "globe", title: msg("Language & level"), sub: msg("What you're learning and where you are. The tutor pitches everything to these.") },
  { id: "about", label: msg("About you"), icon: "user", title: msg("About you"), sub: msg("A few lines the tutor keeps in mind, so conversations are about your life.") },
  { id: "anki", label: msg("Anki"), icon: "cards", title: msg("Anki"), sub: msg("The tutor sees what you know, what's hard and what's next in Anki, so recognised words become words you use.") },
  { id: "voice", label: msg("Voice"), icon: "speaker", title: msg("Voice"), sub: msg("Listen to the tutor and to words, and talk instead of typing.") },
  { id: "dictionaries", label: msg("Dictionaries"), icon: "library", title: msg("Dictionaries"), sub: msg("Free dictionaries stored on this computer, for lookups and for counting your words. Sayfern downloads one for each language you learn.") },
  { id: "appearance", label: msg("Appearance"), icon: "image", title: msg("Appearance"), sub: msg("Choose how Sayfern looks. The change applies at once.") },
  { id: "preferences", label: msg("Preferences"), icon: "settings", title: msg("Preferences"), sub: msg("Defaults for new sessions. You can change them in any session.") },
  { id: "data", label: msg("Data"), icon: "database", title: msg("Your data"), sub: msg("Everything Sayfern records is stored on this computer, in plain files you can export.") },
];
const SKILL_LABEL: Record<Skill, string> = { reading: msg("Reading"), recognition: msg("Recognition"), writing: msg("Writing") };
const BY_LABEL: Record<LevelEstimate["by"], string> = { self: msg("Set by you"), placement: msg("Placement chat"), observed: msg("Seen in your writing") };

export function SettingsScreen({ navigate, tab: routeTab }: SettingsScreenProps) {
  const tab: Tab = (TABS.find((x) => x.id === routeTab)?.id ?? "models") as Tab;
  const info = TABS.find((x) => x.id === tab)!;
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const select = (t: Tab) => replaceRoute(settingsRoute(t));
  const onKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex((x) => x.id === tab);
    const next = e.key === "ArrowDown" ? TABS[(i + 1) % TABS.length] : e.key === "ArrowUp" ? TABS[(i - 1 + TABS.length) % TABS.length] : null;
    if (!next) return;
    e.preventDefault();
    select(next.id);
    tabRefs.current[next.id]?.focus();
  };

  return (
    <main className="main set">
      <nav className="set-nav" aria-label={t("Settings sections")}>
        <div className="set-drag drag" />
        <h1 className="set-title">{t("Settings")}</h1>
        <div role="tablist" aria-orientation="vertical" onKeyDown={onKey}>
          {TABS.map((x) => (
            <button
              key={x.id}
              ref={(el) => {
                tabRefs.current[x.id] = el;
              }}
              role="tab"
              id={`tab-${x.id}`}
              aria-selected={tab === x.id}
              aria-controls="set-panel"
              tabIndex={tab === x.id ? 0 : -1}
              className={cls("set-tab", tab === x.id && "on")}
              onClick={() => select(x.id)}
            >
              <Icon name={x.icon} size={17} />
              {t(x.label)}
            </button>
          ))}
        </div>
      </nav>
      <div className="set-body" id="set-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <div className="set-drag drag" />
        <div className="set-in" key={tab}>
          <h2 className="set-h">{t(info.title)}</h2>
          <p className="set-sub">{t(info.sub)}</p>
          {tab === "models" && <ModelsTab />}
          {tab === "languages" && <LanguagesTab navigate={navigate} />}
          {tab === "about" && <AboutTab navigate={navigate} />}
          {tab === "anki" && <AnkiTab navigate={navigate} />}
          {tab === "voice" && <VoiceTab />}
          {tab === "dictionaries" && <DictionariesTab />}
          {tab === "appearance" && <AppearanceTab />}
          {tab === "preferences" && <PreferencesTab navigate={navigate} />}
          {tab === "data" && <DataTab />}
        </div>
      </div>
    </main>
  );
}

function Group({ title, children, aside }: { title?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="sgroup">
      {(title || aside) && (
        <div className="sgroup-h">
          {title && <h3>{title}</h3>}
          {aside}
        </div>
      )}
      <div className="card sgroup-b">{children}</div>
    </section>
  );
}

function Row({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; htmlFor?: string }) {
  return (
    <div className="srow">
      <div className="srow-t">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span className="srow-l">{label}</span>}
        {hint && <span className="srow-h">{hint}</span>}
      </div>
      {children && <div className="srow-c">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- models

function ModelsTab() {
  const app = useApp();
  const groups = new Map<string, typeof app.models>();
  for (const m of app.models) groups.set(m.provider, [...(groups.get(m.provider) ?? []), m]);
  const pname = (id: string) => app.providers.find((p) => p.id === id)?.name ?? id;
  return (
    <>
      {app.models.length > 0 && (
        <Group>
          <Row label={t("Default model")} hint={t("Used for new messages. Change it any time from the message box.")} htmlFor="def-model">
            <select
              id="def-model"
              className="input select"
              value={app.model ? `${app.model.provider}/${app.model.id}` : ""}
              onChange={(e) => {
                const [provider, ...rest] = e.target.value.split("/");
                app.setModel({ provider, id: rest.join("/") });
              }}
            >
              {[...groups].map(([prov, list]) => (
                <optgroup key={prov} label={pname(prov)}>
                  {list.map((m) => (
                    <option key={m.id} value={`${m.provider}/${m.id}`}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Row>
        </Group>
      )}
      <section className="sgroup">
        <div className="sgroup-h">
          <h3>{t("Providers")}</h3>
          <span className="muted small">
            <Icon name="lock" size={13} /> {t("Keys are encrypted with your system keychain")}
          </span>
        </div>
        <Connect compact providers={app.providers} onChanged={app.refreshAuth} />
      </section>
    </>
  );
}

// ---------------------------------------------------------------- languages & level

function LanguagesTab({ navigate }: { navigate: Navigate }) {
  const app = useApp();
  const enabled = app.languages.map((l) => l.id);
  const toggle = (id: Language, on: boolean) => {
    const next = app.allLanguages.map((l) => l.id).filter((l) => (l === id ? on : enabled.includes(l)));
    if (!next.length) return;
    void app.updateSettings({ languages: next, ...(next.includes(app.language) ? {} : { language: next[0] }) });
  };
  return (
    <>
      <Group title={t("Languages you're learning")}>
        <div className="langpick">
          {app.allLanguages.map((l) => {
            const on = enabled.includes(l.id);
            return (
              <label key={l.id} className={cls("langopt", on && "on")}>
                <input type="checkbox" checked={on} disabled={on && enabled.length === 1} onChange={(e) => toggle(l.id, e.target.checked)} />
                <span className={cls("g", l.fontClass)}>{l.glyph}</span>
                <span className="t">
                  <b>
                    {langName(l.id)}
                    {isBeta(l.id) && <BetaChip />}
                  </b>
                  <small className={l.fontClass}>{l.nativeName}</small>
                </span>
                <span className="check" aria-hidden="true">
                  {on && <Icon name="check" size={14} stroke={2.6} />}
                </span>
              </label>
            );
          })}
        </div>
      </Group>
      {app.languages.map((l) => (
        <LevelCard key={l.id} info={l} navigate={navigate} />
      ))}
    </>
  );
}

function LevelCard({ info, navigate }: { info: LanguageInfo; navigate: Navigate }) {
  const app = useApp();
  const [data, setData] = useState<{ current: Partial<Record<Skill, LevelEstimate>>; history: LevelEstimate[] } | null>(null);
  const [self, setSelf] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [askBand, setAskBand] = useState(false);

  const load = useCallback(() => api.getLevels(info.id).then(setData).catch((e) => setError(errorText(e))), [info.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const rate = async (level: string) => {
    setSelf(level);
    if (!level) return;
    setBusy("self");
    try {
      await api.setSelfLevel(info.id, level);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const place = async (band: LevelBand) => {
    setBusy("place");
    try {
      const v = await api.startPlacement(info.id, band);
      if (info.id !== app.language) app.setLanguage(info.id);
      await app.refreshSessions();
      navigate(sessionRoute(v.meta.id));
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
      setAskBand(false);
    }
  };

  const skills: Skill[] = ["reading", "recognition", "writing"];
  const history = [...(data?.history ?? [])].sort((a, b) => b.at - a.at);
  return (
    <Group
      title={t("{language} level", { language: langName(info.id) })}
      aside={
        history.length > 0 && (
          <button className="linkb" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? t("Hide history") : t("History ({n})", { n: history.length })}
          </button>
        )
      }
    >
      <div className="lvlgrid">
        {skills.map((s) => {
          const e = data?.current[s];
          return (
            <div key={s} className="lvlcell">
              <span className="lvl-s">{t(SKILL_LABEL[s])}</span>
              <b className={cls(!e && "none")}>{e ? e.level : t("Not yet")}</b>
              {e ? (
                <>
                  <span className="lvl-by">
                    {t(BY_LABEL[e.by])} · {fmtShortDate(e.at)}
                  </span>
                  <span className="lvl-ev">{t(e.evidence)}</span>
                </>
              ) : (
                <span className="lvl-by">{t("No estimate yet")}</span>
              )}
            </div>
          );
        })}
      </div>
      {showHistory && (
        <ul className="lvlhist">
          {history.map((h, i) => (
            <li key={i}>
              <span className="mono">{fmtShortDate(h.at)}</span>
              <span>{t(SKILL_LABEL[h.skill])}</span>
              <b>{h.level}</b>
              <span className="muted">{t(BY_LABEL[h.by])}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="lvl-actions">
        <label htmlFor={`self-${info.id}`} className="srow-l">
          {t("I'd say I'm at")}
        </label>
        <select id={`self-${info.id}`} className="input select sm" value={self} onChange={(e) => void rate(e.target.value)} disabled={busy === "self"}>
          <option value="">{t("Choose a level")}</option>
          {info.levels.map((lv) => (
            <option key={lv} value={lv}>
              {lv}
            </option>
          ))}
        </select>
        <span className="lvl-or">{t("or")}</span>
        <button className="btn btn-f btn-s" onClick={() => setAskBand(true)} disabled={busy === "place"}>
          <Icon name="compass" size={15} />
          {t("Find my level")}
        </button>
        <span className="muted small">{t("A 5-minute chat, no test.")}</span>
      </div>
      {error && <p className="err">{t(error)}</p>}
      {askBand && (
        <PlacementStart
          language={info.id}
          levels={info.levels}
          busy={busy === "place"}
          onStart={(band) => void place(band)}
          onClose={() => setAskBand(false)}
        />
      )}
    </Group>
  );
}

// ---------------------------------------------------------------- about you

function AboutTab({ navigate }: { navigate: Navigate }) {
  const app = useApp();
  const [p, setP] = useState<LearnerProfile | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef<LearnerProfile | null>(null);

  useEffect(() => {
    api
      .getProfile()
      .then((x) => {
        latest.current = x;
        setP(x);
      })
      .catch(() => setState("error"));
    return () => window.clearTimeout(timer.current);
  }, []);

  const change = (patch: Partial<LearnerProfile>) => {
    const cur = latest.current;
    if (!cur) return;
    const next: LearnerProfile = { ...cur, ...patch, goals: { ...cur.goals, ...(patch.goals ?? {}) } };
    latest.current = next;
    setP(next);
    setState("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const v = latest.current!;
      try {
        await api.setProfile({ name: v.name, about: v.about, goals: v.goals });
        setState("saved");
      } catch {
        setState("error");
      }
    }, 650);
  };

  if (!p) return null;
  return (
    <>
      <div className={cls("autosave", state)} role="status" aria-live="polite">
        {state === "saving" && t("Saving…")}
        {state === "saved" && (
          <>
            <Icon name="check" size={13} stroke={2.4} /> {t("Saved")}
          </>
        )}
        {state === "error" && t("Couldn't save. Your changes are still here.")}
      </div>
      <Group>
        <div className="sform">
          <div className="field">
            <label htmlFor="pf-name">{t("What should the tutor call you?")}</label>
            <input id="pf-name" className="input" value={p.name ?? ""} maxLength={60} placeholder={t("Your name")} onChange={(e) => change({ name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="pf-about">{t("About you")}</label>
            <textarea
              id="pf-about"
              className="input ta"
              rows={5}
              value={p.about}
              maxLength={2000}
              placeholder={t("What you do, what you like, what you want to talk about. Write in any language.")}
              onChange={(e) => change({ about: e.target.value })}
            />
            <span className="note">{t("Shared across languages. The tutor reads it at the start of every session.")}</span>
          </div>
          {app.languages.map((l) => (
            <div className="field" key={l.id}>
              <label htmlFor={`pf-goal-${l.id}`}>{t("Your goal for {language}", { language: langName(l.id) })}</label>
              <input
                id={`pf-goal-${l.id}`}
                className="input"
                value={p.goals[l.id] ?? ""}
                maxLength={200}
                placeholder={t(GOAL_PLACEHOLDER[l.id])}
                onChange={(e) => change({ goals: { [l.id]: e.target.value } })}
              />
            </div>
          ))}
        </div>
      </Group>
      <div className="tipcard">
        <Icon name="file" size={18} />
        <p>
          {t("Have more to share, like a journal or a CV? Add it to your Library as About me and the tutor can draw on it.")}{" "}
          <button className="linkb" onClick={() => navigate("library")}>
            {t("Open Library")}
          </button>
        </p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- anki

function AnkiTab({ navigate }: { navigate: Navigate }) {
  const app = useApp();
  const [st, setSt] = useState<AnkiStatus | null>(app.anki);
  const [decks, setDecks] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    const s = await api.ankiStatus();
    setSt(s);
    if (s.config.enabled && s.connected) setDecks(await api.ankiDecks().catch(() => []));
  }, []);
  useEffect(() => {
    refresh().catch((e) => setError(errorText(e)));
  }, [refresh]);

  const test = async () => {
    setBusy("test");
    setError(null);
    try {
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const save = async (patch: Partial<AnkiStatus["config"]>) => {
    if (!st) return;
    setError(null);
    try {
      const next = await api.ankiSetConfig({ ...st.config, ...patch });
      setSt(next);
      if (next.config.enabled && next.connected && !decks.length) setDecks(await api.ankiDecks().catch(() => []));
      void app.refreshAnki();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const sync = async (l: Language) => {
    setBusy(l);
    setError(null);
    try {
      setSt(await api.ankiSync(l));
      void app.refreshAnki();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  if (!st) return null;
  const on = st.config.enabled;
  return (
    <>
      <Group>
        <Row
          label={t("Use Anki")}
          hint={
            on ? (
              <span className={cls("anki-st", st.connected ? "ok" : "warn")}>
                <i />
                {st.connected ? `${t("Connected")}${st.version ? ` · AnkiConnect v${st.version}` : ""}` : st.error ? t(st.error) : t("Can't reach Anki right now")}
              </span>
            ) : (
              t("Off. Sessions won't mention your cards.")
            )
          }
        >
          <Switch checked={on} onChange={(v) => void save({ enabled: v })} label={t("Use Anki")} />
        </Row>
        {on && !st.connected && Object.keys(st.snapshots).length > 0 && (
          <p className="srow-note">{t("Until Anki is back, the tutor uses your last synced snapshot.")}</p>
        )}
      </Group>

      {on && !st.connected && <AnkiTroubleshoot st={st} busy={busy === "test"} onTest={() => void test()} />}

      <Group title={t("Get a deck")}>
        <Row label={t("Make a deck with your model")} hint={t("Words at your level, checked with the dictionary, audio, added straight to Anki. Big decks run in batches of 25.")}>
          <button className="btn btn-s btn-f" onClick={() => navigate(deckRoute())}>
            <Icon name="spark" size={14} /> {t("Make a deck")}
          </button>
        </Row>
        <Row label={t("Use a shared deck")} hint={t("Free decks from other learners on AnkiWeb. Import one into Anki, then pick it below.")}>
          <button className="btn btn-s" onClick={() => void api.openExternal(sharedDecksUrl(app.language))}>
            {t("Browse AnkiWeb")} <Icon name="external" size={13} />
          </button>
        </Row>
      </Group>

      <Group title={t("Set up")}>
        <ol className="steps">
          <li>
            <span className="n">1</span>
            <div>
              <b>{t("Install the AnkiConnect add-on.")}</b>
              <p>
                {t("In Anki, choose Tools, Add-ons, Get Add-ons, and paste this code:")}{" "}
                <button
                  className="codechip"
                  onClick={() => {
                    void navigator.clipboard?.writeText("2055492159").then(() => setCopied(true));
                    window.setTimeout(() => setCopied(false), 1500);
                  }}
                  aria-label={t("Copy add-on code {code}", { code: "2055492159" })}
                >
                  2055492159 <span>{copied ? t("Copied") : t("Copy")}</span>
                </button>
              </p>
            </div>
          </li>
          <li>
            <span className="n">2</span>
            <div>
              <b>{t("Restart Anki and keep it open while you practise.")}</b>
              <p>{t("Sayfern talks to it at {url}. Nothing leaves your computer.", { url: st.config.url })}</p>
            </div>
          </li>
          <li>
            <span className="n">3</span>
            <div>
              <b>{t("Pick a deck for each language below.")}</b>
              <p>{t("Tell Sayfern which field holds the word, so the tutor knows which words you know, are learning and find hard.")}</p>
            </div>
          </li>
        </ol>
      </Group>

      {on &&
        app.languages.map((l) => (
          <DeckMapping
            key={l.id}
            info={l}
            decks={decks}
            mapping={st.config.decks.find((d) => d.language === l.id)}
            extra={st.config.decks.filter((d) => d.language === l.id).slice(1)}
            snapshot={st.snapshots[l.id]}
            connected={st.connected}
            syncing={busy === l.id}
            onChange={(m) => {
              // Only the first mapping is edited here; other decks for the language (e.g. decks Sayfern made) stay.
              const first = st.config.decks.find((d) => d.language === l.id);
              const rest = st.config.decks.filter((d) => d !== first);
              void save({ decks: first ? (m ? st.config.decks.map((d) => (d === first ? m : d)) : rest) : [...rest, ...(m ? [m] : [])] });
            }}
            onUnfollow={(deck) => void save({ decks: st.config.decks.filter((d) => !(d.language === l.id && d.deck === deck)) })}
            onSync={() => void sync(l.id)}
          />
        ))}
      {error && (
        <p className="err" role="alert">
          <Icon name="alert" size={15} /> {t(error)}
        </p>
      )}
    </>
  );
}

function DeckMapping({
  info,
  decks,
  mapping,
  extra,
  snapshot,
  connected,
  syncing,
  onChange,
  onSync,
  onUnfollow,
}: {
  info: LanguageInfo;
  decks: string[];
  mapping?: AnkiDeckMapping;
  /** More decks followed for this language (decks Sayfern generated are added here). */
  extra: AnkiDeckMapping[];
  onUnfollow(deck: string): void;
  snapshot?: AnkiStatus["snapshots"][Language];
  connected: boolean;
  syncing: boolean;
  onChange(m: AnkiDeckMapping | null): void;
  onSync(): void;
}) {
  const [fields, setFields] = useState<string[]>([]);
  const [overview, setOverview] = useState<AnkiOverview | null>(null);
  useEffect(() => {
    if (!snapshot) return setOverview(null);
    let alive = true;
    api
      .ankiOverview(info.id)
      .then((o) => alive && setOverview(o))
      .catch(() => alive && setOverview(null));
    return () => {
      alive = false;
    };
  }, [info.id, snapshot?.syncedAt]);
  useEffect(() => {
    if (!mapping?.deck || !connected) return setFields([]);
    let alive = true;
    api
      .ankiFields(mapping.deck)
      .then((f) => alive && setFields(f))
      .catch(() => alive && setFields([]));
    return () => {
      alive = false;
    };
  }, [mapping?.deck, connected]);

  // After a deck is picked, preselect the likely word / reading / meaning fields so the
  // mapping is usable straight away (the learner can still change them).
  useEffect(() => {
    if (!mapping?.deck || mapping.wordField || fields.length === 0) return;
    const pick = (re: RegExp, exclude: string[] = []) => fields.find((f) => re.test(f) && !exclude.includes(f));
    const word =
      pick(/^(word|vocab(ulary)?|expression|term|hanzi|kanji|simplified|traditional|front|单词|词语|汉字|単語|漢字)$/i) ??
      pick(/word|vocab|expression|hanzi|kanji|simplified|front|汉字|単語/i) ??
      fields[0];
    const reading = pick(/pinyin|reading|kana|furigana|yomi|拼音|読み/i, [word]);
    const meaning = pick(/meaning|english|definition|gloss|translation|back|意味|意思/i, [word, reading ?? ""]);
    onChange({
      ...mapping,
      wordField: word,
      ...(reading ? { readingField: reading } : {}),
      ...(meaning ? { meaningField: meaning } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, mapping?.deck, mapping?.wordField]);

  const deckOptions = mapping?.deck && !decks.includes(mapping.deck) ? [mapping.deck, ...decks] : decks;
  const fieldOptions = (cur?: string) => (cur && !fields.includes(cur) ? [cur, ...fields] : fields);
  const id = `anki-${info.id}`;
  const fieldSel = (key: "wordField" | "readingField" | "meaningField", label: string, optional: boolean) => (
    <div className="field">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <select
        id={`${id}-${key}`}
        className="input select"
        value={mapping?.[key] ?? ""}
        disabled={!mapping?.deck}
        onChange={(e) => mapping && onChange({ ...mapping, [key]: e.target.value || undefined })}
      >
        <option value="">{optional ? t("None") : t("Choose a field")}</option>
        {fieldOptions(mapping?.[key]).map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <Group
      title={t("{language} deck", { language: langName(info.id) })}
      aside={
        <button className="btn btn-s" onClick={onSync} disabled={!mapping?.deck || !connected || syncing}>
          <Icon name="refresh" size={14} />
          {syncing ? t("Syncing…") : t("Sync now")}
        </button>
      }
    >
      <div className="deckgrid">
        <div className="field">
          <label htmlFor={`${id}-deck`}>{t("Deck")}</label>
          <select
            id={`${id}-deck`}
            className="input select"
            value={mapping?.deck ?? ""}
            disabled={!connected && !mapping}
            onChange={(e) => onChange(e.target.value ? { language: info.id, deck: e.target.value, wordField: "" } : null)}
          >
            <option value="">{connected ? t("Choose a deck") : t("Open Anki to list decks")}</option>
            {deckOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        {fieldSel("wordField", t("Word field"), false)}
        {fieldSel("readingField", info.readingName ? t("{name} field", { name: t(info.readingName) }) : t("Reading field"), true)}
        {fieldSel("meaningField", t("Meaning field"), true)}
      </div>
      {extra.map((m) => (
        <p className="dk-follow" key={m.deck}>
          <Icon name="cards" size={14} />{" "}
          {tj("Also following {deck} (word field {field})", { deck: <b className={info.fontClass}>{m.deck}</b>, field: m.wordField })}
          <button className="linkb" onClick={() => onUnfollow(m.deck)}>
            {t("Stop following")}
          </button>
        </p>
      ))}
      {overview && <AnkiWords overview={overview} language={info.id} />}
      <p className="srow-note">
        {snapshot
          ? t("Last synced {ago} · {cards} cards · {mature} mature · {today} reviewed today", {
              ago: fmtAgo(snapshot.syncedAt),
              cards: snapshot.cards,
              mature: snapshot.matureCount,
              today: snapshot.reviewedToday,
            })
          : t("Not synced yet.")}
      </p>
    </Group>
  );
}

/** Word counts from the snapshot and the hardest words, collapsible. */
function AnkiWords({ overview: o, language }: { overview: AnkiOverview; language: Language }) {
  const parts: [number, string][] = [
    [o.counts.known, t("known")],
    [o.counts.learning, t("learning")],
    [o.newRemaining, t("still new")],
    [o.struggling, t("struggling")],
  ];
  return (
    <div className="anki-words">
      <p className="anki-ov">
        {parts.map(([n, label], i) => (
          <span key={label}>
            {i > 0 && <span className="sep"> · </span>}
            <b>{fmtNumber(n)}</b> {label}
          </span>
        ))}
      </p>
      {o.topStruggling.length > 0 && (
        <details className="anki-hard">
          <summary>
            <Icon name="chevR" size={13} />
            {t("Hardest right now")}
          </summary>
          <ul>
            {o.topStruggling.map((w) => (
              <li key={w.word}>
                <span className={cls("w", fontOf(language))}>{w.word}</span>
                <span className="m">{[w.reading, w.meaning].filter(Boolean).join(" · ")}</span>
                <span className="r">{w.reasons.map((r) => t(r)).join(", ")}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- dictionaries

function DictionariesTab() {
  const app = useApp();
  const [status, setStatus] = useState<Partial<Record<Language, DictionaryStatus>>>({});
  const [progress, setProgress] = useState<Partial<Record<Language, DictionaryProgress>>>({});
  const [errors, setErrors] = useState<Partial<Record<Language, string>>>({});

  useEffect(() => {
    for (const l of app.languages) void api.dictionaryStatus(l.id).then((s) => setStatus((cur) => ({ ...cur, [l.id]: s })));
    return api.onDictionaryProgress((p) => setProgress((cur) => ({ ...cur, [p.language]: p })));
  }, [app.languages]);

  const install = async (l: Language) => {
    setErrors((e) => ({ ...e, [l]: undefined }));
    setProgress((cur) => ({ ...cur, [l]: { language: l, phase: "download", fraction: 0 } }));
    try {
      const s = await api.installDictionary(l);
      setStatus((cur) => ({ ...cur, [l]: s }));
      clearLookups(l);
    } catch (e) {
      setErrors((x) => ({ ...x, [l]: errorText(e) }));
    } finally {
      setProgress((cur) => ({ ...cur, [l]: undefined }));
    }
  };

  const PHASE: Record<DictionaryProgress["phase"], string> = {
    download: t("Downloading"),
    parse: t("Reading entries"),
    index: t("Building the index"),
    done: t("Done"),
    error: t("Failed"),
  };

  return (
    <>
      {app.languages.map((l) => {
        const s = status[l.id];
        const p = progress[l.id];
        return (
          <Group key={l.id} title={langName(l.id)}>
            {!s ? (
              <div className="skel-row" />
            ) : (
              <div className="dictrow">
                <span className={cls("dict-i", s.installed && "on")}>
                  <Icon name={s.installed ? "check" : "download"} size={18} stroke={s.installed ? 2.2 : 1.6} />
                </span>
                <div className="dictrow-t">
                  <b>{s.name}</b>
                  <span>
                    {s.installed
                      ? `${s.entries ? t("{n} entries", { n: s.entries }) : t("Installed")}${s.version ? ` · ${t("version {v}", { v: s.version })}` : ""}`
                      : s.downloadMb > 0
                        ? t("Not installed · about {mb} MB", { mb: s.downloadMb })
                        : t("No dictionary for this language in your interface language yet.")}
                  </span>
                  {s.license && <span className="lic">{t("License: {license}", { license: s.license })}</span>}
                </div>
                {!s.installed && !p && s.downloadMb > 0 && (
                  <button className="btn btn-f btn-s" onClick={() => void install(l.id)}>
                    <Icon name="download" size={15} />
                    {t("Install")}
                  </button>
                )}
                {s.installed && <span className="badge">{t("Ready for lookups")}</span>}
              </div>
            )}
            {p && (
              <div className="dict-prog">
                <span>
                  {PHASE[p.phase]}
                  {p.fraction != null && ` · ${Math.round(p.fraction * 100)}%`}
                </span>
                <div className="bar" role="progressbar" aria-label={t("Installing {name}", { name: s?.name ?? t("dictionary") })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((p.fraction ?? 0) * 100)}>
                  <i style={{ width: `${Math.round((p.fraction ?? 0) * 100)}%` }} />
                </div>
              </div>
            )}
            {(errors[l.id] || s?.error) && (
              <p className="err">
                <Icon name="alert" size={15} /> {t(errors[l.id] ?? s?.error ?? "")}
              </p>
            )}
          </Group>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------- appearance

function AppearanceTab() {
  return (
    <Group>
      <Row label={t("Theme")} hint={t("Light, or one of two dark themes.")} />
      <div className="srow">
        <ThemePicker />
      </div>
    </Group>
  );
}

// ---------------------------------------------------------------- preferences

function PreferencesTab({ navigate }: { navigate: Navigate }) {
  const app = useApp();
  return (
    <>
      <Group>
        <Row
          label={t("Interface language")}
          hint={t("Sayfern's menus and buttons, and the language the tutor explains grammar and corrections in.")}
          htmlFor="pref-locale"
        >
          <LocalePicker id="pref-locale" withLabel={false} />
        </Row>
      </Group>
      <Group>
        <Row
          label={t("Translate the tutor automatically")}
          hint={t("Adds a line in {language} under each tutor message. Uses a small extra model call per message.", { language: uiLocaleInfo(app.locale).nativeName })}
        >
          <Switch checked={!!app.settings.autoTranslate} onChange={(v) => void app.updateSettings({ autoTranslate: v })} label={t("Translate the tutor automatically")} />
        </Row>
      </Group>
      <UpdatesGroup />
      {import.meta.env.DEV && (
        <Group title={t("Debug")}>
          <Row label={t("Welcome page")} hint={t("Only in dev builds. Opens the first-run welcome page again. Finishing it saves its choices like a real first run.")}>
            <button className="btn btn-s" onClick={() => navigate("onboarding")}>
              {t("Show welcome page")}
            </button>
          </Row>
        </Group>
      )}
    </>
  );
}

// ---------------------------------------------------------------- voice (Stage 3)

function VoiceTab() {
  const app = useApp();
  const st = useVoiceStatus();
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadVoiceStatus(true);
  }, []);

  const run = async (fn: () => Promise<VoiceStatus>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      setVoiceStatus(await fn());
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!key.trim()) return;
    if (await run(() => api.addElevenLabsAccount(key, label))) {
      setKey("");
      setLabel("");
      setAdding(false);
    }
  };

  if (!st) return <div className="pop-skel" aria-label={t("Loading")}><i style={{ width: "60%" }} /></div>;
  const accounts = st.accounts;
  const lang = app.settings.language;

  return (
    <>
      <Group
        title={t("ElevenLabs accounts")}
        aside={
          <button className="iconb sm" aria-label={t("Add an ElevenLabs account")} title={t("Add an ElevenLabs account")} onClick={() => setAdding(true)} disabled={adding}>
            <Icon name="plus" size={16} />
          </button>
        }
      >
        {accounts.length === 0 && !adding && (
          <Row
            label={t("No account connected")}
            hint={t("Speech input and the most natural voices use ElevenLabs. A free account includes 10,000 credits a month. Without one, Sayfern reads aloud with Microsoft's free voices.")}
          >
            <button className="btn btn-s btn-f" onClick={() => setAdding(true)}>
              <Icon name="plus" size={14} />
              {t("Add account")}
            </button>
          </Row>
        )}
        {accounts.map((a, i) => (
          <div className="srow vc-acct" key={a.id}>
            <div className="srow-t">
              <span className="srow-l">
                <span className={cls("anki-st", a.state === "ok" ? "ok" : "warn")}>
                  <i />
                </span>
                {a.label} <span className="mono muted small">{a.keyHint}</span>
                {i === 0 && accounts.length > 1 && <span className="chip chip-s">{t("Used first")}</span>}
              </span>
              <span className="srow-h">
                {a.creditsLeft != null
                  ? t("{left} of {limit} credits left this month", { left: fmtNumber(a.creditsLeft), limit: fmtNumber(a.creditLimit ?? 0) })
                  : t("Credits unknown (the key can't read your subscription)")}
                {a.resetsAt ? ` · ${t("resets {date}", { date: fmtShortDate(a.resetsAt) })}` : ""}
                {a.error ? ` · ${t(a.error)}` : ""}
              </span>
            </div>
            <div className="srow-c vc-acct-c">
              <button className="iconb sm" aria-label={t("Use earlier")} title={t("Use earlier")} disabled={busy || i === 0} onClick={() => void run(() => api.moveElevenLabsAccount(a.id, -1))}>
                <Icon name="chevUp" size={15} />
              </button>
              <button
                className="iconb sm"
                aria-label={t("Use later")}
                title={t("Use later")}
                disabled={busy || i === accounts.length - 1}
                onClick={() => void run(() => api.moveElevenLabsAccount(a.id, 1))}
              >
                <Icon name="chev" size={15} />
              </button>
              <button className="iconb sm" aria-label={t("Remove {name}", { name: a.label })} title={t("Remove")} disabled={busy} onClick={() => void run(() => api.removeElevenLabsAccount(a.id))}>
                <Icon name="trash" size={15} />
              </button>
            </div>
          </div>
        ))}
        {adding && (
          <div className="srow vc-add">
            <div className="srow-t">
              <span className="srow-l">{accounts.length ? t("Add another account") : t("Add account")}</span>
              <span className="srow-h">
                {t(
                  "In ElevenLabs, open Developers, API keys and create a key with Text to Speech, Speech to Text and Voices read (add User read to see your credits). It's stored encrypted on this computer. With several accounts, Sayfern uses them in order and moves on when one runs out of credits.",
                )}{" "}
                <button className="linkb" onClick={() => void api.openExternal("https://elevenlabs.io/app/settings/api-keys")}>
                  {t("Open ElevenLabs")}
                </button>
              </span>
              <div className="vc-add-f">
                <input className="input sm" value={label} maxLength={40} placeholder={t("Name (optional)")} aria-label={t("Account name")} onChange={(e) => setLabel(e.target.value)} />
                <input
                  className="input sm"
                  type="password"
                  autoFocus
                  value={key}
                  placeholder={t("ElevenLabs API key")}
                  aria-label={t("ElevenLabs API key")}
                  onChange={(e) => setKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void add();
                    if (e.key === "Escape") setAdding(false);
                  }}
                />
                <button className="btn btn-s btn-f" onClick={() => void add()} disabled={busy || !key.trim()}>
                  {busy ? t("Checking…") : t("Connect")}
                </button>
                <button className="linkb" onClick={() => setAdding(false)} disabled={busy}>
                  {t("Cancel")}
                </button>
              </div>
            </div>
          </div>
        )}
      </Group>
      {error && (
        <p className="err" role="alert">
          <Icon name="alert" size={15} /> {error}
        </p>
      )}

      <Group title={t("Reading aloud")}>
        <Row
          label={t("Voices")}
          hint={
            st.prefs.tts === "elevenlabs" && st.speaking === "edge"
              ? accounts.length
                ? t("No ElevenLabs account can speak right now, so Sayfern uses the free voices.")
                : t("Add an ElevenLabs account above, or use the free voices.")
              : st.prefs.tts === "elevenlabs"
                ? t("Your ElevenLabs accounts. If they run out of credits, the free voices take over.")
                : t("Microsoft's free online voices. No account and no credits.")
          }
        >
          <div className="seg" role="radiogroup" aria-label={t("Voices")}>
            {(["elevenlabs", "edge"] as const).map((v) => (
              <button key={v} role="radio" aria-checked={st.prefs.tts === v} className={st.prefs.tts === v ? "on" : ""} onClick={() => void run(() => api.setVoicePrefs({ tts: v }))}>
                {v === "elevenlabs" ? "ElevenLabs" : t("Free Microsoft voices")}
              </button>
            ))}
          </div>
        </Row>
        {st.prefs.tts === "elevenlabs" && st.voices.length > 0 && (
          <Row label={t("ElevenLabs voice")} hint={t("Premade voices work with every account.")} htmlFor="vc-voice">
            <select id="vc-voice" className="input sm" value={st.voiceId ?? ""} disabled={busy} onChange={(e) => void run(() => api.setVoicePrefs({ voiceId: e.target.value }))}>
              {st.voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.category && v.category !== "premade" ? ` (${v.category})` : ""}
                </option>
              ))}
            </select>
          </Row>
        )}
        <Row label={t("Speed")} hint={t("The slow button always plays at 0.7×.")}>
          <div className="seg" role="radiogroup" aria-label={t("Speed")}>
            {VOICE_RATES.map((r) => (
              <button key={r} role="radio" aria-checked={st.prefs.rate === r} className={st.prefs.rate === r ? "on" : ""} onClick={() => void run(() => api.setVoicePrefs({ rate: r }))}>
                {r}×
              </button>
            ))}
          </div>
        </Row>
        <Row label={t("Read tutor replies aloud")} hint={t("Each new reply plays as soon as it arrives. Every message also has a listen button.")}>
          <Switch checked={st.prefs.autoSpeak} onChange={(v) => void run(() => api.setVoicePrefs({ autoSpeak: v }))} label={t("Read tutor replies aloud")} />
        </Row>
        <Row label={t("Try it")} hint={t("Plays a short sentence in {language}.", { language: langName(lang) })}>
          <SpeakButtons id={`sample:${lang}`} text={VOICE_SAMPLES[lang]} language={lang} kind="sentence" />
        </Row>
      </Group>

      <Group title={t("Talking")}>
        <Row
          label={t("Speech input")}
          hint={
            st.canTranscribe
              ? t("Click the mic under the message box, or hold it and release. ElevenLabs Scribe writes down what you said; Sayfern keeps the text, not the recording.")
              : t("Needs an ElevenLabs account whose key may use Speech to Text.")
          }
        >
          <span className={cls("anki-st", st.canTranscribe ? "ok" : "warn")}>
            <i />
            {st.canTranscribe ? t("Ready") : t("Not set up")}
          </span>
        </Row>
        <Row label={t("Send right after transcribing")} hint={t("Off: the text waits in the box so you can check it. On: it is sent at once, for a spoken conversation.")}>
          <Switch checked={st.prefs.autoSend} onChange={(v) => void run(() => api.setVoicePrefs({ autoSend: v }))} label={t("Send right after transcribing")} />
        </Row>
      </Group>
    </>
  );
}

// ---------------------------------------------------------------- data

/** Check for updates. Sayfern also checks by itself (lib/updates.ts); this shows that result too. On macOS the app menu has it as well. */
function UpdatesGroup() {
  const status = useUpdateStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      setUpdateStatus(await api.checkForUpdates());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Group title={t("Updates")}>
      <Row label={t("Check for updates")} hint={t("See whether a newer version of Sayfern is out.")}>
        <button className="btn btn-s" onClick={() => void check()} disabled={busy}>
          {busy ? t("Checking…") : t("Check for updates")}
        </button>
      </Row>
      {status && !error && !status.available && (
        <p className="saved-path" role="status">
          <Icon name="check" size={14} stroke={2.4} /> {t("You have the newest version ({version}).", { version: status.current })}
        </p>
      )}
      {status?.available && !error && (
        <Row
          label={t("Sayfern {version} is available.", { version: status.latest })}
          hint={status.flatpak ? tj("Update it in your software store, or run {command}.", { command: <span className="mono">flatpak update ca.sayfern.Sayfern</span> }) : undefined}
        >
          {!status.flatpak && (
            <button className="btn btn-s" onClick={() => void api.openExternal(status.url)}>
              <Icon name="download" size={15} />
              {t("Download")}
            </button>
          )}
        </Row>
      )}
      {error && <p className="err">{t(error)}</p>}
    </Group>
  );
}

function DataTab() {
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exportNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.exportData();
      if (r) setPath(r.path);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Group>
        <ul className="datalist">
          <li>
            <Icon name="sessions" size={17} />
            <span>
              {tj("{what}, with corrections and the tutor's notes on each", { what: <b>{t("Sessions and messages")}</b> })}
            </span>
          </li>
          <li>
            <Icon name="grammar" size={17} />
            <span>
              {tj("{what}, counted on this computer, never by a model", { what: <b>{t("Grammar, words and levels")}</b> })}
            </span>
          </li>
          <li>
            <Icon name="library" size={17} />
            <span>
              {tj("{what}, reading positions and saved words", { what: <b>{t("Your library")}</b> })}
            </span>
          </li>
          <li>
            <Icon name="lock" size={17} />
            <span>
              {tj("{what}, encrypted with the system keychain and never exported", { what: <b>{t("Model keys")}</b> })}
            </span>
          </li>
        </ul>
        <p className="srow-note">{t("Only the messages you send go to your model provider, along with the context the tutor needs for that reply.")}</p>
      </Group>
      <Group title={t("Export")}>
        <Row label={t("Export everything")} hint={t("One JSON file with all your records. Good for backups or taking your data elsewhere.")}>
          <button className="btn btn-s" onClick={() => void exportNow()} disabled={busy}>
            <Icon name="download" size={15} />
            {busy ? t("Exporting…") : t("Export")}
          </button>
        </Row>
        {path && (
          <p className="saved-path" role="status">
            <Icon name="check" size={14} stroke={2.4} /> {tj("Saved to {path}", { path: <span className="mono">{path}</span> })}
          </p>
        )}
        {error && <p className="err">{t(error)}</p>}
      </Group>
      <EraseGroup />
    </>
  );
}

const ERASE_WORD = "erase";

/** Start over: deletes all learner data, then reloads the UI into onboarding. */
function EraseGroup() {
  const [open, setOpen] = useState(false);
  const [keepSignIns, setKeepSignIns] = useState(true);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const armed = typed.trim().toLowerCase() === ERASE_WORD;

  const erase = async () => {
    if (!armed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.eraseAllData({ keepSignIns });
      try {
        localStorage.clear();
      } catch {
        // storage can be unavailable; nothing to clear then
      }
      history.replaceState(null, "", `${location.pathname}${location.search}#/`);
      location.reload();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  const cancel = () => {
    setOpen(false);
    setTyped("");
    setError(null);
  };

  return (
    <Group title={t("Start over")}>
      <Row
        label={t("Erase all data")}
        hint={t(
          "Deletes every session, correction, grammar record, saved word and level, your library, your settings and the Anki link. Dictionaries stay. This can't be undone.",
        )}
      >
        {!open && (
          <button className="btn btn-s btn-danger-o" onClick={() => setOpen(true)}>
            <Icon name="trash" size={15} />
            {t("Erase…")}
          </button>
        )}
      </Row>
      {open && (
        <div className="erase">
          <Row label={t("Keep model sign-ins")} hint={t("Stay signed in to your model providers and keep API keys.")} htmlFor="erase-keep">
            <Switch id="erase-keep" checked={keepSignIns} onChange={setKeepSignIns} label={t("Keep model sign-ins")} disabled={busy} />
          </Row>
          <div className="erase-confirm">
            <label htmlFor="erase-word">{tj("Type {word} to confirm", { word: <b className="mono">{ERASE_WORD}</b> })}</label>
            <input
              id="erase-word"
              className="input sm"
              value={typed}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              disabled={busy}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === "Enter") void erase();
                if (e.key === "Escape") cancel();
              }}
            />
            <div className="erase-actions">
              <button className="btn btn-s" onClick={cancel} disabled={busy}>
                {t("Cancel")}
              </button>
              <button className="btn btn-s btn-danger" onClick={() => void erase()} disabled={!armed || busy}>
                <Icon name="trash" size={15} />
                {busy ? t("Erasing…") : t("Erase everything")}
              </button>
            </div>
          </div>
          {error && (
            <p className="err" role="alert">
              <Icon name="alert" size={15} /> {t(error)}
            </p>
          )}
        </div>
      )}
    </Group>
  );
}

const APP_NAP_FIX = [
  "defaults write net.ankiweb.dtop NSAppSleepDisabled -bool true",
  "defaults write net.ichi2.anki NSAppSleepDisabled -bool true",
  "defaults write org.qt-project.Qt.QtWebEngineCore NSAppSleepDisabled -bool true",
].join("\n");

/** Reason-specific help when AnkiConnect can't be reached. */
function AnkiTroubleshoot({ st, busy, onTest }: { st: AnkiStatus; busy: boolean; onTest(): void }) {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => setCopied(true));
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Group title={t("Troubleshoot")}>
      <div className="anki-help">
        {st.reason === "timeout" && !IS_MAC ? (
          <p>
            <b>{t("Anki is open but not answering.")}</b>{" "}
            {t("Anki may be busy or frozen, and AnkiConnect stops answering. Quit and reopen Anki, then test again.")}
          </p>
        ) : st.reason === "timeout" ? (
          <>
            <p>
              <b>{t("Anki is open but asleep.")}</b>{" "}
              {t("macOS App Nap pauses Anki when another app is in front, and AnkiConnect stops answering. Turn App Nap off for Anki: paste this into Terminal, then quit and reopen Anki.")}
            </p>
            <pre className="anki-cmd">{APP_NAP_FIX}</pre>
            <button className="btn btn-s" onClick={() => copy(APP_NAP_FIX)}>
              {copied ? t("Copied") : t("Copy commands")}
            </button>
          </>
        ) : st.reason === "refused" ? (
          <p>
            <b>{t("Nothing is listening at {url}.", { url: st.url ?? st.config.url })}</b>{" "}
            {t("Check that Anki is open. After installing AnkiConnect, Anki must be restarted once before the add-on starts. In Anki, Tools, Add-ons should list AnkiConnect as enabled.")}
          </p>
        ) : st.reason === "forbidden" ? (
          <p>
            <b>{t("AnkiConnect blocked Sayfern.")}</b>{" "}
            {tj("In Anki, open Tools, Add-ons, AnkiConnect, Config, and make sure {key} contains {value} (the default).", {
              key: <code>webCorsOriginList</code>,
              value: <code>"http://localhost"</code>,
            })}
          </p>
        ) : st.reason === "not_ankiconnect" ? (
          <p>
            <b>{t("Another app is using port 8765.")}</b>{" "}
            {tj("Quit it, or change AnkiConnect's {key} and the address Sayfern uses.", { key: <code>webBindPort</code> })}
          </p>
        ) : (
          <p>{st.error ? t(st.error) : t("Can't reach Anki right now.")}</p>
        )}
        <p className="srow-note">
          {tj("Quick check outside Sayfern: in Terminal run {command}. It should print a version number.", {
            command: <code>{`curl -s ${st.url ?? st.config.url} -X POST -d '{"action":"version","version":6}'`}</code>,
          })}
        </p>
        {st.detail && <p className="srow-note mono">{t("Details: {detail}", { detail: st.detail })}</p>}
        <button className="btn btn-s" disabled={busy} onClick={onTest}>
          {busy ? t("Checking…") : t("Test connection")}
        </button>
      </div>
    </Group>
  );
}
