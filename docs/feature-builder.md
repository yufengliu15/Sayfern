# Building a Sayfern feature

This is the guide the feature builder (the model behind Customize) reads first. It is also the reference for anyone writing a feature by hand. The SDK's exact types are in [`feature-sdk.d.ts`](feature-sdk.d.ts); the full extension API (tutor tools, prompt additions, language packs) is in [`extensions.md`](extensions.md).

## What a feature is

A feature is an extension folder. Each build makes a new **version** of it; versions never change after their build ends, and the learner can turn any finished version on, or roll back to it.

```
package.json        name, description, "type": "module", "sayfern": { "surfaces": [...] }, optional "main"
ui/index.html       a page shown in a sandboxed frame (one per surface, or shared)
ui/main.js          DOM code for the page (ES module)
ui/<logic>.js       pure logic: no DOM access when imported, so tests can import it
ui/style.css        optional, on top of the Sayfern stylesheet
test.js             tests for the logic, run by run_tests
index.js            ONLY if the feature needs full app access (see below)
```

Plain JavaScript ES modules, HTML and CSS. No build step, no npm packages, no TypeScript, no JSX, no imports from URLs, no network, no CDNs, no web fonts, no remote images. Text files only (`.js .mjs .html .css .json .md .txt .svg`), at most 40 files and 1 MB.

## Surfaces (sandboxed UI)

`package.json` lists where the feature appears:

```json
{
  "name": "Measure-word drill",
  "version": "1.0.0",
  "description": "Shows a noun from your Anki deck; you pick the right measure word.",
  "type": "module",
  "sayfern": {
    "surfaces": [
      { "kind": "tab", "title": "Measure words", "entry": "ui/index.html", "languages": ["zh"] },
      { "kind": "activity", "title": "Measure-word drill", "description": "Ten nouns from your Anki", "entry": "ui/index.html", "languages": ["zh"] }
    ]
  }
}
```

- `kind: "tab"`: an entry in the sidebar that opens the page full size.
- `kind: "activity"`: a tile on the Today screen that opens the page. Use it for practice drills and quizzes.
- `title`: 1 to 40 characters. `description`: one line (activities). `languages`: `["zh"]`, `["ja"]` or omit for both.
- `entry`: an `.html` file in the feature.

