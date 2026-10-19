// Colour theme pickers: ThemePicker (Settings > Preferences) and ThemeBlocks (welcome page, step 4, styled
// like the language blocks). Each option previews its theme with that theme's real colours. Choosing
// applies at once (AppProvider sets <html data-theme>) and saves Settings.theme.
import { useRef, type KeyboardEvent } from "react";
import { THEMES, type Theme } from "../../../shared/themes";
import { Icon } from "./icons";
import { useApp } from "../context";
import { t } from "../i18n";
import { cls } from "../lib/format";

/** Token values of each theme (design/themes/themes.css), as literals because a swatch shows a theme other than the current one. */
const SWATCH: Record<Theme, { paper: string; card: string; ink: string; accent: string; side: string }> = {
  light: { paper: "#f4f0e7", card: "#fbf9f4", ink: "#1c1e1b", accent: "#2e5b45", side: "#173e35" },
  forest: { paper: "#10231d", card: "#16302a", ink: "#ece6d8", accent: "#9cc2a7", side: "#0a1a15" },
  ink: { paper: "#111111", card: "#171717", ink: "#f5f5f5", accent: "#f5f5f5", side: "#0a0a0a" },
};

/** A small window drawn in a theme's colours: sidebar, page and a card with two lines. */
function Swatch({ theme }: { theme: Theme }) {
  const c = SWATCH[theme];
  return (
    <span className="th-swatch" aria-hidden="true" style={{ background: c.paper }}>
      <i className="th-side" style={{ background: c.side }} />
      <i className="th-card" style={{ background: c.card }}>
        <b style={{ background: c.ink }} />
        <b style={{ background: c.accent }} />
      </i>
    </span>
  );
}

export function ThemePicker() {
  const app = useApp();
  const chosen = app.settings.theme ?? "light";
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const pick = (id: Theme) => {
    if (id !== chosen) void app.updateSettings({ theme: id });
  };
  const onKey = (e: KeyboardEvent) => {
    const i = THEMES.findIndex((x) => x.id === chosen);
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = THEMES[(i + step + THEMES.length) % THEMES.length];
    pick(next.id);
    refs.current[next.id]?.focus();
  };

  return (
    <div className="th-pick" role="radiogroup" aria-label={t("Theme")} onKeyDown={onKey}>
      {THEMES.map((x) => {
        return (
          <button
            key={x.id}
            ref={(el) => {
              refs.current[x.id] = el;
            }}
            type="button"
            role="radio"
            aria-checked={chosen === x.id}
            tabIndex={chosen === x.id ? 0 : -1}
            className={cls("th-opt", chosen === x.id && "on")}
            onClick={() => pick(x.id)}
          >
            <Swatch theme={x.id} />
            <span className="th-name">{t(x.label)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Welcome page: one block per theme, like the language blocks above it (native radios, so arrow keys work). */
export function ThemeBlocks() {
  const app = useApp();
  const chosen = app.settings.theme ?? "light";
  return (
    <div className="langpick" role="radiogroup" aria-label={t("Theme")}>
      {THEMES.map((x) => {
        const on = chosen === x.id;
        return (
          <label key={x.id} className={cls("langopt", on && "on")}>
            <input type="radio" name="ob-theme" checked={on} onChange={() => void app.updateSettings({ theme: x.id })} />
            <span className="g th-g">
              <Swatch theme={x.id} />
            </span>
            <span className="t">
              <b>{t(x.label)}</b>
              <small>{t(x.blurb)}</small>
            </span>
            <span className="check" aria-hidden="true">
              {on && <Icon name="check" size={14} stroke={2.6} />}
            </span>
          </label>
        );
      })}
    </div>
  );
}
