// Above the composer: "New topic" (the tutor drops the current topic and opens a fresh one), the
// pinyin / furigana switch (Chinese and Japanese) and the "Go easier / go harder" slider
// (SessionMeta.difficulty, read by the tutor's next reply).
import { useEffect, useState } from "react";
import type { Difficulty, Language } from "../../../shared/records";
import { cls } from "../lib/format";
import { msg, t } from "../i18n";
import { Icon } from "./icons";

const LABELS: Record<Difficulty, string> = {
  [-2]: msg("Much easier"),
  [-1]: msg("Easier"),
  0: msg("Normal"),
  1: msg("Harder"),
  2: msg("Much harder"),
};

export interface SessionToolsProps {
  difficulty: Difficulty;
  onDifficulty(d: Difficulty): void;
  /** Omit to hide the button (reading and placement sessions). */
  onNewTopic?: () => void;
  busy: boolean;
  disabled?: boolean;
  /** Readings above the tutor's words; omit for languages without them. */
  ruby?: { on: boolean; language: Language; onChange(on: boolean): void };
}

export function SessionTools({ difficulty, onDifficulty, onNewTopic, busy, disabled, ruby }: SessionToolsProps) {
  // Local value while dragging; saved on release so one drag is one save.
  const [value, setValue] = useState<Difficulty>(difficulty);
  useEffect(() => setValue(difficulty), [difficulty]);
  const commit = (v: Difficulty) => {
    if (v !== difficulty) onDifficulty(v);
  };

  return (
    <div className="stools">
      {onNewTopic && (
        <button
          className="chip chip-s stools-topic"
          onClick={onNewTopic}
          disabled={busy || disabled}
          title={t("The tutor drops this topic and starts a new one")}
        >
          <Icon name="refresh" size={13} />
          <span>{t("New topic")}</span>
        </button>
      )}
      {ruby && (
        <button
          className={cls("chip chip-s", ruby.on && "on")}
          aria-pressed={ruby.on}
          title={ruby.language === "ja" ? t("Show furigana above words") : t("Show pinyin above words")}
          onClick={() => ruby.onChange(!ruby.on)}
        >
          {ruby.language === "ja" ? t("Furigana") : t("Pinyin")}
        </button>
      )}
      <label className="stools-diff" title={t("Applies from the tutor's next reply")}>
        <span className="stools-end">{t("Go easier")}</span>
        <input
          type="range"
          min={-2}
          max={2}
          step={1}
          value={value}
          disabled={disabled}
          aria-label={t("Difficulty")}
          aria-valuetext={t(LABELS[value])}
          onChange={(e) => setValue(Number(e.target.value) as Difficulty)}
          onPointerUp={(e) => commit(Number(e.currentTarget.value) as Difficulty)}
          onKeyUp={(e) => commit(Number(e.currentTarget.value) as Difficulty)}
          onBlur={(e) => commit(Number(e.currentTarget.value) as Difficulty)}
        />
        <span className="stools-end">{t("Go harder")}</span>
        <span className={cls("stools-val", value < 0 && "easy", value > 0 && "hard")}>{t(LABELS[value])}</span>
      </label>
    </div>
  );
}
