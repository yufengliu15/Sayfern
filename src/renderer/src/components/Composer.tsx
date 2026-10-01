// IME-safe message box. Enter sends, Shift+Enter adds a line, ⌘/Ctrl+Enter also sends.
// Tracks pasted text so it can be excluded from the learner's own-word counts (S1-23).
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Language } from "../../../shared/records";
import { cls, COMPOSER_PLACEHOLDER } from "../lib/format";
import { Icon } from "./icons";

export interface ComposerProps {
  language: Language;
  busy: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onSend(input: { text: string; pastedSpans?: string[] }): void;
  onStop(): void;
  /** Left side of the toolbar (model picker, notes count). */
  left?: ReactNode;
  /** Show the keyboard hint. */
  hint?: boolean;
  placeholder?: string;
}

export interface ComposerHandle {
  focus(): void;
  setText(text: string): void;
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { language, busy, disabled, disabledReason, onSend, onStop, left, hint = true, placeholder },
  handle,
) {
  const [text, setText] = useState("");
  const pasted = useRef<string[]>([]);
  const ta = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);

  useImperativeHandle(handle, () => ({
    focus: () => ta.current?.focus(),
    setText: (t: string) => {
      setText(t);
      pasted.current = [];
      requestAnimationFrame(() => {
        ta.current?.focus();
        ta.current?.setSelectionRange(t.length, t.length);
      });
    },
  }));

  // Autosize
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 52), 220)}px`;
  }, [text]);

  useEffect(() => {
    ta.current?.focus();
  }, []);

  const canSend = !busy && !disabled && text.trim().length > 0;

  const submit = () => {
    if (!canSend) return;
    const value = text.trim();
    const spans = pasted.current.filter((s) => s.trim() && value.includes(s.trim())).map((s) => s.trim());
    onSend({ text: value, pastedSpans: spans.length ? spans : undefined });
    setText("");
    pasted.current = [];
  };

  return (
    <div className={cls("composer", busy && "is-busy")}>
      <label htmlFor="reply" className="sr">
        Your reply
      </label>
      <textarea
        id="reply"
        ref={ta}
        className={language}
        rows={2}
        value={text}
        placeholder={disabled ? (disabledReason ?? "") : (placeholder ?? COMPOSER_PLACEHOLDER[language])}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={() => (composing.current = false)}
        onPaste={(e) => {
          const t = e.clipboardData.getData("text/plain");
          if (t) pasted.current.push(t);
        }}
        onKeyDown={(e) => {
          // Never send while an IME (pinyin / kana) is composing.
          if (e.nativeEvent.isComposing || e.keyCode === 229 || composing.current) return;
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="row">
        {left}
        {hint && (
          <span className="kbd-hint" aria-hidden="true">
            ↵ send · ⇧↵ new line
          </span>
        )}
        <button className="iconb" style={{ marginLeft: "auto" }} aria-label="Voice input" title="Voice arrives in Stage 3" disabled>
          <Icon name="mic" size={19} />
        </button>
        {busy ? (
          <button className="send stop" aria-label="Stop the reply" title="Stop" onClick={onStop}>
            <Icon name="stop" size={14} stroke={2.2} />
          </button>
        ) : (
          <button className="send" aria-label="Send message" title="Send" onClick={submit} disabled={!canSend}>
            <Icon name="send" size={17} stroke={2} />
          </button>
        )}
      </div>
    </div>
  );
});
