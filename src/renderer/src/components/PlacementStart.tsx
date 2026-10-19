// Asked before a placement chat: beginner, intermediate or advanced. The answer goes on the session
// (startPlacement's `band`), so the diagnostic starts in the right part of the scale instead of guessing.
import { useEffect, useRef } from "react";
import type { Language, LevelBand } from "../../../shared/records";
import { LEVEL_BANDS } from "../../../shared/records";
import { bandLevels } from "../../../shared/languages";
import { cls } from "../lib/format";
import { Icon } from "./icons";
import { BAND_LABEL, langName, msg, t } from "../i18n";

const BAND_NOTE: Record<LevelBand, string> = {
  beginner: msg("I know a few words, or none yet."),
  intermediate: msg("I can get by in everyday conversations."),
  advanced: msg("I can talk about most topics with ease."),
};

export interface LevelBandsProps {
  levels: readonly string[];
  value?: LevelBand;
  disabled?: boolean;
  onPick(band: LevelBand): void;
}

/** Three cards, one per band, each with the levels it covers. */
export function LevelBands({ levels, value, disabled, onPick }: LevelBandsProps) {
  return (
    <div className="bands" role="radiogroup" aria-label={t("Your rough level")}>
      {LEVEL_BANDS.map((b) => (
        <button key={b} role="radio" aria-checked={value === b} className={cls("band", value === b && "on")} disabled={disabled} onClick={() => onPick(b)}>
          <span className="band-h">{t(BAND_LABEL[b])}</span>
          <span className="band-lv">{bandLevels(levels, b).join(", ")}</span>
          <small>{t(BAND_NOTE[b])}</small>
        </button>
      ))}
    </div>
  );
}

export interface PlacementStartProps {
  language: Language;
  levels: readonly string[];
  busy: boolean;
  onStart(band: LevelBand): void;
  onClose(): void;
}

export function PlacementStart({ language, levels, busy, onStart, onClose }: PlacementStartProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="cr-ask" role="dialog" aria-modal="true" aria-labelledby="place-ask-title" tabIndex={-1} ref={ref}>
        <header className="cr-ask-h">
          <div>
            <div className="eyebrow">{t("Find your level")}</div>
            <h2 id="place-ask-title">{t("How much {language} do you know?", { language: langName(language) })}</h2>
          </div>
          <button className="iconb" onClick={onClose} disabled={busy} aria-label={t("Close")}>
            <Icon name="x" />
          </button>
        </header>
        <p className="muted cr-ask-n">{t("Pick the closest. The tutor starts the chat there and adjusts as it goes. Beginners can answer in their own language.")}</p>
        <LevelBands levels={levels} disabled={busy} onPick={onStart} />
        {busy && <p className="muted cr-ask-n">{t("Starting…")}</p>}
      </div>
    </div>
  );
}
