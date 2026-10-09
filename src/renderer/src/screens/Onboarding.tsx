// First run: (1) connect a model, (2) languages and level, (3) vocabulary with Anki (S2-14),
// (4) optional extras. In dev builds Settings > Preferences can reopen it (previewing).
import { useState, type ReactNode } from "react";
import type { Language, LevelBand } from "../../../shared/records";
import { sharedDecksUrl } from "../../../shared/stage2";
import { api, errorText } from "../api";
import { Connect } from "../components/Connect";
import { Fern, Icon } from "../components/icons";
import { useApp } from "../context";
import { cls } from "../lib/format";
import { LocalePicker } from "../components/LocalePicker";
import { deckRoute, sessionRoute, settingsRoute, type Navigate } from "../router";
import { isBeta } from "../../../shared/course";
import { BetaChip } from "../components/BetaChip";
import { LevelBands } from "../components/PlacementStart";
import { langName, msg, t } from "../i18n";

export interface OnboardingScreenProps {
  language: Language;
  navigate: Navigate;
}

const PLACE = "__place";
const LAST = 3;

/** How the learner will get vocabulary into Anki (S2-14). */
type AnkiPlan = "shared" | "generate" | "later";
const ANKI_PLAN_SUMMARY: Record<AnkiPlan, string> = {
  shared: msg("Use a shared deck from AnkiWeb"),
  generate: msg("Make a deck with my model"),
  later: msg("Decide later"),
};

