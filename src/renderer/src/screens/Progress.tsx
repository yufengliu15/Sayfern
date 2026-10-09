// Progress (S1-22..S1-25): numbers counted locally from the records. No model calls.
import { useEffect, useState } from "react";
import type { CorrectionKind, Language, ProgressRange, ProgressStats } from "../../../shared/records";
import { api, errorText } from "../api";
import { AnnotatedText } from "../components/AnnotatedText";
import { Icon } from "../components/icons";
import { useApp } from "../context";
import { cls, fmtDuration, fmtNumber } from "../lib/format";
import { sessionRoute, type Navigate } from "../router";
import { intlLocale, langName, msg, t, tn } from "../i18n";

export interface ProgressScreenProps {
  language: Language;
  navigate: Navigate;
}

const RANGES: { id: ProgressRange; label: string }[] = [
  { id: "week", label: msg("Week") },
  { id: "month", label: msg("Month") },
  { id: "all", label: msg("All time") },
];
const KINDS: { id: CorrectionKind; label: string }[] = [
  { id: "grammar", label: msg("Grammar") },
  { id: "typo", label: msg("Typo") },
  { id: "speaking", label: msg("Speaking") },
];
const MIN = 60_000;
const day = (iso: string) => new Date(`${iso}T12:00:00`);

