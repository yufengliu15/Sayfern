// Review > Quizzes: the quiz builder and recent quizzes (S2-04..S2-09). Owned by the quiz feature.
// The builder is a sentence with green words; each opens a small popover of choices. Counts,
// minutes and provenance come from the backend (computed locally, never by a model).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Language } from "../../../../shared/records";
import type {
  QuizChapter,
  QuizEstimate,
  QuizFocus,
  QuizFormat,
  QuizFormatChoice,
  QuizLength,
  QuizLevel,
  QuizListItem,
  QuizOptions,
  QuizSource,
  QuizSpec,
} from "../../../../shared/stage2";
import { api, errorText } from "../../api";
import { Icon } from "../../components/icons";
import { useApp } from "../../context";
import { cls, fmtShortDate, fontOf } from "../../lib/format";
import { useDismiss } from "../../lib/hooks";
import { quizRoute, settingsRoute, type Navigate } from "../../router";
import { FOCUS_WORD, FORMAT_HEAD, FORMAT_WORD, lengthWord, levelWord, QuizPreview, ScoreText, sourceWord } from "./QuizParts";
import { msg, t, tj, tn } from "../../i18n";

export interface QuizzesTabProps {
  language: Language;
  navigate: Navigate;
}

interface Builder {
  focus: QuizFocus;
  source: QuizSource | null;
  level: QuizLevel;
  format: QuizFormatChoice;
  length: QuizLength;
}

type PickerKey = "focus" | "source" | "level" | "format" | "length";

const DEFAULT: Builder = { focus: "grammar", source: { kind: "mistakes" }, level: { kind: "current" }, format: "mixed", length: { questions: 10 } };
const FOCI: QuizFocus[] = ["grammar", "vocabulary", "scenarios", "exam", "mixed"];
const FORMATS: QuizFormatChoice[] = ["mixed", "multiple_choice", "cloze", "ordering", "written", "scenario"];
const LENGTHS: QuizLength[] = [{ questions: 5 }, { questions: 10 }, { questions: 20 }, { minutes: 5 }, { minutes: 10 }, { minutes: 15 }];
const FOCUS_HINT: Record<QuizFocus, string> = {
  grammar: msg("Patterns you've met"),
  vocabulary: msg("Words and how they're used"),
  scenarios: msg("Everyday situations and role-play"),
  exam: msg("{exams} style items"),
  mixed: msg("Grammar, words and scenes together"),
};
const FORMAT_HINT: Record<QuizFormatChoice, string> = {
  mixed: msg("A mix suited to the focus"),
  multiple_choice: msg("Graded on this Mac"),
  cloze: msg("Type the missing word. Graded on this Mac"),
  ordering: msg("Tap tiles into a sentence. Graded on this Mac"),
  written: msg("Checked by the model"),
  scenario: msg("Reply in a short role-play. Checked by the model"),
};
const MIX_FIRST: Record<QuizFocus, QuizFormat> = { grammar: "cloze", vocabulary: "multiple_choice", scenarios: "scenario", exam: "multiple_choice", mixed: "multiple_choice" };

const storeKey = (l: Language) => `sayfern.quizBuilder.${l}`;

function loadBuilder(language: Language): Builder {
  try {
    const raw = localStorage.getItem(storeKey(language));
    if (raw) return { ...DEFAULT, ...(JSON.parse(raw) as Partial<Builder>) };
  } catch {
    // ignore
  }
  return DEFAULT;
}

