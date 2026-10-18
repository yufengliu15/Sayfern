// Taking (and reviewing) one quiz: route quiz/<id>. Owned by the quiz feature.
// Generating state with Cancel, one question at a time (keyboard: 1-4 to choose, Enter to check
// and continue, Backspace removes the last tile), immediate feedback with the key, and an end
// summary computed on this computer with links to the grammar pages.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { Language } from "../../../shared/records";
import type { QuizQuestion, QuizVerdict, QuizView } from "../../../shared/stage2";
import { api, errorText } from "../api";
import { AnnotatedText } from "../components/AnnotatedText";
import { Icon, type IconName } from "../components/icons";
import { useApp } from "../context";
import { cls, fmtShortDate } from "../lib/format";
import { grammarRoute, quizRoute, reviewRoute, type Navigate } from "../router";
import { FORMAT_HEAD } from "./review/QuizParts";
import { WRITE_PLACEHOLDER } from "../lib/samples";
import { spaceSeparated } from "../../../shared/languages";
import { langName, msg, t, tn } from "../i18n";

export interface QuizScreenProps {
  id: string;
  language: Language;
  navigate: Navigate;
}

const VERDICT: Record<QuizVerdict, { label: string; cls: string; icon: IconName }> = {
  correct: { label: msg("Correct"), cls: "v-ok", icon: "check" },
  incorrect: { label: msg("Not quite"), cls: "v-bad", icon: "x" },
  uncertain: { label: msg("Unsure"), cls: "v-unc", icon: "hint" },
};

