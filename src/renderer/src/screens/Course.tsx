// Course: the ordered path of units for a language, grouped by level. Status is computed in core
// from the learner's grammar records. Every unit is open; "Up next" is only a suggestion.
import { useEffect, useState } from "react";
import type { CourseView, UnitStatus, UnitView } from "../../../shared/course";
import type { Language } from "../../../shared/records";
import { api, errorText } from "../api";
import { Icon } from "../components/icons";
import { useApp } from "../context";
import { cls } from "../lib/format";
import { sessionRoute, type Navigate } from "../router";
import { langName, t, tc } from "../i18n";

export interface CourseScreenProps {
  language: Language;
  navigate: Navigate;
}

const STATUS_LABEL: Record<UnitStatus, () => string> = {
  done: () => tc("course unit status", "Done"),
  started: () => tc("course unit status", "In progress"),
  new: () => tc("course unit status", "New"),
};

export function CourseScreen({ language, navigate }: CourseScreenProps) {
  const app = useApp();
  const L = app.lang.fontClass;
  const [course, setCourse] = useState<CourseView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getCourse(language)
      .then((c) => alive && setCourse(c))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [language, app.sessions]);

  const start = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const v = await api.startUnit(id);
      await app.refreshSessions();
      navigate(sessionRoute(v.meta.id));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  if (!course) {
    return (
      <main className="main page">
        <div className="page-drag drag" />
        <div className="page-in">
          <div className="eyebrow">{t("{language} · Course", { language: langName(language) })}</div>
          {error ? <p className="err">{t(error)}</p> : <div className="skel-h" />}
        </div>
      </main>
    );
  }

  if (!course.available) {
    return (
      <main className="main">
        <header className="hdr drag" />
        <div className="placeholder">
          <span className="ph-i">
            <Icon name="course" size={26} />
          </span>
          <div className="eyebrow">{t("{language} · Course", { language: langName(language) })}</div>
          <h1>{t("No course for {language} yet.", { language: langName(language) })}</h1>
          <p className="muted ph-p">{t("The tutor still works, but it has no level-by-level plan for this language, so results may vary.")}</p>
          <button className="btn btn-p" onClick={() => void app.startSession()}>
            {t("Start a conversation")} <Icon name="arrow" size={16} stroke={2} />
          </button>
        </div>
      </main>
    );
  }

  const units = course.levels.flatMap((l) => l.units);
  const next = units.find((u) => u.id === course.nextUnitId);

  return (
    <main className="main page cr">
      <div className="page-drag drag" />
      <div className="page-in">
        <header className="page-head">
          <div>
            <div className="eyebrow">{t("{language} · Course", { language: langName(language) })}</div>
            <h1 className="display">{t("Your path.")}</h1>
            <p className="page-sub">
              {t(course.basis)}
              {course.learnerLevel && <> · {t("Your level: {level}", { level: course.learnerLevel })}</>}
            </p>
          </div>
          {next && (
            <div className="page-actions">
              <button className="btn btn-l btn-p" disabled={busy !== null} onClick={() => void start(next.id)}>
                {t("Continue: {unit}", { unit: t(next.title) })} <Icon name="arrow" size={17} stroke={2} />
              </button>
            </div>
          )}
        </header>
        {error && (
          <p className="err" role="alert">
            <Icon name="alert" size={15} /> {t(error)}
          </p>
        )}
        <div className="cr-path">
          {course.levels.map((lv) => (
            <section key={lv.level} className="cr-level" aria-label={lv.level}>
              <h2 className="cr-lh">
                <span>{lv.level}</span>
                <small>{t("{done} of {total} units done", { done: lv.units.filter((u) => u.status === "done").length, total: lv.units.length })}</small>
              </h2>
              <ol className="cr-units">
                {lv.units.map((u) => (
                  <UnitCard key={u.id} unit={u} fontClass={L} busy={busy === u.id} disabled={busy !== null} onStart={() => void start(u.id)} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}

function UnitCard({ unit, fontClass, busy, disabled, onStart }: { unit: UnitView; fontClass: string; busy: boolean; disabled: boolean; onStart: () => void }) {
  return (
    <li className={cls("cr-u", unit.status, unit.next && "next")}>
      <button className="cr-card" disabled={disabled} onClick={onStart}>
        <span className="cr-dot" aria-hidden="true">
          {unit.status === "done" && <Icon name="check" size={12} stroke={3} />}
        </span>
        <span className="cr-body">
          <span className="cr-top">
            <b className="cr-title">{t(unit.title)}</b>
            {unit.next && <span className="cr-next">{t("Up next")}</span>}
          </span>
          <span className={cls("cr-pats", fontClass)}>{unit.patterns.join(" · ")}</span>
          <span className="cr-meta">
            <span className={cls("cr-st", unit.status)}>{busy ? t("Starting…") : STATUS_LABEL[unit.status]()}</span>
            <span>{t("{solid} of {total} patterns on your own", { solid: unit.solid, total: unit.total })}</span>
          </span>
        </span>
        <Icon name="chevR" size={16} stroke={2} />
      </button>
    </li>
  );
}
