# AGENTS.md

Entry point for coding agents (and humans) working on Sayfern. Read this first, then the deep docs linked at the end.

## What Sayfern is

A free, open-source (MIT) macOS app for learning Chinese and Japanese by chatting with an AI tutor that remembers what the learner is learning. The learner brings their own model (API key, or a Claude Pro/Max or ChatGPT subscription). All records stay on the Mac as JSON files.

- **Version:** 0.4.0. Stage 1 (text learning) is built. Stage 2 (corrections review, Anki export, quizzes, AI feature builder) and Stage 3 (voice) are next: [`docs/roadmap.md`](docs/roadmap.md).
- **Owner:** Yufeng. Feature IDs (S1-xx, F-xx, S2-xx, S3-xx) come from the owner's project page; [`docs/stage1.md`](docs/stage1.md) maps S1/F IDs to code.

## Stack

| Layer | Tech |
|---|---|
| Shell | Electron 44 (`electron-vite` 5 for dev/build) |
| UI | React 19, TypeScript 5.9, one CSS file, hash router, fonts via `@fontsource` |
| Logic | Plain Node (ESM, TypeScript) in `src/core` |
| Models | `@earendil-works/pi-ai` 0.99.1 (providers, OAuth, streaming, tools) |
| Language | `pinyin-pro`, `kuromoji` (IPADIC), CC-CEDICT and JMdict (downloaded on demand) |
| Library | `pdfjs-dist` (legacy build, in-process), `jszip` (EPUB, JMdict zip) |
| Storage | JSON files, atomic writes, per-file queues |
| Tests | `node:test` via `tsx --test` |

Node ≥ 22.19. Do not add dependencies without asking the owner.

## Run, test, build

```bash
npm install                      # also patches pi-ai's OAuth page and installs the Electron binary
npm run dev                      # the app (electron-vite dev)
npm run typecheck                # both TS projects (node + web)
npm test                         # all unit/integration tests (~20 s, no network)
npx tsx --test src/core/agent/turn.test.ts   # one file
npm run smoke -- selftest        # offline end-to-end run of SayfernApp with a fake provider
npm run smoke -- chat anthropic "你好！"      # real provider from the terminal (data in ./.sayfern-dev)
npx vite --config vite.mock.config.ts         # UI only, in a browser, mock backend: http://localhost:5174
                                              # add ?onboarding=1, ?fresh=1 or ?anki=offline
npm run build && npm start       # build to out/ and run the built app
npm run bench -- selftest        # offline check of the Sayfern vs Claude Code benchmark (docs/benchmark.md)
```

Before you finish any change: `npm run typecheck` and `npm test` must pass.

## Repo map

```
src/shared/        types + the renderer ↔ main contract (api.ts). No runtime deps.
src/core/          all logic, plain Node, NO electron imports
  contracts.ts     interfaces between core modules
  app/             SayfernApp facade (implements the API) + SettingsStore
  agent/           tutor: prompt, tools, streaming turn loop, retries, translation, end of session
  records/         JSON-file RecordsStore: sessions, corrections, grammar, words, levels, stats, export
  lang/            zh + ja language packs, CC-CEDICT/JMdict dictionaries, lookup
  library/         txt/md/html/epub/pdf import, paragraphs, checkpoints, BM25 search
  anki/            AnkiConnect client, snapshots, word model + struggle score (words.ts)
  extensions/      user extension host
  providers.ts     pi-ai provider registry; credential-file-store.ts: credentials file
src/main/          Electron main: window, dialogs, safeStorage cipher, IPC table; e2e.ts test hook
src/preload/       generic bridge: window.sayfern
src/renderer/      React UI; src/renderer/src/dev/mockApi.ts is the in-browser backend
scripts/           smoke.ts, brand-oauth-page.mjs, brand-electron-app.mjs
build/             app icon: icon.svg (source), icon.png, icon.icns
examples/          example extension (chengyu-of-the-day)
bench/             benchmark vs Claude Code + skill: recording proxy, fake AnkiConnect, scenarios, report
docs/              architecture, decisions, roadmap, stage1 feature map, extensions API
```

## Contracts

