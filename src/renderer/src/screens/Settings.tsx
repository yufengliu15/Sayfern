// Settings: models, languages and level, profile, Anki, dictionaries, preferences, data, extensions.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { AnkiStatus, ExtensionInfo } from "../../../shared/api";
import type { DictionaryProgress, DictionaryStatus, LanguageInfo } from "../../../shared/lang";
import type { AnkiDeckMapping, AnkiOverview, Language, LearnerProfile, LevelEstimate, Skill } from "../../../shared/records";
import { api, errorText } from "../api";
import { Connect } from "../components/Connect";
import { Icon, type IconName } from "../components/icons";
import { Switch } from "../components/ui";
import { useApp } from "../context";
import { clearLookups } from "../lib/cache";
import { cls, fmtAgo, fmtNumber, fmtShortDate } from "../lib/format";
import { replaceRoute, sessionRoute, settingsRoute, type Navigate } from "../router";

export interface SettingsScreenProps {
  language: Language;
  navigate: Navigate;
  tab?: string;
}

type Tab = "models" | "languages" | "about" | "anki" | "dictionaries" | "preferences" | "data" | "extensions";
const TABS: { id: Tab; label: string; icon: IconName; title: string; sub: string }[] = [
  { id: "models", label: "Models", icon: "spark", title: "Models", sub: "Connect the model you already pay for. Your provider bills you directly." },
  { id: "languages", label: "Language & level", icon: "globe", title: "Language & level", sub: "What you're learning and where you are. The tutor pitches everything to these." },
  { id: "about", label: "About you", icon: "user", title: "About you", sub: "A few lines the tutor keeps in mind, so conversations are about your life." },
  { id: "anki", label: "Anki", icon: "cards", title: "Anki", sub: "The tutor sees what you know, what's hard and what's next in Anki, so recognised words become words you use." },
  { id: "dictionaries", label: "Dictionaries", icon: "library", title: "Dictionaries", sub: "Hover lookups use free dictionaries stored on this Mac." },
  { id: "preferences", label: "Preferences", icon: "settings", title: "Preferences", sub: "Defaults for new sessions. You can change them in any session." },
  { id: "data", label: "Data", icon: "database", title: "Your data", sub: "Everything Sayfern records is stored on this Mac, in plain files you can export." },
  { id: "extensions", label: "Extensions", icon: "tool", title: "Extensions", sub: "Add tools, prompt additions and language packs." },
];
const SKILL_LABEL: Record<Skill, string> = { reading: "Reading", recognition: "Recognition", writing: "Writing" };
const BY_LABEL: Record<LevelEstimate["by"], string> = { self: "Set by you", placement: "Placement chat", observed: "Seen in your writing" };

