// Home (S1-02): resume card, start tiles, placement prompt, this week's numbers.
import { useEffect, useState } from "react";
import type { HomeView } from "../../../shared/api";
import type { CourseView } from "../../../shared/course";
import type { Language, Skill } from "../../../shared/records";
import { SCENARIOS } from "../../../shared/scenarios";
import { api, errorText } from "../api";
import { Icon } from "../components/icons";
import { PlacementStart } from "../components/PlacementStart";
import { UnitStart } from "../components/UnitStart";
import { useApp } from "../context";
import { cls, fmtDuration, fmtNumber, fmtShortDate, KIND_LABEL } from "../lib/format";
import { grammarRoute, sessionRoute, settingsRoute, type Navigate } from "../router";
import { intlLocale, msg, t, tj, tn } from "../i18n";

export interface TodayScreenProps {
  language: Language;
  navigate: Navigate;
}

const SKILL_LABEL: Record<Skill, string> = { reading: msg("Reading"), recognition: msg("Recognition"), writing: msg("Writing") };

export function TodayScreen({ language, navigate }: TodayScreenProps) {
  const app = useApp();
  const [home, setHome] = useState<HomeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [course, setCourse] = useState<CourseView | null>(null);
  const [askUnit, setAskUnit] = useState(false);
  const [askBand, setAskBand] = useState(false);

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

  useEffect(() => {
    let alive = true;
    api
      .getCourse(language)
      .then((c) => alive && setCourse(c))
      .catch(() => alive && setCourse(null));
    return () => {
      alive = false;
    };
  }, [language, app.sessions]);

  const L = app.lang.fontClass;
  const now = new Date();
  const dateLine = `${now.toLocaleDateString(intlLocale(), { weekday: "long" })} · ${now.toLocaleDateString(intlLocale(), { month: "long", day: "numeric" })}`;

  const act = async (key: string, fn: () => Promise<{ meta: { id: string } }>) => {
    setBusy(key);
    try {
      const v = await fn();
      await app.refreshSessions();
      navigate(sessionRoute(v.meta.id));
    } catch (e) {
      setError(errorText(e));
      setAskUnit(false);
      setAskBand(false);
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
          {error ? <p className="err">{t(error)}</p> : <div className="skel-h" />}
        </div>
      </main>
    );
  }

  const r = home.resume;
  const headline = r ? t("Pick up where you left off.") : home.needsPlacement ? t("Let's find your level first.") : t("What shall we practise today?");
  const nextUnit = course?.levels.flatMap((l) => l.units).find((u) => u.id === course.nextUnitId);
  const maxDay = Math.max(1, ...home.week.daily.map((d) => d.activeMs));
  const queued = home.followUps.length + (home.reading ? 1 : 0) + (home.targets.length ? 1 : 0);
  const levels = (Object.entries(home.levels) as [Skill, NonNullable<HomeView["levels"][Skill]>][]).filter(([, v]) => v);

  return (
    <main className="main today">
      <div className="today-drag drag" />
      <div className="today-l">
        <div className="eyebrow">{dateLine}</div>
        <h1 className="display">{headline}</h1>

        <section className="hero" aria-label={r ? t("Continue your session") : t("Next session")}>
          <div className={cls("ghost", L)} aria-hidden="true">
            {r ? [...r.session.title][0] : app.lang.glyph}
          </div>
          <div className="hero-eye">{r ? t("Continue · {kind}", { kind: t(KIND_LABEL[r.session.kind]) }) : t("Next session")}</div>
          <div className="hero-title">
            {r ? <span className={cls("t", L)}>{r.session.title}</span> : <span className="serif-t">{t("A fresh conversation")}</span>}
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
                    {tj("Bring back {pattern} naturally", { pattern: <span className={L}>{g.point.pattern}</span> })}
                  </span>
                  <span className="q2">{t("The tutor asks a question that invites it, without showing the pattern")}</span>
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
                    {t("{title} · paragraph {n}", { title: home.reading.doc.title, n: home.reading.paragraph + 1 })}
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
                    {tn(home.targets.length, "{count} word from this week's Anki", "{count} words from this week's Anki")}
                  </span>
                  <span className={cls("q2 words", L)}>{home.targets.map((x) => x.word).join(" · ")}</span>
                </span>
              </div>
            )}
            {queued === 0 && (
              <div className="q">
                <span className="qi">
                  <Icon name="spark" size={17} />
                </span>
                <span className="qt">
                  <span className="q1">{t("Nothing queued yet")}</span>
                  <span className="q2">{t("As you talk, the tutor notes patterns and words worth bringing back.")}</span>
                </span>
              </div>
            )}
          </div>

          <div className="hero-actions">
            {r ? (
              <>
                <button className="btn btn-l btn-light" onClick={() => navigate(sessionRoute(r.session.id))}>
                  {t("Continue session")} <Icon name="arrow" size={17} stroke={2} />
                </button>
                <button className="btn btn-l btn-ghost" disabled={busy === "new"} onClick={() => void act("new", () => api.newSession({ language, kind: "chat" }))}>
                  <Icon name="plus" size={17} stroke={2} />
                  {t("New session")}
                </button>
              </>
            ) : (
              <button className="btn btn-l btn-light" disabled={busy === "new"} onClick={() => void act("new", () => api.newSession({ language, kind: "chat" }))}>
                {t("Start a session")} <Icon name="arrow" size={17} stroke={2} />
              </button>
            )}
          </div>
        </section>

        {nextUnit && (
          <section className="place card" aria-label={t("Course")}>
            <span className="place-i">
              <Icon name="course" size={22} />
            </span>
            <div className="place-t">
              <h2>{t("Course · Up next: {unit} ({level})", { unit: t(nextUnit.title), level: nextUnit.level })}</h2>
            </div>
            <div className="place-a">
              <button className="btn btn-f" disabled={busy === "unit"} onClick={() => setAskUnit(true)}>
                {busy === "unit" ? t("Starting…") : t("Start unit")}
              </button>
              <button className="linkb" onClick={() => navigate("course")}>
                {t("See the course")}
              </button>
            </div>
          </section>
        )}

        {home.needsPlacement && (
          <section className="place card" aria-label={t("Find your level")}>
            <span className="place-i">
              <Icon name="compass" size={22} />
            </span>
            <div className="place-t">
              <h2>{t("Find your level")}</h2>
              <p>{t("A 5-minute chat so the tutor can pitch everything right. No test, no score to worry about.")}</p>
            </div>
            <div className="place-a">
              <button className="btn btn-f" disabled={busy === "placement"} onClick={() => setAskBand(true)}>
                {t("5-minute chat")}
              </button>
              <button className="linkb" onClick={() => navigate(settingsRoute("languages"))}>
                {t("I know my level")}
              </button>
            </div>
          </section>
        )}

        <div className="eyebrow sub">{t("Or start something different")}</div>
        <div className="tiles">
          <button className="tile" disabled={busy === "talk"} onClick={() => void act("talk", () => api.newSession({ language, kind: "chat" }))}>
            <span className="ti">
              <Icon name="sessions" size={22} />
            </span>
            <span className="tt">{t("Just talk")}</span>
            <span className="td">{t("About your day, at your level")}</span>
          </button>
          <button
            className="tile"
            disabled={busy === "reading"}
            onClick={() => (home.reading ? void act("reading", () => api.openReading(home.reading!.doc.id)) : navigate("library"))}
          >
            <span className="ti">
              <Icon name="library" size={22} />
            </span>
            <span className="tt">{t("Read together")}</span>
            <span className="td">{home.reading ? t("Continue {title}", { title: home.reading.doc.title }) : t("A passage from your library")}</span>
          </button>
          <button className="tile" onClick={() => navigate("grammar")}>
            <span className="ti">
              <Icon name="grammar" size={22} />
            </span>
            <span className="tt">{t("Practise a pattern")}</span>
            <span className="td">{t("Pick one from Grammar")}</span>
          </button>
        </div>

        <div className="eyebrow sub">{t("Role-play a situation")}</div>
        <div className="tiles scen">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              className="tile"
              disabled={busy === `scenario:${s.id}`}
              onClick={() => void act(`scenario:${s.id}`, () => api.newSession({ language, kind: "chat", scenarioId: s.id }))}
            >
              <span className="ti">
                <Icon name={s.icon} size={20} />
              </span>
              <span className="tt">{t(s.title)}</span>
              <span className="td">{t(s.description)}</span>
            </button>
          ))}
        </div>
        {error && (
          <p className="err" role="alert">
            <Icon name="alert" size={15} /> {t(error)}
          </p>
        )}
      </div>

      <aside className="today-r" aria-label={t("This week")}>
        <div className="eyebrow">{t("This week")}</div>
        <div className="stat">
          <b>{fmtDuration(home.week.activeMs)}</b>
          <span>{t("Active practice · idle time left out")}</span>
          <div className="mini" role="img" aria-label={t("Minutes practised per day this week")}>
            {home.week.daily.map((d) => {
              const pct = Math.round((d.activeMs / maxDay) * 100);
              const date = new Date(`${d.date}T12:00:00`);
              return (
                <div key={d.date} className="mini-col" title={`${date.toLocaleDateString(intlLocale(), { weekday: "short" })}: ${fmtDuration(d.activeMs)}`}>
                  <i className={d.activeMs === 0 ? "zero" : undefined} style={{ height: `${Math.max(pct, 4)}%` }} />
                  <span>{date.toLocaleDateString(intlLocale(), { weekday: "narrow" })}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="stat">
          <b>{fmtNumber(home.week.wordsWritten)}</b>
          <span>{t("Words you wrote · {n} different", { n: home.week.distinctWords })}</span>
        </div>
        <div className="stat last">
          <b>{fmtNumber(home.week.firstUsed)}</b>
          <span>{t("Words you used for the first time")}</span>
        </div>

        {levels.length > 0 && (
          <>
            <div className="eyebrow sub">{t("Your level")}</div>
            <div className="levels">
              {levels.map(([skill, est]) => (
                <span key={skill} className="lvl" title={est.evidence}>
                  <span className="muted">{t(SKILL_LABEL[skill])}</span> <b>{est.level}</b>
                </span>
              ))}
            </div>
          </>
        )}

        <div className="eyebrow sub">{t("Recent sessions")}</div>
        {home.recent.length === 0 && <p className="muted small">{t("Your conversations will show up here.")}</p>}
        <div className="rs-list">
          {home.recent.slice(0, 5).map((s) => (
            <button key={s.id} className="rs" onClick={() => navigate(sessionRoute(s.id))}>
              <span className={cls("rs-t", L)}>{s.title}</span>
              <span className="rs-k">{t(KIND_LABEL[s.kind])}</span>
              <span className="rs-d">{fmtShortDate(s.updatedAt)}</span>
            </button>
          ))}
        </div>
      </aside>
      {askUnit && nextUnit && (
        <UnitStart
          unit={nextUnit}
          fontClass={L}
          busy={busy === "unit"}
          onStart={(explain) => void act("unit", () => api.startUnit(nextUnit.id, { explain }))}
          onClose={() => setAskUnit(false)}
        />
      )}
      {askBand && (
        <PlacementStart
          language={language}
          levels={app.lang.levels}
          busy={busy === "placement"}
          onStart={(band) => void act("placement", () => api.startPlacement(language, band))}
          onClose={() => setAskBand(false)}
        />
      )}
    </main>
  );
}