Not available yet (don't promise them): statistics widgets, dictionary sources, importers, integrations. Build them as a tab or activity instead.

### The page

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="/_sdk/sayfern.css" />
    <link rel="stylesheet" href="./style.css" />
    <script src="/_sdk/sayfern-sdk.js"></script>
    <script type="module" src="./main.js"></script>
  </head>
  <body>
    <div class="sf-page">
      <div class="sf-bar"><b>Title</b><span id="progress"></span></div>
      <main class="sf-body" id="body"></main>
      <div class="sf-foot" id="source"></div>
    </div>
  </body>
</html>
```

Use exactly these `/_sdk/` paths. No inline `<script>` blocks and no `on…=` attributes: the page's security policy only runs script files from the feature. Inline `style` attributes are fine.

The frame has no network, no access to the app or other features, no popups and no top navigation. It talks to Sayfern only through `window.sayfern`.

### The SDK (`window.sayfern`)

All calls are async. Full types: [`feature-sdk.d.ts`](feature-sdk.d.ts).

| Call | Returns |
|---|---|
| `sayfern.context()` | `{ featureId, version, language, preview }` |
| `sayfern.anki.words({ status?, search?, deck?, limit?, offset? })` | `{ total, items: [{ word, reading, meaning, status, mature, lapses, struggle }], syncedAt }` (empty when Anki is off) |
| `sayfern.grammar.list()` | the learner's grammar patterns: `{ id, pattern, name, level, explanation, examples, state, rate }` |
| `sayfern.words.saved()` | saved words: `{ word, reading, definition, sentence, savedAt }` |
| `sayfern.lookup(word)` | dictionary entries `{ query, needsDictionary, entries: [{ headword, reading, senses: [{ glosses }] }] }` |
| `sayfern.annotate(text)` | tokens `{ text, start, end, isWord, reading, lemma }` |
| `sayfern.storage.get(key)` / `.set(key, value)` | per-feature JSON storage (256 KB; `set(key, null)` deletes) |
| `sayfern.results.record({ item, correct?, score?, answer?, expected?, kind? })` | stores a practice result for this feature |
| `sayfern.results.list(limit?)` | stored results, newest first |

Rules for the UI:

- Always handle empty data: a learner may have no Anki deck, no grammar records, no saved words. Fall back to a small built-in list and say so in the page ("Sample nouns (none from your Anki yet)").
- Every number you show (scores, counts, streaks) is computed by your code from real data. Never invent numbers.
- Keyboard-friendly: buttons are `<button>`, number keys or Enter for quick answers. Ignore key events while an IME is composing (`e.isComposing`).
- English UI copy, plain and short, no em dashes. Learning content in the target language (use the `zh` / `ja` classes for CJK fonts).

### Sayfern stylesheet

`/_sdk/sayfern.css` gives the app's colors as CSS variables (`--paper`, `--card`, `--ink`, `--muted`, `--line`, `--fern`, `--fern-soft`, `--seal`, fonts `--sans`, `--serif`, `--zh`, `--ja`) and a few classes: `sf-page`, `sf-bar`, `sf-body`, `sf-foot`, `sf-card`, `sf-btn` (+ `primary`), `sf-choices` / `sf-choice` (+ `right`, `wrong`), `sf-input`, `sf-ok`, `sf-bad`, `muted`, `eyebrow`, `serif`, `mono`, `zh`, `ja`.

## Tests (`test.js`)

`run_tests` loads `test.js` the same way the UI runs: in a hidden, sandboxed browser page served by `sayfern-feature://` with no network and no Node APIs. Import only the feature's own files with relative paths. Don't touch the DOM in tests (the page is empty). It provides:

- `test(name, fn)`: `fn` may be async.
- `assert(value)`, `assert.ok`, `assert.equal` (`Object.is`), `assert.notEqual`, `assert.deepEqual`, `assert.throws`, `assert.rejects`, `assert.fail`.
- `sayfern`: a fake SDK with sample learner data (a dozen Anki words, three grammar points, a saved word) for the feature's language.
- `console.log` output is shown with the results.

Test the pure logic and how it uses SDK data (including empty data). Don't import `ui/main.js` or anything that touches `document` at import time. Aim for 6 to 15 focused tests. Every test must pass before `finish`.

```js
import { pickNouns, check } from "./ui/drill.js";

test("uses Anki nouns", async () => {
  const page = await sayfern.anki.words({ limit: 200 });
  assert.ok(pickNouns(page.items).fromAnki >= 4);
});

test("explains a wrong answer", () => {
  assert.equal(check({ noun: "鱼", answer: "条" }, "张").correct, false);
});
```

## Full app access (`main`, needs the learner's review)

Only when the request needs the tutor itself to change (a tool the tutor calls in chat, a paragraph added to the tutor's instructions, a language pack), add `"main": "index.js"` to `package.json` and export `activate(api)` as described in [`extensions.md`](extensions.md). That code runs inside the app with full access to the learner's Mac account, so Sayfern shows it to the learner and only runs it after they read and approve this exact version. Keep main-side code short and obvious, never use the network or the file system unless the request is about that, and say in your `finish` summary that the learner needs to review it.

Rules Sayfern enforces for main-side code (the build can't finish otherwise), so the review covers everything that runs:

- Import only the feature's own files with literal relative paths (`import { x } from "./lib/x.js"`) or `node:` built-ins. Never leave the feature folder.
- No `require`, `createRequire`, `import()` with a computed path, `eval`, `new Function`, `node:vm` or `process.dlopen`.
- Keep sandboxed UI code in `ui/`. Every script outside `ui/` is shown to the learner as full access.

A feature can have both: surfaces for the UI and a small `main` for a tutor tool.

## Workflow

1. `list_kit`, read this guide and one or two examples (`examples/extensions/measure-word-drill` is a sandboxed tab plus activity; `examples/extensions/chengyu-of-the-day` is a main-side tutor tool).
2. Write the files with `write_feature_file`. For changes to an existing feature, read the current files first and change only what the request needs.
3. `run_tests`, fix, repeat until all pass.
4. `finish({ summary, name, description })`: 2 or 3 plain sentences for the learner (what it does, where it shows up, what needs review), a name of at most 40 characters and a one-line description.
