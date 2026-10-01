// First run: (1) connect a model, (2) languages and level, (3) optional extras.
import { useState, type ReactNode } from "react";
import type { Language } from "../../../shared/records";
import { api, errorText } from "../api";
import { Connect } from "../components/Connect";
import { Fern, Icon } from "../components/icons";
import { useApp } from "../context";
import { cls } from "../lib/format";
import { sessionRoute, settingsRoute, type Navigate } from "../router";

export interface OnboardingScreenProps {
  language: Language;
  navigate: Navigate;
}

const PLACE = "__place";

export function OnboardingScreen({ navigate }: OnboardingScreenProps) {
  const app = useApp();
  const connected = app.providers.filter((p) => p.connected);
  const [step, setStep] = useState(connected.length ? 1 : 0);
  const [langs, setLangs] = useState<Language[]>([app.settings.language ?? app.allLanguages[0]?.id ?? "zh"]);
  const [levels, setLevels] = useState<Partial<Record<Language, string>>>({});
  const [about, setAbout] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ordered = app.allLanguages.map((l) => l.id).filter((id) => langs.includes(id));
  const langInfo = (id: Language) => app.allLanguages.find((l) => l.id === id);
  const levelsDone = ordered.length > 0 && ordered.every((l) => levels[l]);
  const canContinue = step === 0 ? connected.length > 0 : step === 1 ? levelsDone : true;

  const finish = async (thenSettings?: boolean) => {
    setBusy(true);
    setError(null);
    try {
      for (const l of ordered) if (levels[l] && levels[l] !== PLACE) await api.setSelfLevel(l, levels[l]!);
      if (about.trim()) await api.setProfile({ about: about.trim() });
      const placeIn = ordered.find((l) => levels[l] === PLACE);
      await app.updateSettings({ onboarded: true, languages: ordered, language: placeIn ?? ordered[0] });
      if (thenSettings) return navigate(settingsRoute("anki"));
      if (placeIn) {
        const v = await api.startPlacement(placeIn);
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

  const next = () => (step < 2 ? setStep(step + 1) : void finish());
  const modelSummary = connected.map((p) => p.name).join(", ");
  const langSummary = ordered
    .map((l) => `${langInfo(l)?.name ?? l} · ${levels[l] === PLACE ? "level to find" : (levels[l] ?? "")}`)
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
        <h1>
          Practise with a tutor that <em>remembers</em>.
        </h1>
        <p className="welcome-lead">
          It keeps track of what you're learning and notices what you can already do, so every session picks up where the last one left off.
        </p>
        <div className="welcome-foot">
          <span>
            <Icon name="lock" size={15} /> Records stay on this Mac
          </span>
          <span>
            <Icon name="spark" size={15} /> Free and open source
          </span>
        </div>
      </div>

      <div className="welcome-r">
        <section className="card wcard" aria-label="Set up Sayfern">
          <div className="wsteps">
            <Step n={1} title="Connect a model" state={step === 0 ? "current" : "done"} summary={modelSummary} onChange={() => setStep(0)}>
              <p className="wstep-sub">Use your own API key or a supported subscription. You pay your provider directly.</p>
              <div className="wconnect">
                <Connect compact providers={app.providers} onChanged={app.refreshAuth} />
              </div>
            </Step>

            <Step
              n={2}
              title="Your languages"
              state={step === 1 ? "current" : step > 1 ? "done" : "todo"}
              summary={langSummary}
              onChange={() => setStep(1)}
            >
              <p className="wstep-sub">Pick one or both. Each gets its own records, level and library.</p>
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
              {ordered.map((l) => {
                const info = langInfo(l);
                return (
                  <div className="wlevel" key={l}>
                    <label htmlFor={`lv-${l}`}>Your {info?.name} level</label>
                    <select id={`lv-${l}`} className="input select" value={levels[l] ?? ""} onChange={(e) => setLevels((cur) => ({ ...cur, [l]: e.target.value }))}>
                      <option value="" disabled>
                        Choose a level
                      </option>
                      <option value={PLACE}>Not sure: find my level with a 5-minute chat</option>
                      {(info?.levels ?? []).map((lv) => (
                        <option key={lv} value={lv}>
                          {lv}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </Step>

            <Step n={3} title="Bring your materials" optional state={step === 2 ? "current" : "todo"}>
              <div className="field">
                <label htmlFor="ob-about">A few lines about you</label>
                <textarea
                  id="ob-about"
                  className="input ta"
                  rows={3}
                  value={about}
                  maxLength={2000}
                  placeholder="What you do, what you like, why you're learning. Any language is fine."
                  onChange={(e) => setAbout(e.target.value)}
                />
              </div>
              <div className="wextras">
                <button className="chip" onClick={() => void finish(true)} disabled={busy}>
                  <Icon name="cards" size={14} />
                  Connect Anki
                </button>
                <span className="chip static">
                  <Icon name="library" size={14} />
                  Textbooks and readers: add them in Library
                </span>
              </div>
            </Step>
          </div>

          {error && (
            <p className="err" role="alert">
              <Icon name="alert" size={15} /> {error}
            </p>
          )}
          <div className="wfoot">
            <span className="muted small">You can change any of this in Settings.</span>
            {step > 0 && (
              <button className="btn" onClick={() => setStep(step - 1)} disabled={busy}>
                Back
              </button>
            )}
            <button className="btn btn-p btn-l" onClick={next} disabled={!canContinue || busy}>
              {busy ? "Setting up…" : step === 2 ? (ordered.some((l) => levels[l] === PLACE) ? "Start level chat" : "Start practising") : "Continue"}
              <Icon name="arrow" size={17} stroke={2} />
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function Step({
  n,
  title,
  state,
  summary,
  optional,
  onChange,
  children,
}: {
  n: number;
  title: string;
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
            {optional && <span className="muted"> · optional</span>}
          </h2>
          {state === "done" && onChange && (
            <button className="linkb" onClick={onChange} aria-label={`Change: ${title}`}>
              Change
            </button>
          )}
        </div>
        {state === "done" && summary && <p className="wstep-sum">{summary}</p>}
        {state === "current" && <div className="wstep-body">{children}</div>}
      </div>
    </div>
  );
}
