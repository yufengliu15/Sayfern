// Course: the ordered path of units for a language, grouped by level. Status is computed in core
// from the learner's grammar records. Every unit is open; "Up next" is only a suggestion.
//
// Layout: a syllabus map (one dot per grammar point, by level; the level tiles pick the level shown),
// the "Up next" card, then the chosen level's units as a grid. A unit opens in a side drawer that
// lists every point with the learner's state and asks whether to go over the grammar first.
import { useEffect, useMemo, useRef, useState } from "react";
import type { CourseView, UnitPointView, UnitStatus, UnitView } from "../../../shared/course";
import type { GrammarState, Language } from "../../../shared/records";
import { api, errorText } from "../api";
import { Icon } from "../components/icons";
import { useApp } from "../context";
import { cjkClass, cls } from "../lib/format";
import { sessionRoute, type Navigate } from "../router";
import { langName, levelLabel, t, tc } from "../i18n";

export interface CourseScreenProps {
  language: Language;
  navigate: Navigate;
}

const STATUS_LABEL: Record<UnitStatus, () => string> = {
  done: () => tc("course unit status", "Done"),
  started: () => tc("course unit status", "In progress"),
  new: () => tc("course unit status", "New"),
};

type PointState = GrammarState | "new";
const POINT_STATES: PointState[] = ["new", "introduced", "with_help", "independent"];
const POINT_LABEL: Record<PointState, () => string> = {
  new: () => tc("course unit status", "New"),
  introduced: () => t("Introduced"),
  with_help: () => t("With help"),
  independent: () => t("On your own"),
};
const pointState = (p: UnitPointView): PointState => p.state ?? "new";

/** Dot pitch in the syllabus map (6px dot + 2px gap) and the width the whole map aims for. */
const DOT_PITCH = 8;
const MAP_WIDTH = 900;

