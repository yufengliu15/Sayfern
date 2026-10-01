// Home (S1-02): resume card, start tiles, placement prompt, this week's numbers.
import { useEffect, useState } from "react";
import type { HomeView } from "../../../shared/api";
import type { Language, Skill } from "../../../shared/records";
import { api, errorText } from "../api";
import { Icon } from "../components/icons";
import { useApp } from "../context";
import { cls, fmtDuration, fmtNumber, fmtShortDate, KIND_LABEL } from "../lib/format";
import { grammarRoute, sessionRoute, settingsRoute, type Navigate } from "../router";

export interface TodayScreenProps {
  language: Language;
  navigate: Navigate;
}

const SKILL_LABEL: Record<Skill, string> = { reading: "Reading", recognition: "Recognition", writing: "Writing" };

export function TodayScreen({ language, navigate }: TodayScreenProps) {
  const app = useApp();
  const [home, setHome] = useState<HomeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getHome(language)
      .then((h) => alive && setHome(h))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [language, app.sessions]);

  const L = app.lang.fontClass;
  const now = new Date();
  const dateLine = `${now.toLocaleDateString("en-US", { weekday: "long" })} · ${now.toLocaleDateString("en-US", { month: "long", day: "numeric" })}`;

  const act = async (key: string, fn: () => Promise<{ meta: { id: string } }>) => {
    setBusy(key);
    try {
      const v = await fn();
      await app.refreshSessions();
      navigate(sessionRoute(v.meta.id));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  if (!home) {
    return (
      <main className="main today">
        <div className="today-drag drag" />
        <div className="today-l">
          <div className="eyebrow">{dateLine}</div>
          {error ? <p className="err">{error}</p> : <div className="skel-h" />}
        </div>
      </main>
    );
  }

  const r = home.resume;
  const headline = r ? "Pick up where you left off." : home.needsPlacement ? "Let's find your level first." : "What shall we practise today?";
  const maxDay = Math.max(1, ...home.week.daily.map((d) => d.activeMs));
  const queued = home.followUps.length + (home.reading ? 1 : 0) + (home.targets.length ? 1 : 0);
  const levels = (Object.entries(home.levels) as [Skill, NonNullable<HomeView["levels"][Skill]>][]).filter(([, v]) => v);

  return (
    <main className="main today">
      <div className="today-drag drag" />
      <div className="today-l">
        <div className="eyebrow">{dateLine}</div>
        <h1 className="display">{headline}</h1>

        <section className="hero" aria-label={r ? "Continue your session" : "Next session"}>
          <div className={cls("ghost", L)} aria-hidden="true">
            {r ? [...r.session.title][0] : app.lang.glyph}
          </div>
          <div className="hero-eye">{r ? `Continue · ${KIND_LABEL[r.session.kind]}` : "Next session"}</div>
          <div className="hero-title">
            {r ? <span className={cls("t", L)}>{r.session.title}</span> : <span className="serif-t">A fresh conversation</span>}
            {r && <span className="when">{fmtShortDate(r.session.updatedAt)}</span>}
          </div>
          {r?.lastTutorLine && (
            <p className={cls("hero-line", L)}>
              <Icon name="quote" size={14} />
              <span>{r.lastTutorLine}</span>
            </p>
          )}

          <div className="queue">
            {home.followUps.map((g) => (
              <button key={g.point.id} className="q" onClick={() => navigate(grammarRoute(g.point.id))}>
                <span className="qi">
                  <Icon name="grammar" size={17} />
                </span>
                <span className="qt">
                  <span className="q1">
                    Bring back <span className={L}>{g.point.pattern}</span> naturally
                  </span>
                  <span className="q2">The tutor asks a question that invites it, without showing the pattern</span>
                </span>
              </button>
            ))}
            {home.reading && (
              <button className="q" onClick={() => void act("reading", () => api.openReading(home.reading!.doc.id))}>
                <span className="qi">
                  <Icon name="library" size={17} />
                </span>
                <span className="qt">
                  <span className="q1">
                    {home.reading.doc.title} · paragraph {home.reading.paragraph + 1}
                  </span>
                  <span className={cls("q2 clamp", L)}>{home.reading.preview}</span>
                </span>
              </button>
            )}
            {home.targets.length > 0 && (
              <div className="q">
                <span className="qi">
                  <Icon name="cards" size={17} />
                </span>
                <span className="qt">
                  <span className="q1">
                    {home.targets.length} word{home.targets.length === 1 ? "" : "s"} from this week's Anki
                  </span>
                  <span className={cls("q2 words", L)}>{home.targets.map((t) => t.word).join(" · ")}</span>
                </span>
              </div>
            )}
            {queued === 0 && (
              <div className="q">
                <span className="qi">
                  <Icon name="spark" size={17} />
                </span>
                <span className="qt">
                  <span className="q1">Nothing queued yet</span>
                  <span className="q2">As you talk, the tutor notes patterns and words worth bringing back.</span>
                </span>
              </div>
            )}
          </div>

          <div className="hero-actions">
            {r ? (
              <>
                <button className="btn btn-l btn-light" onClick={() => navigate(sessionRoute(r.session.id))}>
                  Continue session <Icon name="arrow" size={17} stroke={2} />
                </button>
                <button className="btn btn-l btn-ghost" disabled={busy === "new"} onClick={() => void act("new", () => api.newSession({ language, kind: "chat" }))}>
                  <Icon name="plus" size={17} stroke={2} />
                  New session
                </button>
              </>
            ) : (
              <button className="btn btn-l btn-light" disabled={busy === "new"} onClick={() => void act("new", () => api.newSession({ language, kind: "chat" }))}>
                Start a session <Icon name="arrow" size={17} stroke={2} />
              </button>
            )}
          </div>
        </section>

        {home.needsPlacement && (
          <section className="place card" aria-label="Find your level">
            <span className="place-i">
              <Icon name="compass" size={22} />
            </span>
            <div className="place-t">
              <h2>Find your level</h2>
              <p>A 5-minute chat so the tutor can pitch everything right. No test, no score to worry about.</p>
            </div>
            <div className="place-a">
              <button className="btn btn-f" disabled={busy === "placement"} onClick={() => void act("placement", () => api.startPlacement(language))}>
                {busy === "placement" ? "Starting…" : "5-minute chat"}
              </button>
              <button className="linkb" onClick={() => navigate(settingsRoute("languages"))}>
                I know my level
              </button>
            </div>
          </section>
        )}

        <div className="eyebrow sub">Or start something different</div>
        <div className="tiles">
          <button className="tile" disabled={busy === "talk"} onClick={() => void act("talk", () => api.newSession({ language, kind: "chat" }))}>
            <span className="ti">
              <Icon name="sessions" size={22} />
            </span>
            <span className="tt">Just talk</span>
            <span className="td">About your day, at your level</span>
          </button>
          <button
            className="tile"
            disabled={busy === "reading"}
            onClick={() => (home.reading ? void act("reading", () => api.openReading(home.reading!.doc.id)) : navigate("library"))}
          >
            <span className="ti">
              <Icon name="library" size={22} />
            </span>
            <span className="tt">Read together</span>
            <span className="td">{home.reading ? `Continue ${home.reading.doc.title}` : "A passage from your library"}</span>
          </button>
          <button className="tile" onClick={() => navigate("grammar")}>
            <span className="ti">
              <Icon name="grammar" size={22} />
            </span>
            <span className="tt">Practise a pattern</span>
            <span className="td">Pick one from Grammar</span>
          </button>
        </div>
        {error && (
          <p className="err" role="alert">
            <Icon name="alert" size={15} /> {error}
          </p>
        )}
      </div>

      <aside className="today-r" aria-label="This week">
        <div className="eyebrow">This week</div>
        <div className="stat">
          <b>{fmtDuration(home.week.activeMs)}</b>
          <span>Active practice · idle time left out</span>
          <div className="mini" role="img" aria-label="Minutes practised per day this week">
            {home.week.daily.map((d) => {
              const pct = Math.round((d.activeMs / maxDay) * 100);
              const date = new Date(`${d.date}T12:00:00`);
              return (
                <div key={d.date} className="mini-col" title={`${date.toLocaleDateString("en-US", { weekday: "short" })}: ${fmtDuration(d.activeMs)}`}>
                  <i className={d.activeMs === 0 ? "zero" : undefined} style={{ height: `${Math.max(pct, 4)}%` }} />
                  <span>{date.toLocaleDateString("en-US", { weekday: "narrow" })}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="stat">
          <b>{fmtNumber(home.week.wordsWritten)}</b>
          <span>Words you wrote · {fmtNumber(home.week.distinctWords)} different</span>
        </div>
        <div className="stat last">
          <b>{fmtNumber(home.week.firstUsed)}</b>
          <span>Words you used for the first time</span>
        </div>

        {levels.length > 0 && (
          <>
            <div className="eyebrow sub">Your level</div>
            <div className="levels">
              {levels.map(([skill, est]) => (
                <span key={skill} className="lvl" title={est.evidence}>
                  <span className="muted">{SKILL_LABEL[skill]}</span> <b>{est.level}</b>
                </span>
              ))}
            </div>
          </>
        )}

        <div className="eyebrow sub">Recent sessions</div>
        {home.recent.length === 0 && <p className="muted small">Your conversations will show up here.</p>}
        <div className="rs-list">
          {home.recent.slice(0, 5).map((s) => (
            <button key={s.id} className="rs" onClick={() => navigate(sessionRoute(s.id))}>
              <span className={cls("rs-t", L)}>{s.title}</span>
              <span className="rs-k">{KIND_LABEL[s.kind]}</span>
              <span className="rs-d">{fmtShortDate(s.updatedAt)}</span>
            </button>
          ))}
        </div>
      </aside>
    </main>
  );
}