| Contract | File | Rule |
|---|---|---|
| Renderer ↔ main API | `src/shared/api.ts` (`SayfernApi`, `API_METHODS`, `ChatEvent`, `EVENT_CHANNELS`) | Every method is one `ipc:<method>` channel. `METHOD_TABLE` must list every method (compile-time check). |
| Domain types | `src/shared/records.ts`, `src/shared/lang.ts`, `src/shared/types.ts` | Types only (plus `LANGUAGES`, `SKILLS`). Stored JSON follows these shapes, so changes need a migration or optional fields. |
| Core interfaces | `src/core/contracts.ts` | `RecordsStore`, `LanguageService`, `LanguagePack`, `DictionaryProvider`, `LibraryService`, `AnkiService`, `Tutor`, `TutorTool`, `ToolContext`, `ExtensionHost`. Extensions depend on `ToolContext` and `LanguagePack`: treat them as public. |

## How it works in one minute

1. Main (`src/main/index.ts`) builds `SayfernApp` and registers `ipc:<method>` for every `API_METHODS` entry. The preload exposes them as `window.sayfern`.
2. The renderer calls `api.send(sessionId, { text, pastedSpans }, model)`. `SayfernApp.send` returns a `requestId` at once and runs the turn detached.
3. `runTurn` (`src/core/agent/turn.ts`) saves the learner message, records learner words, picks Anki targets once per session, rebuilds the system prompt from records (`prompt.ts`), and streams the model through pi-ai. Tool calls run between iterations (max 5); `record_evidence` stores corrections, grammar observations, taught patterns and level estimates.
4. Progress arrives as `ChatEvent`s on `evt:chat`: `user_saved`, `delta`, `tool`, `correction`, then `done` (with the canonical `SessionView`) or `error`. `src/renderer/src/lib/chatStream.ts` keeps in-flight turns outside React; `useChat` merges them with the stored view.
5. Everything the learner sees as a number comes from `src/core/records/stats.ts`, `grammar.ts` and `src/core/anki/words.ts`.

