// Colour themes. Light is the default (no `data-theme` attribute on <html>). The token values live in
// styles.css (three blocks); only `paper` is repeated here, for the window background that main paints
// before the page loads.
import { msg } from "./i18n";

export type Theme = "light" | "forest" | "ink";

export const THEMES: { id: Theme; label: string; blurb: string; dark: boolean; paper: string }[] = [
  { id: "light", label: msg("Light"), blurb: msg("Warm paper and fern green"), dark: false, paper: "#f4f0e7" },
  { id: "forest", label: msg("Forest Night"), blurb: msg("Deep green, calm at night"), dark: true, paper: "#10231d" },
  { id: "ink", label: msg("Ink"), blurb: msg("Black and white"), dark: true, paper: "#111111" },
];

export const themeInfo = (theme: Theme | undefined) => THEMES.find((x) => x.id === theme) ?? THEMES[0];
