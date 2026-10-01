// Progress (S1-22..S1-25): numbers counted locally from the records. No model calls.
import { useEffect, useState } from "react";
import type { CorrectionKind, Language, ProgressRange, ProgressStats } from "../../../shared/records";
import { api, errorText } from "../api";
import { AnnotatedText } from "../components/AnnotatedText";
import { Icon } from "../components/icons";
import { useApp } from "../context";
import { cls, fmtDuration, fmtNumber } from "../lib/format";
import { sessionRoute, type Navigate } from "../router";

export interface ProgressScreenProps {
  language: Language;
  navigate: Navigate;
}

const RANGES: { id: ProgressRange; label: string }[] = [
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "all", label: "All time" },
];
const KINDS: { id: CorrectionKind; label: string }[] = [
  { id: "grammar", label: "Grammar" },
  { id: "vocabulary", label: "Vocabulary" },
  { id: "phrasing", label: "Phrasing" },
  { id: "style", label: "Style, not errors" },
];
const MIN = 60_000;
const day = (iso: string) => new Date(`${iso}T12:00:00`);

function titleFor(s: ProgressStats): string {
  if (s.range === "week") return "This week";
  if (s.range === "all") return "Everything so far";
  const first = s.daily[0] ? day(s.daily[0].date) : null;
  const now = new Date();
  if (first && first.getDate() === 1 && first.getMonth() === now.getMonth()) return `${now.toLocaleDateString("en-US", { month: "long" })}, so far`;
  return "The last 30 days";
}

