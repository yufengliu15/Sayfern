// Stage 3: listen buttons (normal and slow) for tutor messages, words and example sentences.
import type { Language } from "../../../shared/records";
import type { SpeakKind } from "../../../shared/stage3";
import { cls } from "../lib/format";
import { play, usePlayback } from "../lib/voice";
import { Icon } from "./icons";
import { t } from "../i18n";

export interface SpeakButtonsProps {
  /** Unique per thing spoken (message id, "w:<word>"). */
  id: string;
  text: string;
  language: Language;
  kind: SpeakKind;
  sessionId?: string;
  /** Also show the slow button. */
  slow?: boolean;
  small?: boolean;
}

export function SpeakButtons({ id, text, language, kind, sessionId, slow = true, small }: SpeakButtonsProps) {
  const p = usePlayback();
  const mine = p.key === id;
  const error = p.error?.key === id ? p.error.text : undefined;
  const button = (isSlow: boolean) => {
    const on = mine && p.slow === isSlow && p.phase;
    const label = isSlow ? t("Listen slowly") : t("Listen");
    return (
      <button
        className={cls("iconb", small && "sm", "spk", on && "on", on && p.phase === "loading" && "loading", isSlow && "spk-slow")}
        aria-label={on ? t("Stop") : label}
        aria-pressed={!!on}
        title={error && !isSlow ? t(error) : on ? t("Stop") : label}
        onClick={(e) => {
          e.stopPropagation();
          void play({ key: id, text, language, kind, slow: isSlow, sessionId });
        }}
      >
        {isSlow ? <span className="spk-x">0.7×</span> : <Icon name={on && p.phase === "playing" ? "stop" : "speaker"} size={small ? 15 : 17} />}
      </button>
    );
  };
  return (
    <span className={cls("spk-row", error && "has-err")}>
      {button(false)}
      {slow && button(true)}
      {error && <span className="spk-err">{t(error)}</span>}
    </span>
  );
}
