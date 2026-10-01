// S1-06 / S1-20: a correction the learner can retry, reveal or dispute.
import { useState } from "react";
import type { Correction, GrammarSummary, Language } from "../../../shared/records";
import type { ModelRef } from "../../../shared/types";
import { api, errorText } from "../api";
import { cls, sentenceAt } from "../lib/format";
import { Icon } from "./icons";

export interface CorrectionCardProps {
  correction: Correction;
  language: Language;
  /** Full text of the learner message, for showing the fix in context. */
  messageText?: string;
  grammar?: GrammarSummary;
  model?: ModelRef;
  onUpdate(c: Correction): void;
  onOpenGrammar?(grammarId: string): void;
  /** "inline" sits under the learner bubble with a notch; "sheet" is used in the end-of-session summary. */
  variant?: "inline" | "sheet";
}

type Stage = "ask" | "retry" | "dispute";

const KIND_WORD: Record<Correction["kind"], string> = {
  grammar: "Grammar",
  vocabulary: "Word choice",
  phrasing: "Phrasing",
  style: "Style",
};

export function CorrectionCard({ correction: c, language, messageText, grammar, model, onUpdate, onOpenGrammar, variant = "inline" }: CorrectionCardProps) {
  const [stage, setStage] = useState<Stage>("ask");
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const style = c.kind === "style";
  const done = c.status === "revealed" || c.status === "retried_ok";
  const disputed = c.status === "disputed";
  const L = language;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const check = () =>
    run(async () => {
      if (!model || !draft.trim()) return;
      const r = await api.checkRetry(c.id, draft.trim(), model);
      setFeedback({ ok: r.ok, text: r.feedback });
      onUpdate(r.correction);
      if (r.ok) setStage("ask");
    });

  const reveal = () =>
    run(async () => {
      onUpdate(await api.revealCorrection(c.id));
      setStage("ask");
    });

  const dispute = () =>
    run(async () => {
      onUpdate(await api.disputeCorrection(c.id, note.trim()));
      setStage("ask");
    });

  // Context: the sentence of the learner message that holds the problem span.
  const idx = messageText ? messageText.indexOf(c.original) : -1;
  const context = idx >= 0 && messageText ? sentenceAt(messageText, idx) : c.original;
  const at = context.indexOf(c.original);
  const before = at >= 0 ? context.slice(0, at) : "";
  const after = at >= 0 ? context.slice(at + c.original.length) : "";

  const title = disputed
    ? "Marked as not a mistake"
    : style
      ? "A more natural way to say"
      : done
        ? c.status === "retried_ok"
          ? "Fixed"
          : "Here's the fix for"
        : "One thing to fix in";

  return (
    <div className={cls("corr", `corr-${variant}`, style && "corr-style", done && "corr-done", disputed && "corr-disputed")} role="group" aria-label={style ? "Suggestion" : "Correction"}>
      <div className="corr-h">
        <Icon name={style ? "spark" : disputed ? "flag" : "pen"} size={15} />
        <span>
          {title} <span className={cls("corr-q", L)}>{c.original}</span>
        </span>
        <span className="corr-kind">{style ? "Suggestion" : KIND_WORD[c.kind]}</span>
      </div>

      {disputed && (
        <>
          <p>Thanks. This one won't count against you, and the tutor will take your note into account.</p>
          {c.disputeNote && <p className="corr-note">"{c.disputeNote}"</p>}
        </>
      )}

      {!disputed && !done && stage === "ask" && (
        <>
          <p>
            {style
              ? "What you wrote works. Want to try a smoother version before I show one?"
              : c.status === "retried_wrong"
                ? "Not quite yet. Have another go, or I can show you."
                : "Have another go at this part before I show you?"}
          </p>
          {feedback && !feedback.ok && <p className="corr-fb bad">{feedback.text}</p>}
          <div className="corr-actions">
            <button className="btn btn-p btn-s" onClick={() => setStage("retry")} disabled={busy}>
              Try again
            </button>
            <button className="btn btn-s" onClick={reveal} disabled={busy}>
              Show answer
            </button>
            {!style && (
              <button className="linkb" onClick={() => setStage("dispute")} disabled={busy}>
                Not a mistake?
              </button>
            )}
          </div>
        </>
      )}

      {!disputed && !done && stage === "retry" && (
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            void check();
          }}
        >
          <label htmlFor={`retry-${c.id}`}>Rewrite it your way</label>
          {feedback && !feedback.ok && <p className="corr-fb bad">{feedback.text}</p>}
          <div className="corr-row">
            <input
              id={`retry-${c.id}`}
              className={cls("input", L)}
              autoFocus
              placeholder={c.original}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === "Escape") setStage("ask");
              }}
            />
            <button className="btn btn-p btn-s tall" type="submit" disabled={busy || !draft.trim() || !model}>
              {busy ? "Checking…" : "Check"}
            </button>
          </div>
          <div className="corr-actions">
            <button type="button" className="btn btn-s" onClick={reveal} disabled={busy}>
              Show answer
            </button>
            <button type="button" className="linkb" onClick={() => setStage("ask")}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {!disputed && !done && stage === "dispute" && (
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            void dispute();
          }}
        >
          <label htmlFor={`dispute-${c.id}`}>Why is it right? A few words is enough.</label>
          <div className="corr-row">
            <input
              id={`dispute-${c.id}`}
              className="input"
              autoFocus
              maxLength={200}
              placeholder="e.g. My textbook uses this form"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setStage("ask")}
            />
            <button className="btn btn-p btn-s tall" type="submit" disabled={busy}>
              Send note
            </button>
          </div>
          <div className="corr-actions">
            <button type="button" className="linkb" onClick={() => setStage("ask")}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {!disputed && done && (
        <>
          <div className="diff">
            <span className={cls("o", L)}>
              {before}
              <s>{c.original}</s>
              {after}
            </span>
            <span className={cls("n", L)}>
              {before}
              <b>{c.corrected}</b>
              {after}
            </span>
          </div>
          {feedback?.ok && <p className="corr-fb ok">{feedback.text}</p>}
          <p>{c.explanation}</p>
          <div className="corr-actions wrap">
            {c.status === "retried_ok" && <span className="st st-help">Fixed on retry · logged separately</span>}
            {c.grammarId && (
              <button className="chip" onClick={() => onOpenGrammar?.(c.grammarId!)}>
                <Icon name="grammar" size={14} />
                <span className={L}>{grammar?.point.pattern ?? "See the pattern"}</span>
                {grammar && <span className="muted">{grammar.point.name}</span>}
              </button>
            )}
          </div>
        </>
      )}

      {error && (
        <div className="err">
          <Icon name="alert" size={15} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
