# Extensions (F-09)

Extensions add tools the tutor can call, extra paragraphs for the tutor's system prompt, and whole language packs. They are plain JavaScript ES modules: no build step, no Sayfern SDK to install.

A working example lives in [`examples/extensions/chengyu-of-the-day`](../examples/extensions/chengyu-of-the-day/). The host is `FileExtensionHost` in `src/core/extensions/index.ts`; the `ExtensionApi` and `ExtensionToolInput` types there are the authoritative API.

## Security

**Extensions run inside the app with full privileges.** They can read and write any file your user account can, use the network, and read your learning records. There is no sandbox. Only install extensions you wrote yourself or whose source you have read and trust.

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
