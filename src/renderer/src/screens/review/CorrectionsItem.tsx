// One correction in Review > Corrections (S2-01, S2-02): the learner's sentence with the
// problem struck in red pen, the revision with the fixed part highlighted, the explanation and
// where it came from. "Hide answers and retry" hides the revision until the learner checks or
// reveals. Retry, reveal and dispute use the Stage 1 API (checkRetry, revealCorrection, disputeCorrection).
import { useState } from "react";
import type { Correction } from "../../../../shared/records";
import type { ReviewItem } from "../../../../shared/stage2";
import type { ModelRef } from "../../../../shared/types";
import { api, errorText } from "../../api";
import { Icon } from "../../components/icons";
import { cjkClass, cls, fmtShortDate } from "../../lib/format";
import { grammarRoute, sessionRoute, type Navigate } from "../../router";
import { msg, t } from "../../i18n";

export const KIND_LABEL: Record<Correction["kind"], string> = {
  grammar: msg("Grammar"),
  typo: msg("Typo"),
  speaking: msg("Speaking"),
};
const KIND_CLASS: Record<Correction["kind"], string> = { grammar: "k-g", typo: "k-t", speaking: "k-s" };

export interface CorrectionsItemProps {
  item: ReviewItem;
  /** Language font class (zh / ja). */
  fontClass: string;
  hideAnswers: boolean;
  selecting: boolean;
  selected: boolean;
  onToggle(): void;
  onUpdate(c: Correction): void;
  model?: ModelRef;
  navigate: Navigate;
}

type Mode = "idle" | "retry" | "dispute";

