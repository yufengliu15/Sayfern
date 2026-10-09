// The conversation column: tutor messages (annotated), learner bubbles, correction cards,
// the streaming reply and inline errors.
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatMessage, Correction, GrammarSummary, Language, SourceRef, ToolActivity } from "../../../shared/records";
import type { ModelRef } from "../../../shared/types";
import { activityText, cls, fmtDay, fontOf } from "../lib/format";
import { AnnotatedText } from "./AnnotatedText";
import { CorrectionCard } from "./CorrectionCard";
import { Fern, Icon } from "./icons";
import { SpeakButtons } from "./Speak";
import { t, tn } from "../i18n";

export interface TranslationState {
  text?: string;
  loading?: boolean;
  error?: string;
}

export interface MessageListProps {
  language: Language;
  messages: ChatMessage[];
  corrections: Correction[];
  /** Anki target words to underline. */
  targets: string[];
  grammarById: Record<string, GrammarSummary>;
  model?: ModelRef;
  streaming?: { text: string; tools: ToolActivity[]; error?: string } | null;
  showTranslations: boolean;
  translations: Record<string, TranslationState>;
  onCorrectionUpdate(c: Correction): void;
  onOpenGrammar(id: string): void;
  onOpenSource(s: SourceRef): void;
  /** Resend the last learner message; shown on the last failed reply. */
  onRetry?(): void;
  /** Rendered when there are no messages and nothing streaming. */
  empty?: ReactNode;
}

export function MessageList(p: MessageListProps) {
  const byMessage = new Map<string, Correction[]>();
  for (const c of p.corrections) byMessage.set(c.messageId, [...(byMessage.get(c.messageId) ?? []), c]);
  const lastIdx = p.messages.length - 1;

  if (p.messages.length === 0 && !p.streaming) return <>{p.empty}</>;

  return (
    <>
      {p.messages.map((m, i) => {
        const prev = p.messages[i - 1];
        const newDay = !prev || fmtDay(prev.at) !== fmtDay(m.at);
        const corr = byMessage.get(m.id) ?? [];
        return (
          <Fragment key={m.id}>
            {newDay && i > 0 && <div className="day">{fmtDay(m.at)}</div>}
            {m.role === "user" ? (
              <LearnerMessage m={m} language={p.language} corrections={corr} />
            ) : (
              <TutorMessage
                m={m}
                language={p.language}
                targets={p.targets}
                translation={p.showTranslations ? p.translations[m.id] : undefined}
                onOpenSource={p.onOpenSource}
                onRetry={i === lastIdx && m.error && m.error !== "Stopped" ? p.onRetry : undefined}
              />
            )}
            {m.role === "user" && corr.length > 0 && (
              <div className="corr-stack">
                {corr.map((c) => (
                  <CorrectionCard
                    key={c.id}
                    correction={c}
                    language={p.language}
                    messageText={m.text}
                    grammar={c.grammarId ? p.grammarById[c.grammarId] : undefined}
                    model={p.model}
                    onUpdate={p.onCorrectionUpdate}
                    onOpenGrammar={p.onOpenGrammar}
                  />
                ))}
              </div>
            )}
          </Fragment>
        );
      })}
      {p.streaming && (
        <div className="tmsg streaming" aria-live="polite" aria-busy={!p.streaming.error}>
          <Who />
          {p.streaming.text ? (
            <AnnotatedText language={p.language} text={p.streaming.text} className="msg-text" plain>
              {!p.streaming.error && <span className="caret" aria-hidden="true" />}
            </AnnotatedText>
          ) : !p.streaming.error ? (
            <div className="thinking" aria-label={t("Tutor is replying")}>
              <i />
              <i />
              <i />
            </div>
          ) : null}
          {p.streaming.tools.length > 0 && (
            <div className="activity">
              {p.streaming.tools.map((tool, i) => (
                <span key={i} className={cls("act", !tool.ok && "bad")}>
                  <Icon name={tool.ok ? "check" : "alert"} size={13} stroke={2.2} />
                  {activityText(tool.summary)}
                </span>
              ))}
            </div>
          )}
          {p.streaming.error && <ErrorLine text={p.streaming.error} onRetry={p.onRetry} />}
        </div>
      )}
    </>
  );
}

function Who({ model }: { model?: string }) {
  return (
    <div className="who">
      <span className="av">
        <Fern size={15} />
      </span>
      {t("Tutor")}
      {model && <span className="model">{model.split("/").pop()}</span>}
    </div>
  );
}

