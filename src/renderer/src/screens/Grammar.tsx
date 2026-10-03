// Grammar (S1-15..S1-20): the catalogue of patterns and one pattern's record: state ladder,
// locally computed counts, the pattern card, every attempt (disputable) and related corrections.
import { useEffect, useMemo, useState } from "react";
import type { GrammarDetail } from "../../../shared/api";
import type { Assistance, GrammarObservation, GrammarState, GrammarSummary, Language, SessionMeta, Verdict } from "../../../shared/records";
import { api, errorText } from "../api";
import { AnnotatedText } from "../components/AnnotatedText";
import { Icon, type IconName } from "../components/icons";
import { useApp } from "../context";
import { cjkClass, cls, fmtShortDate, STATE_LABEL } from "../lib/format";
import { grammarRoute, quizRoute, readerRoute, sessionRoute, type Navigate } from "../router";
import { langName, msg, t, tn } from "../i18n";

export interface GrammarScreenProps {
  language: Language;
  navigate: Navigate;
  /** Set for `grammar/:id`: show one pattern's detail. */
  grammarId?: string;
}

type Filter = "all" | GrammarState;
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: msg("All") },
  { id: "independent", label: msg("On your own") },
  { id: "with_help", label: msg("With help") },
  { id: "introduced", label: msg("Introduced") },
];
const STATE_ORDER: GrammarState[] = ["introduced", "with_help", "independent"];
const DOTS: Record<GrammarState, number> = { introduced: 1, with_help: 2, independent: 3 };

const VERDICT: Record<Verdict, { label: string; icon: IconName; cls: string }> = {
  correct: { label: msg("Correct"), icon: "check", cls: "ok" },
  incorrect: { label: msg("Incorrect"), icon: "x", cls: "bad" },
  uncertain: { label: msg("Unsure"), icon: "hint", cls: "unc" },
  unassessed: { label: msg("Not assessed"), icon: "stop", cls: "unc" },
};
const ASSIST: Record<Assistance, string> = { independent: msg("On your own"), prompted: msg("With a prompt"), corrected_retry: msg("Fixed on retry") };

export function Dots({ state }: { state: GrammarState }) {
  const n = DOTS[state];
  return (
    <span className="dots" role="img" aria-label={t(STATE_LABEL[state])}>
      {[0, 1, 2].map((i) => (
        <i key={i} className={i < n ? "f" : undefined} />
      ))}
    </span>
  );
}

