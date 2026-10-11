# Theme mapping: Light, Forest Night, Ink

Design canvas: https://claude.ai/artifact/D7SJJro87VqaZNFtV7qZzh (private)
Token values for all three themes: `design/themes/themes.css`.

Light is the default and should look the same after the swap. Forest Night and Ink only change token values. No component CSS needs a per-theme rule once the literals below are replaced.

## Steps (about 2 to 3 hours total)

1. **Tokens (10 min).** Replace the colour lines in the `:root` block of `src/renderer/src/styles.css` with `themes.css`. Keep the font, `--chat-max` and `--bubble-max` lines.
2. **Hex literals (60 to 90 min).** Work through table A in `styles.css` and each file in `styles/`. 151 distinct literals, about 350 uses.
3. **Alpha literals (30 to 45 min).** Replace every `rgba(...)` using the rules in table B.
4. **Switcher (20 min).** Set `document.documentElement.dataset.theme` to `forest` or `ink` (delete it for Light). Save the choice in settings. Set Electron `nativeTheme.themeSource` to `light` or `dark` to match, so scrollbars and native controls follow.
5. **Check (15 min).** Run `grep -nE "#[0-9a-fA-F]{3,8}\b|rgba?\(" src/renderer/src/styles.css src/renderer/src/styles/*.css`. Only the "Leave as is" rows and the `:root` blocks should remain.

## A. Hex literals to tokens

"On forest" means the element sits on a `--forest` or `--hero-*` surface: `.side`, `.hero`, `.q*`, review `.ank*`, course `.cr-next-card`, `.cr-seg.dark`, `.seltool`, `.btip`. Those surfaces stay dark in every theme.

| Literal | Uses | Where | Replace with |
|---|---|---|---|
| `#fff` | 24 | `background` (inputs, hover cards, `.langopt`, `.codechip`, `.band`, `.dk-path`, `.btn-light:hover`) | `var(--white)` |
| `#fff` | ~10 | `color` or `border-color` on forest (`.nav button.on`, `.recent-list .cur`, `.status:hover`, `.seltool`, `.btip b`, `.q1`, `.btn-ghost:hover`, `.ank-*:hover`, `.ank-go:hover`, `.cr-next-b:hover`) | `var(--side-ink)` |
| `#fff` | 3 | text on seal (`.btn-danger:hover`, voice `.mic.rec`) | `var(--on-seal)` |
| `#fff` | 1 | `.langopt .check` (on fern) | `var(--on-fern)` |
| `#fff` | 1 | `.switch i` (thumb) | leave `#fff` |
| `#f7f4ec`, `#f4f0e7` (as `color`) | 10 | text on fern buttons (`.btn-p`, `div.stop span`, `.rung.current`) | `var(--on-fern)` |
| `#fbf6f1` (as `color`) | 2 | `.btn-danger`, `.bdot.failed` | `var(--on-seal)` |
| `#8e3219` | 3 | danger and stop hover | `var(--seal-dark)` |
| `#f1ece0`, `#ede8dc`, `#eef1ea`, `#fbfaf5`, `#f3f4ee` | 21 | text on forest | `var(--side-ink)` |
| `#a9c8b2`, `#b9d3bf` | 9 | icons and highlights on forest | `var(--side-accent)` |
| `#0f2c25` | 1 | `.side` border | `var(--side-line)` |
| `#2c5a46` / `#10302a` | 2 | `.cr-next-card` gradient | `var(--hero-a)` / `var(--hero-b)` |
| `#b9b19f`, `#9aa394` | 22 | hover borders, `.st-intro` | `var(--line-hover)` |
| `#cfc7b5`, `#c8bfaa`, `#bdb49f` | 14 | ghost cards, link underline, composer focus | `var(--line-strong)` |
| `#d9d2c3`, `#d5cdbb` | 7 | chip, composer, `.btn`, `.input` borders | `var(--line-2)` |
| `#eee8dc`, `#e2dbcc`, `#e6dfd1` | 10 | separators | `var(--line-3)` |
| `#9d9a8e`, `#b0a894`, `#b5ae9c` | 5 | placeholders, empty values | `var(--placeholder)` |
| `#f0ebe0`, `#f3eee4`, `#f5f1e8`, `#ece6da`, `#faf7f0` | 12 | row hover, skeletons, loading | `var(--hover)` |
| `#e6e0d2`, `#e3dccd`, `#ebe5d8`, `#ddd5c4` | 6 | segmented bg, progress track, rungs | `var(--track)` |
| `#d6cebc` | 3 | switch track, dots | `var(--track-strong)` |
| `#e1eae2`, `#dde7de` | 4 | avatar, reached rung | `var(--fern-soft)` |
| `#d3e0d5`, `#c9d8cc` | 4 | help chips, `--st-introduced` | `var(--fern-line)` |
| `#f3f6ef`, `#f3f7f2` | 4 | empty states, selected tiles | `var(--fern-wash)` |
| `#f8f7f1` / `#e3ddcd` / `#8a5a3c` / `#c48a6a` | 6 | `.corr-light` suggestion style | `--note-bg` / `--note-line` / `--note-ink` / `--note-mark` |
| `#f2ddc9` / `#7a3a15`, `#6d2a18` | 3 | review `.k-s`, `.frv-note.warn` | `var(--warn-bg)` / `var(--warn-ink)` |
| `#9a6a1c` | 1 | `.anki-st.warn` text | `var(--warn-ink)` |
| `#e0b25c` | 2 | warn dots | `var(--warn)` |
| `#7fc29a` | 3 | ok dots | `var(--ok)` |
| `#e0704f` | 1 | `.cr-pulse` | `var(--pulse)` |
| `#f0a48f` | 3 | error text on review card | `var(--seal-on-side)` |
| `#e6b64a` | 1 | `.ank-warn` | `var(--warn-on-side)` |
| `#8a7f68`, `#d9d1bf` | 4 | book cover art (`.spine.alt`, `.cover-*`) | leave as is (decorative, same in every theme) |

