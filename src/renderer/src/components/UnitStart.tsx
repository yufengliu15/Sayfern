// Asked before a course unit starts: "Begin Lesson" (an overview of the unit's grammar, then each point taught)
// or "More practice" (straight into the conversation). The answer goes on the session (startUnit's `explain`).
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
        <p className="cr-ask-q">{t("Begin Course?")}</p>
        <div className="cr-ask-a">
          <button className="btn btn-p" disabled={busy} onClick={() => onStart(true)}>
            {busy ? t("Starting…") : t("Begin Lesson")}
          </button>
          <button className="btn btn-f" disabled={busy} onClick={() => onStart(false)}>
            {t("More practice")}
          </button>
        </div>
      </div>
    </div>
  );
}