export function GrammarScreen({ language, navigate, grammarId }: GrammarScreenProps) {
  const app = useApp();
  const L = app.lang.fontClass;
  const [list, setList] = useState<GrammarSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .listGrammar(language)
      .then((l) => {
        if (!alive) return;
        const recency = (g: GrammarSummary) => g.lastUsedAt ?? g.point.introducedAt ?? g.point.createdAt;
        setList([...l].sort((a, b) => recency(b) - recency(a)));
      })
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [language]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (list ?? []).filter(
      (g) =>
        (filter === "all" || g.state === filter) &&
        (!needle || g.point.pattern.toLowerCase().includes(needle) || g.point.name.toLowerCase().includes(needle) || (g.point.reading ?? "").toLowerCase().includes(needle)),
    );
  }, [list, q, filter]);

  const selected = grammarId ?? list?.[0]?.point.id;

  if (list && list.length === 0) {
    return (
      <main className="main">
        <header className="hdr drag" />
        <div className="placeholder">
          <span className="ph-i">
            <Icon name="grammar" size={26} />
          </span>
          <div className="eyebrow">{t("{language} · Grammar", { language: langName(language) })}</div>
          <h1>{t("No patterns yet.")}</h1>
          <p className="muted ph-p">
            {t("As you talk, the tutor notes each pattern you try and whether it landed. They collect here, with every sentence you used them in.")}
          </p>
          <button className="btn btn-p" onClick={() => void app.startSession()}>
            {t("Start a conversation")} <Icon name="arrow" size={16} stroke={2} />
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="main gram">
      <nav className="gcat" aria-label={t("Grammar patterns")}>
        <div className="gcat-drag drag" />
        <div className="search">
          <Icon name="search" size={16} />
          <label htmlFor="g-search" className="sr">
            {t("Search patterns")}
          </label>
          <input
            id="g-search"
            className="input"
            type="search"
            placeholder={list ? tn(list.length, "Search {count} pattern", "Search {count} patterns") : t("Search patterns")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="fchips" role="radiogroup" aria-label={t("Filter by state")}>
          {FILTERS.map((f) => (
            <button key={f.id} role="radio" aria-checked={filter === f.id} className={cls("fchip", filter === f.id && "on")} onClick={() => setFilter(f.id)}>
              {t(f.label)}
            </button>
          ))}
        </div>
        <ul className="gitems">
          {shown.map((g) => (
            <li key={g.point.id}>
              <button
                className={cls("gitem", g.point.id === selected && "on")}
                aria-current={g.point.id === selected ? "true" : undefined}
                onClick={() => navigate(grammarRoute(g.point.id))}
              >
                <span className="gitem-t">
                  <span className={cls("gitem-p", L)}>{g.point.pattern}</span>
                  <span className="gitem-n">{g.point.name}</span>
                </span>
                <Dots state={g.state} />
              </button>
            </li>
          ))}
          {list && shown.length === 0 && <li className="gcat-none">{t("No patterns match.")}</li>}
        </ul>
        <div className="gcat-legend" aria-hidden="true">
          <span>
            <Dots state="introduced" /> {t("Introduced")}
          </span>
          <span>
            <Dots state="with_help" /> {t("With help")}
          </span>
          <span>
            <Dots state="independent" /> {t("On your own")}
          </span>
        </div>
      </nav>

      <div className="gdet">
        <div className="gdet-drag drag" />
        {error && (
          <p className="err">
            <Icon name="alert" size={15} /> {t(error)}
          </p>
        )}
        {selected && <Detail key={selected} id={selected} language={language} navigate={navigate} />}
      </div>
    </main>
  );
}

function Detail({ id, language, navigate }: { id: string; language: Language; navigate: Navigate }) {
  const app = useApp();
  const L = app.lang.fontClass;
  const [d, setD] = useState<GrammarDetail | null | undefined>(undefined);
  const [busy, setBusy] = useState<"practise" | "explain" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assist, setAssist] = useState<"all" | "own" | "help">("all");

  useEffect(() => {
    let alive = true;
    api
      .getGrammar(id)
      .then((g) => alive && setD(g))
      .catch((e) => {
        if (!alive) return;
        setError(errorText(e));
        setD(null);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  if (d === undefined) return <div className="skel-h" style={{ width: "40%", height: 90, marginTop: 40 }} />;
  if (d === null)
    return (
      <div className="gdet-missing">
        <h2 className="serif">{t("This pattern isn't in your records.")}</h2>
        {error && <p className="err">{t(error)}</p>}
      </div>
    );

  const { point, counts, state, rate } = d.summary;
  const obs = d.observations;
  const sessionsById = new Map<string, SessionMeta>(d.sessions.map((s) => [s.id, s]));
  const assessed = counts.correct + counts.incorrect;
  const firstMet = point.introducedAt ?? Math.min(point.createdAt, ...obs.map((o) => o.at));
  const oldestFirst = [...obs].sort((a, b) => a.at - b.at);
  const firstHelp = oldestFirst.find((o) => o.verdict === "correct");
  const firstOwn = oldestFirst.find((o) => o.verdict === "correct" && o.assistance === "independent");
  const reached = STATE_ORDER.indexOf(state);
  const libSource = point.sources.find((s) => s.kind === "library");

  const ladder = [
    {
      s: "introduced" as const,
      title: t("Introduced"),
      sub: `${fmtShortDate(firstMet)}${libSource && libSource.kind === "library" ? ` · ${libSource.title ?? t("your library")}` : ""}`,
    },
    { s: "with_help" as const, title: t("Used with help"), sub: reached >= 1 && firstHelp ? t("{date} · first correct use", { date: fmtShortDate(firstHelp.at) }) : t("Not yet") },
    { s: "independent" as const, title: t("Used on your own"), sub: reached >= 2 && firstOwn ? t("Since {date}", { date: fmtShortDate(firstOwn.at) }) : t("Not yet") },
  ];

  const filtered = obs.filter((o) => assist === "all" || (assist === "own" ? o.assistance === "independent" : o.assistance !== "independent"));

  const practise = async (explain: boolean) => {
    setBusy(explain ? "explain" : "practise");
    setError(null);
    try {
      // The explanation request goes into the tutor's opening; sending a message here would be
      // rejected while the opening runs (v0.2.1 bug).
      const v = await api.practiseGrammar(id, { explain });
      await app.refreshSessions();
      navigate(sessionRoute(v.meta.id));
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  };

  return (
    <article className="gd" aria-label={`${point.pattern}, ${point.name}`}>
      <div className="eyebrow">
        {t("Grammar")}
        {point.level ? ` · ${point.level}` : ""} · {t("First met {date}", { date: fmtShortDate(firstMet) })}
      </div>
      <div className="gd-head">
        <div className="gd-title">
          <div className="gd-row">
            <h1 className={cls("gd-pattern selectable", L)}>{point.pattern}</h1>
            {point.reading && <span className="gd-reading mono">{point.reading}</span>}
          </div>
          <p className="gd-name">{point.name}</p>
        </div>
        <div className="gd-actions">
          <button className="btn" onClick={() => void practise(true)} disabled={!!busy} title={t("Start a practice chat that opens with a fresh explanation")}>
            {busy === "explain" ? t("Starting…") : t("Explain again")}
          </button>
          <button className="btn btn-f" onClick={() => void practise(false)} disabled={!!busy} title={t("The tutor steers the chat so you need this pattern")}>
            {busy === "practise" ? t("Starting…") : t("Practise this")} <Icon name="arrow" size={16} stroke={2} />
          </button>
        </div>
      </div>
      {error && (
        <p className="err" role="alert">
          <Icon name="alert" size={15} /> {t(error)}
        </p>
      )}

      <ol className="ladder" aria-label={t("Progress on this pattern")}>
        {ladder.map((step, i) => (
          <li key={step.s} className={cls("rung", i <= reached && "reached", i === reached && "current")} aria-current={i === reached ? "step" : undefined}>
            <b>
              {i < reached && <Icon name="check" size={13} stroke={2.4} />}
              {step.title}
            </b>
            <span>{step.sub}</span>
          </li>
        ))}
      </ol>

      <div className="gd-cols">
        <div className="gd-left">
          <div className="ctiles">
            <div className="ctile">
              <b className="ok-n">{counts.correct}</b>
              <span>{t("Correct")}</span>
            </div>
            <div className="ctile">
              <b className="bad">{counts.incorrect}</b>
              <span>{t("Incorrect")}</span>
            </div>
            <div className="ctile">
              <b>{counts.uncertain}</b>
              <span>{t("Unsure")}</span>
            </div>
            <div className="ctile">
              <b className="muted">{counts.unassessed}</b>
              <span>{t("Not assessed")}</span>
            </div>
          </div>
          <p className="rate">
            {rate == null
              ? t("Nothing assessed yet. Unassessed uses don't count as correct.")
              : t("{pct}% correct of {n} assessed. Unassessed uses don't count as correct.", { pct: Math.round(rate * 100), n: assessed })}
          </p>
          {d.summary.quiz && (
            <p className="rate">
              {t("In quizzes: {right} of {total} right. Quiz answers count as practice with a prompt, apart from conversation.", {
                right: d.summary.quiz.counts.correct,
                total: d.summary.quiz.counts.correct + d.summary.quiz.counts.incorrect + d.summary.quiz.counts.uncertain,
              })}
            </p>
          )}

          <section className="card pcard" aria-labelledby="pc-h">
            <h2 id="pc-h" className="eyebrow">
              {t("The pattern")}
            </h2>
            <div className={cls("pbox", L)}>{point.pattern}</div>
            <p className="pexp">{point.explanation}</p>
            {point.examples.length > 0 && (
              <ul className="pex">
                {point.examples.map((ex, i) => (
                  <li key={i}>
                    <AnnotatedText language={language} text={ex.text} className="pex-t" />
                    <span className="pex-tr">{ex.translation}</span>
                  </li>
                ))}
              </ul>
            )}
            {point.sources.length > 0 && (
              <div className="psrc">
                {point.sources.map((s, i) =>
                  s.kind === "library" ? (
                    <button key={i} className="chip chip-s" onClick={() => navigate(readerRoute(s.docId, s.paragraph))} title={s.quote}>
                      <Icon name="library" size={13} />
                      {s.title ?? t("Library")} · ¶{s.paragraph + 1}
                    </button>
                  ) : (
                    <button key={i} className="chip chip-s" onClick={() => navigate(sessionRoute(s.sessionId))}>
                      <Icon name="sessions" size={13} />
                      {t("From a chat")}
                    </button>
                  ),
                )}
              </div>
            )}
          </section>

          {d.corrections.length > 0 && (
            <section className="gd-corr" aria-labelledby="gc-h">
              <h2 id="gc-h" className="eyebrow">
                {t("Corrections on this pattern")}
              </h2>
              <ul>
                {d.corrections.map((c) => (
                  <li key={c.id} className="gc">
                    <div className={cls("gc-d", L)}>
                      <s>{c.original}</s>
                      <Icon name="arrow" size={14} />
                      <b>{c.corrected}</b>
                    </div>
                    <p>{c.explanation}</p>
                    <span className="gc-s">
                      {c.status === "retried_ok"
                        ? t("Fixed on retry")
                        : c.status === "revealed"
                          ? t("Answer shown")
                          : c.status === "disputed"
                            ? t("You disputed this")
                            : c.status === "retried_wrong"
                              ? t("Still open after a retry")
                              : t("Open")}{" "}
                      · {fmtShortDate(c.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <section className="gd-right" aria-labelledby="tl-h">
          <div className="tl-top">
            <h2 id="tl-h" className="eyebrow">
              {t("Every time you've used it")}
            </h2>
            <div className="seg" role="radiogroup" aria-label={t("Filter by help")}>
              {(
                [
                  ["all", t("All")],
                  ["own", t("On your own")],
                  ["help", t("With help")],
                ] as const
              ).map(([k, label]) => (
                <button key={k} role="radio" aria-checked={assist === k} className={assist === k ? "on" : ""} onClick={() => setAssist(k)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {obs.length === 0 ? (
            <div className="ghost-card">
              {t("You haven't used this one yet. Practise it and every attempt shows up here, with the sentence and how it went.")}
            </div>
          ) : filtered.length === 0 ? (
            <div className="ghost-card">{t("No attempts match this filter.")}</div>
          ) : (
            <ol className="tl">
              {filtered.map((o) => (
                <Attempt key={o.id} o={o} pattern={point.pattern} L={L} session={sessionsById.get(o.sessionId)} navigate={navigate} onUpdated={setD} />
              ))}
            </ol>
          )}
        </section>
      </div>
    </article>
  );
}

/** Placeholder words in patterns written for alphabetic languages ("ser + adj", "A + 比 + B"). */
const PLACEHOLDERS = new Set(["adj", "adjective", "verb", "noun", "inf", "infinitive", "subj", "subject", "obj", "object", "sb", "sth", "pp", "ger", "past", "participle"]);

/**
 * Fixed chunks of a pattern for highlighting inside a sentence: CJK runs ("除了…还…" → 除了, 还),
 * Hangul runs, or words of alphabetic languages that aren't placeholders ("ser + adj" → ser).
 */
function patternParts(pattern: string): string[] {
  const cjk = pattern.match(/[぀-ヿ㐀-鿿]+/g);
  if (cjk) return cjk.sort((a, b) => b.length - a.length);
  const hangul = pattern.match(/\p{Script=Hangul}+/gu);
  if (hangul) return hangul.sort((a, b) => b.length - a.length);
  const words = (pattern.match(/\p{L}{2,}/gu) ?? []).filter((w) => !PLACEHOLDERS.has(w.toLowerCase()) && w !== w.toUpperCase());
  return words.sort((a, b) => b.length - a.length);
}

function Highlighted({ text, pattern }: { text: string; pattern: string }) {
  const parts = patternParts(pattern);
  if (!parts.length) return <>{text}</>;
  const re = new RegExp(`(${parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "giu");
  const lower = new Set(parts.map((p) => p.toLocaleLowerCase()));
  return (
    <>
      {text.split(re).map((seg, i) => (lower.has(seg.toLocaleLowerCase()) ? <mark key={i} className="pm">{seg}</mark> : <span key={i}>{seg}</span>))}
    </>
  );
}

function Attempt({
  o,
  pattern,
  L,
  session,
  navigate,
  onUpdated,
}: {
  o: GrammarObservation;
  pattern: string;
  L: string;
  session?: SessionMeta;
  navigate: Navigate;
  onUpdated(d: GrammarDetail | null): void;
}) {
  const [open, setOpen] = useState(false);
  const [verdict, setVerdict] = useState<Verdict>(o.verdict === "incorrect" ? "correct" : o.verdict);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const v = VERDICT[o.verdict];

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.disputeObservation(o.id, verdict, note.trim());
      setOpen(false);
      if (next) onUpdated(next);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="obs">
      <span className="obs-d">{fmtShortDate(o.at)}</span>
      <div className="obs-b">
        <p className={cls("obs-s selectable", L)}>
          <Highlighted text={o.span} pattern={pattern} />
        </p>
        <div className="obs-m">
          <span className={cls("vd", v.cls)}>
            <Icon name={v.icon} size={13} stroke={2.2} />
            {t(v.label)}
            {o.note && <span className="vd-note"> · {t(o.note)}</span>}
          </span>
          <span className={cls("achip", o.assistance === "independent" && "own")}>{t(ASSIST[o.assistance])}</span>
          <span className="obs-acts">
            {session && (
              <button className={cls("obs-link", cjkClass(session.title, L))} onClick={() => navigate(sessionRoute(session.id))} title={t("Open the session")}>
                {session.title}
              </button>
            )}
            {o.origin === "quiz" && o.quizId && (
              <button className="obs-link" onClick={() => navigate(quizRoute(o.quizId!))} title={t("Open the quiz")}>
                {t("Open quiz")}
              </button>
            )}
            {!o.disputed && !open && (
              <button className="linkb" onClick={() => setOpen(true)}>
                {t("Dispute")}
              </button>
            )}
          </span>
        </div>
        {o.disputed && (
          <p className="obs-disp">
            <Icon name="flag" size={13} />
            <span>
              {t("You disputed this on {date}. It was marked {verdict}.", {
                date: fmtShortDate(o.disputed.at),
                verdict: t(VERDICT[o.disputed.originalVerdict].label).toLocaleLowerCase(),
              })}
              {o.disputed.note && <em> "{o.disputed.note}"</em>}
            </span>
          </p>
        )}
        {open && (
          <form
            className="dispute"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="dispute-row">
              <label htmlFor={`dv-${o.id}`} className="sr">
                {t("What it should be")}
              </label>
              <select id={`dv-${o.id}`} className="input select" value={verdict} onChange={(e) => setVerdict(e.target.value as Verdict)}>
                {(Object.keys(VERDICT) as Verdict[]).map((k) => (
                  <option key={k} value={k}>
                    {t("Should be: {verdict}", { verdict: t(VERDICT[k].label) })}
                  </option>
                ))}
              </select>
              <label htmlFor={`dn-${o.id}`} className="sr">
                {t("Why")}
              </label>
              <input
                id={`dn-${o.id}`}
                className="input"
                autoFocus
                maxLength={200}
                placeholder={t("Why? e.g. My textbook uses this form")}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
              />
            </div>
            <div className="dispute-row">
              <button className="btn btn-p btn-s" type="submit" disabled={busy || verdict === o.verdict}>
                {busy ? t("Saving…") : t("Save")}
              </button>
              <button className="btn btn-s" type="button" onClick={() => setOpen(false)}>
                {t("Cancel")}
              </button>
              <span className="muted small">{t("Counts update right away. Style choices aren't errors.")}</span>
            </div>
            {error && <p className="err">{t(error)}</p>}
          </form>
        )}
      </div>
    </li>
  );
}
