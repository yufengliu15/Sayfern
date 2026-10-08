// Asked before a course unit starts: a quick overview of the unit's grammar first, or straight into
// the conversation. The answer goes on the session (startUnit's `explain`), so the tutor's opening carries it.
import { useEffect, useRef } from "react";
import type { UnitView } from "../../../shared/course";
import { cls } from "../lib/format";
import { Icon } from "./icons";
import { t } from "../i18n";

export interface UnitStartProps {
  unit: Pick<UnitView, "title" | "level" | "patterns">;
  fontClass: string;
  busy: boolean;
  onStart(explain: boolean): void;
  onClose(): void;
}

export function UnitStart({ unit, fontClass, busy, onStart, onClose }: UnitStartProps) {
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
      <div className="cr-ask" role="dialog" aria-modal="true" aria-labelledby="cr-ask-title" tabIndex={-1} ref={ref}>
        <header className="cr-ask-h">
          <div>
            <div className="eyebrow">{unit.level}</div>
            <h2 id="cr-ask-title">{t(unit.title)}</h2>
          </div>
          <button className="iconb" onClick={onClose} disabled={busy} aria-label={t("Close")}>
            <Icon name="x" />
          </button>
        </header>
        <p className={cls("cr-ask-pats", fontClass)}>{unit.patterns.join(" · ")}</p>
        <p className="cr-ask-q">{t("Go over this unit's grammar quickly first?")}</p>
        <p className="muted cr-ask-n">{t("The tutor gives a short summary of each pattern, then starts the conversation. It is a reminder, not a replacement for your textbook.")}</p>
        <div className="cr-ask-a">
          <button className="btn btn-p" disabled={busy} onClick={() => onStart(true)}>
            {busy ? t("Starting…") : t("Yes, go over it")}
          </button>
          <button className="btn btn-f" disabled={busy} onClick={() => onStart(false)}>
            {t("No, start talking")}
          </button>
        </div>
      </div>
    </div>
  );
}