export function CourseScreen({ language, navigate }: CourseScreenProps) {
  const app = useApp();
  const L = app.lang.fontClass;
  const [course, setCourse] = useState<CourseView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

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

  useEffect(() => {
    setPicked(null);
    setOpenId(null);
  }, [language]);

  const units = useMemo(() => course?.levels.flatMap((l) => l.units) ?? [], [course]);
  const next = units.find((u) => u.id === course?.nextUnitId);
  const open = units.find((u) => u.id === openId) ?? null;

  const start = async (id: string, explain: boolean) => {
    setBusy(id);
    setError(null);
    try {
      const v = await api.startUnit(id, { explain });
      await app.refreshSessions();
      navigate(sessionRoute(v.meta.id));
    } catch (e) {
      setError(errorText(e));
      setOpenId(null);
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

  const level = course.levels.find((l) => l.level === picked) ?? course.levels.find((l) => l.level === (next?.level ?? course.learnerLevel)) ?? course.levels[0];
  const allPoints = units.flatMap((u) => u.points);
  const solid = allPoints.filter((p) => p.state === "independent").length;
  const unitsDone = units.filter((u) => u.status === "done").length;

  return (
    <main className="main page cr">
      <div className="page-drag drag" />
      <div className="page-in cr-in">
        <header className="cr-head">
          <div className="cr-head-t">
            <div className="eyebrow">{t("{language} · Course", { language: langName(language) })}</div>
            <h1 className="display">{t("Your path.")}</h1>
            <p className="page-sub">
              {t(course.basis)}
              {course.learnerLevel && <> · {t("Your level: {level}", { level: levelLabel(course.learnerLevel) })}</>}
            </p>
          </div>
          <div className="cr-stats">
            <Ring value={allPoints.length ? solid / allPoints.length : 0} />
            <div className="cr-stats-t">
              <span>{t("{solid} of {total} patterns on your own", { solid: solid.toLocaleString(), total: allPoints.length.toLocaleString() })}</span>
              <span className="muted">{t("{done} of {total} units done", { done: unitsDone, total: units.length })}</span>
            </div>
          </div>
        </header>

        {error && (
          <p className="err" role="alert">
            <Icon name="alert" size={15} /> {t(error)}
          </p>
        )}

        {next && <NextCard unit={next} fontClass={L} disabled={busy !== null} onOpen={() => setOpenId(next.id)} />}

        <SyllabusMap course={course} total={allPoints.length} picked={level.level} nextId={course.nextUnitId} onPick={setPicked} />

        <section className="cr-level" aria-label={level.level}>
          <header className="cr-lh">
            <h2>{levelLabel(level.level)}</h2>
            <span className="muted">
              {t("{done} of {total} units done", { done: level.units.filter((u) => u.status === "done").length, total: level.units.length })}
              {" · "}
              {t("{solid} of {total} patterns on your own", {
                solid: level.units.reduce((n, u) => n + u.solid, 0),
                total: level.units.reduce((n, u) => n + u.total, 0),
              })}
            </span>
          </header>
          <ol className="cr-grid">
            {level.units.map((u, i) => (
              <UnitCard key={u.id} unit={u} index={i + 1} fontClass={L} busy={busy === u.id} disabled={busy !== null} onOpen={() => setOpenId(u.id)} />
            ))}
          </ol>
        </section>
      </div>
      {open && <UnitDrawer unit={open} fontClass={L} busy={busy === open.id} onStart={(explain) => void start(open.id, explain)} onClose={() => setOpenId(null)} />}
    </main>
  );
}

/** Share of points used on their own, as a ring with the percentage in the middle. */
function Ring({ value }: { value: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const pct = value > 0 && value < 0.01 ? "<1" : String(Math.round(value * 100));
  return (
    <svg className="cr-ring" viewBox="0 0 84 84" aria-hidden="true">
      <circle cx="42" cy="42" r={r} className="cr-ring-bg" />
      <circle cx="42" cy="42" r={r} className="cr-ring-fg" strokeDasharray={`${Math.max(value * c, value > 0 ? 2 : 0)} ${c}`} />
      <text x="42" y="42" dominantBaseline="central" textAnchor="middle">
        {pct}%
      </text>
    </svg>
  );
}

/** Every grammar point of the course, one dot each, grouped by level. A level tile picks the level shown below. */
function SyllabusMap({ course, total, picked, nextId, onPick }: { course: CourseView; total: number; picked: string; nextId?: string; onPick: (level: string) => void }) {
  const rows = Math.max(5, Math.ceil((total * DOT_PITCH) / MAP_WIDTH));
  return (
    <nav className="cr-map" aria-label={t("Course")}>
      <div className="cr-tiles">
        {course.levels.map((lv) => {
          const points = lv.units.flatMap((u) => u.points.map((p) => ({ p, next: u.id === nextId, title: u.title })));
          const own = points.filter(({ p }) => p.state === "independent").length;
          return (
            <button key={lv.level} className={cls("cr-tile", lv.level === picked && "on")} aria-pressed={lv.level === picked} onClick={() => onPick(lv.level)}>
              <span className="cr-tile-h">
                <b>{lv.level}</b>
                <span>
                  {own}/{points.length}
                </span>
              </span>
              <span className="cr-dots" style={{ gridTemplateRows: `repeat(${rows}, 6px)` }} aria-hidden="true">
                {points.map(({ p, next, title }) => (
                  <i key={p.id} className={cls(pointState(p), next && "nx")} title={`${p.pattern} · ${t(title)}`} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="cr-legend" aria-hidden="true">
        {POINT_STATES.map((s) => (
          <span key={s}>
            <i className={s} /> {POINT_LABEL[s]()}
          </span>
        ))}
        <span>
          <i className="new nx" /> {t("Up next")}
        </span>
      </div>
    </nav>
  );
}

/** One segment per point, filled by the learner's state. */
function Segments({ points, dark }: { points: UnitPointView[]; dark?: boolean }) {
  return (
    <span className={cls("cr-seg", dark && "dark")} aria-hidden="true">
      {points.map((p) => (
        <i key={p.id} className={pointState(p)} />
      ))}
    </span>
  );
}

/** The unit's patterns as chips; past `max`, one "+N" chip lists the rest on hover. */
function Chips({ points, fontClass, max = points.length }: { points: UnitPointView[]; fontClass: string; max?: number }) {
  const shown = points.length > max ? points.slice(0, max - 1) : points;
  const rest = points.slice(shown.length);
  return (
    <ul className="cr-chips">
      {shown.map((p) => (
        <li key={p.id} className={cls("cr-chip", pointState(p), cjkClass(p.pattern, fontClass))} title={p.name}>
          {p.pattern}
        </li>
      ))}
      {rest.length > 0 && (
        <li className="cr-chip more" title={rest.map((p) => p.pattern).join(" · ")}>
          +{rest.length}
        </li>
      )}
    </ul>
  );
}

function NextCard({ unit, fontClass, disabled, onOpen }: { unit: UnitView; fontClass: string; disabled: boolean; onOpen: () => void }) {
  return (
    <section className="cr-next-card">
      <span className="cr-next-bg" aria-hidden="true">
        {unit.level}
      </span>
      <div className="cr-next-t">
        <div className="eyebrow">
          <span className="cr-pulse" aria-hidden="true" /> {t("Up next")} · {unit.level}
        </div>
        <h2>{t(unit.title)}</h2>
        <Chips points={unit.points} fontClass={fontClass} />
      </div>
      <div className="cr-next-r">
        <span className="cr-next-p">
          <Segments points={unit.points} dark />
          <span className="cr-next-m">{t("{solid} of {total} patterns on your own", { solid: unit.solid, total: unit.total })}</span>
        </span>
        <button className="btn btn-l cr-next-b" disabled={disabled} onClick={onOpen}>
          {t("Continue: {unit}", { unit: t(unit.title) })} <Icon name="arrow" size={17} stroke={2} />
        </button>
      </div>
    </section>
  );
}

function UnitCard({ unit, index, fontClass, busy, disabled, onOpen }: { unit: UnitView; index: number; fontClass: string; busy: boolean; disabled: boolean; onOpen: () => void }) {
  return (
    <li className={cls("cr-u", unit.status, unit.next && "next")}>
      <button className="cr-card" disabled={disabled} onClick={onOpen}>
        <span className="cr-card-h">
          <span className="cr-idx" aria-hidden="true">
            {String(index).padStart(2, "0")}
          </span>
          <b className="cr-title">{t(unit.title)}</b>
          {unit.next ? <span className="cr-badge">{t("Up next")}</span> : <span className={cls("cr-st", unit.status)}>{busy ? t("Starting…") : STATUS_LABEL[unit.status]()}</span>}
        </span>
        <Segments points={unit.points} />
        <Chips points={unit.points} fontClass={fontClass} max={6} />
        <span className="cr-meta">
          {t("{solid} of {total} patterns on your own", { solid: unit.solid, total: unit.total })}
          <Icon name="arrow" size={15} stroke={2} />
        </span>
      </button>
    </li>
  );
}

function UnitDrawer({ unit, fontClass, busy, onStart, onClose }: { unit: UnitView; fontClass: string; busy: boolean; onStart: (explain: boolean) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  return (
    <div className="overlay cr-scrim" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <aside className="cr-drawer" role="dialog" aria-modal="true" aria-labelledby="cr-drawer-title" tabIndex={-1} ref={ref}>
        <header className="cr-dr-h">
          <div>
            <div className="eyebrow">
              {unit.level} · {STATUS_LABEL[unit.status]()}
            </div>
            <h2 id="cr-drawer-title">{t(unit.title)}</h2>
          </div>
          <button className="iconb" onClick={onClose} disabled={busy} aria-label={t("Close")}>
            <Icon name="x" />
          </button>
        </header>
        <div className="cr-dr-prog">
          <Segments points={unit.points} />
          <span className="muted">{t("{solid} of {total} patterns on your own", { solid: unit.solid, total: unit.total })}</span>
        </div>
        <ol className="cr-pts">
          {unit.points.map((p, i) => (
            <li key={p.id} className={cls("cr-pt", pointState(p))} style={{ animationDelay: `${i * 22}ms` }}>
              <span className="cr-pt-n" aria-hidden="true">
                {i + 1}
              </span>
              <span className="cr-pt-b">
                <span className={cls("cr-pt-p", cjkClass(p.pattern, fontClass))}>{p.pattern}</span>
                <span className="cr-pt-name">{p.name}</span>
              </span>
              <span className={cls("cr-pt-s", pointState(p))}>
                <i /> {POINT_LABEL[pointState(p)]()}
              </span>
            </li>
          ))}
        </ol>
        <footer className="cr-dr-f">
          <p className="cr-ask-q">{t("Go over this unit's grammar quickly first?")}</p>
          <p className="muted cr-ask-n">{t("The tutor gives a short summary of each pattern, then starts the conversation. It is a reminder, not a replacement for your textbook.")}</p>
          <div className="cr-ask-a">
            <button className="btn btn-p" disabled={busy} onClick={() => onStart(true)}>
              {busy ? t("Starting…") : t("Yes, go over it")}
            </button>
            <button className="btn btn-f" disabled={busy} onClick={() => onStart(false)}>
              {t("No, start talking")}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
