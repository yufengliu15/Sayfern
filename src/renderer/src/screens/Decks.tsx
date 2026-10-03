// Anki deck generator (S2-14..S2-16). Owned by the decks feature.
// New deck: a short form (level, theme, size, order, audio, model), then DECK_SAMPLE_SIZE sample
// cards to approve, then batches of DECK_BATCH_SIZE cards straight into Anki. Every number shown
// (counts, batches, minutes, characters) comes from the backend, computed locally.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Language } from "../../../shared/records";
import {
  DECK_BATCH_SIZE,
  DECK_BEGINNER,
  DECK_MAX_CARDS,
  DECK_MIN_CARDS,
  DECK_REQUEST_MAX,
  DECK_SAMPLE_SIZE,
  suggestDeckName,
  type DeckAudioProvider,
  type DeckCardView,
  type DeckEstimate,
  type DeckListItem,
  type DeckOptions,
  type DeckOrder,
  type DeckProjectView,
  type DeckRubySeg,
  type DeckSpec,
  type ElevenLabsStatus,
} from "../../../shared/stage2";
import { api, errorText } from "../api";
import { Icon } from "../components/icons";
import { ModelPicker } from "../components/ModelPicker";
import { Switch } from "../components/ui";
import { useApp } from "../context";
import { cls, fmtAgo, fontOf } from "../lib/format";
import { deckRoute, navigate as go, settingsRoute, type Navigate } from "../router";
import { loadVoiceStatus } from "../lib/voice";
import { DECK_REQUEST_EXAMPLES, DECK_REQUEST_PLACEHOLDER } from "../lib/samples";
import { hasRuby } from "../../../shared/languages";
import { langName, msg, t, tc, tj, tn } from "../i18n";

export interface DecksScreenProps {
  id?: string;
  language: Language;
  navigate: Navigate;
}

export function DecksScreen({ id, language, navigate }: DecksScreenProps) {
  const app = useApp();
  return (
    <main className="main page">
      <div className="page-drag drag" />
      <div className="page-in dk">
        <header className="page-head">
          <div>
            <div className="eyebrow">{t("{language} · Anki", { language: langName(language) })}</div>
            <h1 className="display">{id ? t("Your new deck") : t("Make an Anki deck")}</h1>
          </div>
          <div className="page-actions">
            {id ? (
              <button className="btn btn-s" onClick={() => navigate(deckRoute())}>
                <Icon name="back" size={14} /> {t("All decks")}
              </button>
            ) : (
              <button className="btn btn-s" onClick={() => navigate(settingsRoute("anki"))}>
                {t("Anki settings")}
              </button>
            )}
          </div>
        </header>
        {id ? <DeckProject id={id} navigate={navigate} /> : <NewDeck language={language} navigate={navigate} />}
      </div>
    </main>
  );
}

const SIZES = [50, 100, 300, 1000];



/** The deck size a request asks for ("top 1,500 words" → 1500), when it's a usable size. */
function sizeIn(request: string): number | null {
  // Grouping separators differ by language: 1,500 / 1.500 / 1 500.
  const m = /(?:^|[^\d.,])(\d{1,3}(?:[,.\u00a0\u202f ]\d{3})+|\d{2,4})(?![\d])/.exec(request);
  if (!m) return null;
  const n = Number(m[1].replace(/[,.\u00a0\u202f ]/g, ""));
  return n >= DECK_MIN_CARDS && n <= DECK_MAX_CARDS ? n : null;
}