Practice, reading and placement sessions open with a tutor turn started by main (hidden kickoff message in the transcript only). Full flows: [`docs/architecture.md` section 11](docs/architecture.md#11-end-to-end-flows).

## Data on disk

`~/Library/Application Support/sayfern/` (Electron `userData`): `credentials.json` (encrypted), `settings.json`, `records/` (one JSON file per session in `records/sessions/`, one file per record kind), `dict/`, `library/<docId>/`, `anki/`, `extensions/`, `extensions.json`. The smoke script uses `./.sayfern-dev/` with plain-text credentials. Layout and JSON examples: [`docs/architecture.md` section 7](docs/architecture.md#7-disk-layout).

## Where to change what

| If you need to... | Touch |
|---|---|
| Add or change an API method | `src/shared/api.ts` (`SayfernApi` + `METHOD_TABLE`) → `src/core/app/index.ts` (`SayfernApp`) or `electronOnly` in `src/main/index.ts` if it needs dialogs/shell → `src/renderer/src/dev/mockApi.ts` → the UI. Preload and main's IPC loop pick it up automatically. |
| Change what the tutor is told | `src/core/agent/prompt.ts` (`renderSystemPrompt` blocks, `gatherPromptData`); tests in `prompt.test.ts` |
| Add a tutor tool | `src/core/agent/tools.ts` (`turnTools`) or `anki-tools.ts`; decide `recordingOnly`; update the tool protocol text in `prompt.ts` if the model needs to know |
| Change the turn loop, streaming, errors, abort | `src/core/agent/turn.ts`; tests in `turn.test.ts` and `src/core/app/app.test.ts` |
| Change token caps / reasoning effort | `src/core/agent/options.ts`, constants in `turn.ts` |
| Store a new kind of record | `src/core/records/store.ts` (+ `files.ts` shape, `exportAll`), the `RecordsStore` interface, types in `src/shared/records.ts` |
| Change a progress number | `src/core/records/stats.ts` (`computeProgress`) or `grammar.ts` (`summarizeGrammar`) |
| Add a model provider | `FACTORIES` (and `NOTES`, `LOGIN_LABELS`) in `src/core/providers.ts`; default pick in `src/shared/models.ts` |
| Change sign-in behavior | `SayfernApp.login` / `authInteraction` in `src/core/app/index.ts`; UI in `src/renderer/src/components/Connect.tsx` |
| Add a language | A `LanguagePack` (+ `DictionaryProvider`) like `src/core/lang/zh.ts`; register in `DefaultLanguageService`; widen `Language` in `src/shared/records.ts` and the renderer's `FALLBACK_LANG`, `STARTERS`, `COMPOSER_PLACEHOLDER`, CSS font class |
| Improve segmentation or readings | `src/core/lang/zh.ts`, `src/core/lang/ja.ts`; renderer ruby split in `src/renderer/src/lib/ruby.ts` |
| Support a new import format | `src/core/library/index.ts` (`FORMATS`, `parseBytes`) + a parser file; `IMPORT_EXTENSIONS` in `src/main/index.ts` |
| Change search ranking | `src/core/library/search.ts` (bump `DocIndex.v` if the index format changes) |
| Change Anki sync or the word model | `src/core/anki/index.ts` (`pull`, `history`, `toCard`), `src/core/anki/words.ts` (`struggleScore`, `aggregateWords`, `queryWords`) |
| Change Anki troubleshooting | `classifyFetchError` in `src/core/anki/index.ts`, `AnkiTroubleshoot` in `src/renderer/src/screens/Settings.tsx` |
| Benchmark Sayfern vs Claude Code, add a scenario | `bench/scenarios/*.json`, `bench/lib/`; see [`docs/benchmark.md`](docs/benchmark.md). If you change `SayfernApi` or `record_evidence`, run `npm run bench -- selftest` |
| Change the extension API | `src/core/extensions/index.ts` (`ExtensionApi`, `normalizeTool`) and `docs/extensions.md`; keep `examples/extensions/` working |
| Add a screen | `src/renderer/src/router.ts` (route + `parseRoute`), `App.tsx` switch, `components/Sidebar.tsx` nav |
| Change the app name shown or the icon | `setUpBranding` in `src/main/index.ts`, `scripts/brand-electron-app.mjs`, `build/icon.*` (keep `app.name` as `sayfern`) |
| Change colors or fonts | Tokens at the top of `src/renderer/src/styles.css`; fonts imported in `src/renderer/src/main.tsx` |
| Change window, navigation or IPC wiring | `src/main/index.ts` (`buildApp` builds the backend; `sayfern` is replaced after an erase, so never capture it) |
| Change what "Erase all data" deletes | `ERASE_PATHS` and `eraseData` in `src/core/app/index.ts`; test in `app.test.ts` |

## Invariants and rules

1. **Layering.** `src/core` never imports `electron`. Core services take explicit deps (`dataDir`, `fetch`, `now`); no singletons. The renderer reaches the backend only through `window.sayfern` (use `api` from `src/renderer/src/api.ts`).
2. **Locally computed numbers (S1-25).** Models record evidence; code computes every count, rate, state and stat. Never ask a model for a number shown to the learner.
3. **Recording-only tool pattern (S1-26, S1-27).** The tutor writes its reply first, then calls `record_evidence` once. When every tool call in a step is `recordingOnly` and there is reply text, the loop ends without a follow-up request. Record ids are deterministic (`src/core/records/ids.ts`) so repeated calls dedupe. Keep the transcript valid: assistant(toolCall) → toolResult → next user message.
4. **Learner words.** Only the learner's own writing counts: pasted spans are removed (`stripPasted`), tutor text never counts.
5. **Every turn ends with exactly one `done` or `error` ChatEvent**, and `error` carries a fresh `view` whenever the session exists. Failed or stopped replies are saved on the tutor message (`error`), never thrown.
6. **Storage writes** go through the existing atomic helpers (`JsonFile`, `writeJsonAtomic`). One process only (single-instance lock).
7. **Openings.** Practice, reading and placement sessions start with a tutor turn from main; `send` is rejected while it runs. To make the tutor open a certain way, put it on the session (`SessionMeta.openWith`, read by `kickoffText` and `sessionBlock`), never send right after creating the session.
8. **UI copy:** plain, short, no em dashes. Colors and fonts from `styles.css` tokens only.
9. **API change checklist:** `src/shared/api.ts` (`SayfernApi` + `METHOD_TABLE` / `API_METHODS`) → `SayfernApp` (or main `electronOnly`) → main IPC (automatic) → `mockApi.ts` → UI → tests.
10. **Every change bumps the version** (semver; while 0.x, minor = features, patch = fixes) in `package.json` + `package-lock.json` + the `README.md` version line, and adds a `CHANGELOG.md` entry (Keep a Changelog: Added / Changed / Fixed).
11. **Docs:** if you change behavior described in `docs/`, update the doc in the same change. Code wins over docs.
12. **Git:** do not commit or push unless the owner asks.

## Gotchas

- **pi-ai patch.** `scripts/brand-oauth-page.mjs` overwrites `node_modules/@earendil-works/pi-ai/dist/utils/oauth-page.js` on `postinstall` and `predev`. After upgrading pi-ai, check the file still exists and exports `oauthSuccessHtml` / `oauthErrorHtml`, then test a real sign-in (`npm run smoke -- login anthropic`).
- **App name vs display name.** `app.name` must stay `sayfern` (package.json `name`, no `productName`): it names the userData folder and the Keychain item `sayfern Safe Storage` that encrypts credentials. Changing it, even its case, strands saved sign-ins. The learner-facing name "Sayfern" comes from the menu labels and About panel (`setUpBranding` in `src/main/index.ts`) and, in dev, from `scripts/brand-electron-app.mjs`, which renames node_modules' `Electron.app` (CFBundleName, icon) and re-signs it ad hoc on `postinstall`, `predev` and `prestart`.
- **App icon.** Edit `build/icon.svg`, then regenerate `build/icon.png` (1024 px, transparent corners) and `build/icon.icns` (Pillow: `Image.open("icon.png").save("icon.icns")`). The next `npm run dev` repatches the dev bundle.
- **Electron binary.** Electron 44 does not download itself on install; `install-electron` runs in `postinstall` and `predev`. If `npm install --ignore-scripts` was used, run `npx install-electron`.
- **IME-safe inputs.** Chinese and Japanese are typed through an IME. Any input that submits on Enter must ignore key events while composing: check `e.nativeEvent.isComposing || e.keyCode === 229` (see `Composer.tsx`).
- **AnkiConnect port conflicts.** AnkiConnect listens on 127.0.0.1:8765. If something else owns the port (this happened: a Python LaunchAgent), AnkiConnect can't bind and Sayfern reports `refused` or `not_ankiconnect`. Check with `sudo lsof -i :8765`. `timeout` usually means macOS App Nap. Anki calls use Node's fetch (`ankiFetch`), not Chromium's.
- **safeStorage prompt.** The first credential read/write can make macOS ask to allow "sayfern Safe Storage" in the Keychain. Deny it and credentials can't be read. The smoke script uses plain JSON in `.sayfern-dev/` instead.
- **Two TS projects.** `src/shared` is compiled by both `tsconfig.node.json` and `tsconfig.web.json`: keep it free of Node and DOM APIs.
- **Mock API drift.** `mockApi.ts` implements `SayfernApi`; a new method without a mock implementation fails typecheck.
- **Extension imports are cached by URL.** The host adds `?v=<generation>`; reloading happens on toggle or restart, not on file change.
- **Tests with timers.** Many core services take `now`; use it instead of `Date.now()` so tests can control time.
- **Known gaps.** Before "fixing" odd behavior, check the backlog in [`docs/roadmap.md`](docs/roadmap.md#known-gaps-and-backlog): some are known (retry duplicates the learner message, disputes don't reach the tutor).

## Debugging

- A provider misbehaves: reproduce outside the UI with `npm run smoke -- chat <provider> [model-id] "text"`; it prints deltas, tool activity, usage and recorded corrections.
- Test a turn without credentials: `pi-ai`'s `fauxProvider()` scripts replies and tool calls (see `src/core/app/app.test.ts`, `scripts/smoke.ts selftest`). The built app can run with a scripted faux provider: `SAYFERN_E2E_FAUX=1` (`src/main/e2e.ts`).
- UI work: run the mock server; `src/renderer/src/dev/mockApi.ts` simulates streaming, corrections and tool activity.
- Anki: Settings > Anki shows the failure reason; outside the app, `curl -s http://127.0.0.1:8765 -X POST -d '{"action":"version","version":6}'` should print a version.
- Records are plain JSON: open the files under `records/` to see exactly what the tutor stored.

## Deep docs

- [`docs/architecture.md`](docs/architecture.md): every module, disk layout with JSON examples, the full API table, ChatEvent protocol, prompt and tools, end-to-end flows, renderer, testing, scripts.
- [`docs/decisions.md`](docs/decisions.md): why (Electron, pi-ai, JSON storage, recording-only tools, Anki transport, versioning, ...).
- [`docs/roadmap.md`](docs/roadmap.md): Stage 2 and 3, and the known-gaps backlog with pointers.
- [`docs/stage1.md`](docs/stage1.md): Stage 1 feature map and status.
- [`docs/extensions.md`](docs/extensions.md): extension API.
- [`docs/benchmark.md`](docs/benchmark.md): benchmark vs Claude Code + skill (context, limits, accuracy).
- [`CHANGELOG.md`](CHANGELOG.md): version history.