function ErrorLine({ text, onRetry, quiet }: { text: string; onRetry?: () => void; quiet?: boolean }) {
  return (
    <div className={cls("err", quiet && "quiet")} role={quiet ? undefined : "alert"}>
      <Icon name={quiet ? "stop" : "alert"} size={quiet ? 12 : 15} />
      <span>{t(text)}</span>
      {onRetry && (
        <button className="btn btn-s" onClick={onRetry}>
          <Icon name="refresh" size={14} />
          {t("Retry")}
        </button>
      )}
    </div>
  );
}

function TutorMessage({
  m,
  language,
  targets,
  translation,
  onOpenSource,
  onRetry,
}: {
  m: ChatMessage;
  language: Language;
  targets: string[];
  translation?: TranslationState;
  onOpenSource(s: SourceRef): void;
  onRetry?: () => void;
}) {
  const library = (m.sources ?? []).filter((s): s is Extract<SourceRef, { kind: "library" }> => s.kind === "library");
  return (
    <div className="tmsg">
      <Who model={m.model} />
      {m.text && (
        <AnnotatedText
          language={language}
          text={m.text}
          targets={targets}
          className="msg-text"
          source={{ kind: "session", sessionId: m.sessionId, messageId: m.id }}
        />
      )}
      {m.text && (
        <div className="msg-voice">
          {!m.error && <SpeakButtons id={m.id} text={m.text} language={language} kind="message" sessionId={m.sessionId} small />}
          <CopyButton text={m.text} />
        </div>
      )}
      {translation && (
        <p className={cls("tr", translation.loading && "loading")}>
          {translation.loading ? t("Translating…") : (translation.text ?? (translation.error ? t(translation.error) : undefined))}
        </p>
      )}
      {library.length > 0 && (
        <div className="msg-sources">
          {library.slice(0, 2).map((s, i) => (
            <button key={i} className="chip chip-s" onClick={() => onOpenSource(s)} title={s.quote}>
              <Icon name="library" size={14} />
              {s.title ?? t("Library")} · ¶{s.paragraph + 1}
            </button>
          ))}
        </div>
      )}
      {m.error && (m.error === "Stopped" ? <ErrorLine text={t("You stopped this reply.")} quiet /> : <ErrorLine text={m.error} onRetry={onRetry} />)}
    </div>
  );
}

function LearnerMessage({ m, language, corrections }: { m: ChatMessage; language: Language; corrections: Correction[] }) {
  // Highlight each open correction's span; fixed ones get a quieter mark.
  type Seg = { text: string; c?: Correction };
  const marks = corrections
    .filter((c) => c.status !== "disputed")
    .map((c) => ({ c, at: m.text.indexOf(c.original) }))
    .filter((x) => x.at >= 0 && x.c.original.length > 0)
    .sort((a, b) => a.at - b.at);
  const segs: Seg[] = [];
  let pos = 0;
  for (const { c, at } of marks) {
    if (at < pos) continue;
    if (at > pos) segs.push({ text: m.text.slice(pos, at) });
    segs.push({ text: c.original, c });
    pos = at + c.original.length;
  }
  if (pos < m.text.length) segs.push({ text: m.text.slice(pos) });

  const pending = m.id.startsWith("pending-");
  return (
    <div className="umsg-row">
      {!pending && <CopyButton text={m.text} />}
      <div className={cls("umsg", pending && "pending")}>
        <p className={cls("msg-text", fontOf(language))}>
          {segs.map((s, i) =>
            s.c ? (
              <mark
                key={i}
                className={cls("mk", s.c.kind !== "grammar" && "mk-light", (s.c.status === "revealed" || s.c.status === "retried_ok") && "mk-done")}
              >
                {s.text}
              </mark>
            ) : (
              <Fragment key={i}>{s.text}</Fragment>
            ),
          )}
        </p>
        {m.spoken && (
          <div className="pasted-note" title={t("Transcribed from your voice. Pronunciation isn't judged from the text.")}>
            <Icon name="mic" size={12} /> {t("Spoken")}
          </div>
        )}
        {m.pastedSpans && m.pastedSpans.length > 0 && (
          <div className="pasted-note" title={t("Pasted text doesn't count toward your own words")}>
            <Icon name="quote" size={12} /> {t("Includes pasted text")}
          </div>
        )}
      </div>
    </div>
  );
}

/** Copies a whole message; shows a check for a moment after. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = () =>
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    });
  const label = copied ? t("Copied") : t("Copy");
  return (
    <button className={cls("iconb sm msg-copy", copied && "on")} aria-label={label} title={label} onClick={copy}>
      <Icon name={copied ? "check" : "copy"} size={15} />
    </button>
  );
}
