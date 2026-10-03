// Shared bits for the quiz builder (QuizzesTab) and the quiz screen (Quiz.tsx).
import type { Language } from "../../../../shared/records";
import type { QuizFocus, QuizFormat, QuizFormatChoice, QuizLength, QuizLevel, QuizListItem, QuizOptions, QuizSource } from "../../../../shared/stage2";
import type { ReactNode } from "react";
import { cls } from "../../lib/format";
import { QUIZ_SAMPLES } from "../../lib/samples";
import { msg, t, tn } from "../../i18n";

/** Question header per format (translate with t() where it renders). */
export const FORMAT_HEAD: Record<QuizFormat, string> = {
  multiple_choice: msg("Choose one"),
  cloze: msg("Fill the gap"),
  ordering: msg("Put the words in order"),
  written: msg("Write your answer"),
  scenario: msg("Role-play"),
};

export const FOCUS_WORD: Record<QuizFocus, string> = {
  grammar: msg("grammar"),
  vocabulary: msg("vocabulary"),
  scenarios: msg("real-life scenes"),
  exam: msg("exam prep"),
  mixed: msg("a bit of everything"),
};

export const FORMAT_WORD: Record<QuizFormatChoice, string> = {
  mixed: msg("mixed formats"),
  multiple_choice: msg("multiple choice"),
  cloze: msg("fill the gap"),
  ordering: msg("sentence order"),
  written: msg("written answers"),
  scenario: msg("role-play"),
};

/** Translated. */
export function lengthWord(l: QuizLength): string {
  return "minutes" in l ? tn(l.minutes, "{count} minute", "{count} minutes") : tn(l.questions, "{count} question", "{count} questions");
}

/** "HSK 3", "HSK 4 (3.0)", "N4", "my level" (translated). */
export function levelWord(l: QuizLevel): string {
  if (l.kind === "current") return t("my level");
  if (l.exam === "hsk3") return `${l.level} (3.0)`;
  return l.level;
}

/** Translated. */
export function sourceWord(s: QuizSource | null, o: QuizOptions | null): string {
  if (!s) return t("anything at this level");
  switch (s.kind) {
    case "mistakes":
      return t("my mistakes");
    case "anki":
      return s.anki === "struggling" ? t("my hardest Anki words") : s.anki === "all" ? t("my Anki words") : t("this week's Anki");
    case "grammar": {
      const ids = s.grammarIds ?? [];
      if (!ids.length) return t("grammar I'm working on");
      if (ids.length === 1) return o?.grammar.find((g) => g.id === ids[0])?.pattern ?? t("one pattern");
      return t("{n} grammar points", { n: ids.length });
    }
    case "document": {
      const title = o?.docs.find((d) => d.docId === s.docId)?.title ?? t("a document");
      return s.chapter ? s.chapter : title;
    }
    case "targets":
      return t("my goals");
    case "saved_words":
      return t("my saved words");
  }
}

export function ScoreText({ q }: { q: Pick<QuizListItem, "status" | "answered" | "total" | "correct"> }) {
  if (q.status === "generating") return <span className="muted">{t("writing…")}</span>;
  if (q.status !== "finished") return <span className="muted">{q.answered ? t("{n} of {total}", { n: q.answered, total: q.total }) : t("not started")}</span>;
  return (
    <span>
      {q.correct}/{q.total}
    </span>
  );
}


/** Gap-aware sentence: "___" becomes a drawn blank (or children, e.g. an input). */
export function GapText({ text, fill, className }: { text: string; fill?: ReactNode; className?: string }) {
  const at = text.indexOf("___");
  if (at < 0) return <span className={className}>{text}</span>;
  return (
    <span className={className}>
      {text.slice(0, at)}
      {fill ?? <span className="qz-blank" aria-label={t("blank")} />}
      {text.slice(at + 3)}
    </span>
  );
}

/** Static first-question preview for the builder. */
export function QuizPreview({ language, format, L }: { language: Language; format: QuizFormat; L: string }) {
  const s = QUIZ_SAMPLES[language][format];
  return (
    <div className="qz-prev" aria-hidden="true">
      {s.context && <p className="qz-prev-ctx">{t(s.context)}</p>}
      {s.text && <div className={cls("qz-prev-text", L)}>{format === "cloze" || format === "multiple_choice" ? <GapText text={s.text} /> : s.text}</div>}
      {s.choices && (
        <div className="qz-prev-opts">
          {s.choices.map((c) => (
            <span key={c} className={cls("qz-prev-opt", L)}>
              <i />
              {c}
            </span>
          ))}
        </div>
      )}
      {s.tiles && (
        <div className="qz-tiles">
          {s.tiles.map((t) => (
            <span key={t} className={cls("qz-tile", L)}>
              {t}
            </span>
          ))}
        </div>
      )}
      {(format === "written" || format === "scenario") && <div className="qz-prev-box" />}
    </div>
  );
}