Merging near-identical literals moves a few Light colours by 2 to 6 RGB points. That isn't visible in practice.

## B. Alpha literals

Use `color-mix(in srgb, var(--token) N%, transparent)` where N is the old alpha × 100. Example: `rgba(46, 91, 69, 0.1)` becomes `color-mix(in srgb, var(--fern) 10%, transparent)`.

| Old base colour | Used for | Token |
|---|---|---|
| `rgba(46,91,69,a)` | word hover, selection, focus rings, marks | `--fern` |
| `rgba(28,30,27,a)` in `background` | hover tints, skeletons, `.cover-personal::after` | `--ink` |
| `rgba(28,30,27,a)`, `rgba(15,25,20,a)`, `rgba(15,20,17,a)`, `rgba(15,40,32,a)`, `rgba(31,66,50,a)`, `rgba(0,0,0,a)` in `box-shadow` | every shadow | `--shadow-ink` |
| `rgba(241,236,224,a)`, `rgba(237,232,220,a)`, `rgba(238,241,234,a)`, `rgba(255,255,255,a)` on forest | sidebar, hero, review card, course card | `--side-ink` |
| `rgba(255,255,255,0.6 / 0.55)` on paper (`.gitem:hover`, `.set-tab:hover`) | hover lift | `--white` |
| `rgba(244,240,231,0.85)` (`.hdr`) | frosted header | `--paper` |
| `rgba(244,240,231,a)` (`.rung.current span`) | text on fern | `--on-fern` |
| `rgba(244,240,231,a)` (`.cover::after`, `.spine::after`, `.cover-g`) | cover art | leave as is |
| `rgba(239,234,223,a)` | `.gcat`, `.set-nav`, `.sheet-f`, `.cr-dr-f` | `--paper-3` |
| `rgba(228,236,227,0.5)` | `.reading-bar` | `--fern-soft` |
| `rgba(147,179,156,a)` | course chips and segments | `--fern-mid` |
| `rgba(169,200,178,a)` | review card focus, done | `--side-accent` |
| `rgba(166,61,34,a)` | strike-through in diffs | `--seal` |
| `rgba(184,69,42,a)` | `.mk` highlight, `.mk-done` | `--seal-2` |
| `rgba(240,164,143,a)` | `.ank-done.bad` | `--seal-on-side` |
| `rgba(224,112,79,a)` | `.cr-pulse` keyframes | `--pulse` |
| `rgba(127,194,154,a)` | ok dot glow | `--ok` |
| `rgba(224,178,92,a)` | warn dot glow | `--warn` |
| `rgba(23,30,26,0.38)` | `.overlay` | `var(--scrim)` (whole value) |

Electron's Chromium supports `color-mix`, so this needs no fallback.

## Design notes

- **Forest Night** uses the same forest-night palette as the dark mode on sayfern.ca, so the app and the site match.
- **Ink** is neutral black, greys and white, and the accent becomes white. Corrections keep one warm red (`--seal`) so they still stand out. The status dots (ok, warn, pulse) keep their colours.
- In both dark themes, each surface is one step lighter than the one behind it: `--forest` (sidebar), then `--paper`, then `--card`, then `--white` (inputs, popovers).
