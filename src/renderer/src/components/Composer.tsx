// IME-safe message box. Enter sends, Shift+Enter adds a line, ⌘/Ctrl+Enter also sends.
// Tracks pasted text so it can be excluded from the learner's own-word counts (S1-23).
// Stage 3: the mic button records (click to start and stop, or hold and release), ElevenLabs Scribe
// transcribes, and the text lands in the box (or is sent at once when the learner chose that).
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Language } from "../../../shared/records";
import { cls, COMPOSER_PLACEHOLDER } from "../lib/format";
import { LANGUAGE_META } from "../../../shared/languages";
import { Icon } from "./icons";
import { t } from "../i18n";
import { api, errorText } from "../api";
import { navigate, settingsRoute } from "../router";
import { Recorder, stopPlayback, useVoiceStatus } from "../lib/voice";
import { RECORD_MIN_MS } from "../../../shared/stage3";

export interface ComposerProps {
  language: Language;
  busy: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onSend(input: { text: string; pastedSpans?: string[]; spoken?: boolean }): void;
  onStop(): void;
  /** Left side of the toolbar (model picker, notes count). */
  left?: ReactNode;
  /** Show the keyboard hint. */
  hint?: boolean;
  placeholder?: string;
  /** Voice practice time is counted for this session. */
  sessionId?: string;
}

export interface ComposerHandle {
  focus(): void;
  setText(text: string): void;
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { language, busy, disabled, disabledReason, onSend, onStop, left, hint = true, placeholder, sessionId },
  handle,
) {
  const [text, setText] = useState("");
  const pasted = useRef<string[]>([]);
  const ta = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  /** Transcribed text currently in the box (the message counts as spoken when it is still there). */
  const spoken = useRef<string[]>([]);
  const voice = useVoiceStatus();
  const recorder = useRef<Recorder | null>(null);
  const [mic, setMic] = useState<"idle" | "starting" | "recording" | "transcribing">("idle");
  const [micError, setMicError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const pressedAt = useRef(0);

  useEffect(() => {
    if (mic !== "recording") return;
    const id = window.setInterval(() => setElapsed(recorder.current?.elapsedMs() ?? 0), 250);
    return () => window.clearInterval(id);
  }, [mic]);

  useEffect(() => () => recorder.current?.cancel(), []);

  useEffect(() => {
    if (mic !== "recording") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        recorder.current?.cancel();
        setMic("idle");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [mic]);

  useImperativeHandle(handle, () => ({
    focus: () => ta.current?.focus(),
    setText: (t: string) => {
      setText(t);
      pasted.current = [];
      spoken.current = [];
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
    const wasSpoken = spoken.current.some((s) => s && value.includes(s));
    onSend({ text: value, pastedSpans: spans.length ? spans : undefined, ...(wasSpoken ? { spoken: true } : {}) });
    setText("");
    pasted.current = [];
    spoken.current = [];
  };

  const canTalk = !!voice?.canTranscribe;

  const startRecording = async () => {
    if (!canTalk) {
      navigate(settingsRoute("voice"));
      return;
    }
    setMicError(null);
    stopPlayback();
    const rec = (recorder.current ??= new Recorder());
    setMic("starting");
    try {
      await rec.start(() => void finishRecording());
      setElapsed(0);
      setMic("recording");
    } catch (e) {
      setMic("idle");
      setMicError(errorText(e));
    }
  };

  const finishRecording = async () => {
    const rec = recorder.current;
    if (!rec?.active) return;
    setMic("transcribing");
    const clip = await rec.stop();
    if (!clip || clip.durationMs < RECORD_MIN_MS) {
      setMic("idle");
      if (clip) setMicError(t("That was too short. Hold the mic a little longer."));
      return;
    }
    try {
      const r = await api.transcribe({ audio: clip.audio, mime: clip.mime, language, sessionId, durationMs: clip.durationMs });
      const heard = r.text.trim();
      if (voice?.prefs.autoSend && !text.trim() && !busy && !disabled) {
        onSend({ text: heard, spoken: true });
      } else {
        const next = text.trim() ? `${text.trimEnd()} ${heard}` : heard;
        spoken.current.push(heard);
        setText(next);
        requestAnimationFrame(() => {
          ta.current?.focus();
          ta.current?.setSelectionRange(next.length, next.length);
        });
      }
    } catch (e) {
      setMicError(errorText(e));
    } finally {
      setMic("idle");
    }
  };

  const micLabel =
    mic === "recording"
      ? t("Stop recording")
      : mic === "transcribing"
        ? t("Transcribing…")
        : canTalk
          ? t("Talk instead of typing (click, or hold and release)")
          : t("Connect ElevenLabs in Settings > Voice to talk instead of typing");

  return (
    <div className={cls("composer", busy && "is-busy")}>
      <label htmlFor="reply" className="sr">
        {t("Your reply")}
      </label>
      <textarea
        id="reply"
        ref={ta}
        className={LANGUAGE_META[language]?.fontClass ?? language}
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
      {micError && (
        <div className="composer-note" role="alert">
          <Icon name="alert" size={13} />
          <span>{micError}</span>
          <button className="iconb sm" aria-label={t("Dismiss")} onClick={() => setMicError(null)}>
            <Icon name="x" size={12} />
          </button>
        </div>
      )}
      <div className="row">
        {left}
        {hint && (
          <span className="kbd-hint" aria-hidden="true">
            {t("↵ send · ⇧↵ new line")}
          </span>
        )}
        {mic === "recording" && (
          <span className="rec-time" aria-live="off">
            <i aria-hidden="true" />
            {Math.floor(elapsed / 60000)}:{String(Math.floor(elapsed / 1000) % 60).padStart(2, "0")}
            <span className="muted small">{t("Esc to cancel")}</span>
          </span>
        )}
        <button
          className={cls("iconb", "mic", mic === "recording" && "rec", mic === "transcribing" && "loading", !canTalk && "off")}
          style={{ marginLeft: mic === "recording" ? undefined : "auto" }}
          aria-label={t("Voice input")}
          aria-pressed={mic === "recording"}
          title={micLabel}
          disabled={disabled || mic === "starting" || mic === "transcribing"}
          onPointerDown={() => {
            pressedAt.current = performance.now();
            if (mic === "idle") void startRecording();
          }}
          onPointerUp={() => {
            // Held down for a while: push to talk, releasing stops.
            if (mic === "recording" && performance.now() - pressedAt.current > 450) void finishRecording();
          }}
          onClick={() => {
            if (mic === "recording" && performance.now() - pressedAt.current <= 450 && (recorder.current?.elapsedMs() ?? 0) > 450) void finishRecording();
          }}
        >
          <Icon name={mic === "recording" ? "stop" : "mic"} size={19} />
        </button>
        {busy ? (
          <button className="send stop" aria-label={t("Stop the reply")} title={t("Stop")} onClick={onStop}>
            <Icon name="stop" size={14} stroke={2.2} />
          </button>
        ) : (
          <button className="send" aria-label={t("Send message")} title={t("Send")} onClick={submit} disabled={!canSend}>
            <Icon name="send" size={17} stroke={2} />
          </button>
        )}
      </div>
    </div>
  );
});
