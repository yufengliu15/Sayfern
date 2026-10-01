// End-of-session summary: corrections, grammar observed, new words, Anki targets.
import { useEffect, useRef } from "react";
import type { EndSummary } from "../../../shared/api";
import type { ChatMessage, Correction, Language } from "../../../shared/records";
import type { ModelRef } from "../../../shared/types";
import { cls, fmtDuration, STATE_CLASS, STATE_LABEL } from "../lib/format";
import { CorrectionCard } from "./CorrectionCard";
import { Icon } from "./icons";

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
  const used = summary.targets.filter((t) => t.status === "used");
  const errors = summary.corrections.filter((c) => c.kind !== "style");
  const L = language;

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
            <div className="eyebrow">Session wrap-up · {fmtDuration(summary.session.activeMs)} active</div>
            <h2 id="end-title">Nicely done. Here's what stood out.</h2>
          </div>
          <button className="iconb" onClick={onClose} aria-label="Close summary">
            <Icon name="x" />
          </button>
        </header>

        <div className="sheet-stats">
          <Stat n={errors.length} label={errors.length === 1 ? "thing to fix" : "things to fix"} />
          <Stat n={summary.grammar.length} label={summary.grammar.length === 1 ? "pattern used" : "patterns used"} />
          <Stat n={summary.newWords.length} label="new words used" />
          <Stat n={used.length} label={`of ${summary.targets.length} Anki words`} />
        </div>

        <div className="sheet-body">
          {summary.corrections.length > 0 && (
            <section>
              <h3 className="sheet-sec">Corrections</h3>
              <div className="stack">
                {summary.corrections.map((c) => (
                  <CorrectionCard
                    key={c.id}
                    variant="sheet"
                    correction={c}
                    language={L}
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
              <h3 className="sheet-sec">Grammar you used</h3>
              <ul className="glist">
                {summary.grammar.map(({ summary: g, observations }) => {
                  const ok = observations.filter((o) => o.verdict === "correct").length;
                  const bad = observations.filter((o) => o.verdict === "incorrect").length;
                  return (
                    <li key={g.point.id}>
                      <button className="glist-row" onClick={() => onOpenGrammar(g.point.id)}>
                        <span className={cls("gp", L)}>{g.point.pattern}</span>
                        <span className="gname">{g.point.name}</span>
                        <span className="dots" aria-label={`${ok} correct, ${bad} incorrect this session`}>
                          {observations.map((o) => (
                            <i key={o.id} className={o.verdict === "correct" ? "f" : o.verdict === "incorrect" ? "x" : ""} />
                          ))}
                        </span>
                        <span className={STATE_CLASS[g.state]}>{STATE_LABEL[g.state]}</span>
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
              <h3 className="sheet-sec">First time you used</h3>
              {summary.newWords.length === 0 ? (
                <p className="muted small">No new words this time. That's fine: repetition counts too.</p>
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
              <h3 className="sheet-sec">Anki words</h3>
              {summary.targets.length === 0 ? (
                <p className="muted small">Connect Anki to weave your review words into sessions.</p>
              ) : (
                <div className="wchips">
                  {summary.targets.map((t) => (
                    <span key={t.word} className={cls("wchip", t.status === "used" && "used")} title={t.meaning}>
                      {t.status === "used" && <Icon name="check" size={12} stroke={2.6} />}
                      <span className={L}>{t.word}</span>
                    </span>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>

        <footer className="sheet-f">
          <span className="muted small">Everything here is saved to your Progress and Grammar pages.</span>
          <button className="btn" onClick={onClose}>
            Keep talking
          </button>
          <button className="btn btn-p" onClick={onDone}>
            Back to Today <Icon name="arrow" size={16} stroke={2} />
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