function longestStreak(daily: ProgressStats["daily"]): number {
  let best = 0;
  let cur = 0;
  for (const d of daily) {
    cur = d.activeMs > 0 ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}

export function ProgressScreen({ language, navigate }: ProgressScreenProps) {
  const app = useApp();
  const L = app.lang.fontClass;
  const [range, setRange] = useState<ProgressRange>(() => {
    try {
      return (localStorage.getItem("sayfern.progress.range") as ProgressRange) || "month";
    } catch {
      return "month";
    }
  });
  const [stats, setStats] = useState<ProgressStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    api
      .getProgress(language, range)
      .then((s) => alive && setStats(s))
      .catch((e) => alive && setError(errorText(e)));
    try {
      localStorage.setItem("sayfern.progress.range", range);
    } catch {
      /* ignore */
    }
    return () => {
      alive = false;
    };
  }, [language, range]);

  const s = stats;
  const newCount = s?.firstUsed.length ?? 0;
  const g = s?.grammar;
  const gTotal = g ? g.independent + g.with_help + g.introduced : 0;
  const cMax = s ? Math.max(1, ...KINDS.map((k) => s.corrections.byKind[k.id])) : 1;
  const rangeWord = range === "week" ? "this week" : range === "month" ? "this month" : "so far";

  return (
    <main className="main page">
      <div className="page-drag drag" />
      <div className="page-in">
        <header className="page-head">
          <div>
            <div className="eyebrow">{app.lang.name}</div>
            <h1 className="display">{s ? titleFor(s) : " "}</h1>
          </div>
          <div className="page-actions">
            <span className="chip local-chip" title="Every number here is counted from your records on this Mac">
              <Icon name="lock" size={14} />
              Counted on this Mac. No model calls.
            </span>
            <div className="seg" role="radiogroup" aria-label="Time range">
              {RANGES.map((r) => (
                <button key={r.id} role="radio" aria-checked={range === r.id} className={range === r.id ? "on" : ""} onClick={() => setRange(r.id)}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </header>

        {error && (
          <p className="err" role="alert">
            <Icon name="alert" size={15} /> {error}
          </p>
        )}

        {s && (
          <>
            <div className="ptiles">
              <div className="ptile">
                <span className="ptile-l">Active practice</span>
                <b>{fmtDuration(s.activeMs)}</b>
                <span>Idle time left out</span>
              </div>
              <div className="ptile">
                <span className="ptile-l">Words you wrote</span>
                <b>{fmtNumber(s.wordsWritten)}</b>
                <span>Tutor text and pastes left out</span>
              </div>
              <div className="ptile">
                <span className="ptile-l">Different words</span>
                <b>{fmtNumber(s.distinctWords)}</b>
                <span>{newCount} used for the first time</span>
              </div>
              <div className="ptile">
                <span className="ptile-l">Sessions</span>
                <b>{fmtNumber(s.sessions)}</b>
                <span>{s.sessions ? `Longest streak: ${longestStreak(s.daily)} ${longestStreak(s.daily) === 1 ? "day" : "days"}` : "Start one from Today"}</span>
              </div>
            </div>

            <div className="pgrid">
              <section className="card pc" aria-labelledby="chart-h">
                <div className="pc-h">
                  <h2 id="chart-h">Active minutes per day</h2>
                  {s.activeMs > 0 && <span className="muted small">{s.range === "all" ? "Last 90 days · hover a bar" : "Hover a bar"}</span>}
                </div>
                <DailyChart daily={s.daily} />

                {s.anki && (
                  <div className="anki-cmp">
                    <h2>Anki vs. what you actually write</h2>
                    <HBar label="Mature cards in Anki" value={s.anki.matureCount} max={Math.max(s.anki.matureCount, s.anki.usedInWriting)} tone="soft" />
                    <HBar label="Used by you in writing" value={s.anki.usedInWriting} max={Math.max(s.anki.matureCount, s.anki.usedInWriting)} />
                    <p className="muted small">Recognising a card isn't the same as producing the word. The tutor works on the gap.</p>
                  </div>
                )}
              </section>

              <div className="pcol">
                <section className="card pc" aria-labelledby="gm-h">
                  <div className="pc-h">
                    <h2 id="gm-h">Grammar you've met</h2>
                    <span className="muted small">
                      {gTotal} {gTotal === 1 ? "pattern" : "patterns"}
                    </span>
                  </div>
                  {g && gTotal > 0 ? (
                    <>
                      <div className="stackbar" role="img" aria-label={`On your own ${g.independent}, with help ${g.with_help}, introduced ${g.introduced}`}>
                        {g.independent > 0 && <i className="s-own" style={{ flexGrow: g.independent }} title={`On your own: ${g.independent}`} />}
                        {g.with_help > 0 && <i className="s-help" style={{ flexGrow: g.with_help }} title={`With help: ${g.with_help}`} />}
                        {g.introduced > 0 && <i className="s-intro" style={{ flexGrow: g.introduced }} title={`Introduced: ${g.introduced}`} />}
                      </div>
                      <div className="legend">
                        <span>
                          <i className="s-own" />
                          On your own · {g.independent}
                        </span>
                        <span>
                          <i className="s-help" />
                          With help · {g.with_help}
                        </span>
                        <span>
                          <i className="s-intro" />
                          Introduced · {g.introduced}
                        </span>
                      </div>
                      <p className="muted small">On your own means correct with no prompt and no retry.</p>
                    </>
                  ) : (
                    <p className="muted small">Patterns show up once the tutor sees you try them.</p>
                  )}
                </section>

                <section className="card pc" aria-labelledby="ck-h">
                  <div className="pc-h">
                    <h2 id="ck-h">Corrections by kind</h2>
                    <span className="muted small">{s.corrections.total} total</span>
                  </div>
                  {s.corrections.total === 0 ? (
                    <p className="muted small">No corrections {rangeWord}.</p>
                  ) : (
                    <div className="kbars">
                      {KINDS.map((k) => (
                        <HBar key={k.id} label={k.label} value={s.corrections.byKind[k.id]} max={cMax} tone={k.id === "style" ? "soft" : undefined} />
                      ))}
                    </div>
                  )}
                </section>

                <section className="card pc fu" aria-labelledby="fu-h">
                  <div className="pc-h">
                    <h2 id="fu-h">First used {rangeWord}</h2>
                    <span className="muted small">Not proof you've learned it</span>
                  </div>
                  {newCount === 0 ? (
                    <p className="muted small">Words you write for the first time show up here with the sentence you used them in.</p>
                  ) : (
                    <ul className="fu-list">
                      {s.firstUsed.slice(0, 8).map((w) => (
                        <li key={w.word}>
                          <button className={cls("fu-w", L)} onClick={() => navigate(sessionRoute(w.firstSessionId))} title="Open the session where you first used it">
                            {w.word}
                          </button>
                          {w.firstSentence ? (
                            <AnnotatedText language={language} text={w.firstSentence} className="fu-s" />
                          ) : (
                            <span className="fu-s muted">Used {w.count} times</span>
                          )}
                        </li>
                      ))}
                      {newCount > 8 && <li className="fu-more muted small">and {newCount - 8} more</li>}
                    </ul>
                  )}
                </section>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function HBar({ label, value, max, tone }: { label: string; value: number; max: number; tone?: "soft" }) {
  return (
    <div className="hbar">
      <span className="hbar-l">{label}</span>
      <span className="hbar-t" aria-hidden="true">
        <i className={tone} style={{ width: `${max ? Math.max((value / max) * 100, value ? 1.5 : 0) : 0}%` }} />
      </span>
      <span className="hbar-v mono">{fmtNumber(value)}</span>
    </div>
  );
}

function DailyChart({ daily }: { daily: ProgressStats["daily"] }) {
  const mins = daily.map((d) => d.activeMs / MIN);
  const max = Math.max(36, ...mins) * 1.08;
  const n = daily.length;
  const every = n <= 7 ? 1 : n <= 31 ? 7 : 15;
  const labelled = (i: number) => n <= 7 || i === 0 || i === n - 1 || (i % every === 0 && n - 1 - i > every / 2);
  const empty = mins.every((m) => m === 0);
  const fmtDate = (iso: string, long = false) =>
    day(iso).toLocaleDateString("en-US", long ? { weekday: "short", month: "short", day: "numeric" } : n <= 7 ? { weekday: "short" } : { month: "short", day: "numeric" });

  return (
    <div className={cls("bchart", n > 40 && "dense", n <= 7 && "few")}>
      <div className="bplot" role="img" aria-label={`Active minutes per day, ${n} days. Total ${Math.round(mins.reduce((a, b) => a + b, 0))} minutes.`}>
        <div className="bgrid" style={{ bottom: `${(30 / max) * 100}%` }}>
          <span>30 min</span>
        </div>
        {daily.map((d, i) => {
          const m = Math.round(mins[i]);
          const pos = n <= 7 ? "c" : i < n * 0.15 ? "l" : i > n * 0.85 ? "r" : "c";
          return (
            <div key={d.date} className="bcol">
              <i className={m === 0 ? "zero" : undefined} style={{ height: m === 0 ? undefined : `${(mins[i] / max) * 100}%` }}>
                <span className={cls("btip", pos)} role="tooltip">
                  <b>{m} min</b>
                  {fmtDate(d.date, true)}
                </span>
              </i>
            </div>
          );
        })}
        {empty && <div className="bempty">Practice time shows up here after your first session.</div>}
      </div>
      <div className="baxis" aria-hidden="true">
        {daily.map((d, i) => (
          <span key={d.date} className={cls(i === 0 && "first", i === n - 1 && "last")}>
            {labelled(i) ? fmtDate(d.date) : ""}
          </span>
        ))}
      </div>
      <table className="sr">
        <caption>Active minutes per day</caption>
        <tbody>
          {daily.map((d) => (
            <tr key={d.date}>
              <th scope="row">{d.date}</th>
              <td>{Math.round(d.activeMs / MIN)} min</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
