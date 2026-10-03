# Extensions (F-09)

Extensions add tools the tutor can call, extra paragraphs for the tutor's system prompt, and whole language packs. They are plain JavaScript ES modules: no build step, no Sayfern SDK to install.

Two working examples: [`examples/extensions/chengyu-of-the-day`](../examples/extensions/chengyu-of-the-day/) (a tutor tool and a prompt addition) and [`examples/extensions/measure-word-drill`](../examples/extensions/measure-word-drill/) (a sandboxed tab and Today activity). The host is `FileExtensionHost` in `src/core/extensions/index.ts`; the `ExtensionApi` and `ExtensionToolInput` types there are the authoritative API.

There are two ways to get an extension:

- **Build it in Customize** (Stage 2, S2-10..S2-13). Describe a feature; the builder (your chosen model) reads [`feature-builder.md`](feature-builder.md), the SDK reference [`feature-sdk.d.ts`](feature-sdk.d.ts) and the examples, writes the files, runs the tests and shows a live preview. See [Built features](#built-features-customize).
- **Install a folder by hand** (below).

## Security

Two kinds of code, two levels of trust:

- **Sandboxed UI** (`sayfern.surfaces` in `package.json`): pages shown in `<iframe sandbox="allow-scripts">` (opaque origin) from the `sayfern-feature://` protocol, with a strict Content Security Policy (no network, scripts only from the feature itself, no `eval`) and no popups or navigation. The app window's session sends all web traffic to a dead proxy (loopback included, except in dev), restricts WebRTC to that proxy (no STUN/TURN), and grants frames no permissions; main's own downloads use a separate session. Pages reach Sayfern only through the SDK (`window.sayfern`), whose calls are allowlisted and checked in the renderer and again in core. A built feature with only surfaces can be turned on directly.
- **Main-side code** (`activate(api)` in `main` / `index.js`): runs in the app with full privileges, as described next. For built features it only runs after you read and approve that exact version (see [Review gate](#review-gate)).

**Main-side extensions run inside the app with full privileges.** They can read and write any file your user account can, use the network, and read your learning records. There is no sandbox. Only install extensions you wrote yourself or whose source you have read and trust.

## Install

1. Open **Settings > Extensions > Open extensions folder**. This is `~/Library/Application Support/sayfern/extensions/`.
2. Copy the extension's folder in, e.g. `extensions/chengyu-of-the-day/`.
3. Restart Sayfern. (Toggling any listed extension in Settings > Extensions also reloads the whole folder, including newly added extensions.)

The folder name is the extension's id. Folders starting with `.` are ignored. Enabled flags are stored in `extensions.json` next to the `extensions/` folder (`{ "enabled": { "<id>": false } }`); extensions are enabled by default. Settings > Extensions and the Customize screen list every extension with its name, version, description, contributions and any load error.

## Layout

```
extensions/<id>/
  package.json     { "name", "version", "description", "type": "module", "main"? }
  index.js         ES module exporting activate(api)
```

- `name`: display name (defaults to the folder name). `version` defaults to `0.0.0`.
- `main`: entry file relative to the folder, default `index.js`. It must stay inside the folder and exist.
- A missing or invalid `package.json` is shown as an error on the extension; nothing is loaded.
- `"type": "module"` makes Node treat `.js` as ESM. Alternatively name the entry `index.mjs`.

## Lifecycle

- On startup Sayfern reads every sub-folder of `extensions/`, in name order.
- For each enabled extension it imports the entry and calls `activate(api)` (the function may be `async`). Registration calls are only allowed while `activate` runs; calling them later throws. Disabled extensions are listed but never imported.
- If loading or `activate` throws, the error is shown on the extension in Settings, nothing it registered is kept, and the other extensions load normally. (Exception: if one of several `registerLanguage` calls fails after `activate`, packs registered before it stay registered.)
- Toggling any extension reloads all of them: each loaded module's optional `deactivate()` export is called, then entries are imported again (a fresh copy, so edits to `index.js` are picked up).
- Language packs can't be unregistered while the app runs: after disabling an extension that registered one, restart Sayfern.
- Editing `index.js` has no effect until the next reload (a toggle or a restart): modules are cached per load.

The entry may export `activate` (and `deactivate`) by name, as properties of a default export object, or as a default-exported function.

## API

```js
export function activate(api) {
  api.id;    // folder id
  api.path;  // absolute folder path, for bundled data files
  api.registerTool(tool);
  api.addPromptAddition((language) => "..." | undefined);
  api.registerLanguage(pack, dictionary?);
  api.log("anything");
}
```

### `registerTool(tool)`

```js
api.registerTool({
  name: "chengyu_of_the_day",            // [A-Za-z0-9_-], max 64; core tools win on a name clash
  description: "What it does and when the tutor should call it.",
  parameters: { type: "object", properties: {} },  // JSON schema or a TypeBox schema; default: no parameters
  recordingOnly: false,                  // true: stores data only, the turn ends without sending the result back
  async execute(args, ctx) {
    // ctx: { sessionId, language, userMessageId?, records, library, anki, lang }
    return "Text for the model";         // or { content: "Text for the model", activity: "One line for the inspector" }
  },
});
```

- `args` is whatever the model sent. Validate it yourself.
- `parameters` that isn't an object falls back to "no parameters".
- Return values: a string becomes the content (inspector line "Used <name>"); `{ content, activity }` sets both; any other object is sent as JSON; `undefined` becomes "Done.".
- Thrown errors are reported to the model as a tool error and shown in the inspector; they don't break the turn.
- `ctx` gives the same services the core tools use (`RecordsStore`, `LibraryService`, `AnkiService`, `LanguageService` in `src/core/contracts.ts`). `ctx.userMessageId` is absent when the tutor speaks first (practice, reading and placement openings).
- Tools are offered in every session, whatever the language: check `ctx.language` yourself.
- Name clashes: core tools win over extension tools; between extensions, the first by folder name wins. The losing tool is silently not offered.
- `recordingOnly: true` is for tools whose result the model doesn't need (S1-27): when every tool the model called in a step is recording-only and the reply already has text, the turn ends without sending the results back. If the model called it before writing any reply, the loop continues so the learner still gets one.

### `addPromptAddition(fn)`

`fn(language)` runs whenever the tutor's system prompt is built (every turn). Return a short paragraph, or `undefined` / an empty string to add nothing for that language. Additions are appended at the very end of the system prompt, after the core tool protocol, in extension folder order. A function that throws is logged and skipped. Keep it brief: it costs tokens on every request.

### `registerLanguage(pack, dictionary?)`

Adds (or replaces) a language pack: an object implementing `LanguagePack` from `src/core/contracts.ts` (`info`, `ready()`, `segment()`, `learnerWords()`, `normalize()`, `promptNotes()`), optionally with a `DictionaryProvider` (`status()`, `install(onProgress)`, `lookup(word)`, optional `longestMatch()`). Registering a pack without a dictionary removes any dictionary that language had. The language then appears in `listLanguages()`. Records, settings and the UI are still typed for `zh` and `ja`, so a new language is experimental in Stage 1; replacing the `zh` or `ja` pack is the practical use today.

### `log(...args)`

Writes to the app's console, prefixed with the extension id.

## Example

```js
export function activate(api) {
  api.registerTool({
    name: "chengyu_of_the_day",
    description: "Returns today's chengyu with pinyin, meaning and an example.",
    parameters: { type: "object", properties: {} },
    execute(_args, ctx) {
      if (ctx.language !== "zh") return "Chinese sessions only.";
      return { content: "一举两得 (yī jǔ liǎng dé): kill two birds with one stone.", activity: "Chengyu of the day: 一举两得" };
    },
  });
  api.addPromptAddition((language) =>
    language === "zh" ? "Occasionally call chengyu_of_the_day and invite the learner to use the idiom." : undefined,
  );
}
```

## Built features (Customize)

A built feature is an extension folder with versions, kept under `<userData>/builder/`:

```
builder/features/<id>/feature.json          name, description, versions, approvals, the builder conversation
builder/features/<id>/versions/<n>/…        one extension folder per version
builder/data/<id>/storage.json              what the feature saved with sayfern.storage
builder/data/<id>/results.json              practice results from sayfern.results.record
builder/features/<id>/approved/<hash>/…      read-only copy of an approved full-access version (what the host loads)
```

- **Versions.** Each build (a new feature or "Ask for changes") writes a new version folder, starting as a copy of the previous one. When the build ends the version is sealed: its files are hashed (`hashFiles`: sha256 over sorted path + bytes) and never written again. Every version is kept; turn any finished one on, or roll back to it. "Discard" deletes the draft (the newest version that was never turned on).
- **Apart from the app.** Features live in your user data, never in the app bundle, so updates never overwrite them. "Erase all data" keeps `builder/features/` (like `extensions/`) and removes `builder/data/`.
- **Loading.** The feature builder registers its features with the extension host (`setManagedSource`). The active version of each feature loads from its version folder after the hand-installed extensions, on every (re)load. A hand-installed folder with the same id wins. `list()` returns hand-installed extensions only; `managedList()` the built ones.
- **UI-only features** (no `main` and no `index.js`) import nothing in the app: the host lists them without loading code.

### Surfaces

```json
"sayfern": {
  "surfaces": [
    { "kind": "tab", "title": "Measure words", "entry": "ui/index.html", "languages": ["zh"] },
    { "kind": "activity", "title": "Measure-word drill", "description": "Ten nouns from your Anki", "entry": "ui/index.html" }
  ]
}
```

- `tab`: a sidebar entry under the main navigation (route `feature/<id>/<index>`).
- `activity`: a tile under "Your activities" on Today, opening the same full-size host.
- `languages` limits the surface to those workspaces. At most 8 surfaces.
- Statistics widgets, dictionary sources, importers and integrations are not surfaces yet (follow-ups).
- Only built features show surfaces. A hand-installed folder with a `sayfern` block loads its `main` code as usual; its surfaces are ignored for now.

Pages load `/_sdk/sayfern-sdk.js` and `/_sdk/sayfern.css` (served by Sayfern) and their own files by relative URL. The SDK and its limits are documented in [`feature-builder.md`](feature-builder.md) and typed in [`feature-sdk.d.ts`](feature-sdk.d.ts). Sandboxed code can read Anki words, grammar, saved words, look up and segment text, keep up to 256 KB of JSON and record practice results. It can't write grammar evidence or anything else in your records.

### Tests

`test.js` is unapproved code, so it never runs in the app process. In the app it runs where the UI runs: a hidden, sandboxed, preload-less window on its own in-memory session (same dead proxy, WebRTC limit and no permissions) loads `sayfern-feature://<id>/v<n>/_test/index.html` (served only to that session; CSP `connect-src 'none'`, no `eval`), with a fake SDK holding sample data. The window is destroyed after the result is read or after 8 s. Without Electron (unit tests, smoke, dev), a child process under Node's permission model (no file system, child process, worker or addon access) runs the tests instead; Node's permission model does not restrict the network, so that fallback is not used in the app. Pass and fail counts are counted by Sayfern from the per-test results, never reported by the model.

### Review gate

If a version has main-side code (`"main"` in `package.json`, or an `index.js`), turning it on needs your approval: Customize shows every file, flags those that run with full access, and offers "I've read this code, turn it on". The approval stores the version's hash and freezes a read-only copy of exactly those files in `builder/features/<id>/approved/<hash>/`; the host loads main-side code only from that copy, never from `versions/`, which builds write to. The host computes the copy's hash again at every load and refuses code you didn't approve (for example if a file changed on disk); the feature then shows a load error in Customize. Main-side code must import only the version's own files with literal relative paths (or `node:` built-ins) and may not use `require`, computed `import()`, `eval`, `new Function`, `node:vm` or `process.dlopen`; a version that breaks these rules can't finish building or be approved. In the review sheet, every script outside `ui/` is flagged as full access. Hand-installed extensions in `extensions/` are not affected.
