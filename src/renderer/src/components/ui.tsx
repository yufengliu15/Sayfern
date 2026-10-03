// Small shared controls: switch, popover menu, doc kind labels.
import { useRef, useState, type ReactNode } from "react";
import type { DocKind } from "../../../shared/records";
import { cls } from "../lib/format";
import { useDismiss } from "../lib/hooks";
import { Icon, type IconName } from "./icons";
import { msg } from "../i18n";

export function Switch({ checked, onChange, label, disabled, id }: { checked: boolean; onChange(v: boolean): void; label: string; disabled?: boolean; id?: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cls("switch", checked && "on")}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  );
}

export interface MenuItem {
  label: string;
  icon?: IconName;
  hint?: string;
  danger?: boolean;
  onSelect(): void;
}

/** A button that opens a small menu. `trigger` renders the button content. */
export function PopMenu({
  label,
  trigger,
  items,
  className,
  buttonClass = "iconb sm",
  align = "right",
  header,
  footer,
}: {
  label: string;
  trigger: ReactNode;
  items: MenuItem[];
  className?: string;
  buttonClass?: string;
  align?: "left" | "right";
  header?: string;
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  return (
    <div className={cls("pmenu", className)} ref={ref}>
      <button className={buttonClass} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {trigger}
      </button>
      {open && (
        <div className={cls("pmenu-list", align)} role="menu" aria-label={label}>
          {header && <div className="mh">{header}</div>}
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              className={cls("pmenu-item", it.danger && "danger", it.hint && "rich")}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              {it.icon && <Icon name={it.icon} size={16} />}
              <span className="pmenu-t">
                <span>{it.label}</span>
                {it.hint && <small>{it.hint}</small>}
              </span>
            </button>
          ))}
          {footer && <div className="pmenu-foot">{footer}</div>}
        </div>
      )}
    </div>
  );
}

/** Translate with t() where they render. */
export const KIND_NAME: Record<DocKind, string> = {
  textbook: msg("Textbook"),
  reader: msg("Graded reader"),
  personal: msg("About me"),
  other: msg("Other"),
};

/** Translate with t() where they render. */
export const KIND_HINT: Record<DocKind, string> = {
  textbook: msg("Lessons, dialogues and grammar notes"),
  reader: msg("Stories written for learners"),
  personal: msg("Notes about your life the tutor can use"),
  other: msg("Articles, subtitles, anything else"),
};

export const KIND_ICON: Record<DocKind, IconName> = {
  textbook: "library",
  reader: "bookmark",
  personal: "user",
  other: "file",
};

/** Book cover swatch for a document. */
export function Cover({ kind, title, size = "m" }: { kind: DocKind; title: string; size?: "s" | "m" }) {
  const glyph = [...title.replace(/^[^\p{L}]+/u, "")][0] ?? "·";
  return (
    <span className={cls("cover", `cover-${kind}`, size === "s" && "cover-s")} aria-hidden="true">
      <span className="cover-g">{glyph}</span>
    </span>
  );
}