function sameSource(a: QuizSource | null, b: QuizSource | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Why a source can't be used right now, or null. */
function sourceProblem(s: QuizSource | null, o: QuizOptions, b: Builder): string | null {
  if (!s) return b.focus === "exam" || b.level.kind === "exam" ? null : t("Only for exam practice");
  const c = o.counts;
  switch (s.kind) {
    case "mistakes":
      return c.mistakes ? null : t("No corrections yet");
    case "anki":
      if (!o.ankiEnabled) return t("Turn on Anki in Settings");
      if (o.ankiSyncedAt == null) return t("Sync Anki first");
      return (s.anki === "struggling" ? c.ankiStruggling : s.anki === "all" ? c.ankiAll : c.ankiRecent) ? null : t("No words here yet");
    case "grammar":
      return c.grammar ? null : t("No grammar points yet");
    case "document":
      if (!o.docs.length) return t("Add a book to your library");
      return !s.docId || o.docs.some((d) => d.docId === s.docId) ? null : t("That book is no longer in your library");
    case "targets":
      return c.targets ? null : t("Nothing to target yet");
    case "saved_words":
      return c.savedWords ? null : t("No saved words yet");
  }
}

export function QuizzesTab({ language, navigate }: QuizzesTabProps) {
  const app = useApp();
  const L = app.lang.fontClass;
  const [b, setB] = useState<Builder>(() => loadBuilder(language));
  const [options, setOptions] = useState<QuizOptions | null>(null);
  const [estimate, setEstimate] = useState<QuizEstimate | null>(null);
  const [recent, setRecent] = useState<QuizListItem[] | null>(null);
  const [open, setOpen] = useState<PickerKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .quizOptions(language)
      .then((o) => alive && setOptions(o))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [language]);

  // Recent quizzes; poll while one is being written.
  const generating = recent?.some((q) => q.status === "generating") ?? false;
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .listQuizzes(language)
        .then((l) => alive && setRecent(l))
        .catch(() => alive && setRecent([]));
    void load();
    const timer = generating ? window.setInterval(load, 1500) : undefined;
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [language, generating]);

  // Keep the source valid when options load or the focus/level changes.
  useEffect(() => {
    if (!options) return;
    if (!sourceProblem(b.source, options, b)) return;
    const candidates: (QuizSource | null)[] = [
      { kind: "mistakes" },
      { kind: "grammar" },
      { kind: "anki", anki: "recent" },
      { kind: "targets" },
      { kind: "saved_words" },
      null,
    ];
    const next = candidates.find((c) => !sourceProblem(c, options, b));
    if (next !== undefined && !sameSource(next, b.source)) setB((x) => ({ ...x, source: next }));
  }, [options, b]);

  const spec: QuizSpec = useMemo(
    () => ({ language, focus: b.focus, sources: b.source ? [b.source] : [], level: b.level, format: b.format, length: b.length }),
    [language, b],
  );

  useEffect(() => {
    try {
      localStorage.setItem(storeKey(language), JSON.stringify(b));
    } catch {
      // ignore
    }
    let alive = true;
    api
      .estimateQuiz(spec)
      .then((e) => alive && setEstimate(e))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [spec, language, b]);

  const set = (patch: Partial<Builder>) => {
    setB((x) => ({ ...x, ...patch }));
    setOpen(null);
    setError(null);
  };

  const problem = options ? sourceProblem(b.source, options, b) : null;
  const canStart = !!app.model && !!options && !problem && !busy;

  const start = async () => {
    if (!app.model) return;
    setBusy(true);
    setError(null);
    try {
      const v = await api.startQuiz(spec, app.model);
      navigate(quizRoute(v.id));
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const previewFormat: QuizFormat = b.format === "mixed" ? MIX_FIRST[b.focus] : b.format;
  const examNames = (options?.exams ?? []).map((e) => e.name).join(" / ") || "Exam";
  const focusHint = (f: QuizFocus) => t(FOCUS_HINT[f], { exams: examNames });

  return (
    <div className="qz-grid">
      <section className="qz-build" aria-label={t("Make a quiz")}>
        <div className="eyebrow">{t("Tap the green words to change them")}</div>
        <p className="qz-mad">
          {tj("Quiz me on {focus} from {source}, at {level}, as {format}, for {length}.", {
            focus: (
              <Picker k="focus" label={t(FOCUS_WORD[b.focus])} open={open} setOpen={setOpen} title={t("Focus")}>
                {FOCI.map((f) => (
                  <Opt key={f} on={b.focus === f} label={t(FOCUS_WORD[f])} hint={focusHint(f)} onPick={() => set({ focus: f })} />
                ))}
              </Picker>
            ),
            source: (
              <Picker k="source" label={sourceWord(b.source, options)} open={open} setOpen={setOpen} title={t("Source")} wide>
                <SourceMenu options={options} b={b} onPick={(source) => set({ source })} />
              </Picker>
            ),
            level: (
          <Picker k="level" label={levelWord(b.level)} open={open} setOpen={setOpen} title={t("Level")}>
            <Opt
              on={b.level.kind === "current"}
              label={t("My level")}
              hint={options?.currentLevel ? t("Your current estimate: {level}", { level: options.currentLevel }) : t("Not placed yet: kept simple")}
              onPick={() => set({ level: { kind: "current" } })}
            />
            {options?.exams.map((ex) => (
              <div key={ex.exam} className="qz-pop-group">
                <div className="mh">{ex.name}</div>
                <div className="qz-levels">
                  {ex.levels.map((lv) => {
                    const on = b.level.kind === "exam" && b.level.exam === ex.exam && b.level.level === lv;
                    return (
                      <button key={lv} type="button" role="menuitemradio" aria-checked={on} className={cls("chip chip-s", on && "on")} onClick={() => set({ level: { kind: "exam", exam: ex.exam, level: lv } })}>
                        {lv}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </Picker>
            ),
            format: (
              <Picker k="format" label={t(FORMAT_WORD[b.format])} open={open} setOpen={setOpen} title={t("Format")}>
                {FORMATS.map((f) => (
                  <Opt key={f} on={b.format === f} label={t(FORMAT_WORD[f])} hint={t(FORMAT_HINT[f])} onPick={() => set({ format: f })} />
                ))}
              </Picker>
            ),
            length: (
              <Picker k="length" label={lengthWord(b.length)} open={open} setOpen={setOpen} title={t("Length")}>
                {LENGTHS.map((l) => (
                  <Opt key={lengthWord(l)} on={lengthWord(b.length) === lengthWord(l)} label={lengthWord(l)} onPick={() => set({ length: l })} />
                ))}
              </Picker>
            ),
          })}
        </p>

        <div className="qz-go">
          <button className="btn btn-f btn-l qz-start" disabled={!canStart} onClick={() => void start()}>
            {busy ? t("Starting…") : t("Start quiz")} <Icon name="arrow" size={18} stroke={2} />
          </button>
          {estimate && (
            <span className="muted qz-mins">
              {tn(estimate.minutes, "About {count} minute", "About {count} minutes")}
              {"minutes" in b.length ? ` · ${tn(estimate.questions, "{count} question", "{count} questions")}` : ""}
            </span>
          )}
        </div>
        {!app.model && (
          <p className="err quiet">
            {t("Connect a model to make quizzes.")}{" "}
            <button className="linkb" onClick={() => navigate(settingsRoute("models"))}>
              {t("Open Settings")}
            </button>
          </p>
        )}
        {problem && options && <p className="err quiet">{t("{problem}. Pick another source.", { problem })}</p>}
        {error && (
          <p className="err" role="alert">
            <Icon name="alert" size={15} /> {t(error)}
          </p>
        )}
        {estimate?.exam && (
          <div className="qz-prov">
            <Icon name="flag" size={15} />
            <span>{estimate.provenance}</span>
          </div>
        )}
      </section>

      <aside className="qz-side">
        <div className="card qz-prev-card">
          <div className="qz-prev-head">
            <span className="eyebrow">{t("Question 1 preview")}</span>
            <span className="eyebrow">{t(FORMAT_HEAD[previewFormat])}</span>
          </div>
          <QuizPreview language={language} format={previewFormat} L={L} />
          <div className="qz-note">{t("Graded on this Mac. Written answers go to the model.")}</div>
        </div>
        <div>
          <div className="eyebrow qz-rq-h">{t("Recent quizzes")}</div>
          {recent === null ? (
            <div className="skel-row" />
          ) : recent.length === 0 ? (
            <p className="qz-empty">{t("Your quizzes show up here, with scores worked out on this Mac.")}</p>
          ) : (
            <ul className="qz-rq-list">
              {recent.slice(0, 6).map((q) => (
                <li key={q.id}>
                  <button className="qz-rq" onClick={() => navigate(quizRoute(q.id))} title={`${q.alignment} · ${fmtShortDate(q.createdAt)}`}>
                    <span className="qz-rq-t">{q.title}</span>
                    <span className="mono qz-rq-s">
                      <ScoreText q={q} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="qz-foot">{t("Quiz results feed your grammar pages as prompted practice, kept apart from conversation.")}</p>
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------- picker

function Picker({
  k,
  label,
  open,
  setOpen,
  title,
  wide,
  children,
}: {
  k: PickerKey;
  label: string;
  open: PickerKey | null;
  setOpen(k: PickerKey | null): void;
  title: string;
  wide?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const isOpen = open === k;
  const [alignRight, setAlignRight] = useState(false);
  useDismiss(ref, isOpen, () => setOpen(null));
  useEffect(() => {
    if (!isOpen) return;
    const r = ref.current?.getBoundingClientRect();
    if (r) setAlignRight(r.left + (wide ? 380 : 320) > window.innerWidth - 16);
    // Focus the selected (or first) option for keyboard users.
    const el = popRef.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? popRef.current?.querySelector<HTMLElement>("button:not(:disabled)");
    el?.focus();
  }, [isOpen, wide]);
  return (
    <span className="pk-wrap" ref={ref}>
      <button type="button" className={cls("pk", isOpen && "open")} aria-haspopup="menu" aria-expanded={isOpen} aria-label={`${title}: ${label}`} onClick={() => setOpen(isOpen ? null : k)}>
        {label}
      </button>
      {isOpen && (
        <div ref={popRef} className={cls("qz-pop", wide && "wide", alignRight && "right")} role="menu" aria-label={title}>
          {children}
        </div>
      )}
    </span>
  );
}

function Opt({ on, label, hint, count, disabled, onPick }: { on: boolean; label: string; hint?: string; count?: number | null; disabled?: boolean; onPick(): void }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={on} disabled={disabled} className={cls("qz-opt", on && "on")} onClick={onPick}>
      <span className="qz-opt-t">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      {count != null && <span className="qz-opt-n mono">{count}</span>}
      {on && <Icon name="check" size={15} stroke={2.2} />}
    </button>
  );
}

function SourceMenu({ options, b, onPick }: { options: QuizOptions | null; b: Builder; onPick(s: QuizSource | null): void }) {
  const [view, setView] = useState<"main" | "grammar" | "docs">(b.source?.kind === "grammar" && b.source.grammarIds?.length ? "grammar" : "main");
  const [picked, setPicked] = useState<string[]>(b.source?.kind === "grammar" ? (b.source.grammarIds ?? []) : []);
  const [doc, setDoc] = useState<string | null>(b.source?.kind === "document" ? (b.source.docId ?? null) : null);
  const [chapters, setChapters] = useState<QuizChapter[] | null>(null);

  useEffect(() => {
    if (!doc) return;
    let alive = true;
    setChapters(null);
    api
      .quizChapters(doc)
      .then((c) => alive && setChapters(c))
      .catch(() => alive && setChapters([]));
    return () => {
      alive = false;
    };
  }, [doc]);

  if (!options) return <div className="qz-pop-load">{t("Loading…")}</div>;
  const c = options.counts;
  const item = (s: QuizSource | null, label: string, count: number | null, hint?: string) => {
    const problem = sourceProblem(s, options, b);
    return <Opt key={label} on={sameSource(s, b.source)} label={label} hint={problem ?? hint} count={count} disabled={!!problem} onPick={() => onPick(s)} />;
  };

  if (view === "grammar") {
    return (
      <div className="qz-sub">
        <button type="button" className="qz-back" onClick={() => setView("main")}>
          <Icon name="back" size={14} /> {t("Sources")}
        </button>
        <div className="qz-check-list">
          {options.grammar.map((g) => {
            const on = picked.includes(g.id);
            return (
              <label key={g.id} className={cls("qz-check", on && "on")}>
                <input type="checkbox" checked={on} onChange={() => setPicked(on ? picked.filter((x) => x !== g.id) : [...picked, g.id])} />
                <span className={cls("qz-check-p", fontOf(options.language))}>{g.pattern}</span>
                <span className="qz-check-n">{g.name}</span>
                {g.level && <span className="qz-check-l">{g.level}</span>}
              </label>
            );
          })}
        </div>
        <div className="qz-sub-foot">
          <button type="button" className="btn btn-p btn-s" disabled={!picked.length} onClick={() => onPick({ kind: "grammar", grammarIds: picked })}>
            {picked.length ? tn(picked.length, "Use {count} pattern", "Use {count} patterns") : t("Use these patterns")}
          </button>
        </div>
      </div>
    );
  }

  if (view === "docs") {
    return (
      <div className="qz-sub">
        <button type="button" className="qz-back" onClick={() => setView("main")}>
          <Icon name="back" size={14} /> {t("Sources")}
        </button>
        {options.docs.map((d) => (
          <Opt key={d.docId} on={doc === d.docId} label={d.title} hint={tn(d.paragraphs, "{count} paragraph", "{count} paragraphs")} onPick={() => setDoc(d.docId)} />
        ))}
        {doc && (
          <div className="qz-pop-group">
            <div className="mh">{t("Which part")}</div>
            <Opt on={b.source?.kind === "document" && b.source.docId === doc && !b.source.chapter} label={t("Where I'm reading now")} onPick={() => onPick({ kind: "document", docId: doc })} />
            {chapters === null ? (
              <div className="qz-pop-load">{t("Loading chapters…")}</div>
            ) : (
              chapters.map((ch) => (
                <Opt
                  key={ch.heading}
                  on={b.source?.kind === "document" && b.source.docId === doc && b.source.chapter === ch.heading}
                  label={ch.heading}
                  hint={tn(ch.paragraphs, "{count} paragraph", "{count} paragraphs")}
                  onPick={() => onPick({ kind: "document", docId: doc, chapter: ch.heading })}
                />
              ))
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {item({ kind: "mistakes" }, t("my mistakes"), c.mistakes, t("Corrections and wrong quiz answers"))}
      {item({ kind: "anki", anki: "recent" }, t("this week's Anki"), options.ankiEnabled ? c.ankiRecent : null, t("Reviewed in the last 7 days"))}
      {item({ kind: "anki", anki: "struggling" }, t("my hardest Anki words"), options.ankiEnabled ? c.ankiStruggling : null)}
      {item({ kind: "anki", anki: "all" }, t("my Anki words"), options.ankiEnabled ? c.ankiAll : null)}
      {item({ kind: "targets" }, t("my goals"), null, options.goal ? t("\"{goal}\" and what to follow up", { goal: options.goal }) : t("Grammar to follow up and Anki targets"))}
      {item({ kind: "saved_words" }, t("my saved words"), c.savedWords)}
      {item({ kind: "grammar" }, t("grammar I'm working on"), c.grammarToWork, t("Patterns not yet used on your own"))}
      <button type="button" className="qz-opt more" disabled={!c.grammar} onClick={() => setView("grammar")}>
        <span className="qz-opt-t">
          <span>{t("Pick grammar points…")}</span>
          <small>{c.grammar ? t("{n} in your records", { n: c.grammar }) : t("No grammar points yet")}</small>
        </span>
        <Icon name="chev" size={15} />
      </button>
      <button type="button" className="qz-opt more" disabled={!options.docs.length} onClick={() => setView("docs")}>
        <span className="qz-opt-t">
          <span>{t("A book or chapter…")}</span>
          <small>{options.docs.length ? t("From your library") : t("Add a book to your library")}</small>
        </span>
        <Icon name="chev" size={15} />
      </button>
      {(b.focus === "exam" || b.level.kind === "exam") && item(null, t("anything at this level"), null, t("General exam-style practice"))}
    </>
  );
}