export function OnboardingScreen({ navigate }: OnboardingScreenProps) {
  const app = useApp();
  const connected = app.providers.filter((p) => p.connected);
  const [step, setStep] = useState(connected.length ? 1 : 0);
  // First run: nothing picked yet. Reopened from Settings: the learner's current languages.
  const [langs, setLangs] = useState<Language[]>(app.settings.onboarded ? (app.settings.languages ?? [app.settings.language]) : []);
  const [levels, setLevels] = useState<Partial<Record<Language, string>>>({});
  // "Not sure" languages: the learner's rough level, so the level chat starts in the right place.
  const [bands, setBands] = useState<Partial<Record<Language, LevelBand>>>({});
  const [about, setAbout] = useState("");
  const [ankiPlan, setAnkiPlan] = useState<AnkiPlan | null>(null);
  // Reopened from Settings (dev builds): finishing still saves, but the learner can just close it.
  const previewing = !!app.settings.onboarded;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ordered = app.allLanguages.map((l) => l.id).filter((id) => langs.includes(id));
  const langInfo = (id: Language) => app.allLanguages.find((l) => l.id === id);
  const levelsDone = ordered.length > 0 && ordered.every((l) => levels[l] && (levels[l] !== PLACE || bands[l]));
  const canContinue = step === 0 ? connected.length > 0 : step === 1 ? levelsDone : step === 2 ? ankiPlan !== null : true;

  const finish = async (then?: "settings" | "decks") => {
    setBusy(true);
    setError(null);
    try {
      for (const l of ordered) if (levels[l] && levels[l] !== PLACE) await api.setSelfLevel(l, levels[l]!);
      if (about.trim()) await api.setProfile({ about: about.trim() });
      const placeIn = ordered.find((l) => levels[l] === PLACE);
      await app.updateSettings({ onboarded: true, languages: ordered, language: placeIn ?? ordered[0] });
      if (then === "settings") return navigate(settingsRoute("anki"));
      if (then === "decks" || ankiPlan === "generate") {
        await app.refreshSessions();
        return navigate(deckRoute());
      }
      if (placeIn) {
        const v = await api.startPlacement(placeIn, bands[placeIn]);
        await app.refreshSessions();
        navigate(sessionRoute(v.meta.id));
      } else {
        await app.refreshSessions();
        navigate("today");
      }
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const next = () => (step < LAST ? setStep(step + 1) : void finish());
  const modelSummary = connected.map((p) => p.name).join(", ");
  const langSummary = ordered
    .map((l) => `${langName(l)} · ${levels[l] === PLACE ? t("level to find") : (levels[l] ?? "")}`)
    .join("   ");

  return (
    <div className="welcome">
      <div className="ghost zh" aria-hidden="true" style={{ fontSize: 560, left: -40, top: 280 }}>
        说
      </div>
      <div className="ghost ja" aria-hidden="true" style={{ fontSize: 300, left: 430, top: -40 }}>
        話
      </div>
      <div className="welcome-l drag">
        <div className="welcome-brand">
          <Fern size={32} />
          <span className="serif">Sayfern</span>
        </div>
        <h1>{t("Practise with a tutor that remembers.")}</h1>
        <p className="welcome-lead">
          {t("It keeps track of what you're learning and notices what you can already do, so every session picks up where the last one left off.")}
        </p>
        <div className="welcome-foot">
          <span>
            <Icon name="lock" size={15} /> {t("Records stay on this Mac")}
          </span>
          <span>
            <Icon name="spark" size={15} /> {t("Free and open source")}
          </span>
        </div>
      </div>

      <div className="welcome-r">
        <section className="card wcard" aria-label={t("Set up Sayfern")}>
          <div className="wlocale">
            <LocalePicker id="ob-locale" />
          </div>
          <div className="wsteps">
            <Step n={1} title={t("Connect a model")} state={step === 0 ? "current" : "done"} summary={modelSummary} onChange={() => setStep(0)}>
              <p className="wstep-sub">{t("Use your own API key or a supported subscription. You pay your provider directly.")}</p>
              <div className="wconnect">
                <Connect compact providers={app.providers} onChanged={app.refreshAuth} />
              </div>
            </Step>

            <Step
              n={2}
              title={t("Languages you're learning")}
              state={step === 1 ? "current" : step > 1 ? "done" : "todo"}
              summary={langSummary}
              onChange={() => setStep(1)}
            >
              <p className="wstep-sub">{t("Pick one or more. Each gets its own records, level and library.")}</p>
              <div className="langpick">
                {app.allLanguages.map((l) => {
                  const on = langs.includes(l.id);
                  return (
                    <label key={l.id} className={cls("langopt", on && "on")}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => setLangs((cur) => (e.target.checked ? [...cur, l.id] : cur.filter((x) => x !== l.id)))}
                      />
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
              {ordered.map((l) => {
                const info = langInfo(l);
                return (
                  <div className="wlevel" key={l}>
                    <label htmlFor={`lv-${l}`}>{t("Your {language} level", { language: langName(l) })}</label>
                    <select id={`lv-${l}`} className="input select" value={levels[l] ?? ""} onChange={(e) => setLevels((cur) => ({ ...cur, [l]: e.target.value }))}>
                      <option value="" disabled>
                        {t("Choose a level")}
                      </option>
                      <option value={PLACE}>{t("Not sure: find my level with a 5-minute chat")}</option>
                      {(info?.levels ?? []).map((lv) => (
                        <option key={lv} value={lv}>
                          {lv}
                        </option>
                      ))}
                    </select>
                    {levels[l] === PLACE && (
                      <>
                        <p className="wstep-sub">{t("Roughly, how much do you know? The chat starts there.")}</p>
                        <LevelBands levels={info?.levels ?? []} value={bands[l]} onPick={(b) => setBands((cur) => ({ ...cur, [l]: b }))} />
                      </>
                    )}
                  </div>
                );
              })}
            </Step>

            <Step
              n={3}
              title={t("Learn words with Anki")}
              badge={t("Strongly recommended")}
              state={step === 2 ? "current" : step > 2 ? "done" : "todo"}
              summary={ankiPlan ? t(ANKI_PLAN_SUMMARY[ankiPlan]) : ""}
              onChange={() => setStep(2)}
            >
              <AnkiStep languages={ordered} plan={ankiPlan} onPlan={setAnkiPlan} onConnect={() => void finish("settings")} busy={busy} />
            </Step>

            <Step n={4} title={t("Bring your materials")} optional state={step === LAST ? "current" : "todo"}>
              <div className="field">
                <label htmlFor="ob-about">{t("A few lines about you")}</label>
                <textarea
                  id="ob-about"
                  className="input ta"
                  rows={3}
                  value={about}
                  maxLength={2000}
                  placeholder={t("What you do, what you like, why you're learning. Any language is fine.")}
                  onChange={(e) => setAbout(e.target.value)}
                />
              </div>
              <div className="wextras">
                <button className="chip" onClick={() => void finish("settings")} disabled={busy}>
                  <Icon name="cards" size={14} />
                  {t("Connect Anki")}
                </button>
                <span className="chip static">
                  <Icon name="library" size={14} />
                  {t("Textbooks and readers: add them in Library")}
                </span>
              </div>
            </Step>
          </div>

          {error && (
            <p className="err" role="alert">
              <Icon name="alert" size={15} /> {t(error)}
            </p>
          )}
          <div className="wfoot">
            {previewing ? (
              <button className="linkb dk-close" onClick={() => navigate(settingsRoute("preferences"))} disabled={busy}>
                {t("Close preview")}
              </button>
            ) : (
              <span className="muted small">{t("You can change any of this in Settings.")}</span>
            )}
            {step > 0 && (
              <button className="btn" onClick={() => setStep(step - 1)} disabled={busy}>
                {t("Back")}
              </button>
            )}
            <button className="btn btn-p btn-l" onClick={next} disabled={!canContinue || busy}>
              {busy
                ? t("Setting up…")
                : step === LAST
                  ? ankiPlan === "generate"
                    ? t("Make my Anki deck")
                    : ordered.some((l) => levels[l] === PLACE)
                      ? t("Start level chat")
                      : t("Start practising")
                  : t("Continue")}
              <Icon name="arrow" size={17} stroke={2} />
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Step 3 (S2-14): Sayfern works best once you can read some words, and Anki is the fastest way there. */
function AnkiStep({
  languages,
  plan,
  onPlan,
  onConnect,
  busy,
}: {
  languages: Language[];
  plan: AnkiPlan | null;
  onPlan(p: AnkiPlan): void;
  onConnect(): void;
  busy: boolean;
}) {
  return (
    <>
      <div className="dk-why">
        <span className="dk-why-i" aria-hidden="true">
          <Icon name="cards" size={20} />
        </span>
        <div>
          <b>{t("Sayfern assumes you can read some words.")}</b>
          <p>
            {t(
              "It can start you from zero, but learning vocabulary with Anki alongside makes everything much easier and faster. We recommend memorizing at least the 1,500 most common words in the language you wish to learn first.",
            )}
          </p>
        </div>
      </div>

      <div className="dk-paths" role="radiogroup" aria-label={t("How to get an Anki deck")}>
        <button role="radio" aria-checked={plan === "shared"} className={cls("dk-path", plan === "shared" && "on")} onClick={() => onPlan("shared")}>
          <span className="dk-path-h">
            <Icon name="download" size={16} /> {t("Use a shared deck")}
          </span>
          <small>{t("Free decks made by other learners on AnkiWeb. Pick one for your level and import it into Anki.")}</small>
        </button>
        <button role="radio" aria-checked={plan === "generate"} className={cls("dk-path", plan === "generate" && "on")} onClick={() => onPlan("generate")}>
          <span className="dk-path-h">
            <Icon name="spark" size={16} /> {t("Make one with your model")}
          </span>
          <small>{t("Sayfern picks words at your level, checks them with the dictionary, adds audio and sends the cards to Anki.")}</small>
        </button>
      </div>

      {plan === "shared" && (
        <div className="dk-links">
          {languages.map((l) => (
            <button key={l} className="btn btn-s" onClick={() => void api.openExternal(sharedDecksUrl(l))}>
              {t("Find {language} decks on AnkiWeb", { language: langName(l) })} <Icon name="external" size={13} />
            </button>
          ))}
        </div>
      )}
      {plan === "generate" && (
        <p className="dk-note">
          {t(
            "You'll set it up right after this. Cards are made 25 at a time, so a big deck takes several batches. Sayfern saves after each one, so you can stop and come back any time.",
          )}
        </p>
      )}

      <p className="dk-setup">
        {t("New to Anki? It's free at apps.ankiweb.net. Add the AnkiConnect add-on (code 2055492159) so Sayfern can see your cards.")}{" "}
        <button className="linkb" onClick={onConnect} disabled={busy}>
          {t("Connect Anki now")}
        </button>
        {plan !== "later" && (
          <>
            {" · "}
            <button className="linkb" onClick={() => onPlan("later")}>
              {t("Decide later")}
            </button>
          </>
        )}
      </p>
    </>
  );
}

function Step({
  n,
  title,
  state,
  summary,
  optional,
  badge,
  onChange,
  children,
}: {
  n: number;
  title: string;
  badge?: string;
  state: "done" | "current" | "todo";
  summary?: string;
  optional?: boolean;
  onChange?(): void;
  children: ReactNode;
}) {
  return (
    <div className={cls("wstep", state)} aria-current={state === "current" ? "step" : undefined}>
      <span className="wnum" aria-hidden="true">
        {state === "done" ? <Icon name="check" size={14} stroke={2.6} /> : n}
      </span>
      <div className="wstep-b">
        <div className="wstep-h">
          <h2>
            {title}
            {optional && <span className="muted"> · {t("optional")}</span>}
            {badge && state !== "done" && <span className="dk-badge">{badge}</span>}
          </h2>
          {state === "done" && onChange && (
            <button className="linkb" onClick={onChange} aria-label={t("Change: {title}", { title })}>
              {t("Change")}
            </button>
          )}
        </div>
        {state === "done" && summary && <p className="wstep-sum">{summary}</p>}
        {state === "current" && <div className="wstep-body">{children}</div>}
      </div>
    </div>
  );
}