const simplify = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const imeBusy = (e: ReactKeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;
const inField = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

export function QuizScreen({ id, language, navigate }: QuizScreenProps) {
  const app = useApp();
  const [view, setView] = useState<QuizView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [cur, setCur] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const v = await api.getQuiz(id);
      setView(v);
      return v;
    } catch (e) {
      setError(errorText(e));
      setView(null);
      return null;
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while the model writes the questions.
  useEffect(() => {
    if (view?.status !== "generating") return;
    const t = window.setInterval(() => void load(), 800);
    return () => window.clearInterval(t);
  }, [view?.status, load]);

  // Start at the first unanswered question.
  useEffect(() => {
    if (!view || view.status !== "ready" || cur !== null) return;
    const first = view.questions.findIndex((q) => !q.answered);
    setCur(first >= 0 ? first : Math.max(0, view.questions.length - 1));
  }, [view, cur]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const L = app.lang.fontClass;

  if (view === undefined) {
    return (
      <Shell>
        <div className="skel-h" style={{ width: "40%" }} />
      </Shell>
    );
  }
  if (view === null) {
    return (
      <Shell>
        <div className="eyebrow">{t("{language} · Quiz", { language: langName(language) })}</div>
        <h1 className="display">{t("This quiz isn't here anymore.")}</h1>
        {error && <p className="err">{t(error)}</p>}
        <button className="btn" onClick={() => navigate(reviewRoute("quizzes"))}>
          <Icon name="back" size={16} /> {t("Back to quizzes")}
        </button>
      </Shell>
    );
  }

  const head = (
    <QuizHead view={view} cur={cur} lang={langName(language)} navigate={navigate} onEnd={view.status === "ready" && view.summary.answered > 0 ? () => void run("finish", async () => setView(await api.finishQuiz(view.id))) : undefined} />
  );

  if (view.status === "generating") {
    return (
      <Shell>
        {head}
        <section className="card qz-gen" aria-live="polite">
          <div className="thinking" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <h2 className="serif">{t("Writing your questions…")}</h2>
          <p className="muted">
            {t("This usually takes 20 to 60 seconds. The material comes from your records; the model writes the items, and every one is checked here before you see it.")}
          </p>
          <button
            className="btn"
            disabled={!!busy}
            onClick={() =>
              void run("cancel", async () => {
                await api.cancelQuizGeneration(view.id);
                navigate(reviewRoute("quizzes"));
              })
            }
          >
            {t("Cancel")}
          </button>
        </section>
      </Shell>
    );
  }

  if (view.status === "failed") {
    return (
      <Shell>
        {head}
        <section className="card qz-gen">
          <h2 className="serif">{t("Couldn't write this quiz.")}</h2>
          <p className="err">
            <Icon name="alert" size={15} /> {view.error ? t(view.error) : t("Something went wrong.")}
          </p>
          <div className="row-gap">
            <button
              className="btn btn-f"
              disabled={!!busy || !app.model}
              onClick={() =>
                void run("retry", async () => {
                  const next = await api.startQuiz(view.spec, app.model!);
                  await api.cancelQuizGeneration(view.id).catch(() => undefined);
                  navigate(quizRoute(next.id));
                })
              }
            >
              {t("Try again")}
            </button>
            <button className="btn" onClick={() => navigate(reviewRoute("quizzes"))}>
              {t("Back to quizzes")}
            </button>
          </div>
          {error && <p className="err">{t(error)}</p>}
        </section>
      </Shell>
    );
  }

  if (view.status === "finished") {
    return (
      <Shell>
        {head}
        <Summary
          view={view}
          L={L}
          language={language}
          navigate={navigate}
          busy={busy}
          onRetry={() =>
            void run("retry", async () => {
              const next = await api.retryMistakes(view.id);
              navigate(quizRoute(next.id));
            })
          }
          onDelete={() =>
            void run("delete", async () => {
              await api.deleteQuiz(view.id);
              navigate(reviewRoute("quizzes"));
            })
          }
        />
        {error && <p className="err">{t(error)}</p>}
      </Shell>
    );
  }

  const i = cur ?? 0;
  const q = view.questions[i];
  const last = i >= view.questions.length - 1;
  const next = () => {
    if (!last) setCur(i + 1);
    else void run("finish", async () => setView(await api.finishQuiz(view.id)));
  };

  return (
    <Shell>
      {head}
      {q && (
        <QuestionCard
          key={q.id}
          q={q}
          L={L}
          language={language}
          last={last}
          checking={busy === "answer"}
          finishing={busy === "finish"}
          onAnswer={(response, reveal) =>
            run("answer", async () => {
              setView(await api.answerQuestion(view.id, q.id, response, app.model ?? null, reveal ? { reveal: true } : undefined));
            })
          }
          onNext={next}
          navigate={navigate}
        />
      )}
      {error && (
        <p className="err" role="alert">
          <Icon name="alert" size={15} /> {t(error)}
        </p>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="main page">
      <div className="page-drag drag" />
      <div className="page-in qz-page">{children}</div>
    </main>
  );
}

function QuizHead({ view, cur, lang, navigate, onEnd }: { view: QuizView; cur: number | null; lang: string; navigate: Navigate; onEnd?: () => void }) {
  const total = view.questions.length;
  const taking = view.status === "ready" && total > 0;
  return (
    <header className="qz-head">
      <div className="qz-head-top">
        <button className="linkb qz-backlink" onClick={() => navigate(reviewRoute("quizzes"))}>
          <Icon name="back" size={14} /> {t("Quizzes")}
        </button>
        {taking && onEnd && (
          <button className="linkb" onClick={onEnd} title={t("Score what you've answered so far")}>
            {t("End quiz")}
          </button>
        )}
      </div>
      <div className="page-head qz-ph">
        <div>
          <div className="eyebrow">
            {lang} · {t("Quiz")} · {view.alignment}
          </div>
          <h1 className="display qz-title">{view.title}</h1>
        </div>
        {taking && (
          <div className="qz-progress" aria-label={t("Question {n} of {total}", { n: (cur ?? 0) + 1, total })}>
            <span className="mono">{t("{n} of {total}", { n: (cur ?? 0) + 1, total })}</span>
            <div className="qz-bar">
              {view.questions.map((q, i) => (
                <i key={q.id} className={cls(q.answered && VERDICT[q.answered.verdict].cls, i === cur && "cur")} />
              ))}
            </div>
          </div>
        )}
      </div>
      <p className={cls("qz-provline", view.exam && "exam")}>
        <Icon name="flag" size={13} /> {view.provenance}
      </p>
    </header>
  );
}

// ---------------------------------------------------------------- one question

/** Target-language text with hover lookup; "___" becomes `fill`. Lookup is off for word questions until answered. */
function QText({ text, language, lookup, fill, className }: { text: string; language: Language; lookup: boolean; fill?: ReactNode; className?: string }) {
  const at = text.indexOf("___");
  const part = (s: string) => (s ? <AnnotatedText as="span" language={language} text={s} plain={!lookup} /> : null);
  if (at < 0) return <div className={className}>{part(text)}</div>;
  return (
    <div className={className}>
      {part(text.slice(0, at))}
      {fill ?? <span className="qz-blank" />}
      {part(text.slice(at + 3))}
    </div>
  );
}

function QuestionCard({
  q,
  L,
  language,
  last,
  checking,
  finishing,
  onAnswer,
  onNext,
  navigate,
}: {
  q: QuizQuestion;
  L: string;
  language: Language;
  last: boolean;
  checking: boolean;
  finishing: boolean;
  onAnswer(response: string, reveal?: boolean): Promise<void>;
  onNext(): void;
  navigate: Navigate;
}) {
  const a = q.answered;
  const [choice, setChoice] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const [placed, setPlaced] = useState<number[]>([]);
  const nextRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const lookup = !!a || !q.word;

  const response = (): string => {
    switch (q.format) {
      case "multiple_choice":
        return choice != null && q.choices ? q.choices[choice] : "";
      case "ordering":
        // Spaces between tiles for languages written with spaces (grading ignores them either way).
        return placed.map((p) => q.tiles![p]).join(spaceSeparated(language) ? " " : "");
      default:
        return typed;
    }
  };
  const ready = q.format === "multiple_choice" ? choice != null : q.format === "ordering" ? placed.length === (q.tiles?.length ?? 0) : typed.trim() !== "";
  const check = () => {
    if (!a && ready && !checking) void onAnswer(response());
  };

  useEffect(() => {
    if (a) nextRef.current?.focus();
    else if (q.format === "cloze" || q.format === "written" || q.format === "scenario") inputRef.current?.focus();
  }, [a, q.format]);

  // Keyboard: 1-4 choose, Enter checks or continues, Backspace removes the last tile.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (inField(e.target)) return;
      if (e.isComposing) return;
      if (!a && q.format === "multiple_choice" && q.choices && /^[1-9]$/.test(e.key)) {
        const n = Number(e.key) - 1;
        if (n < q.choices.length) {
          e.preventDefault();
          setChoice(n);
        }
      } else if (!a && q.format === "ordering" && e.key === "Backspace") {
        e.preventDefault();
        setPlaced((p) => p.slice(0, -1));
      } else if (e.key === "Enter") {
        // Buttons keep their own Enter, except choices and tiles (Enter there means "check").
        const t = e.target;
        if (t instanceof HTMLButtonElement && !t.classList.contains("qz-optb") && !t.classList.contains("qz-tile")) return;
        e.preventDefault();
        if (a) onNext();
        else check();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onFieldKey = (e: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || imeBusy(e) || e.shiftKey) return;
    e.preventDefault();
    if (a) onNext();
    else check();
  };

  const isOpen = q.format === "written" || q.format === "scenario";
  const verdict = a ? VERDICT[a.verdict] : null;

  return (
    <section className={cls("card qz-q", a && `answered ${verdict!.cls}`)} aria-label={t("Question {n}", { n: q.index + 1 })}>
      <div className="qz-q-head">
        <span className="eyebrow">{t(FORMAT_HEAD[q.format])}</span>
        {/* The pattern can give the answer away: show it once answered. */}
        {a && q.grammarLabel && <span className={cls("chip chip-s static", L)}>{q.grammarLabel}</span>}
      </div>
      {simplify(q.prompt) !== simplify(FORMAT_HEAD[q.format]) && simplify(q.prompt) !== simplify(t(FORMAT_HEAD[q.format])) && <p className="qz-prompt">{q.prompt}</p>}
      {q.context && <p className="qz-ctx">{q.context}</p>}

      {q.format === "scenario" && q.text && (
        <div className="qz-bubble">
          <QText text={q.text} language={language} lookup={lookup} className={cls("qz-bubble-t", L)} />
        </div>
      )}

      {q.format === "multiple_choice" && q.text && <QText text={q.text} language={language} lookup={lookup} className={cls("qz-text", L)} />}

      {q.format === "cloze" && q.text && (
        <QText
          text={q.text}
          language={language}
          lookup={lookup}
          className={cls("qz-text", L)}
          fill={
            a ? (
              <span className={cls("qz-filled", verdict!.cls)}>
                {a.verdict !== "correct" && a.response && <s>{a.response}</s>}
                <b>{a.answer}</b>
              </span>
            ) : (
              <input
                ref={inputRef}
                className={cls("qz-gap", L)}
                value={typed}
                aria-label={t("Your answer for the gap")}
                size={Math.max(3, [...typed].length + 1)}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={onFieldKey}
                autoComplete="off"
                spellCheck={false}
              />
            )
          }
        />
      )}
      {q.format === "cloze" && q.hint && !a && <p className="qz-hint">{t("Hint: {hint}", { hint: q.hint })}</p>}

      {q.format === "multiple_choice" && q.choices && (
        <div className="qz-opts" role="radiogroup" aria-label={t("Choose one")}>
          {q.choices.map((c, k) => {
            const isKey = a && c === a.answer;
            const isMine = a ? c === a.response : choice === k;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={isMine}
                disabled={!!a}
                className={cls("qz-optb", L, isMine && "sel", isKey && "key", a && isMine && !isKey && "wrong")}
                onClick={() => setChoice(k)}
                onDoubleClick={() => {
                  setChoice(k);
                  if (!a && !checking) void onAnswer(c);
                }}
              >
                <span className="qz-k mono">{k + 1}</span>
                <span className="qz-optt">{c}</span>
              </button>
            );
          })}
        </div>
      )}

      {q.format === "ordering" && q.tiles && (
        <div className="qz-order">
          <div className={cls("qz-slot", a && verdict!.cls)} aria-label={t("Your sentence")}>
            {placed.length === 0 && !a && <span className="qz-slot-ph">{t("Tap the tiles in order")}</span>}
            {(a ? (a.verdict === "correct" ? [] : placed) : placed).map((p, k) => (
              <button key={`${p}-${k}`} type="button" className={cls("qz-tile placed", L)} disabled={!!a} onClick={() => setPlaced(placed.filter((_, j) => j !== k))}>
                {q.tiles![p]}
              </button>
            ))}
            {a && (a.verdict === "correct" || !placed.length) && <span className={cls("qz-slot-done", L)}>{a.response || a.answer}</span>}
          </div>
          {!a && (
            <div className="qz-tiles" aria-label={t("Tiles")}>
              {q.tiles.map((tile, k) => (
                <button key={k} type="button" className={cls("qz-tile", L)} disabled={placed.includes(k)} onClick={() => setPlaced([...placed, k])}>
                  {tile}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {isOpen && (
        <textarea
          ref={inputRef}
          className={cls("input qz-write", L)}
          rows={3}
          value={a ? a.response : typed}
          readOnly={!!a}
          placeholder={WRITE_PLACEHOLDER[language]}
          aria-label={t("Your answer")}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={onFieldKey}
        />
      )}

      {!a ? (
        <div className="qz-actions">
          <button className="btn btn-p" disabled={!ready || checking} onClick={check}>
            {checking ? t("Checking…") : t("Check")}
          </button>
          {q.format === "ordering" && placed.length > 0 && (
            <button className="btn btn-s" onClick={() => setPlaced([])}>
              {t("Clear")}
            </button>
          )}
          <button className="linkb" disabled={checking} onClick={() => void onAnswer("", true)}>
            {t("Show me the answer")}
          </button>
          <span className="qz-keys muted">
            {q.format === "multiple_choice" ? t("1-4 to choose, Enter to check") : isOpen ? t("Enter to check, Shift+Enter for a new line") : t("Enter to check")}
            {isOpen ? ` · ${t("checked by the model")}` : ` · ${t("graded on this computer")}`}
          </span>
        </div>
      ) : (
        <div className={cls("qz-fb", verdict!.cls)} aria-live="polite">
          <div className="qz-fb-v">
            <Icon name={verdict!.icon} size={16} stroke={2.2} />
            <b>{a.revealed ? t("Answer shown") : t(verdict!.label)}</b>
            {a.feedback && !["Right.", "Not quite.", "Here's the answer."].includes(a.feedback) && <span>{t(a.feedback)}</span>}
          </div>
          {q.format !== "cloze" && q.format !== "multiple_choice" && (
            <div className="qz-fb-row">
              <span className="qz-fb-k">{isOpen ? t("One good answer") : t("Answer")}</span>
              <AnnotatedText as="span" language={language} text={a.answer} className={cls("qz-fb-a", L)} />
            </div>
          )}
          {a.better && a.better !== a.answer && (
            <div className="qz-fb-row">
              <span className="qz-fb-k">{t("Your answer, improved")}</span>
              <AnnotatedText as="span" language={language} text={a.better} className={cls("qz-fb-a", L)} />
            </div>
          )}
          {a.accepted && a.accepted.length > 0 && (
            <div className="qz-fb-row">
              <span className="qz-fb-k">{t("Also right")}</span>
              <span className={cls("qz-fb-a small", L)}>{a.accepted.join(" · ")}</span>
            </div>
          )}
          <p className="qz-fb-ex">{a.explanation}</p>
          {a.gradedBy === "fallback" && <p className="muted small">{t("The model couldn't check this, so it counts as unsure.")}</p>}
          <div className="qz-actions">
            <button ref={nextRef} className="btn btn-f" disabled={finishing} onClick={onNext}>
              {last ? (finishing ? t("Scoring…") : t("See results")) : t("Next question")} <Icon name="arrow" size={16} stroke={2} />
            </button>
            {q.grammarId && (
              <button className="linkb" onClick={() => navigate(grammarRoute(q.grammarId!))}>
                {q.grammarLabel ? t("Open {pattern}", { pattern: q.grammarLabel }) : t("Open the grammar page")}
              </button>
            )}
            <span className="qz-keys muted">{t("Enter to continue")}</span>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- summary

function Summary({
  view,
  L,
  language,
  navigate,
  busy,
  onRetry,
  onDelete,
}: {
  view: QuizView;
  L: string;
  language: Language;
  navigate: Navigate;
  busy: string | null;
  onRetry(): void;
  onDelete(): void;
}) {
  const s = view.summary;
  const [confirm, setConfirm] = useState(false);
  const review = view.questions.filter((q) => s.review.includes(q.id));
  const unanswered = s.total - s.answered;
  return (
    <div className="qz-sum">
      <section className="card qz-score" aria-label={t("Score")}>
        <div className="qz-score-big">
          <b className="serif">{s.correct}</b>
          <span className="serif">/ {s.total}</span>
        </div>
        <div className="qz-score-tiles">
          <div className="ctile">
            <b className="ok-n">{s.correct}</b>
            <span>{t("Correct")}</span>
          </div>
          <div className="ctile">
            <b className="bad">{s.incorrect}</b>
            <span>{t("Not quite")}</span>
          </div>
          <div className="ctile">
            <b>{s.uncertain}</b>
            <span>{t("Unsure")}</span>
          </div>
          {unanswered > 0 && (
            <div className="ctile">
              <b className="muted">{unanswered}</b>
              <span>{t("Skipped")}</span>
            </div>
          )}
        </div>
        <p className="muted small">
          {t("Scored on this computer")}
          {view.finishedAt ? ` · ${fmtShortDate(view.finishedAt)}` : ""}. {t("Unsure answers count as neither right nor wrong.")}
          {s.grammar.length > 0 && ` ${t("Your grammar pages now show these answers as quiz practice.")}`}
        </p>
        <div className="qz-actions">
          {review.length > 0 && (
            <button className="btn btn-f" disabled={!!busy} onClick={onRetry}>
              {busy === "retry" ? t("Making it…") : t("Quiz me on my mistakes")} <Icon name="arrow" size={16} stroke={2} />
            </button>
          )}
          <button className="btn" onClick={() => navigate(reviewRoute("quizzes"))}>
            {t("Back to Review")}
          </button>
          {confirm ? (
            <span className="qz-confirm">
              {t("Delete this quiz and its grammar evidence?")}
              <button className="btn btn-danger-o btn-s" disabled={!!busy} onClick={onDelete}>
                {t("Delete")}
              </button>
              <button className="btn btn-s" onClick={() => setConfirm(false)}>
                {t("Keep")}
              </button>
            </span>
          ) : (
            <button className="linkb" onClick={() => setConfirm(true)}>
              {t("Delete quiz")}
            </button>
          )}
        </div>
      </section>

      <section className="qz-again" aria-labelledby="qz-a-h">
        <h2 id="qz-a-h" className="eyebrow">
          {review.length ? t("What to look at again") : t("Every answer was right")}
        </h2>
        {review.length === 0 ? (
          <p className="muted">{t("Nothing to look at again. Try a longer quiz or a higher level next time.")}</p>
        ) : (
          <ol>
            {review.map((q) => (
              <ReviewRow key={q.id} q={q} L={L} language={language} navigate={navigate} />
            ))}
          </ol>
        )}
      </section>

      {s.grammar.length > 0 && (
        <section className="qz-gram" aria-labelledby="qz-g-h">
          <h2 id="qz-g-h" className="eyebrow">
            {t("Grammar in this quiz")}
          </h2>
          <ul>
            {s.grammar.map((g) => (
              <li key={g.grammarId}>
                <button className="qz-grow" onClick={() => navigate(grammarRoute(g.grammarId))}>
                  <span className={cls("qz-grow-p", L)}>{g.label}</span>
                  <span className="mono">{t("{right} of {total} right", { right: g.correct, total: g.correct + g.incorrect + g.uncertain })}</span>
                  <Icon name="arrow" size={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="qz-all">
        <summary>{tn(s.total, "All {count} answer", "All {count} answers")}</summary>
        <ol>
          {view.questions.map((q) => (
            <ReviewRow key={q.id} q={q} L={L} language={language} navigate={navigate} compact />
          ))}
        </ol>
      </details>
    </div>
  );
}

function ReviewRow({ q, L, language, navigate, compact }: { q: QuizQuestion; L: string; language: Language; navigate: Navigate; compact?: boolean }) {
  const a = q.answered;
  const v = a ? VERDICT[a.verdict] : null;
  return (
    <li className={cls("qz-rr", compact && "compact")}>
      <span className={cls("qz-rr-v", v?.cls ?? "v-unc")} title={v ? t(v.label) : t("Not answered")}>
        <Icon name={v?.icon ?? "more"} size={13} stroke={2.2} />
      </span>
      <div className="qz-rr-b">
        <div className={cls("qz-rr-q", L)}>{q.text ? <AnnotatedText as="span" language={language} text={q.text.replace("___", "＿＿")} /> : <span className="qz-rr-ctx">{q.context ?? q.prompt}</span>}</div>
        {a && (
          <div className="qz-rr-a">
            {a.verdict !== "correct" && a.response && (
              <span className={cls("qz-rr-mine", L)}>
                <s>{a.response}</s>
              </span>
            )}
            <span className={cls("qz-rr-key", L)}>{a.better && a.verdict !== "correct" ? a.better : a.answer}</span>
          </div>
        )}
        {!compact && a && <p className="qz-rr-ex">{a.explanation}</p>}
      </div>
      {q.grammarId && (
        <button className={cls("chip chip-s", L)} onClick={() => navigate(grammarRoute(q.grammarId!))}>
          {q.grammarLabel ?? t("Grammar")}
        </button>
      )}
    </li>
  );
}