function titleFor(s: ProgressStats): string {
  if (s.range === "week") return t("This week");
  if (s.range === "all") return t("Everything so far");
  const first = s.daily[0] ? day(s.daily[0].date) : null;
  const now = new Date();
  if (first && first.getDate() === 1 && first.getMonth() === now.getMonth())
    return t("{month}, so far", { month: now.toLocaleDateString(intlLocale(), { month: "long" }) });
  return t("The last 30 days");
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


  return (
    <main className="main page">
      <div className="page-drag drag" />
      <div className="page-in">
        <header className="page-head">
          <div>
            <div className="eyebrow">{langName(language)}</div>
            <h1 className="display">{s ? titleFor(s) : " "}</h1>
          </div>
          <div className="page-actions">
            <span className="chip local-chip" title={t("Every number here is counted from your records on this Mac")}>
              <Icon name="lock" size={14} />
              {t("Counted on this Mac. No model calls.")}
            </span>
            <div className="seg" role="radiogroup" aria-label={t("Time range")}>
              {RANGES.map((r) => (
                <button key={r.id} role="radio" aria-checked={range === r.id} className={range === r.id ? "on" : ""} onClick={() => setRange(r.id)}>
                  {t(r.label)}
                </button>
              ))}
            </div>
          </div>
        </header>

        {error && (
          <p className="err" role="alert">
            <Icon name="alert" size={15} /> {t(error)}
          </p>
        )}

        {s && (
          <>
            <div className="ptiles">
              <div className="ptile">
                <span className="ptile-l">{t("Active practice")}</span>
                <b>{fmtDuration(s.activeMs)}</b>
                <span>{s.voiceMs > 0 ? t("Plus {time} speaking and listening", { time: fmtDuration(s.voiceMs) }) : t("Idle time left out")}</span>
              </div>
              <div className="ptile">
                <span className="ptile-l">{t("Words you wrote")}</span>
                <b>{fmtNumber(s.wordsWritten)}</b>
                <span>{t("Tutor text and pastes left out")}</span>
              </div>
              <div className="ptile">
                <span className="ptile-l">{t("Different words")}</span>
                <b>{fmtNumber(s.distinctWords)}</b>
                <span>{t("{n} used for the first time", { n: newCount })}</span>
              </div>
              <div className="ptile">
                <span className="ptile-l">{t("Sessions")}</span>
                <b>{fmtNumber(s.sessions)}</b>
                <span>{s.sessions ? tn(longestStreak(s.daily), "Longest streak: {count} day", "Longest streak: {count} days") : t("Start one from Today")}</span>
              </div>
            </div>

            <div className="pgrid">
              <section className="card pc" aria-labelledby="chart-h">
                <div className="pc-h">
                  <h2 id="chart-h">{t("Active minutes per day")}</h2>
                  {s.activeMs > 0 && <span className="muted small">{s.range === "all" ? t("Last 90 days · hover a bar") : t("Hover a bar")}</span>}
                </div>
                <DailyChart daily={s.daily} />

                {s.anki && (
                  <div className="anki-cmp">
                    <h2>{t("Anki vs. what you actually write")}</h2>
                    <HBar label={t("Mature cards in Anki")} value={s.anki.matureCount} max={Math.max(s.anki.matureCount, s.anki.usedInWriting)} tone="soft" />
                    <HBar label={t("Used by you in writing")} value={s.anki.usedInWriting} max={Math.max(s.anki.matureCount, s.anki.usedInWriting)} />
                    <p className="muted small">{t("Recognising a card isn't the same as producing the word. The tutor works on the gap.")}</p>
                  </div>
                )}
              </section>

              <div className="pcol">
                <section className="card pc" aria-labelledby="gm-h">
                  <div className="pc-h">
                    <h2 id="gm-h">{t("Grammar you've met")}</h2>
                    <span className="muted small">{tn(gTotal, "{count} pattern", "{count} patterns")}</span>
                  </div>
                  {g && gTotal > 0 ? (
                    <>
                      <div
                        className="stackbar"
                        role="img"
                        aria-label={`${t("On your own")} ${g.independent}, ${t("With help")} ${g.with_help}, ${t("Introduced")} ${g.introduced}`}
                      >
                        {g.independent > 0 && <i className="s-own" style={{ flexGrow: g.independent }} title={`${t("On your own")}: ${g.independent}`} />}
                        {g.with_help > 0 && <i className="s-help" style={{ flexGrow: g.with_help }} title={`${t("With help")}: ${g.with_help}`} />}
                        {g.introduced > 0 && <i className="s-intro" style={{ flexGrow: g.introduced }} title={`${t("Introduced")}: ${g.introduced}`} />}
                      </div>
                      <div className="legend">
                        <span>
                          <i className="s-own" />
                          {t("On your own")} · {g.independent}
                        </span>
                        <span>
                          <i className="s-help" />
                          {t("With help")} · {g.with_help}
                        </span>
                        <span>
                          <i className="s-intro" />
                          {t("Introduced")} · {g.introduced}
                        </span>
                      </div>
                      <p className="muted small">{t("On your own means correct with no prompt and no retry.")}</p>
                    </>
                  ) : (
                    <p className="muted small">{t("Patterns show up once the tutor sees you try them.")}</p>
                  )}
                </section>

                <section className="card pc" aria-labelledby="ck-h">
                  <div className="pc-h">
                    <h2 id="ck-h">{t("Corrections by kind")}</h2>
                    <span className="muted small">{t("{n} total", { n: s.corrections.total })}</span>
                  </div>
                  {s.corrections.total === 0 ? (
                    <p className="muted small">{range === "week" ? t("No corrections this week.") : range === "month" ? t("No corrections this month.") : t("No corrections so far.")}</p>
                  ) : (
                    <div className="kbars">
                      {KINDS.map((k) => (
                        <HBar key={k.id} label={t(k.label)} value={s.corrections.byKind[k.id]} max={cMax} tone={k.id !== "grammar" ? "soft" : undefined} />
                      ))}
                    </div>
                  )}
                </section>

                <section className="card pc fu" aria-labelledby="fu-h">
                  <div className="pc-h">
                    <h2 id="fu-h">{range === "week" ? t("First used this week") : range === "month" ? t("First used this month") : t("First used so far")}</h2>
                    <span className="muted small">{t("Not proof you've learned it")}</span>
                  </div>
                  {newCount === 0 ? (
                    <p className="muted small">{t("Words you write for the first time show up here with the sentence you used them in.")}</p>
                  ) : (
                    <ul className="fu-list">
                      {s.firstUsed.slice(0, 8).map((w) => (
                        <li key={w.word}>
                          <button className={cls("fu-w", L)} onClick={() => navigate(sessionRoute(w.firstSessionId))} title={t("Open the session where you first used it")}>
                            {w.word}
                          </button>
                          {w.firstSentence ? (
                            <AnnotatedText language={language} text={w.firstSentence} className="fu-s" />
                          ) : (
                            <span className="fu-s muted">{tn(w.count, "Used {count} time", "Used {count} times")}</span>
                          )}
                        </li>
                      ))}
                      {newCount > 8 && <li className="fu-more muted small">{t("and {n} more", { n: newCount - 8 })}</li>}
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
    day(iso).toLocaleDateString(intlLocale(), long ? { weekday: "short", month: "short", day: "numeric" } : n <= 7 ? { weekday: "short" } : { month: "short", day: "numeric" });

  return (
    <div className={cls("bchart", n > 40 && "dense", n <= 7 && "few")}>
      <div
        className="bplot"
        role="img"
        aria-label={t("Active minutes per day, {n} days. Total {total} minutes.", { n, total: Math.round(mins.reduce((a, b) => a + b, 0)) })}
      >
        <div className="bgrid" style={{ bottom: `${(30 / max) * 100}%` }}>
          <span>{t("{n} min", { n: 30 })}</span>
        </div>
        {daily.map((d, i) => {
          const m = Math.round(mins[i]);
          const pos = n <= 7 ? "c" : i < n * 0.15 ? "l" : i > n * 0.85 ? "r" : "c";
          return (
            <div key={d.date} className="bcol">
              <i className={m === 0 ? "zero" : undefined} style={{ height: m === 0 ? undefined : `${(mins[i] / max) * 100}%` }}>
                <span className={cls("btip", pos)} role="tooltip">
                  <b>{t("{n} min", { n: m })}</b>
                  {fmtDate(d.date, true)}
                </span>
              </i>
            </div>
          );
        })}
        {empty && <div className="bempty">{t("Practice time shows up here after your first session.")}</div>}
      </div>
      <div className="baxis" aria-hidden="true">
        {daily.map((d, i) => (
          <span key={d.date} className={cls(i === 0 && "first", i === n - 1 && "last")}>
            {labelled(i) ? fmtDate(d.date) : ""}
          </span>
        ))}
      </div>
      <table className="sr">
        <caption>{t("Active minutes per day")}</caption>
        <tbody>
          {daily.map((d) => (
            <tr key={d.date}>
              <th scope="row">{d.date}</th>
              <td>{t("{n} min", { n: Math.round(d.activeMs / MIN) })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