function OrderSeg({ order, onOrder }: { order: DeckOrder; onOrder(o: DeckOrder): void }) {
  return (
    <div className="seg" role="radiogroup" aria-label={t("Order")}>
      {(
        [
          ["frequency", t("Most useful first")],
          ["theme", t("Grouped by theme")],
        ] as const
      ).map(([v, label]) => (
        <button key={v} role="radio" aria-checked={order === v} className={order === v ? "on" : ""} onClick={() => onOrder(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Err({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p className="err" role="alert">
      <Icon name="alert" size={15} /> {t(text)}
    </p>
  );
}

// ---------------------------------------------------------------- new deck

function NewDeck({ language, navigate }: { language: Language; navigate: Navigate }) {
  const app = useApp();
  const [o, setO] = useState<DeckOptions | null>(null);
  const [level, setLevel] = useState<string>("");
  const [request, setRequest] = useState("");
  const [size, setSize] = useState(100);
  const [order, setOrder] = useState<DeckOrder>("frequency");
  const [deckName, setDeckName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [skipKnown, setSkipKnown] = useState(true);
  const [audio, setAudio] = useState<DeckAudioProvider>("edge");
  const [estimate, setEstimate] = useState<DeckEstimate | null>(null);
  const [projects, setProjects] = useState<DeckListItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const opts = await api.deckOptions(language);
    setO(opts);
    setLevel((cur) => cur || (opts.currentLevel && opts.levels.includes(opts.currentLevel) ? opts.currentLevel : DECK_BEGINNER));
    if (opts.elevenlabs.connected) setAudio((a) => (a === "edge" ? "elevenlabs" : a));
  }, [language]);
  useEffect(() => {
    load().catch((e) => setError(errorText(e)));
    api
      .listDeckProjects(language)
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [language, load]);

  const name = nameEdited ? deckName : suggestDeckName(language, level || DECK_BEGINNER, request);
  const spec: DeckSpec = { language, level: level || DECK_BEGINNER, request, size, order, deckName: name, skipKnown, audio };
  // "the top 1,500 words" → offer to make the deck that size.
  const askedSize = sizeIn(request);
  const specKey = JSON.stringify(spec);

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      api
        .estimateDeck(JSON.parse(specKey) as DeckSpec)
        .then((e) => alive && setEstimate(e))
        .catch(() => undefined);
    }, 200);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [specKey]);

  const start = async () => {
    if (!app.model) return setError(t("Connect a model first."));
    setBusy(true);
    setError(null);
    try {
      const p = await api.startDeckProject(spec, app.model);
      navigate(deckRoute(p.id));
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const installDict = async () => {
    setInstalling(true);
    try {
      await api.installDictionary(language);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setInstalling(false);
    }
  };

  if (!o) return <Err text={error} />;
  const L = app.lang.fontClass;
  const elevenReady = o.elevenlabs.connected;
  const canStart = !!app.model && !busy && (audio === "edge" || elevenReady) && size >= DECK_MIN_CARDS;

  return (
    <div className="dk-new">
      <section className="card dk-form" aria-label={t("New deck")}>
        <p className="dk-lead">
          {hasRuby(language)
            ? t(
                "Tell Sayfern what you want, and your model picks the words and writes a card for each one: the word, its reading, a short meaning, an example sentence with translation, and audio. It checks every reading against {dictionary} and adds the cards straight to Anki.",
                { dictionary: o.dictionary.name },
              )
            : t(
                "Tell Sayfern what you want, and your model picks the words and writes a card for each one: the word, a short meaning, an example sentence with translation, and audio. It checks the words against {dictionary} and adds the cards straight to Anki.",
                { dictionary: o.dictionary.name },
              )}{" "}
          <button className="linkb" onClick={() => void api.openExternal(o.sharedDecksUrl)}>
            {t("Prefer a ready-made deck? Browse AnkiWeb")}
          </button>
        </p>

        <div className="dk-grid">
          <div className="field dk-wide">
            <label htmlFor="dk-request">{t("What do you want to learn?")}</label>
            <textarea
              id="dk-request"
              className="input ta dk-request"
              rows={3}
              value={request}
              maxLength={DECK_REQUEST_MAX}
              placeholder={t(DECK_REQUEST_PLACEHOLDER[language])}
              onChange={(e) => setRequest(e.target.value)}
            />
            <div className="dk-examples" aria-label={t("Examples")}>
              {DECK_REQUEST_EXAMPLES[language].map((key) => {
                const ex = t(key);
                return (
                  <button
                    key={key}
                    className="chip chip-s"
                    onClick={() => {
                      setRequest(ex);
                      const n = sizeIn(ex);
                      if (n) setSize(n);
                    }}
                  >
                    {ex}
                  </button>
                );
              })}
            </div>
            <small className="muted">
              {t("Name a word list or source, a theme, or a kind of item (words, sayings, set phrases). Leave it empty for everyday words at your level.")}
              {askedSize && askedSize !== size && (
                <>
                  {" "}
                  <button className="linkb" onClick={() => setSize(askedSize)}>
                    {t("Make it {n} cards", { n: askedSize })}
                  </button>
                </>
              )}
            </small>
          </div>
          <div className="field">
            <label htmlFor="dk-level">{t("Level")}</label>
            <select id="dk-level" className="input select" value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value={DECK_BEGINNER}>{t("Starting from zero")}</option>
              {o.levels.map((lv) => (
                <option key={lv} value={lv}>
                  {lv}
                  {lv === o.currentLevel ? ` ${t("(your level)")}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="field dk-order">
            <label>{t("Order")}</label>
            <OrderSeg order={order} onOrder={setOrder} />
          </div>
          <div className="field dk-wide">
            <label htmlFor="dk-size">{t("Cards")}</label>
            <div className="dk-size">
              <div className="seg" role="radiogroup" aria-label={t("Deck size")}>
                {SIZES.map((n) => (
                  <button key={n} role="radio" aria-checked={size === n} className={size === n ? "on" : ""} onClick={() => setSize(n)}>
                    {n}
                  </button>
                ))}
              </div>
              <input
                id="dk-size"
                className="input sm dk-num"
                type="number"
                min={DECK_MIN_CARDS}
                max={DECK_MAX_CARDS}
                value={size}
                onChange={(e) => setSize(Math.max(0, Math.min(DECK_MAX_CARDS, Number(e.target.value) || 0)))}
                aria-label={t("Number of cards")}
              />
            </div>
          </div>
          <div className="field dk-wide">
            <label htmlFor="dk-name">{t("Anki deck")}</label>
            <input
              id="dk-name"
              className="input"
              value={name}
              maxLength={100}
              onChange={(e) => {
                setNameEdited(true);
                setDeckName(e.target.value);
              }}
            />
            <small className="muted">{t("A new deck, kept apart from your other decks. Use :: for a sub-deck.")}</small>
          </div>
        </div>

        <div className="dk-row">
          <div className="dk-row-t">
            <b>{t("Skip words already in my Anki")}</b>
            <small>
              {o.anki.knownWords != null
                ? t("{n} words in your linked decks, from the last sync.", { n: o.anki.knownWords })
                : t("Link and sync a deck in Settings > Anki to use this.")}
            </small>
          </div>
          <Switch checked={skipKnown} onChange={setSkipKnown} label={t("Skip words already in my Anki")} />
        </div>

        <div className="dk-row">
          <div className="dk-row-t">
            <b>{hasRuby(language) ? t("Checked readings") : t("Checked words")}</b>
            <small>
              {o.dictionary.installed
                ? hasRuby(language)
                  ? t("{name} is installed: every reading is checked against it.", { name: o.dictionary.name })
                  : t("{name} is installed: every word is checked against it.", { name: o.dictionary.name })
                : o.dictionary.downloadMb > 0
                  ? hasRuby(language)
                    ? t("Install {name} ({mb} MB) so Sayfern can check every reading the model writes.", { name: o.dictionary.name, mb: o.dictionary.downloadMb })
                    : t("Install {name} ({mb} MB) so Sayfern can check every word the model writes.", { name: o.dictionary.name, mb: o.dictionary.downloadMb })
                  : t("No dictionary for this language in your interface language yet: the model's cards aren't checked.")}
            </small>
          </div>
          {!o.dictionary.installed && o.dictionary.downloadMb > 0 && (
            <button className="btn btn-s" onClick={() => void installDict()} disabled={installing}>
              {installing ? t("Installing…") : t("Install")}
            </button>
          )}
        </div>

        <AudioPicker audio={audio} onAudio={setAudio} status={o.elevenlabs} onStatus={(s) => setO({ ...o, elevenlabs: s })} />

        <div className="dk-row">
          <div className="dk-row-t">
            <b>{t("Model")}</b>
            <small>{t("Writes the word list and the cards. Uses your plan or API key.")}</small>
          </div>
          <ModelPicker placement="up" />
        </div>

        {!o.anki.enabled || !o.anki.connected ? (
          <p className="dk-warn">
            <Icon name="alert" size={15} />
            {o.anki.enabled ? t("Anki isn't reachable right now.") : t("Anki is turned off in Sayfern.")}{" "}
            {t("You can plan the deck and check the samples now; open Anki with AnkiConnect before adding cards.")}{" "}
            <button className="linkb" onClick={() => navigate(settingsRoute("anki"))}>
              {t("Anki settings")}
            </button>
          </p>
        ) : null}

        <div className="dk-foot">
          <div className="dk-est" aria-live="polite">
            {estimate && (
              <>
                <b>
                  {tn(estimate.batches, "{cards} cards in {count} batch of {size}", "{cards} cards in {count} batches of {size}", {
                    cards: estimate.cards,
                    size: DECK_BATCH_SIZE,
                  })}
                </b>
                <span>
                  {t("About {n} min of generating.", { n: estimate.minutes })}{" "}
                  {estimate.batches > 1 ? t("Run the batches whenever you like; progress is saved.") : ""}
                </span>
                {audio === "elevenlabs" && (
                  <span className={cls(estimate.creditsAfter != null && estimate.creditsAfter < 0 && "dk-over")}>
                    {t("Audio: about {n} characters", { n: estimate.audioCharacters })}
                    {estimate.creditsAfter != null &&
                      (estimate.creditsAfter < 0
                        ? t(", more than the {n} credits left this month. Sayfern switches to the free voices when they run out.", { n: o.elevenlabs.creditsLeft ?? 0 })
                        : t(". {n} credits left this month.", { n: o.elevenlabs.creditsLeft ?? 0 }))}
                  </span>
                )}
              </>
            )}
          </div>
          <button className="btn btn-p btn-l" onClick={() => void start()} disabled={!canStart}>
            {busy ? t("Starting…") : t("Write {n} sample cards", { n: DECK_SAMPLE_SIZE })}
            <Icon name="arrow" size={17} stroke={2} />
          </button>
        </div>
        <Err text={error} />
      </section>

      {projects && projects.length > 0 && (
        <section className="dk-list" aria-label={t("Your generated decks")}>
          <h3 className="eyebrow">{t("Your generated decks")}</h3>
          {projects.map((p) => (
            <button key={p.id} className="card dk-item" onClick={() => navigate(deckRoute(p.id))}>
              <span className={cls("dk-item-n", L)}>{p.deckName}</span>
              <span className="dk-item-m">
                {t("{n} added", { n: p.added })}
                {p.remaining > 0 ? ` · ${t("{n} to go", { n: p.remaining })}` : ""} · {t(STATUS_LABEL[p.status])} · {fmtAgo(p.updatedAt)}
              </span>
              <Icon name="chevR" size={15} />
            </button>
          ))}
        </section>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<DeckProjectView["status"], string> = {
  planning: msg("choosing words"),
  preview: msg("samples to check"),
  ready: msg("ready for the next batch"),
  generating: msg("making cards"),
  done: msg("finished"),
  failed: msg("failed"),
};

// ---------------------------------------------------------------- audio

function AudioPicker({
  audio,
  onAudio,
  status,
  onStatus,
}: {
  audio: DeckAudioProvider;
  onAudio(a: DeckAudioProvider): void;
  status: ElevenLabsStatus;
  onStatus(s: ElevenLabsStatus): void;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<ElevenLabsStatus>) => {
    setBusy(true);
    setError(null);
    try {
      const s = await fn();
      onStatus(s);
      void loadVoiceStatus(true);
      return s;
    } catch (e) {
      setError(errorText(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dk-audio">
      <div className="dk-row-t">
        <b>{t("Audio")}</b>
        <small>{t("Every card gets the word and the sentence read aloud.")}</small>
      </div>
      <div className="dk-paths" role="radiogroup" aria-label={t("Voices")}>
        <button
          role="radio"
          aria-checked={audio === "elevenlabs"}
          className={cls("dk-path", audio === "elevenlabs" && "on")}
          onClick={() => onAudio("elevenlabs")}
        >
          <span className="dk-path-h">
            <Icon name="speaker" size={16} /> ElevenLabs
          </span>
          <small>{t("Your own account. Very natural voices. A free account includes 10,000 characters a month.")}</small>
        </button>
        <button role="radio" aria-checked={audio === "edge"} className={cls("dk-path", audio === "edge" && "on")} onClick={() => onAudio("edge")}>
          <span className="dk-path-h">
            <Icon name="globe" size={16} /> {t("Free Microsoft voices")}
          </span>
          <small>{t("No account needed. Microsoft's online voices: one speaker for the word, another for the sentence.")}</small>
        </button>
      </div>

      {audio === "elevenlabs" &&
        (status.connected ? (
          <div className="dk-eleven">
            <span className="anki-st ok">
              <i />
              {t("Connected")}
              {status.creditsLeft != null && ` · ${t("{left} of {limit} credits left this month", { left: status.creditsLeft, limit: status.creditLimit ?? 0 })}`}
            </span>
            {status.voices.length > 0 && (
              <select
                className="input sm"
                value={status.voiceId ?? ""}
                aria-label={t("ElevenLabs voice")}
                onChange={(e) => void run(() => api.setElevenLabsVoice(e.target.value))}
                disabled={busy}
              >
                {status.voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.category && v.category !== "premade" ? ` (${v.category})` : ""}
                  </option>
                ))}
              </select>
            )}
            <button className="linkb" onClick={() => go(settingsRoute("voice"))}>
              {t("Manage accounts")}
            </button>
            {status.error && <span className="muted small">{t(status.error)}</span>}
          </div>
        ) : (
          <div className="dk-eleven">
            <p className="small muted">
              {t(
                "Would you like to connect your ElevenLabs account? Create an API key in ElevenLabs under Developers, API keys (Text to Speech and Voices read are enough; add User read to see your credits), then paste it here. It's stored encrypted on this Mac with your model sign-ins.",
              )}{" "}
              <button className="linkb" onClick={() => void api.openExternal("https://elevenlabs.io/app/settings/api-keys")}>
                {t("Open ElevenLabs")}
              </button>
            </p>
            <div className="dk-key">
              <input
                className="input sm"
                type="password"
                value={key}
                placeholder={t("ElevenLabs API key")}
                aria-label={t("ElevenLabs API key")}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && key.trim()) void run(() => api.connectElevenLabs(key)).then((s) => s && setKey(""));
                }}
              />
              <button
                className="btn btn-s btn-f"
                onClick={() => void run(() => api.connectElevenLabs(key)).then((s) => s && setKey(""))}
                disabled={busy || !key.trim()}
              >
                {busy ? t("Checking…") : t("Connect")}
              </button>
              <button className="linkb" onClick={() => onAudio("edge")}>
                {t("No thanks, use the free voices")}
              </button>
            </div>
          </div>
        ))}
      <Err text={error} />
    </div>
  );
}

// ---------------------------------------------------------------- a project

function DeckProject({ id, navigate }: { id: string; navigate: Navigate }) {
  const app = useApp();
  const [p, setP] = useState<DeckProjectView | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    const v = await api.getDeckProject(id);
    if (alive.current) setP(v);
  }, [id]);
  useEffect(() => {
    alive.current = true;
    load().catch((e) => setError(errorText(e)));
    return () => {
      alive.current = false;
    };
  }, [load]);
  const working = p?.status === "planning" || p?.status === "generating";
  useEffect(() => {
    if (!working) return;
    const timer = window.setInterval(() => void load().catch(() => undefined), 1000);
    return () => window.clearInterval(timer);
  }, [working, load]);

  const act = async (fn: () => Promise<DeckProjectView>) => {
    setBusy(true);
    setError(null);
    try {
      setP(await fn());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (p === undefined) return <Err text={error} />;
  if (p === null)
    return (
      <div className="card dk-empty">
        <p>{t("That deck project no longer exists.")}</p>
        <button className="btn btn-s" onClick={() => navigate(deckRoute())}>
          {t("Make a new deck")}
        </button>
      </div>
    );

  const L = fontOf(p.language);
  const pr = p.progress;
  const target = p.spec.size;
  const pct = Math.min(100, Math.round((pr.added / Math.max(1, target)) * 100));

  return (
    <div className="dk-proj">
      <section className="card dk-sum">
        <div className="dk-sum-h">
          <div>
            <b className={L}>{p.spec.deckName}</b>
            <small>
              {p.spec.level === DECK_BEGINNER ? t("From zero") : p.spec.level} · {p.spec.audio === "elevenlabs" ? t("ElevenLabs audio") : t("Free Microsoft voices")} ·{" "}
              {p.model}
            </small>
          </div>
          <span className={cls("dk-status", p.status)}>{t(STATUS_LABEL[p.status])}</span>
        </div>
        {p.spec.request && <p className="dk-asked">“{p.spec.request}”</p>}
        {(p.status === "ready" || p.status === "generating" || p.status === "done") && (
          <>
            <div className="dk-bar" role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={pr.added} aria-label={t("Cards added")}>
              <i style={{ width: `${pct}%` }} />
            </div>
            <p className="dk-count">
              <b>{t("{added} of {target} cards in Anki", { added: pr.added, target })}</b>
              {pr.remaining > 0 && (
                <span>
                  {" "}
                  · {tn(pr.batchesLeft, "{n} to go, about {count} batch", "{n} to go, about {count} batches", { n: pr.remaining })}
                </span>
              )}
              {(pr.skipped > 0 || pr.duplicates > 0 || pr.failed > 0) && (
                <span className="muted">
                  {" "}
                  · {t("left out:")}{" "}
                  {[
                    pr.skipped && t("{n} already in your Anki or not usable", { n: pr.skipped }),
                    pr.duplicates && t("{n} duplicates", { n: pr.duplicates }),
                    pr.failed && t("{n} failed", { n: pr.failed }),
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              )}
            </p>
          </>
        )}
        {working && (
          <p className="dk-activity" aria-live="polite">
            <span className="dk-spin" aria-hidden="true" /> {p.activity ? t(p.activity) : t("Working…")}
          </p>
        )}
        {p.status === "failed" && <Err text={p.error ?? t("Something went wrong.")} />}
        {p.lastError && <p className="err quiet">{t(p.lastError)}</p>}

        {(p.status === "ready" || p.status === "generating") && (
          <div className="dk-actions">
            {p.status === "ready" ? (
              <>
                <button className="btn btn-p" onClick={() => void act(() => api.runDeckBatch(p.id, app.model))} disabled={busy}>
                  {t("Add the next {n} cards", { n: Math.min(DECK_BATCH_SIZE, pr.remaining) })}
                </button>
                {pr.batchesLeft > 1 && (
                  <button className="btn" onClick={() => void act(() => api.runDeckBatch(p.id, app.model, { continuous: true }))} disabled={busy}>
                    {t("Keep going until it's done")}
                  </button>
                )}
                <ModelPicker placement="down" />
              </>
            ) : (
              <button className="btn" onClick={() => void act(() => api.stopDeckBatches(p.id))} disabled={busy}>
                {t("Stop after this")}
              </button>
            )}
            <span className="muted small">
              {pr.batchesLeft > 1
                ? t("A deck this size takes several batches. Each one is saved, so you can close Sayfern and come back.")
                : t("Anki needs to be open with AnkiConnect.")}
            </span>
          </div>
        )}
        {p.status === "done" && (
          <p className="dk-done">
            <Icon name="check" size={16} stroke={2.4} />{" "}
            {tj("Done. Open Anki and study {deck}. Sayfern follows this deck in Settings > Anki, so your tutor will bring its words into your chats.", {
              deck: <b>{p.spec.deckName}</b>,
            })}
          </p>
        )}
      </section>

      {(p.status === "preview" || (p.status === "planning" && p.samples.length > 0)) && (
        <section className="dk-preview" aria-label={t("Sample cards")}>
          <div className="dk-preview-h">
            <h3 className="eyebrow">{t("Sample cards: check them before anything goes to Anki")}</h3>
            <span className="muted small">
              {hasRuby(p.language)
                ? t("Front on the left, back on the right. Readings were checked by Sayfern, not just the model.")
                : t("Front on the left, back on the right. Words were checked by Sayfern, not just the model.")}
            </span>
          </div>
          {p.samples.map((c) => (
            <CardPreview key={c.word} card={c} L={L} />
          ))}
          <div className="card dk-approve">
            <div className="field">
              <label htmlFor="dk-notes">{t("Want changes? Tell the model, and it will write new samples")}</label>
              <textarea
                id="dk-notes"
                className="input ta"
                rows={2}
                maxLength={400}
                value={notes}
                placeholder={t("Shorter sentences, a more casual tone, no food words…")}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <div className="dk-actions">
              <button className="btn btn-p" onClick={() => void act(() => api.approveDeckSamples(p.id))} disabled={busy || p.status !== "preview"}>
                <Icon name="check" size={15} stroke={2.4} /> {t("Looks good")}
              </button>
              <button
                className="btn"
                onClick={() => void act(() => api.redoDeckSamples(p.id, notes, app.model))}
                disabled={busy || p.status !== "preview" || !notes.trim()}
              >
                {t("Write new samples")}
              </button>
              <span className="muted small">
                {t("Next: {n} cards in batches of {size}. Your notes are kept for every batch.", { n: p.spec.size, size: DECK_BATCH_SIZE })}
              </span>
            </div>
          </div>
        </section>
      )}

      {p.recent.length > 0 && (
        <section className="dk-recent" aria-label={t("Latest cards")}>
          <h3 className="eyebrow">{t("Latest cards")}</h3>
          <ul className="card">
            {p.recent.map((c, i) => (
              <li key={`${c.word}-${i}`} className={cls("dk-rc", c.status)}>
                <span className={cls("dk-rc-w", L)}>{c.word}</span>
                <span className="dk-rc-r">{c.reading}</span>
                <span className="dk-rc-d">{c.definition}</span>
                <span className="dk-rc-s">{c.status === "added" ? t("added") : c.status === "duplicate" ? t("already in Anki") : t(c.error ?? "failed")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Err text={error} />
    </div>
  );
}

function Ruby({ segs, ruby }: { segs: DeckRubySeg[]; ruby: boolean }) {
  return (
    <>
      {segs.map((s, i) => {
        const inner =
          ruby && s.rt ? (
            <ruby>
              {s.text}
              <rt>{s.rt}</rt>
            </ruby>
          ) : (
            s.text
          );
        return s.target ? <b key={i}>{inner}</b> : <span key={i}>{inner}</span>;
      })}
    </>
  );
}

function Play({ src, label }: { src?: string; label: string }) {
  if (!src) return null;
  return (
    <button className="dk-play" aria-label={label} title={label} onClick={() => void new Audio(src).play().catch(() => undefined)}>
      <Icon name="speaker" size={14} />
    </button>
  );
}

function CardPreview({ card: c, L }: { card: DeckCardView; L: string }) {
  return (
    <article className="dk-card">
      <div className="card dk-face">
        <span className="dk-face-l">{t("Front")}</span>
        <div className={cls("dk-word", L)}>{c.word}</div>
        <div className={cls("dk-sent", L)}>
          <Ruby segs={c.sentenceRuby} ruby={false} />
        </div>
      </div>
      <div className="card dk-face back">
        <span className="dk-face-l">{tc("card side", "Back")}</span>
        <div className={cls("dk-word", L)}>
          <Ruby segs={c.wordRuby} ruby />
          <Play src={c.audio?.word} label={t("Play {word}", { word: c.word })} />
        </div>
        {c.reading && <div className="dk-reading">{c.reading}</div>}
        <div className="dk-def">{c.definition}</div>
        <div className={cls("dk-sent", L)}>
          <Ruby segs={c.sentenceRuby} ruby />
          <Play src={c.audio?.sentence} label={t("Play the sentence")} />
        </div>
        <div className="dk-tr">{c.translation}</div>
        {c.notes && <div className="dk-notes">{c.notes}</div>}
      </div>
      {c.checks.length > 0 && (
        <ul className="dk-checks">
          {c.checks.map((x) => (
            <li key={x} className={cls(/fixed|check this|No audio|Install/.test(x) && "warn")}>
              <Icon name={/fixed|check this|No audio|Install/.test(x) ? "alert" : "check"} size={13} stroke={2.2} /> {checkText(x)}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/**
 * A card check line in the interface language. Core stores them in English (the warning test above
 * matches the English text); known shapes are translated here, anything else passes through t().
 */
const CHECK_PATTERNS: [RegExp, string][] = [
  [/^Reading checked in (.+)$/, msg("Reading checked in {a}")],
  [/^Reading fixed with (.+) \(model wrote (.+)\)$/, msg("Reading fixed with {a} (model wrote {b})")],
  [/^Reading from Sayfern's reader \(model wrote (.+)\); not in (.+)$/, msg("Reading from Sayfern's reader (model wrote {a}); not in {b}")],
  [/^Reading from Sayfern's reader \(model wrote (.+)\)$/, msg("Reading from Sayfern's reader (model wrote {a})")],
  [/^Reading from (.+)$/, msg("Reading from {a}")],
  [/^Not in (.+): check this one$/, msg("Not in {a}: check this one")],
  [/^Word found in (.+)$/, msg("Word found in {a}")],
  [/^No audio: (.+)$/, msg("No audio: {a}")],
];

function checkText(x: string): string {
  for (const [re, key] of CHECK_PATTERNS) {
    const m = re.exec(x);
    if (m) return t(key, { a: t(m[1]), b: m[2] ?? "" });
  }
  return t(x);
}
