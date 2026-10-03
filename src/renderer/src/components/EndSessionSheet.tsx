// End-of-session summary: corrections, grammar observed, new words, Anki targets.
import { useEffect, useRef } from "react";
import type { EndSummary } from "../../../shared/api";
import type { ChatMessage, Correction, Language } from "../../../shared/records";
import type { ModelRef } from "../../../shared/types";
import { cls, fmtDuration, fontOf, STATE_CLASS, STATE_LABEL } from "../lib/format";
import { CorrectionCard } from "./CorrectionCard";
import { Icon } from "./icons";
import { t, tn } from "../i18n";

export interface EndSessionSheetProps {
  summary: EndSummary;
  language: Language;
  messages: ChatMessage[];
  model?: ModelRef;
  onCorrectionUpdate(c: Correction): void;
  onOpenGrammar(id: string): void;
  onClose(): void;
  onDone(): void;
}

export function EndSessionSheet({ summary, language, messages, model, onCorrectionUpdate, onOpenGrammar, onClose, onDone }: EndSessionSheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const textOf = (id: string) => messages.find((m) => m.id === id)?.text;
  const grammarById = Object.fromEntries(summary.grammar.map((g) => [g.summary.point.id, g.summary]));
  const used = summary.targets.filter((x) => x.status === "used");
  const errors = summary.corrections.filter((c) => c.kind !== "style");
  const L = fontOf(language);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay sheet-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="end-title" tabIndex={-1} ref={ref}>
        <header className="sheet-h">
          <div>
            <div className="eyebrow">{t("Session wrap-up · {duration} active", { duration: fmtDuration(summary.session.activeMs) })}</div>
            <h2 id="end-title">{t("Nicely done. Here's what stood out.")}</h2>
          </div>
          <button className="iconb" onClick={onClose} aria-label={t("Close summary")}>
            <Icon name="x" />
          </button>
        </header>

        <div className="sheet-stats">
          <Stat n={errors.length} label={tn(errors.length, "thing to fix", "things to fix")} />
          <Stat n={summary.grammar.length} label={tn(summary.grammar.length, "pattern used", "patterns used")} />
          <Stat n={summary.newWords.length} label={tn(summary.newWords.length, "new word used", "new words used")} />
          <Stat n={used.length} label={tn(summary.targets.length, "of {count} Anki word", "of {count} Anki words")} />
        </div>

        <div className="sheet-body">
          {summary.corrections.length > 0 && (
            <section>
              <h3 className="sheet-sec">{t("Corrections")}</h3>
              <div className="stack">
                {summary.corrections.map((c) => (
                  <CorrectionCard
                    key={c.id}
                    variant="sheet"
                    correction={c}
                    language={language}
                    messageText={textOf(c.messageId)}
                    grammar={c.grammarId ? grammarById[c.grammarId] : undefined}
                    model={model}
                    onUpdate={onCorrectionUpdate}
                    onOpenGrammar={onOpenGrammar}
                  />
                ))}
              </div>
            </section>
          )}

          {summary.grammar.length > 0 && (
            <section>
              <h3 className="sheet-sec">{t("Grammar you used")}</h3>
              <ul className="glist">
                {summary.grammar.map(({ summary: g, observations }) => {
                  const ok = observations.filter((o) => o.verdict === "correct").length;
                  const bad = observations.filter((o) => o.verdict === "incorrect").length;
                  return (
                    <li key={g.point.id}>
                      <button className="glist-row" onClick={() => onOpenGrammar(g.point.id)}>
                        <span className={cls("gp", L)}>{g.point.pattern}</span>
                        <span className="gname">{g.point.name}</span>
                        <span className="dots" aria-label={t("{ok} correct, {bad} incorrect this session", { ok, bad })}>
                          {observations.map((o) => (
                            <i key={o.id} className={o.verdict === "correct" ? "f" : o.verdict === "incorrect" ? "x" : ""} />
                          ))}
                        </span>
                        <span className={STATE_CLASS[g.state]}>{t(STATE_LABEL[g.state])}</span>
                        <Icon name="chevR" size={15} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <div className="sheet-cols">
            <section>
              <h3 className="sheet-sec">{t("First time you used")}</h3>
              {summary.newWords.length === 0 ? (
                <p className="muted small">{t("No new words this time. That's fine: repetition counts too.")}</p>
              ) : (
                <div className="wchips">
                  {summary.newWords.map((w) => (
                    <span key={w.word} className="wchip" title={w.firstSentence}>
                      <span className={L}>{w.word}</span>
                    </span>
                  ))}
                </div>
              )}
            </section>
            <section>
              <h3 className="sheet-sec">{t("Anki words")}</h3>
              {summary.targets.length === 0 ? (
                <p className="muted small">{t("Connect Anki to weave your review words into sessions.")}</p>
              ) : (
                <div className="wchips">
                  {summary.targets.map((target) => (
                    <span key={target.word} className={cls("wchip", target.status === "used" && "used")} title={target.meaning}>
                      {target.status === "used" && <Icon name="check" size={12} stroke={2.6} />}
                      <span className={L}>{target.word}</span>
                    </span>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>

        <footer className="sheet-f">
          <span className="muted small">{t("Everything here is saved to your Progress and Grammar pages.")}</span>
          <button className="btn" onClick={onClose}>
            {t("Keep talking")}
          </button>
          <button className="btn btn-p" onClick={onDone}>
            {t("Back to Today")} <Icon name="arrow" size={16} stroke={2} />
          </button>
        </footer>
      </div>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="sstat">
      <b>{n}</b>
      <span>{label}</span>
    </div>
  );
}
