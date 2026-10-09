// Target-language text with hoverable, clickable words (S1-07). Tokens come from
// api.annotate (cached per text). Anki targets get the fern underline.
import { memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Token } from "../../../shared/lang";
import type { Language, SourceRef } from "../../../shared/records";
import { annotateCached, peekAnnotation } from "../lib/cache";
import { cls, sentenceAt, fontOf } from "../lib/format";
import { t as tr } from "../i18n";
import { rubySegments } from "../../../shared/ruby";
import { openWordPopover, scheduleCloseWordPopover, useWordPopover, closeWordPopover, cancelCloseWordPopover } from "./WordPopover";

export interface AnnotatedTextProps {
  language: Language;
  text: string;
  /** Words to mark with the Anki underline (surface or dictionary form). */
  targets?: string[];
  /** Where "Save with sentence" records the word came from. */
  source?: SourceRef;
  className?: string;
  /** Rendered after the text, inside the same paragraph (e.g. a streaming caret). */
  children?: ReactNode;
  /** Skip annotation (e.g. while streaming); renders plain text. */
  plain?: boolean;
  as?: "p" | "span" | "div";
  /** Show readings (pinyin / furigana) above words as ruby. */
  ruby?: boolean;
}

const HOVER_DELAY = 380;

export const AnnotatedText = memo(function AnnotatedText({
  language,
  text,
  targets,
  source,
  className,
  children,
  plain,
  as: Tag = "p",
  ruby,
}: AnnotatedTextProps) {
  const [tokens, setTokens] = useState<Token[] | undefined>(() => (plain ? undefined : peekAnnotation(language, text)));
  const id = useId();
  const open = useWordPopover();
  const hoverTimer = useRef<number | undefined>(undefined);
  const targetSet = useMemo(() => new Set(targets ?? []), [targets]);

  useEffect(() => {
    if (plain) return;
    let alive = true;
    const cached = peekAnnotation(language, text);
    if (cached) setTokens(cached);
    else
      annotateCached(language, text)
        .then((t) => alive && setTokens(t))
        .catch(() => alive && setTokens(undefined));
    return () => {
      alive = false;
    };
  }, [language, text, plain]);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const show = (el: HTMLElement, token: Token, pinned: boolean) => {
    const key = `${id}:${token.start}`;
    if (pinned && open?.key === key && open.pinned) return closeWordPopover();
    openWordPopover({ key, anchor: el, token, language, sentence: sentenceAt(text, token.start), source, pinned });
  };

  if (plain || !tokens) {
    return (
      <Tag className={cls("atext", fontOf(language), className)}>
        {text}
        {children}
      </Tag>
    );
  }

  return (
    <Tag className={cls("atext", fontOf(language), ruby && "has-ruby", className)}>
      {tokens.map((t, i) => {
        if (!t.isWord) return <span key={i}>{t.text}</span>;
        const key = `${id}:${t.start}`;
        const isTarget = targetSet.has(t.text) || (t.lemma ? targetSet.has(t.lemma) : false);
        const selected = open?.key === key;
        return (
          <span
            key={i}
            role="button"
            tabIndex={0}
            aria-label={`${t.text}${t.reading ? `, ${t.reading}` : ""}${isTarget ? `, ${tr("Anki word")}` : ""}`}
            aria-expanded={selected}
            className={cls("w", isTarget && "anki", selected && "sel")}
            onPointerEnter={(e) => {
              // A held button means a text selection drag: no popover.
              if (e.pointerType !== "mouse" || e.buttons) return;
              const el = e.currentTarget;
              cancelCloseWordPopover();
              window.clearTimeout(hoverTimer.current);
              // Once a hover popover is up, moving across words updates it immediately.
              const delay = open && !open.pinned ? 60 : HOVER_DELAY;
              if (open?.pinned) return;
              hoverTimer.current = window.setTimeout(() => show(el, t, false), delay);
            }}
            onPointerLeave={() => {
              window.clearTimeout(hoverTimer.current);
              scheduleCloseWordPopover(key);
            }}
            onClick={(e) => {
              window.clearTimeout(hoverTimer.current);
              // The click that ends a drag inside one word keeps the selection.
              if (!window.getSelection()?.isCollapsed) return;
              show(e.currentTarget, t, true);
            }}
            onKeyDown={(e: KeyboardEvent<HTMLSpanElement>) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                show(e.currentTarget, t, true);
              }
            }}
          >
            {ruby && t.reading
              ? rubySegments(language, t.text, t.reading).map((seg, j) =>
                  seg.rt ? (
                    <ruby key={j}>
                      {seg.text}
                      <rp>(</rp>
                      <rt>{seg.rt}</rt>
                      <rp>)</rp>
                    </ruby>
                  ) : (
                    <span key={j}>{seg.text}</span>
                  ),
                )
              : t.text}
          </span>
        );
      })}
      {children}
    </Tag>
  );
});