export function SettingsScreen({ navigate, tab: routeTab }: SettingsScreenProps) {
  const tab: Tab = (TABS.find((t) => t.id === routeTab)?.id ?? "models") as Tab;
  const info = TABS.find((t) => t.id === tab)!;
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const select = (t: Tab) => replaceRoute(settingsRoute(t));
  const onKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const next = e.key === "ArrowDown" ? TABS[(i + 1) % TABS.length] : e.key === "ArrowUp" ? TABS[(i - 1 + TABS.length) % TABS.length] : null;
    if (!next) return;
    e.preventDefault();
    select(next.id);
    tabRefs.current[next.id]?.focus();
  };

  return (
    <main className="main set">
      <nav className="set-nav" aria-label="Settings sections">
        <div className="set-drag drag" />
        <h1 className="set-title">Settings</h1>
        <div role="tablist" aria-orientation="vertical" onKeyDown={onKey}>
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="set-panel"
              tabIndex={tab === t.id ? 0 : -1}
              className={cls("set-tab", tab === t.id && "on")}
              onClick={() => select(t.id)}
            >
              <Icon name={t.icon} size={17} />
              {t.label}
            </button>
          ))}
        </div>
      </nav>
      <div className="set-body" id="set-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <div className="set-drag drag" />
        <div className="set-in" key={tab}>
          <h2 className="set-h">{info.title}</h2>
          <p className="set-sub">{info.sub}</p>
          {tab === "models" && <ModelsTab />}
          {tab === "languages" && <LanguagesTab navigate={navigate} />}
          {tab === "about" && <AboutTab navigate={navigate} />}
          {tab === "anki" && <AnkiTab />}
          {tab === "dictionaries" && <DictionariesTab />}
          {tab === "preferences" && <PreferencesTab />}
          {tab === "data" && <DataTab />}
          {tab === "extensions" && <ExtensionsTab />}
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
          <Row label="Default model" hint="Used for new messages. Change it any time from the message box." htmlFor="def-model">
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
          <h3>Providers</h3>
          <span className="muted small">
            <Icon name="lock" size={13} /> Keys are encrypted with your Mac's Keychain
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
      <Group title="Languages you're learning">
        <div className="langpick">
          {app.allLanguages.map((l) => {
            const on = enabled.includes(l.id);
            return (
              <label key={l.id} className={cls("langopt", on && "on")}>
                <input type="checkbox" checked={on} disabled={on && enabled.length === 1} onChange={(e) => toggle(l.id, e.target.checked)} />
                <span className={cls("g", l.fontClass)}>{l.glyph}</span>
                <span className="t">
                  <b>{l.name}</b>
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

  const place = async () => {
    setBusy("place");
    try {
      const v = await api.startPlacement(info.id);
      if (info.id !== app.language) app.setLanguage(info.id);
      await app.refreshSessions();
      navigate(sessionRoute(v.meta.id));
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  };

  const skills: Skill[] = ["reading", "recognition", "writing"];
  const history = [...(data?.history ?? [])].sort((a, b) => b.at - a.at);
  return (
    <Group
      title={`${info.name} level`}
      aside={
        history.length > 0 && (
          <button className="linkb" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? "Hide history" : `History (${history.length})`}
          </button>
        )
      }
    >
      <div className="lvlgrid">
        {skills.map((s) => {
          const e = data?.current[s];
          return (
            <div key={s} className="lvlcell">
              <span className="lvl-s">{SKILL_LABEL[s]}</span>
              <b className={cls(!e && "none")}>{e ? e.level : "Not yet"}</b>
              {e ? (
                <>
                  <span className="lvl-by">
                    {BY_LABEL[e.by]} · {fmtShortDate(e.at)}
                  </span>
                  <span className="lvl-ev">{e.evidence}</span>
                </>
              ) : (
                <span className="lvl-by">No estimate yet</span>
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
              <span>{SKILL_LABEL[h.skill]}</span>
              <b>{h.level}</b>
              <span className="muted">{BY_LABEL[h.by]}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="lvl-actions">
        <label htmlFor={`self-${info.id}`} className="srow-l">
          I'd say I'm at
        </label>
        <select id={`self-${info.id}`} className="input select sm" value={self} onChange={(e) => void rate(e.target.value)} disabled={busy === "self"}>
          <option value="">Choose a level</option>
          {info.levels.map((lv) => (
            <option key={lv} value={lv}>
              {lv}
            </option>
          ))}
        </select>
        <span className="lvl-or">or</span>
        <button className="btn btn-f btn-s" onClick={() => void place()} disabled={busy === "place"}>
          <Icon name="compass" size={15} />
          {busy === "place" ? "Starting…" : "Find my level"}
        </button>
        <span className="muted small">A 5-minute chat, no test.</span>
      </div>
      {error && <p className="err">{error}</p>}
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
        {state === "saving" && "Saving…"}
        {state === "saved" && (
          <>
            <Icon name="check" size={13} stroke={2.4} /> Saved
          </>
        )}
        {state === "error" && "Couldn't save. Your changes are still here."}
      </div>
      <Group>
        <div className="sform">
          <div className="field">
            <label htmlFor="pf-name">What should the tutor call you?</label>
            <input id="pf-name" className="input" value={p.name ?? ""} maxLength={60} placeholder="Your name" onChange={(e) => change({ name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="pf-about">About you</label>
            <textarea
              id="pf-about"
              className="input ta"
              rows={5}
              value={p.about}
              maxLength={2000}
              placeholder="What you do, what you like, what you want to talk about. Write in any language."
              onChange={(e) => change({ about: e.target.value })}
            />
            <span className="note">Shared across languages. The tutor reads it at the start of every session.</span>
          </div>
          {app.languages.map((l) => (
            <div className="field" key={l.id}>
              <label htmlFor={`pf-goal-${l.id}`}>Your goal for {l.name}</label>
              <input
                id={`pf-goal-${l.id}`}
                className="input"
                value={p.goals[l.id] ?? ""}
                maxLength={200}
                placeholder={l.id === "zh" ? "e.g. Pass HSK 4 by June" : "e.g. Read a novel without a dictionary"}
                onChange={(e) => change({ goals: { [l.id]: e.target.value } })}
              />
            </div>
          ))}
        </div>
      </Group>
      <div className="tipcard">
        <Icon name="file" size={18} />
        <p>
          Have more to share, like a journal or a CV? Add it to your Library as <b>About me</b> and the tutor can draw on it.{" "}
          <button className="linkb" onClick={() => navigate("library")}>
            Open Library
          </button>
        </p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- anki

function AnkiTab() {
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
          label="Use Anki"
          hint={
            on ? (
              <span className={cls("anki-st", st.connected ? "ok" : "warn")}>
                <i />
                {st.connected ? `Connected${st.version ? ` · AnkiConnect v${st.version}` : ""}` : (st.error ?? "Can't reach Anki right now")}
              </span>
            ) : (
              "Off. Sessions won't mention your cards."
            )
          }
        >
          <Switch checked={on} onChange={(v) => void save({ enabled: v })} label="Use Anki" />
        </Row>
        {on && !st.connected && Object.keys(st.snapshots).length > 0 && (
          <p className="srow-note">Until Anki is back, the tutor uses your last synced snapshot.</p>
        )}
      </Group>

      {on && !st.connected && <AnkiTroubleshoot st={st} busy={busy === "test"} onTest={() => void test()} />}

      <Group title="Set up">
        <ol className="steps">
          <li>
            <span className="n">1</span>
            <div>
              <b>Install the AnkiConnect add-on.</b>
              <p>
                In Anki, choose Tools, Add-ons, Get Add-ons, and paste this code:{" "}
                <button
                  className="codechip"
                  onClick={() => {
                    void navigator.clipboard?.writeText("2055492159").then(() => setCopied(true));
                    window.setTimeout(() => setCopied(false), 1500);
                  }}
                  aria-label="Copy add-on code 2055492159"
                >
                  2055492159 <span>{copied ? "Copied" : "Copy"}</span>
                </button>
              </p>
            </div>
          </li>
          <li>
            <span className="n">2</span>
            <div>
              <b>Restart Anki and keep it open while you practise.</b>
              <p>Sayfern talks to it at {st.config.url}. Nothing leaves your Mac.</p>
            </div>
          </li>
          <li>
            <span className="n">3</span>
            <div>
              <b>Pick a deck for each language below.</b>
              <p>Tell Sayfern which field holds the word, so the tutor knows which words you know, are learning and find hard.</p>
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
            snapshot={st.snapshots[l.id]}
            connected={st.connected}
            syncing={busy === l.id}
            onChange={(m) => void save({ decks: [...st.config.decks.filter((d) => d.language !== l.id), ...(m ? [m] : [])] })}
            onSync={() => void sync(l.id)}
          />
        ))}
      {error && (
        <p className="err" role="alert">
          <Icon name="alert" size={15} /> {error}
        </p>
      )}
    </>
  );
}

function DeckMapping({
  info,
  decks,
  mapping,
  snapshot,
  connected,
  syncing,
  onChange,
  onSync,
}: {
  info: LanguageInfo;
  decks: string[];
  mapping?: AnkiDeckMapping;
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
        <option value="">{optional ? "None" : "Choose a field"}</option>
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
      title={`${info.name} deck`}
      aside={
        <button className="btn btn-s" onClick={onSync} disabled={!mapping?.deck || !connected || syncing}>
          <Icon name="refresh" size={14} />
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      }
    >
      <div className="deckgrid">
        <div className="field">
          <label htmlFor={`${id}-deck`}>Deck</label>
          <select
            id={`${id}-deck`}
            className="input select"
            value={mapping?.deck ?? ""}
            disabled={!connected && !mapping}
            onChange={(e) => onChange(e.target.value ? { language: info.id, deck: e.target.value, wordField: "" } : null)}
          >
            <option value="">{connected ? "Choose a deck" : "Open Anki to list decks"}</option>
            {deckOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        {fieldSel("wordField", "Word field", false)}
        {fieldSel("readingField", `${info.readingName} field`, true)}
        {fieldSel("meaningField", "Meaning field", true)}
      </div>
      {overview && <AnkiWords overview={overview} language={info.id} />}
      <p className="srow-note">
        {snapshot
          ? `Last synced ${fmtAgo(snapshot.syncedAt)} · ${fmtNumber(snapshot.cards)} cards · ${fmtNumber(snapshot.matureCount)} mature · ${snapshot.reviewedToday} reviewed today`
          : "Not synced yet."}
      </p>
    </Group>
  );
}

/** Word counts from the snapshot and the hardest words, collapsible. */
function AnkiWords({ overview: o, language }: { overview: AnkiOverview; language: Language }) {
  const parts: [number, string][] = [
    [o.counts.known, "known"],
    [o.counts.learning, "learning"],
    [o.newRemaining, "still new"],
    [o.struggling, "struggling"],
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
            Hardest right now
          </summary>
          <ul>
            {o.topStruggling.map((w) => (
              <li key={w.word}>
                <span className={cls("w", language)}>{w.word}</span>
                <span className="m">{[w.reading, w.meaning].filter(Boolean).join(" · ")}</span>
                <span className="r">{w.reasons.join(", ")}</span>
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

  const PHASE: Record<DictionaryProgress["phase"], string> = { download: "Downloading", parse: "Reading entries", index: "Building the index", done: "Done", error: "Failed" };

  return (
    <>
      {app.languages.map((l) => {
        const s = status[l.id];
        const p = progress[l.id];
        return (
          <Group key={l.id} title={l.name}>
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
                      ? `${s.entries ? `${fmtNumber(s.entries)} entries` : "Installed"}${s.version ? ` · version ${s.version}` : ""}`
                      : `Not installed · about ${s.downloadMb} MB`}
                  </span>
                  <span className="lic">License: {s.license}</span>
                </div>
                {!s.installed && !p && (
                  <button className="btn btn-f btn-s" onClick={() => void install(l.id)}>
                    <Icon name="download" size={15} />
                    Install
                  </button>
                )}
                {s.installed && <span className="badge">Ready for lookups</span>}
              </div>
            )}
            {p && (
              <div className="dict-prog">
                <span>
                  {PHASE[p.phase]}
                  {p.fraction != null && ` · ${Math.round(p.fraction * 100)}%`}
                </span>
                <div className="bar" role="progressbar" aria-label={`Installing ${s?.name ?? "dictionary"}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((p.fraction ?? 0) * 100)}>
                  <i style={{ width: `${Math.round((p.fraction ?? 0) * 100)}%` }} />
                </div>
              </div>
            )}
            {(errors[l.id] || s?.error) && (
              <p className="err">
                <Icon name="alert" size={15} /> {errors[l.id] ?? s?.error}
              </p>
            )}
          </Group>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------- preferences

function PreferencesTab() {
  const app = useApp();
  const mode = app.settings.feedbackMode ?? "inline";
  return (
    <Group>
      <Row label="Corrections" hint={mode === "inline" ? "Shown under your message as you go." : "Saved and shown when you end the session."}>
        <div className="seg" role="radiogroup" aria-label="When to show corrections">
          {(["inline", "end"] as const).map((m) => (
            <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} onClick={() => void app.updateSettings({ feedbackMode: m })}>
              {m === "inline" ? "Inline" : "After session"}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Translate the tutor automatically" hint="Adds an English line under each tutor message. Uses a small extra model call per message.">
        <Switch checked={!!app.settings.autoTranslate} onChange={(v) => void app.updateSettings({ autoTranslate: v })} label="Translate the tutor automatically" />
      </Row>
    </Group>
  );
}

// ---------------------------------------------------------------- data

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
              <b>Sessions and messages</b>, with corrections and the tutor's notes on each
            </span>
          </li>
          <li>
            <Icon name="grammar" size={17} />
            <span>
              <b>Grammar, words and levels</b>, counted on this Mac, never by a model
            </span>
          </li>
          <li>
            <Icon name="library" size={17} />
            <span>
              <b>Your library</b>, reading positions and saved words
            </span>
          </li>
          <li>
            <Icon name="lock" size={17} />
            <span>
              <b>Model keys</b>, encrypted with the Keychain and never exported
            </span>
          </li>
        </ul>
        <p className="srow-note">Only the messages you send go to your model provider, along with the context the tutor needs for that reply.</p>
      </Group>
      <Group title="Export">
        <Row label="Export everything" hint="One JSON file with all your records. Good for backups or taking your data elsewhere.">
          <button className="btn btn-s" onClick={() => void exportNow()} disabled={busy}>
            <Icon name="download" size={15} />
            {busy ? "Exporting…" : "Export"}
          </button>
        </Row>
        {path && (
          <p className="saved-path" role="status">
            <Icon name="check" size={14} stroke={2.4} /> Saved to <span className="mono">{path}</span>
          </p>
        )}
        {error && <p className="err">{error}</p>}
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
    <Group title="Start over">
      <Row
        label="Erase all data"
        hint="Deletes every session, correction, grammar record, saved word and level, your library, your settings and the Anki link. Dictionaries and extensions stay. This can't be undone."
      >
        {!open && (
          <button className="btn btn-s btn-danger-o" onClick={() => setOpen(true)}>
            <Icon name="trash" size={15} />
            Erase…
          </button>
        )}
      </Row>
      {open && (
        <div className="erase">
          <Row label="Keep model sign-ins" hint="Stay signed in to your model providers and keep API keys." htmlFor="erase-keep">
            <Switch id="erase-keep" checked={keepSignIns} onChange={setKeepSignIns} label="Keep model sign-ins" disabled={busy} />
          </Row>
          <div className="erase-confirm">
            <label htmlFor="erase-word">
              Type <b className="mono">{ERASE_WORD}</b> to confirm
            </label>
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
                Cancel
              </button>
              <button className="btn btn-s btn-danger" onClick={() => void erase()} disabled={!armed || busy}>
                <Icon name="trash" size={15} />
                {busy ? "Erasing…" : "Erase everything"}
              </button>
            </div>
          </div>
          {error && (
            <p className="err" role="alert">
              <Icon name="alert" size={15} /> {error}
            </p>
          )}
        </div>
      )}
    </Group>
  );
}

// ---------------------------------------------------------------- extensions

function ExtensionsTab() {
  const [list, setList] = useState<ExtensionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .listExtensions()
      .then(setList)
      .catch((e) => setError(errorText(e)));
  }, []);
  const toggle = async (id: string, on: boolean) => {
    setList((cur) => cur?.map((x) => (x.id === id ? { ...x, enabled: on } : x)) ?? null);
    try {
      setList(await api.setExtensionEnabled(id, on));
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <>
      <Group
        title="Installed"
        aside={
          <button className="btn btn-s" onClick={() => void api.openExtensionsFolder()}>
            <Icon name="folder" size={15} />
            Open extensions folder
          </button>
        }
      >
        {list === null ? (
          <div className="skel-row" />
        ) : list.length === 0 ? (
          <p className="srow-note">No extensions yet. Drop a folder with a package.json and index.js into the extensions folder, then reopen Sayfern.</p>
        ) : (
          <ul className="extlist">
            {list.map((x) => (
              <li key={x.id} className={cls("ext", !x.enabled && "off")}>
                <span className="ext-i">
                  <Icon name="tool" size={18} />
                </span>
                <div className="ext-t">
                  <div className="ext-n">
                    <b>{x.name}</b>
                    <span className="mono">v{x.version}</span>
                  </div>
                  <p>{x.description}</p>
                  <div className="ext-c">
                    {x.contributes.tools.map((t) => (
                      <span key={t} className="tag mono">
                        tool · {t}
                      </span>
                    ))}
                    {x.contributes.languages.map((t) => (
                      <span key={t} className="tag mono">
                        language · {t}
                      </span>
                    ))}
                  </div>
                  {x.error && (
                    <p className="err">
                      <Icon name="alert" size={14} /> {x.error}
                    </p>
                  )}
                </div>
                <Switch checked={x.enabled} onChange={(v) => void toggle(x.id, v)} label={`Enable ${x.name}`} />
              </li>
            ))}
          </ul>
        )}
        {error && <p className="err">{error}</p>}
      </Group>
      <div className="tipcard">
        <Icon name="customize" size={18} />
        <p>
          Extensions are plain JavaScript folders. The API is documented in <span className="mono">docs/extensions.md</span>. A builder that makes them
          for you from a description arrives in Stage 2.
        </p>
      </div>
    </>
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
    <Group title="Troubleshoot">
      <div className="anki-help">
        {st.reason === "timeout" ? (
          <>
            <p>
              <b>Anki is open but asleep.</b> macOS App Nap pauses Anki when another app is in front, and AnkiConnect
              stops answering. Turn App Nap off for Anki: paste this into Terminal, then quit and reopen Anki.
            </p>
            <pre className="anki-cmd">{APP_NAP_FIX}</pre>
            <button className="btn btn-s" onClick={() => copy(APP_NAP_FIX)}>
              {copied ? "Copied" : "Copy commands"}
            </button>
          </>
        ) : st.reason === "refused" ? (
          <p>
            <b>Nothing is listening at {st.url ?? st.config.url}.</b> Check that Anki is open. After installing
            AnkiConnect, Anki must be restarted once before the add-on starts. In Anki, Tools, Add-ons should list
            AnkiConnect as enabled.
          </p>
        ) : st.reason === "forbidden" ? (
          <p>
            <b>AnkiConnect blocked Sayfern.</b> In Anki, open Tools, Add-ons, AnkiConnect, Config, and make sure{" "}
            <code>webCorsOriginList</code> contains <code>"http://localhost"</code> (the default).
          </p>
        ) : st.reason === "not_ankiconnect" ? (
          <p>
            <b>Another app is using port 8765.</b> Quit it, or change AnkiConnect's <code>webBindPort</code> and the
            address Sayfern uses.
          </p>
        ) : (
          <p>{st.error ?? "Can't reach Anki right now."}</p>
        )}
        <p className="srow-note">
          Quick check outside Sayfern: in Terminal run{" "}
          <code>curl -s {st.url ?? st.config.url} -X POST -d '{"{"}"action":"version","version":6{"}"}'</code>. It should
          print a version number.
        </p>
        {st.detail && <p className="srow-note mono">Details: {st.detail}</p>}
        <button className="btn btn-s" disabled={busy} onClick={onTest}>
          {busy ? "Checking…" : "Test connection"}
        </button>
      </div>
    </Group>
  );
}
