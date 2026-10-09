// Applies the colour theme. <html data-theme> is the single source (CSS tokens and the feature
// sandbox both read it); Light has no attribute. The last theme is cached in localStorage so the
// first paint is right, before settings load.
import type { Theme } from "../../../shared/themes";

const KEY = "sayfern.theme";

export function applyTheme(theme: Theme | undefined) {
  const root = document.documentElement;
  if (theme === "forest" || theme === "ink") root.dataset.theme = theme;
  else delete root.dataset.theme;
  try {
    localStorage.setItem(KEY, theme ?? "light");
  } catch {
    // Storage unavailable: the theme still applies for this run.
  }
}

/** Before React renders: the theme of the last run. */
export function applyCachedTheme() {
  try {
    const cached = localStorage.getItem(KEY);
    if (cached === "forest" || cached === "ink") document.documentElement.dataset.theme = cached;
  } catch {
    // Light.
  }
}
