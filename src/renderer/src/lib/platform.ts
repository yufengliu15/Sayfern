/** True on macOS (the mock dev server runs in any browser, so this reads the browser's platform). */
export const IS_MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
/** ⌘ on Mac, Ctrl elsewhere. */
export const MOD = IS_MAC ? "⌘" : "Ctrl ";