export function CorrectionsItem({ item, fontClass: L, hideAnswers, selecting, selected, onToggle, onUpdate, model, navigate }: CorrectionsItemProps) {
  const c = item.correction;
  const [mode, setMode] = useState<Mode>("idle");
  /** Answer shown in hide mode (after a right retry or "Show answer"). */
  const [shown, setShown] = useState(false);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const disputed = c.status === "disputed";
  const retrying = (hideAnswers && !shown && !disputed) || mode === "retry";
  const showAnswer = !retrying || shown;
  const boxId = `rv-sel-${c.id}`;
  const retryId = `rv-retry-${c.id}`;

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
      const text = draft.trim();
      if (!model || !text) return;
      const r = await api.checkRetry(c.id, text, model);
      setFeedback({ ok: r.ok, text: r.feedback });
      onUpdate(r.correction);
      if (r.ok) {
        setShown(true);
        setMode("idle");
      }
    });

  const reveal = () =>
    run(async () => {
      // Seeing the answer again doesn't undo a fix on retry (or a dispute).
      if (c.status === "open" || c.status === "retried_wrong") onUpdate(await api.revealCorrection(c.id));
      setShown(true);
      setMode("idle");
    });

  const dispute = () =>
    run(async () => {
      onUpdate(await api.disputeCorrection(c.id, note.trim()));
      setMode("idle");
    });

  const at = item.sentence.indexOf(c.original);
  const before = at >= 0 ? item.sentence.slice(0, at) : "";
  const after = at >= 0 ? item.sentence.slice(at + c.original.length) : "";
  const strike = at >= 0 ? c.original : item.sentence;

  const status =
    c.status === "retried_ok"
      ? { label: t("Fixed on retry"), cls: "rv-st-ok" }
      : c.status === "revealed"
        ? { label: t("Answer shown"), cls: "" }
        : c.status === "retried_wrong"
          ? { label: t("Not fixed yet"), cls: "rv-st-bad" }
          : null;

  return (
    <li className={cls("rv-item", selecting && "selecting", selected && "sel", disputed && "disputed")}>
      {selecting && (
        <div className="rv-check">
          <input
            type="checkbox"
            id={boxId}
            checked={selected}
            disabled={disputed}
            onChange={onToggle}
            title={disputed ? t("You marked this as not a mistake, so it isn't exported.") : undefined}
          />
          <label htmlFor={boxId} className="sr">
            {t("Select for export")}
          </label>
        </div>
      )}
      <div className="rv-main">
        <div className={cls("rv-o", L)}>
          {before}
          <s>{strike}</s>
          {after}
        </div>

        {showAnswer && (
          <>
            <div className={cls("rv-n", L)}>
              {item.revised.before}
              <b>{item.revised.fixed}</b>
              {item.revised.after}
            </div>
            {feedback?.ok && <p className="rv-fb ok">{t(feedback.text)}</p>}
            <p className="rv-why">{c.explanation}</p>
          </>
        )}

        {retrying && !shown && (
          <form
            className="rv-retry"
            onSubmit={(e) => {
              e.preventDefault();
              void check();
            }}
          >
            <label className="sr" htmlFor={retryId}>
              {t("Your retry")}
            </label>
            <input
              id={retryId}
              className={cls("input", L)}
              placeholder={t("Write it correctly…")}
              value={draft}
              autoFocus={mode === "retry"}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === "Escape" && mode === "retry") setMode("idle");
              }}
            />
            <button className="btn btn-s tall" type="submit" disabled={busy || !draft.trim() || !model} title={!model ? t("Pick a model to check retries") : undefined}>
              {busy ? t("Checking…") : t("Check")}
            </button>
            <button type="button" className="linkb" onClick={() => void reveal()} disabled={busy}>
              {t("Show answer")}
            </button>
          </form>
        )}
        {retrying && !shown && feedback && !feedback.ok && <p className="rv-fb bad">{t(feedback.text)}</p>}

        {disputed && (
          <p className="rv-dispute">
            <Icon name="flag" size={13} />{" "}
            {c.disputeNote ? t("You marked this as not a mistake: \"{note}\"", { note: c.disputeNote }) : t("You marked this as not a mistake.")}
          </p>
        )}

        {mode === "dispute" && (
          <form
            className="rv-retry"
            onSubmit={(e) => {
              e.preventDefault();
              void dispute();
            }}
          >
            <label className="sr" htmlFor={`rv-dispute-${c.id}`}>
              {t("Why is it right?")}
            </label>
            <input
              id={`rv-dispute-${c.id}`}
              className="input"
              autoFocus
              maxLength={200}
              placeholder={t("Why is it right? A few words is enough.")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === "Escape") setMode("idle");
              }}
            />
            <button className="btn btn-s tall" type="submit" disabled={busy}>
              {t("Send note")}
            </button>
            <button type="button" className="linkb" onClick={() => setMode("idle")}>
              {t("Cancel")}
            </button>
          </form>
        )}

        <div className="rv-ctx">
          <span className={cls("rv-kind", KIND_CLASS[c.kind])}>{t(KIND_LABEL[c.kind])}</span>
          {item.session ? (
            <button className={cls("rv-link", cjkClass(item.session.title, L))} onClick={() => navigate(sessionRoute(item.session!.id))}>
              {item.session.title}
            </button>
          ) : (
            <span>{t("Deleted session")}</span>
          )}
          <span>· {fmtShortDate(c.createdAt)}</span>
          {item.grammar && (
            <button className="rv-link rv-gram" onClick={() => navigate(grammarRoute(item.grammar!.id))} title={item.grammar.name}>
              <Icon name="grammar" size={13} />
              <span className={L}>{item.grammar.pattern}</span>
            </button>
          )}
          {status && <span className={cls("rv-st", status.cls)}>{status.label}</span>}
          {c.exportedAt && (
            <span className="rv-st rv-st-anki" title={t("Sent to Anki on {date}", { date: fmtShortDate(c.exportedAt) })}>
              <Icon name="cards" size={12} /> {t("In Anki")}
            </span>
          )}
          {!disputed && mode === "idle" && !selecting && (
            <span className="rv-acts">
              {!retrying && c.status !== "retried_ok" && (
                <button className="linkb" onClick={() => setMode("retry")}>
                  {t("Try again")}
                </button>
              )}
              <button className="linkb" onClick={() => setMode("dispute")}>
                {t("Not a mistake?")}
              </button>
            </span>
          )}
        </div>

        {error && (
          <p className="err">
            <Icon name="alert" size={15} /> {t(error)}
          </p>
        )}
      </div>
    </li>
  );
}
