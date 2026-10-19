# Sayfern architecture (v0.5.0)

This is the deep reference for the codebase. It describes what the code does as of v0.5.0, module by module, then walks through every end-to-end flow. Sections 1 to 15 cover the app as a whole (Stage 1 plus the places Stage 2 touched); section 16 covers the Stage 2 modules (review, quizzes, Anki decks). For the short version read [`AGENTS.md`](../AGENTS.md). For why things are the way they are, read [`decisions.md`](decisions.md). For what comes next, read [`roadmap.md`](roadmap.md). Feature IDs are mapped to code in [`stage1.md`](stage1.md) (S1-xx, F-xx) and [`stage2.md`](stage2.md) (S2-xx).

Contents

1. [Process model](#1-process-model)
2. [Repository map](#2-repository-map)
3. [Layering rules](#3-layering-rules)
4. [Shared contracts (`src/shared`)](#4-shared-contracts-srcshared)
5. [Core modules (`src/core`)](#5-core-modules-srccore)
6. [Electron main and preload](#6-electron-main-and-preload)
7. [Disk layout](#7-disk-layout)
8. [IPC / API surface](#8-ipc--api-surface)
9. [ChatEvent protocol](#9-chatevent-protocol)
10. [The tutor: system prompt and tools](#10-the-tutor-system-prompt-and-tools)
11. [End-to-end flows](#11-end-to-end-flows)
12. [Renderer](#12-renderer)
13. [Styling](#13-styling)
14. [Testing](#14-testing)
15. [Build and dev scripts](#15-build-and-dev-scripts)
16. [Stage 2: review, quizzes, Anki decks](#16-stage-2-review-quizzes-anki-decks)

---

## 1. Process model

```
┌───────────────────────── Electron app (one instance: requestSingleInstanceLock) ─────────────────────────┐
│                                                                                                          │
│  Renderer process (Chromium, no Node)            Preload (src/preload/index.ts)                          │
│  src/renderer/src/**  React 19                   contextBridge.exposeInMainWorld("sayfern", api)          │
│    api.ts: Proxy over window.sayfern  ───────►   every API_METHODS entry → ipcRenderer.invoke("ipc:<m>")  │
│    lib/chatStream.ts  ◄── events ─────────────   onChatEvent / onAuthEvent / onAuthPrompt /               │
│                                                  onDictionaryProgress →                                   │
│                                                  ipcRenderer.on("evt:*")                                 │
│                                                              │  ▲                                        │
│                                                  invoke      │  │ webContents.send(EVENT_CHANNELS[x])    │
│                                                              ▼  │                                        │
│  Main process (Node) src/main/index.ts                                                                   │
│    ipcMain.handle("ipc:<m>") for every API method                                                        │
│      ├── electronOnly: importDocs, exportData, eraseAllData, openExternal                            │
│      └── everything else ──► SayfernApp (src/core/app/index.ts, plain Node)                              │
│    FileCredentialStore + safeStorage cipher (key in macOS Keychain)                                      │
│    window and navigation guards, single-instance lock                                                    │
│                                                                                                          │
│  SayfernApp wires: SettingsStore · JsonRecordsStore · DefaultLanguageService · FileLibraryService ·      │
│                    AnkiConnectService · SayfernTutor             · pi-ai MutableModels           │
│                    + Stage 2 (bindSlot): ReviewService · QuizService · DeckService                       │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
        │ HTTPS (pi-ai's own requests)          │ Node fetch                  │ Chromium net.fetch (default session)
        ▼                                       ▼                             ▼
  model providers (Anthropic, OpenAI, ...)   AnkiConnect 127.0.0.1:8765    dictionary downloads
```

The same `SayfernApp` also runs outside Electron: `scripts/smoke.ts` and `src/core/app/app.test.ts` construct it directly with a plain (unencrypted) `FileCredentialStore` and an `emit` callback.

## 2. Repository map

| Path | What it is |
|---|---|
| `package.json` | Scripts, dependencies, version (single source of the app version). |
| `CHANGELOG.md` | Keep a Changelog, one section per version. |
| `electron.vite.config.ts` | Build config for main, preload and renderer (electron-vite). |
| `vite.mock.config.ts` | Serves the renderer in a plain browser against the mock API (port 5174). |
| `tsconfig.node.json` / `tsconfig.web.json` | Two TypeScript projects: Node side (main, preload, core, shared, scripts) and web side (renderer, shared). |
| `scripts/brand-oauth-page.mjs` | Patches pi-ai's OAuth callback page in `node_modules` (postinstall, predev). |
| `scripts/brand-electron-app.mjs` | macOS only: renames node_modules' `Electron.app` to Sayfern (CFBundleName, plus a localized display name in every `.lproj/InfoPlist.strings` with `LSHasLocalizedDisplayName`, so the Dock and Finder do not show the folder name "Electron"), swaps in `build/icon.icns`, re-signs ad hoc (postinstall, predev, prestart). Idempotent; never fails the install. |
| `build/icon.svg`, `icon.png`, `icon.icns` | App icon: the sidebar fern on forest green, Apple 824 px grid. The SVG is the source. |
| `scripts/smoke.ts` | Terminal harness: providers, login, key, models, chat, offline selftest. |
| `src/shared/` | Types and the renderer ↔ main contract. No runtime dependencies. Stage 2 API slots in `src/shared/stage2/`. |
| `src/core/` | All app logic, plain Node, no Electron imports. |
| `src/main/` | Electron main process: window, dialogs, credentials cipher, IPC table, e2e hooks (`e2e.ts`). |
| `src/preload/` | Generic bridge exposing `window.sayfern`. |
| `src/renderer/` | React UI: `src/renderer/index.html`, `src/renderer/src/**`, including the mock backend `src/renderer/src/dev/mockApi.ts` (+ Stage 2 mock slots) and per-feature stylesheets in `src/renderer/src/styles/`. |
| `bench/` | Benchmark vs Claude Code + skill ([`benchmark.md`](benchmark.md)). |
| `docs/` | This documentation. |
| `.sayfern-dev/` | Gitignored data and plain-text credentials written by `npm run smoke`. |
| `design/wireframes/` | Design Component sources and canvas link. Exists in the owner's copy of the repo; not present in this checkout. |

## 3. Layering rules

```
src/shared   ◄── imported by everyone; imports nothing but itself (types + tiny pure consts)
src/core     ◄── imports src/shared and npm packages; never "electron"
src/main     ◄── imports src/core, src/shared, electron
src/preload  ◄── imports src/shared, electron
src/renderer ◄── imports src/shared (types, pickDefaultModel); talks to the backend only through window.sayfern
```

- Core services are classes constructed with explicit dependencies (`dataDir`, `fetch`, `now`, other services). No singletons, no globals. This is what lets tests and the smoke script run the whole app without Electron.
- Cross-module calls inside core go through the interfaces in `src/core/contracts.ts` (`RecordsStore`, `LanguageService`, `LibraryService`, `AnkiService`, `Tutor`, `TutorTool`, `ToolContext`). Stage 2 services are the exception: they get one `Stage2Deps` object (`src/core/stage2.ts`) holding the concrete Stage 1 services, plus `resolveModel`, `emit`, `now`, `newId`.
- The only renderer-visible surface is `SayfernApi` in `src/shared/api.ts`, which extends the Stage 2 slot interfaces.

---

## 4. Shared contracts (`src/shared`)

| File | Contents |
|---|---|
| `src/shared/api.ts` | `SayfernApi` (every renderer-callable method), view types (`HomeView`, `SessionView`, `EndSummary`, `GrammarDetail`, `RetryResult`, `AnkiStatus`, `NewSessionOptions`, `SaveWordInput`), the `ChatEvent` union, `EVENT_CHANNELS`, `ApiMethod`, `ipcChannel()`, and `API_METHODS` (derived from a `Record<ApiMethod, true>` table that spreads `REVIEW_METHODS`, `QUIZ_METHODS` and `DECK_METHODS`, so a missing or unknown method is a compile error). |
| `src/shared/records.ts` | Domain types: `Language` (`"zh" \| "ja"`), `LANGUAGES`, sessions (`SessionMeta`, `ChatMessage`, `ToolActivity`, `UsageTotals`), `Correction`, grammar (`GrammarPoint`, `GrammarObservation` (optional `origin: "quiz"`, `quizId`), `GrammarSummary` (optional `quiz` counts), `Verdict`, `Assistance`, `GrammarState`), vocabulary (`SavedWord`, `WordUsage`), `LevelEstimate`, `SKILLS`, `LearnerProfile`, library (`LibraryDoc`, `LibraryParagraph`, `LibraryHit`, `DocKind`, `DocFormat`), Anki (`AnkiConfig` with optional `exportDecks`, `AnkiDeckMapping`, `AnkiCard`, `AnkiSnapshot`, `AnkiWord`, `AnkiWordFilter`, `AnkiWordPage`, `AnkiOverview`, `PracticeTarget`), progress (`ProgressStats`, `ProgressRange`). Types only plus `LANGUAGES` and `SKILLS`. |
| `src/shared/lang.ts` | `Token`, `DictEntry`, `DictSense`, `LookupResult`, `DictionaryStatus`, `DictionaryProgress`, `LanguageInfo`. |
| `src/shared/types.ts` | `ProviderInfo`, `ModelInfo`, `ModelRef`, `Settings` (incl. `theme`), `AuthPromptPayload`, `AuthEventPayload`. |
| `src/shared/themes.ts` | `Theme` (`light` / `forest` / `ink`), `THEMES` (label, dark flag, `--paper` value for the window background), `themeInfo`. |
| `src/shared/models.ts` | `pickDefaultModel(list)`: prefers `/sonnet/`, then `gpt-5`, `gpt-5-mini`, any `gpt-5*`, Gemini Flash, `deepseek-chat`; newest match (last in the catalogue) wins; otherwise the first model. Used by main (openings) and the renderer (initial model). |
| `src/shared/stage2/index.ts` | Re-exports the slots. `api.ts` re-exports all their types. |
| `src/shared/stage2/review.ts` | `ReviewApi` + `REVIEW_METHODS`; `ReviewFilter`, `ReviewItem`, `ReviewList`, `AnkiCardStyle`, `AnkiCardDraft`, draft/export inputs and results; helpers `REVIEW_KIND` (correction kind → chip) and `clozeFront(back, gap, hint)`. |
| `src/shared/stage2/quiz.ts` | `QuizApi` + `QUIZ_METHODS`; `QuizSpec` (focus, source, level, formats, length), `QuizOptions`, `QuizEstimate`, `QuizView`, `QuizQuestion` (no key until answered), `QuizListItem`, `QuizSummary`. |
| `src/shared/correction.ts` | `splitCorrection(text)`: splits a "✎ " correction line off a reply. Not used by current code (the tutor records corrections through `record_evidence`); kept from v0.1. |

Key `Token` contract (`src/shared/lang.ts`): tokens cover the input exactly and in order (`start`/`end` are UTF-16 offsets), `isWord` is false for punctuation, whitespace, latin and numbers, `reading` is tone-marked pinyin (zh) or hiragana (ja), `lemma` is the dictionary form (ja).

---

## 5. Core modules (`src/core`)

### 5.1 `providers.ts` and `credential-file-store.ts`

**Purpose.** Model access through `@earendil-works/pi-ai` 0.99.1 and credential persistence.

| Symbol | File | Role |
|---|---|---|
| `createSayfernModels(credentials)` | `src/core/providers.ts` | `createModels({ credentials })` then `setProvider()` for each factory in `FACTORIES`: anthropic, openai, deepseek, openrouter, google. Adding a pi-ai provider is one line here. |
| `describeProviders(models, credentials, localServers)` | same | Builds `ProviderInfo[]` (local engines are added after the cloud providers, section 5.1a): `canApiKey`, `oauthLabel` (friendlier labels in `LOGIN_LABELS` for anthropic and openai; pi-ai's `loginLabel` otherwise), `oauthIsSubscription`, `connected` (from `models.checkAuth`), `connectedVia`, a short `note` from `NOTES`. |
| `listAvailableModels(models)` | same | `models.getAvailable()` mapped to `ModelInfo` (provider, id, name, reasoning, input modalities, contextWindow). |
| `FileCredentialStore` | `src/core/credential-file-store.ts` | Implements pi-ai's `CredentialStore` (`read`, `list`, `modify`, `delete`). One JSON file, writes serialized on a promise chain (pi-ai relies on serialized `modify` so concurrent requests never double-refresh an OAuth token). Optional `Cipher`; main passes one backed by `safeStorage`. |

Auth modes as registered in v0.5.0: every provider accepts an API key; anthropic (Claude Pro/Max, subscription), openai (ChatGPT subscription) and openrouter have OAuth.

**Persistence.** `credentials.json`, mode 0600, written via tmp + rename:

```json
{ "v": 1, "encrypted": true, "data": "djEwAAAA...base64 from safeStorage.encryptString..." }
```

Decrypted `data` is `Record<providerId, Credential>` as defined by pi-ai (`{ "type": "api_key", "key": "sk-..." }` or an OAuth credential). The smoke script passes no cipher, so `.sayfern-dev/credentials.json` has `"encrypted": false` and plain JSON in `data`.

### 5.1a `local/`: local model servers (v0.28.0)

**Purpose.** Connect models that run on the learner's computer, through OpenAI-compatible servers (ADR 37). User guide and the steps to add an engine: [`local-models.md`](local-models.md).

| Symbol | File | Role |
|---|---|---|
| `LOCAL_ENGINES` | `src/core/local/engines.ts` | Table keyed by `LocalEngineId` (`src/shared/types.ts`, today `"llamacpp"`). Each `LocalEngine` has `id`, `name`, `defaultUrl`, `docsUrl`, `note` and `listModels(baseUrl, apiKey, fetch)`. llama.cpp reads `GET <baseUrl>/models` and `GET <root>/props` (`n_ctx`, vision). |
| `registerLocal(models, engine, server, fetch)` | `src/core/local/index.ts` | Lists the models, then `models.setProvider(createProvider({ ..., api: openAICompletionsApi() }))`. Rejects if the server cannot be reached. |
| `refreshLocals(models, servers, fetch)` | same | Re-registers every saved server (at startup and in `listModels`). Never throws; a server that is down keeps its last list. |

`describeProviders` (section 5.1) skips local provider ids in the loop and then appends one `ProviderInfo` per local engine, with `local: { engine, baseUrl?, defaultUrl, docsUrl }`, so the connect screen can show a URL field. `SayfernApp.connectLocal` saves `Settings.localServers[engine]` only after `registerLocal` succeeds. `disconnectLocal` (also called by `logout` for a local id) removes the setting and the provider. Local calls use `ankiFetch` (Node's `fetch`), because the servers are on localhost. Non-Claude models get the evidence pass (ADR 25).

### 5.1b `usage/`: provider usage (v0.29.0)

**Purpose.** The usage line beside each connected provider on the connect screen: plan limits, balance, and what Sayfern spent with an API key on this computer (ADR 38).

| Symbol | File | Role |
|---|---|---|
| `UsageLog` | `src/core/usage/log.ts` | `records/usage.json`: local day (`localDate`) → provider id → `{ requests, tokens, cost }`. Keeps 60 days. `totals(provider)` returns today and the last 30 days (`lastDates`). |
| `meterModels(models, log)` | `src/core/usage/meter.ts` | A `Proxy` over `MutableModels` that logs each reply from `streamSimple` and `completeSimple` when the provider uses an API key (not OAuth, not `LOCAL_ENGINES`). Tokens = input + cache read + cache write + output; cost = pi-ai's `usage.cost.total`. `SayfernApp` wraps `deps.models` with it, so every service is metered. |
| `USAGE_SOURCES` | `src/core/usage/live.ts` | Per provider: `oauth` fetcher (Claude `api.anthropic.com/api/oauth/usage`, ChatGPT `chatgpt.com/backend-api/wham/usage` with the `chatgpt-account-id` from the token), `apiKey` fetcher (DeepSeek `/user/balance`, OpenRouter `/api/v1/key` `limit_remaining`, OpenCode Go `opencode.ai/zen/go/v1/usage`), `billingUrl`, `free` (Google). |
| `UsageService` | `src/core/usage/index.ts` | `forProvider(id)`: `{}` when not connected; else the billing or plan page, `spent` for API keys, and the live part, cached `LIVE_TTL_MS` (2 min) per provider and auth type. Failures come back as `error`, never thrown. `forget(id)` after `setApiKey`, `login`, `logout`. |



**Purpose.** The facade. Wires every service and implements `CoreApi` (all of `SayfernApi` except the Electron-only methods), including the Stage 2 slot methods bound from `ReviewService`, `QuizService` and `DeckService` (section 16.1). Main's IPC table routes to it; the smoke script and `app.test.ts` call it directly.

Key files: `src/core/app/index.ts`, `src/core/app/settings.ts`.

Constructor deps (`SayfernAppDeps`): `dataDir`, `models`, `credentials`, `fetch?` (dictionary downloads; main passes Chromium's `net.fetch`), `ankiFetch?` (main passes Node's `fetch`), `now?`, `emit(channel, payload)`, `newId?`, `openExternal?`, `kuromojiDicPath?`.

It constructs, under `dataDir`:

| Field | Class | dataDir |
|---|---|---|
| `settings` | `SettingsStore` | `settings.json` |
| `records` | `JsonRecordsStore` | `records/` |
| `anki` | `AnkiConnectService` | `anki/` (fetch = `ankiFetch ?? fetch`) |
| `library` | `FileLibraryService` | `library/` |
| `lang` | `DefaultLanguageService` | `dict/` (plus `wordUsage` and `ankiCard` callbacks into records and anki) |
| `tutor` | `SayfernTutor` | uses all of the above |
| `review` | `ReviewService` | none (reads records, writes through Anki) |
| `quizzes` | `QuizService` | `records/quizzes/` |
| `decks` | `DeckService` | `records/decks/`, `records/deck-audio/` |

The last three share one `Stage2Deps` and are bound with `bindSlot(this, service, *_METHODS)`; `SayfernApp` is declared to extend `ReviewApi`, `QuizApi` and `DeckApi` through interface merging.

Public helpers beyond `CoreApi`: `init()`, `refreshAnki(language)`, `whenAnkiFresh()`, `whenIdle()`, `getDeviceId()`, `authInteraction(signal)`, `importFiles(language, kind, paths)`, `exportTo(path)`, `exportFileName()`, `eraseData({ keepSignIns })` (stops turns and quiz generations, then deletes learner data; the instance must be discarded afterwards). Constants: `ANKI_MAX_AGE_MS` (6 h), `ERASE_PATHS`, `ElectronOnlyMethod`, `CoreApi`, `errorText()`.

Internal state:

- `inflight: Map<requestId, AbortController>`: running turns, for `abort`.
- `openings: Set<sessionId>`: sessions whose opening turn is running. `send` rejects while set.
- `running: Set<Promise>`: every detached turn; `whenIdle()` waits for them.
- `ankiRefresh: Map<Language, Promise>`: at most one background `ensureFresh` per language.
- `messageSessions: Map<messageId, sessionId>`: cache for `translate(messageId)`; filled by `getSession` and turn completion; `findMessageSession` falls back to scanning every session.
- `pendingPrompts` and `loginAbort`: OAuth prompt plumbing.

`SettingsStore` (`src/core/app/settings.ts`): lazily reads `settings.json`, merges over `DEFAULT_SETTINGS` (`{ language: "zh", languages: ["zh", "ja"] }`), `update(patch)` is a shallow merge that ignores `undefined`, serialized, atomic.

```json
{
  "language": "zh",
  "languages": ["zh", "ja"],
  "model": { "provider": "anthropic", "id": "claude-sonnet-5-5" },
  "deviceId": "3f0c2a8e-8d5b-4c3a-9d59-3a1f0e6b7c21",
  "autoTranslate": false,
  "onboarded": true,
  "legacyImported": true
}
```

Tests: `src/core/app/app.test.ts` (streaming events, failure and abort paths, openings, self level, import + reading spot, export, settings + legacy import, translate lookup, background Anki refresh); `src/core/quiz/app.test.ts` (quiz methods bound, quiz evidence on the grammar page, export and erase).

### 5.3 `records/`: `JsonRecordsStore`

**Purpose.** Every learning record, and every number derived from them (S1-25). Implements `RecordsStore`.

| File | Contents |
|---|---|
| `src/core/records/store.ts` | `JsonRecordsStore`: sessions, messages, transcripts, usage, active time, corrections, grammar, observations, saved words, learner words, targets, levels, profile, progress, export, legacy import. |
| `src/core/records/io.ts` | `JsonFile<T>` (lazy load, in-memory cache, per-file promise queue, atomic tmp + rename writes, corrupt file renamed to `<file>.corrupt-<ts>` and replaced by defaults), `writeJsonAtomic`, `JsonCodec`. |
| `src/core/records/files.ts` | On-disk shapes (`SessionFile`, `WritingRow`, `ActivityEntry`), `wordUsageCodec`, `DEFAULT_TITLES` (`新对话`, `新しい会話`), `titleFrom()` (first 14 characters). |
| `src/core/records/ids.ts` | `observationId(messageId, grammarId, span)` and `correctionId(messageId, original)`: first 16 hex chars of a SHA-1. Deterministic, so a retried tool call dedupes (S1-27). |
| `src/core/records/grammar.ts` | `newGrammarPoint`, `mergeGrammarPoint` (empty values never wipe stored ones; `introducedAt` set once), `stubGrammarPoint` (for observations of unknown ids), `summarizeGrammar`, `compareSummaries`. |
| `src/core/records/stats.ts` | `computeProgress()` and `CORRECTION_KINDS`. |
| `src/core/records/dates.ts` | `localDate(ms)` (machine timezone, `YYYY-MM-DD`), `lastDates(now, n)` (DST-safe). |
| `src/core/records/legacy.ts` | v0.1 session format and `legacyToSessionFile()`. |

**Derived values.**

- Grammar summary (`summarizeGrammar`): counts per current verdict (after disputes), `rate = correct / (correct + incorrect)` or `null`, state: `introduced` by default, `with_help` after any correct non-independent observation, `independent` after any correct independent one. `lastUsedAt` = newest observation. Quiz observations (`isQuizObservation`: `origin: "quiz"` or `sessionId` starting `quiz:`) are counted apart in `GrammarSummary.quiz` (`counts`, `rate`, `lastAt`, absent when there are none) and never touch the conversation counts, rate or `lastUsedAt`; a correct quiz answer can only move `introduced` to `with_help`.
- `listGrammar` sorts by `lastUsedAt` desc (never used last), then `updatedAt`.
- `listSessions(language)` sorts by `updatedAt` desc and hides sessions with no messages that are older than one day (their files stay on disk).
- Session title: set from the first learner message while the title is still the default.
- `recordLearnerWords`: one `writing-<lang>.json` row per learner message (a repeat for the same message is a no-op); `word-usage-<lang>.json` counts every use and keeps the first use (S1-22). Returns first-ever words.
- `markTargets` only upgrades status: `pending` → `asked` → `used`.
- `getLevels`: history sorted by time; `current[skill]` is the latest estimate.
- `deleteSession` removes the session file and its corrections, observations and writing rows. Word usage is kept.
- `recordObservations` keeps the optional `origin` / `quizId`; `deleteObservations({ sessionId })` (not on the `RecordsStore` interface) removes a quiz's evidence when the quiz is deleted.

**Progress (`computeProgress`, S1-22..S1-25).** Range windows: week = last 7 local dates, month = 30, all = everything (daily chart shows last 90 days).

| Field | Computation |
|---|---|
| `activeMs`, `daily` | Sum of `activity.json` entries for the language in range, per local date. |
| `sessions` | Distinct session ids with activity > 0, a learner message in range, or a writing row in range. |
| `wordsWritten` / `distinctWords` | Sum / set of `writing-<lang>.json` words in range (learner words only, pasted spans excluded). |
| `firstUsed` | Word usages whose first use is in range, newest first, max 50. |
| `grammar` | Count of grammar points per state (all time). |
| `corrections` | Corrections created in range, total and by kind (all statuses, disputed included). |
| `anki` | When a snapshot is passed: `matureCount`, `usedInWriting` (distinct snapshot words that appear in word usage), `reviewedToday`, `syncedAt`. |

**Persistence** (`records/`, pretty-printed JSON, one `JsonFile` each):

`sessions/<sessionId>.json` (`SessionFile`):

```json
{
  "meta": {
    "id": "0b6f1c1e-5a8e-4f7a-9d0e-2c7b9a1f4e11",
    "language": "zh",
    "kind": "chat",
    "title": "我去了北京昨天。",
    "createdAt": 1790794800000,
    "updatedAt": 1790794864000,
    "feedbackMode": "inline",
    "activeMs": 42000,
    "usage": { "input": 3120, "output": 188, "cost": 0.0122 }
  },
  "messages": [
    { "id": "7c1d...", "sessionId": "0b6f...", "role": "user", "text": "我去了北京昨天。", "at": 1790794860000 },
    {
      "id": "a93e...", "sessionId": "0b6f...", "role": "tutor", "at": 1790794864000,
      "text": "听起来很好玩！你在北京做了什么？",
      "model": "anthropic/claude-sonnet-5-5",
      "usage": { "input": 3120, "output": 188, "cost": 0.0122 },
      "toolActivity": [{ "name": "record_evidence", "summary": "Logged 1 correction, 2 observations", "ok": true }]
    }
  ],
  "transcript": [
    { "role": "user", "content": "我去了北京昨天。", "timestamp": 1790794860000 },
    { "role": "assistant", "content": [
        { "type": "text", "text": "听起来很好玩！你在北京做了什么？" },
        { "type": "toolCall", "id": "toolu_01...", "name": "record_evidence", "arguments": { "corrections": ["..."] } }
      ], "stopReason": "toolUse", "usage": { "...": "pi-ai usage" } },
    { "role": "toolResult", "toolCallId": "toolu_01...", "toolName": "record_evidence",
      "content": [{ "type": "text", "text": "Recorded." }], "isError": false, "timestamp": 1790794864000 }
  ],
  "targets": [
    { "word": "印象", "reading": "yìnxiàng", "meaning": "impression", "reason": "difficult", "cardId": 1690000000001, "status": "asked" }
  ]
}
```

`transcript` holds pi-ai `Message` objects (provider-neutral, abridged above). Openings add a hidden user message `(The learner opened a <kind> session. Start.)` that never appears in `messages`.

Other files:

| File | Shape | Example item |
|---|---|---|
| `corrections.json` | `Correction[]` (exported ones also carry `exportedAt` and `ankiNoteIds`) | `{ "id": "5e0c9b2a41d7f3c8", "language": "zh", "sessionId": "0b6f...", "messageId": "7c1d...", "original": "我去了北京昨天", "corrected": "我昨天去了北京", "explanation": "Time words come before the verb.", "kind": "grammar", "grammarId": "zh:time-before-verb", "createdAt": 1790794864000, "status": "retried_ok", "retries": [{ "text": "我昨天去了北京", "ok": true, "at": 1790794900000 }] }` |
| `grammar.json` | `GrammarPoint[]` | `{ "id": "zh:chule-hai", "language": "zh", "pattern": "除了…还…", "name": "besides A, also B", "reading": "chúle… hái…", "level": "HSK 3", "explanation": "...", "examples": [{ "text": "除了中文，她还会说日语。", "translation": "Besides Chinese, she also speaks Japanese." }], "sources": [], "createdAt": 1790000000000, "updatedAt": 1790794864000, "introducedAt": 1790000000000 }` |
| `observations.json` | `GrammarObservation[]` | `{ "id": "b41f0a9c7e2d8813", "grammarId": "zh:le-completed", "language": "zh", "sessionId": "0b6f...", "messageId": "7c1d...", "span": "去了", "verdict": "correct", "assistance": "independent", "at": 1790794864000 }` (a dispute adds `"disputed": { "note": "...", "at": ..., "originalVerdict": "incorrect" }`; quiz evidence has `"origin": "quiz", "quizId": "...", "sessionId": "quiz:<quizId>", "assistance": "prompted"`, `messageId` = question id) |
| `saved-words.json` | `SavedWord[]` | `{ "id": "...", "language": "zh", "word": "烤鸭", "reading": "kǎoyā", "definition": "roast duck", "sentence": "我们吃了北京烤鸭。", "source": { "kind": "session", "sessionId": "0b6f...", "messageId": "a93e..." }, "createdAt": 1790794870000 }` |
| `activity.json` | `ActivityEntry[]` | `{ "date": "2026-09-30", "language": "zh", "sessionId": "0b6f...", "ms": 42000 }` |
| `levels.json` | `LevelEstimate[]` | `{ "language": "zh", "skill": "writing", "level": "HSK 3", "confidence": "medium", "evidence": "Self-rated", "examples": [], "at": 1790794800000, "by": "self" }` |
| `profile.json` | `LearnerProfile` | `{ "about": "CS student, likes hiking.", "goals": { "zh": "Chat about daily life" }, "name": "Sam" }` |
| `word-usage-<lang>.json` | `WordUsage[]` (Map in memory) | `{ "word": "北京", "language": "zh", "count": 3, "firstUsedAt": 1790794860000, "firstSessionId": "0b6f...", "firstMessageId": "7c1d...", "firstSentence": "我去了北京昨天。" }` |
| `writing-<lang>.json` | `WritingRow[]` | `{ "at": 1790794860000, "sessionId": "0b6f...", "messageId": "7c1d...", "words": ["我", "去了", "北京", "昨天"] }` |

**Export** (`exportAll`): `{ exportedAt, version: 1, sessions: [{ meta, messages, targets }], corrections, grammar, observations, savedWords, wordUsage: { zh, ja }, writing: { zh, ja }, activity, levels, profile }`. Transcripts are not exported.

**Legacy import.** `importLegacySessions(dir)` reads v0.1 `<userData>/sessions/*.json` (`LegacyStoredSession`: `display` + `transcript`), skips ids already present, writes `SessionFile`s with `kind: "chat"`. `SayfernApp.init()` runs it once and sets `settings.legacyImported`.

Tests: `src/core/records/sessions.test.ts` (create, titles, listing rules, updates, messages/transcript/usage, delete, active time, persistence, 50 concurrent appends, cross-file concurrency, legacy import), `grammar.test.ts` (ids, correction dedupe, upsert merge, idempotent observations and stubs, state/counts/rate with disputes, ordering), `progress.test.ts` (learner words, targets, levels, profile, saved words, week/month/all progress, export). Helpers in `helpers.test-util.ts`.

### 5.4 `lang/`: `DefaultLanguageService`, language packs, dictionaries

**Purpose.** Segmentation and readings for hover text and ruby (S1-07), learner-word extraction for stats (S1-22, S1-23), text normalization for retry checks, dictionaries and lookup, and the `LanguagePack` interface (F-08).

| File | Contents |
|---|---|
| `src/core/lang/index.ts` | `DefaultLanguageService`: pack registry, per-language `DictionaryProvider`, 500-entry LRU of `annotate` results (cleared when a pack registers or a dictionary installs), `lookup` (exact, then single-token lemma fallback; attaches Anki card and first-use date through injected callbacks). |
| `src/core/lang/zh.ts` | `ChinesePack`, `ZH_INFO` (levels `HSK 1`..`HSK 6`, `HSK 7-9`). |
| `src/core/lang/ja.ts` | `JapanesePack`, `JA_INFO` (levels `N5`..`N1`), `defaultKuromojiDicPath()`. |
| `src/core/lang/dictionary.ts` | `StoredDictionary<Row>` base class (download, parse, index, persist, single-flight install, status), `download()` with progress, `writeFileAtomic`. |
| `src/core/lang/cedict.ts` | `CedictProvider`, `parseCedict`, `parseCedictLine`, `CEDICT_URL` (MDBG gzip export, CC BY-SA 4.0, about 4 MB). |
| `src/core/lang/jmdict.ts` | `JmdictProvider`, `parseJmdict`, `readTarFile`, `JMDICT_RELEASE_API` (GitHub releases API of scriptin/jmdict-simplified; English: `jmdict-eng-common-*.json.zip`, else `.tgz`; other gloss languages (`JMDICT_GLOSS`: ger, rus, spa, fre) use the full `jmdict-<gloss>-*` file). |
| `src/core/lang/spaced.ts` | `SpacedPack` (en, es, fr, de, it, pt, ru: `Intl.Segmenter` words, French/Italian elision split, `lemma` checked against the dictionary's `WordIndex`), `KoreanPack` (strips particles and endings to a dictionary form), `VietnamesePack` (joins syllables into the longest dictionary word, up to 4), `spacedPromptNotes`. |
| `src/core/lang/lemma.ts` | Irregular forms and suffix rules per language; `candidates(language, word)`, `lemmatize(language, surface, has?)`. |
| `src/core/lang/wordlists.ts` | `SimpleDictionary` (rows `[headword, reading, senses, importance]`, exact then lower-case lookup, `has()`, `glossLanguage`, `glossWord`, `glossWordsOf`), `OewnProvider` / `parseOewn` (Open English WordNet 2025 JSON zip: synset definitions, up to 3 senses per part of speech, the part of speech with most senses first), `WikdictProvider` (`download.wikdict.com` bilingual SQLite, read with `node:sqlite` from a temp file, `cleanGloss`), `KengdicProvider` (Korean–English TSV), `KaikkiProvider` (kaikki.org Wiktionary JSONL, Vietnamese). |
| `src/core/lang/pinyin.ts` | `toneMark`, `numberedToMarks`, `joinSyllables`, `glossPinyin`. |
| `src/core/lang/text.ts` | `normalizeText` (NFKC, strip whitespace and punctuation), `toHiragana`, `runs`, `otherTokens`, `Lru`, script tests. |

**Chinese.** `segment()` splits text into Han runs and other runs. Other runs become non-word tokens (`Intl.Segmenter("en")`). Han runs are split by greedy forward maximum matching against CC-CEDICT (`longestMatch`, up to 8 characters) when the dictionary index is loaded, otherwise by `Intl.Segmenter("zh")`. Readings come from `pinyin-pro` for the whole run (context aware), then are assigned to words and joined with `joinSyllables` (apostrophe before a/e/o). `learnerWords()` = word token texts, minus every clause that has kana (Japanese, not Chinese).

**Japanese.** `ready()` builds the kuromoji IPADIC tokenizer once (dictionary directory from `kuromojiDicPath` or `defaultKuromojiDicPath()`). `segment()` aligns kuromoji tokens to the input, merges a verb or adjective head with its conjugation auxiliaries (`CONJUGATION_AUX`, て/で, non-independent verbs), gives hiragana readings only when the surface has kanji and the reading has none, and sets `lemma` to kuromoji's `basic_form`. `learnerWords()` = lemmas of content words (nouns except numbers/suffixes, independent verbs and adjectives, adverbs, interjections).

**Target-language filter (ADR 30).** Only words of the language the learner is learning count as learner words (`writing-<lang>.json`, `word-usage-<lang>.json`). Spaced packs (`SpacedPack.learnerWords`) first drop words in the wrong script (Latin in Korean or Russian). In Latin-script languages they then judge each clause (split at sentence ends and at `, ; : ( ) " —`) word by word (`side`):

| Word | Side | Example (Spanish, English interface) |
|---|---|---|
| In the target language only | target | quiero, playa |
| In both, and the dictionary's glosses for it contain the word itself (same meaning) | target | hotel, chocolate, no |
| In the learner's own language only | own (never counts) | want, the, airport |
| In both with another meaning, a single letter, or in neither | unclear | a (= to), I, Juan |

Unclear words count when the clause has no own-language words, or fewer than target words (`keepTarget`). "Target language" = the installed dictionary's headwords (and lemmas) plus the built-in common words (`src/core/lang/common-words.ts`, which also cover contractions like del). "Own language" = words used in the installed dictionary's glosses plus the interface language's common words (`WordIndex.ownWord`); `wordForms` strips plural and past endings first. Without a dictionary the common-word lists decide alone. When the interface language is the language learned, nothing is own-language. `SayfernApp.init` recounts stored words once per filter key (`WORD_FILTER_VERSION` + installed dictionary) through `RecordsStore.recountLearnerWords`, which rewrites each message's words and rebuilds word usage (counts, first use); installing a dictionary recounts that language again. The key is kept in `records/word-filter.json`.

**Required dictionaries (ADR 31).** `SayfernApp.ensureDictionaries` downloads, one at a time and in the background, the missing preferred dictionary of each language in `settings.languages`: at `init`, and after `setSettings` changes `languages`, `language`, `uiLocale` or `onboarded`. It waits for onboarding, skips pairs with no dictionary (`downloadMb: 0`), and does not block sessions (the common-word lists fill in until the download ends; `installDictionary` then recounts the language's words). A failure stays on `DictionaryStatus.error`; Settings > Dictionaries keeps an Install button as the retry. `whenDictionariesReady()` lets tests wait.

**Dictionary choice.** `DefaultLanguageService.choices(language, locale)` lists the dictionaries for a pair, best first: gloss in the interface language when one exists (JMdict in 5 languages, WikDict pairs among en/es/fr/de/it/pt/ru, and English–Chinese for a Chinese interface), English otherwise; zh, ko and vi have English glosses only. English always ends with Open English WordNet (`OewnProvider`, English definitions, key `en`): the only choice for an English, Korean or Vietnamese interface, and the fallback for the others. `resolve(language)` returns the preferred one and the installed ones; lookup uses an installed one and sets `needsDictionary` when the preferred one isn't installed yet, or `noDictionary` when none exists. Each `SimpleDictionary` has a `glossLanguage`; the ADR 30 filter treats gloss words as own-language words only when the glosses are in the learner's own language, and checks "same meaning" only with bilingual dictionaries (not WordNet). Built dictionaries are cached per key (`"ja@de"`, `"es@en"`) under `dict/<key>/`. The interface locale comes from the `glossLocale` option (`settings.locale()`).

**Dictionaries.** `StoredDictionary` stores rows in `<dir>/<file>` and writes `<dir>/meta.json` last; meta present means installed. `install()` is single-flight and idempotent, reports `download` → `parse` → `index` → `done` (or `error`) through `DictionaryProgress`. CC-CEDICT lookups fall back to single characters when the whole word is missing. JMdict lookups index every kanji and kana form, also try the hiragana form, and rank headword matches, then common words.

```json
// dict/zh/meta.json
{ "format": 1, "version": "2026-09-29T09:16:04Z", "entries": 123456, "installedAt": 1790794800000 }
// dict/zh/cedict.json   (row: [simplified, traditional variants joined by "|", reading, glosses])
{ "format": 1, "rows": [["烤鸭", "烤鴨", "kǎoyā", ["roast duck"]]] }
// dict/ja/jmdict.json   (row: [headword, variants, reading, common 0|1, [[glosses, tags], ...]])
{ "format": 1, "rows": [["食べる", ["喰べる"], "たべる", 1, [[["to eat"], ["v1", "vt"]]]]] }
```

Tests: `zh.test.ts`, `ja.test.ts`, `pinyin.test.ts`, `service.test.ts` (install both dictionaries from fixtures served by a fake fetch, progress, persistence, failure and retry, `.tgz` fallback, tar reader, annotate cache, lookup extras, `registerPack`), `live.test.ts` (real downloads, skipped unless `LIVE=1`). Coverage helper: `testutil.ts` (`assertCovers`, `SAMPLES`).

### 5.5 `library/`: `FileLibraryService`

**Purpose.** Import learner materials, store them as paragraphs, serve reading windows and checkpoints, CJK-aware search (S1-10..S1-12), personal context for the prompt (S1-03).

| File | Contents |
|---|---|
| `src/core/library/index.ts` | `FileLibraryService`, `parseBytes(bytes, format, language)`, extension → format table (`.txt .md .markdown .html .htm .xhtml .epub .pdf`). |
| `src/core/library/txt.ts` | `parseTxt`: blank-line paragraphs, or one paragraph per line when the file has no blank lines. |
| `src/core/library/md.ts` | `parseMarkdown`, `stripInline`: headings become paragraph context, list items become paragraphs, inline syntax stripped. |
| `src/core/library/html.ts` | Tag scanner (`tokenize`), `decodeEntities`, `parseHtml`: block elements and `<br>` end paragraphs, h1-h3 set the heading context, script/style/ruby annotations (`rt`, `rp`) and similar are dropped. |
| `src/core/library/epub.ts` | `parseEpub` (JSZip): container.xml → OPF → spine order; title from `dc:title`; headings from h1-h3 or the nav/NCX table of contents. |
| `src/core/library/pdf.ts` | `parsePdf` with the legacy pdf.js build in-process (worker module registered on `globalThis`), CMaps from `pdfjs-dist/cmaps`; lines by baseline, paragraphs by gaps, font size jumps, sentence ends and indentation, large short lines as headings, page numbers dropped; `NO_TEXT_LAYER_WARNING` when under 10 non-space characters per page. |
| `src/core/library/text.ts` | `ParsedDoc`, `cleanParagraph`, `joinLines` (no space across CJK), `collapseWhitespace`, `charLength`, `decodeText` (UTF-8, UTF-16 BOM, then GB18030/Big5/Shift_JIS/EUC-JP fallbacks by language). |
| `src/core/library/search.ts` | `tokenizeForSearch` (CJK single chars + bigrams, lowercase latin words), `buildIndex`, `rankBm25` (k1 1.2, b 0.75, single CJK characters weighted 0.3), `snippet` (about 300 chars around the match), `phraseBonus` (x1.25 for whole-phrase latin matches). |
| `src/core/library/json-file.ts` | Compact atomic JSON writes with a per-path queue, `readJson` (null on missing or unreadable). |

Behavior notes:

- `importFile` parses the file and builds the index in memory, then creates the folder, copies the original, writes `paragraphs.json`, `index.json` and finally `meta.json`. A folder without `meta.json` is an incomplete import and is ignored. Failures remove the folder.
- `search(language, query, limit = 5)` ranks all paragraphs of the language's docs as one collection, over-fetches, applies the phrase bonus, returns `LibraryHit`s with snippets. Missing or outdated `index.json` is rebuilt.
- `setCheckpoint` validates paragraph and offset against the document.
- `personalContext(language, maxChars)` concatenates `kind: "personal"` docs (oldest first, `# <title>` headers) and truncates with "…".
- Caches: all metas in memory, 16 most recent paragraph lists, every loaded index.

```json
// library/<docId>/meta.json (LibraryDoc)
{ "id": "5d2c...", "language": "zh", "title": "Integrated Chinese 2", "kind": "textbook", "format": "pdf",
  "addedAt": 1790794800000, "paragraphCount": 412, "charCount": 58231, "warnings": [],
  "checkpoint": { "paragraph": 37, "offset": 0, "at": 1790795000000 } }
// library/<docId>/paragraphs.json
[{ "docId": "5d2c...", "index": 0, "text": "第十二课 ...", "heading": "Lesson 12" }]
// library/<docId>/index.json
{ "v": 1, "lens": [48, 120], "postings": { "除了": [1, 2], "除": [1, 2] } }
```

Tests: `parsers.test.ts` (txt, md, html, epub), `pdf.test.ts` (text, paragraphs, title, headings, no-text-layer warning, garbage), `service.test.ts` (import, formats, ranking for 除了, Japanese and latin search, limits and snippets, checkpoints, delete, personal context, persistence, ordering).

### 5.6 `anki/`: `AnkiConnectService` and the word model

**Purpose.** Talk to AnkiConnect (add-on 2055492159), cache per-language snapshots so everything works while Anki is closed, and turn cards into a word-level model the tutor can use (S1-13, S1-14).

| File | Contents |
|---|---|
| `src/core/anki/index.ts` | `AnkiConnectService`, `DEFAULT_ANKI_URL` (`http://127.0.0.1:8765`), `AnkiUnreachableError`, `AnkiFailure`, `classifyFetchError`, `deckQuery`, `HISTORY_DAYS` (90), `ANKI_UNREACHABLE`. |
| `src/core/anki/words.ts` | Pure functions: `cardStage`, `cardStatus`, `cardMature`, `struggleScore`, `aggregateWords`, `foldReading`, `isStruggling`, `queryWords`, `wordPage`, `checkWordsIn`, `buildOverview`; constants `MATURE_DAYS` (21), `STRUGGLE_THRESHOLD` (0.35), `DEFAULT_WORD_LIMIT` (20), `MAX_WORD_LIMIT` (1000). |
| `src/core/anki/clean.ts` | `cleanField` (strip HTML, `[sound:]`, ruby `<rt>`, entities, furigana brackets), `furiganaReading` (reading implied by `日本[にほん]` syntax). |
| `src/core/anki/json-file.ts` | Pretty atomic JSON writes with a per-path queue, `readJson`. |

Writing to Anki (v0.5.0, used by the corrections export): `ensureNoteType(type)` (`modelNames`, then `createModel` if missing; cloze types are created as real cloze types), `ensureDeck(name)` (`createDeck`), `addNotes(notes)` (`canAddNotesWithErrorDetail`, falling back to `canAddNotes`, then `addNotes`, then per-note `addNote` if the batch is rejected). All go through `call`, so failures are the usual `AnkiUnreachableError` reasons. `normalizeConfig` keeps `exportDecks`.

**Transport.** `call(action, params, timeout)` POSTs `{ action, version: 6, params }` to `config.url` with `AbortSignal.timeout` (8 s per call, 20 s for bulk calls). Failures become `AnkiUnreachableError` with a reason:

| Reason | Trigger | Message / fix shown in Settings > Anki |
|---|---|---|
| `refused` | ECONNREFUSED / reset / unreachable | Open Anki; restart Anki once after installing AnkiConnect. |
| `timeout` | Timeout or abort | macOS App Nap; Settings shows copyable `defaults write ... NSAppSleepDisabled -bool true` commands. |
| `forbidden` | HTTP 403 | Check AnkiConnect's `webCorsOriginList`. |
| `not_ankiconnect` | Non-2xx, non-JSON, or JSON without `result` | Another app is on the port. |
| `other` | Anything else | Generic message. |

A JSON body with `error` becomes a plain `Error("AnkiConnect error: ...")` (recoverable, for example an unsupported action). `ping()` never throws and returns `{ connected, version?, error?, reason?, detail? }`.

**Config.** `normalizeConfig` keeps decks whose `language` is valid and `deck` is non-empty, even with an empty `wordField` (the v0.2.1 fix). There is no UI for `url`; it can only be changed by editing `anki/config.json`.

```json
// anki/config.json
{ "enabled": true, "url": "http://127.0.0.1:8765",
  "decks": [{ "language": "zh", "deck": "Chinese::HSK", "wordField": "Hanzi", "readingField": "Pinyin", "meaningField": "English" }],
  "exportDecks": { "zh": "Chinese::Sayfern corrections" } }
```

**Sync (`sync(language)` → `pull`).** One sync per language at a time (shared promise).

1. Requires a linked deck for the language and at least one mapping with a `wordField` (else a friendly error).
2. For each mapping: `findCards deck:"<deck>"` (includes subdecks), `cardsInfo` in batches of 500, `toCard()` cleans fields (reading from `readingField` or furigana brackets), maps `type` to `stage` (0 new, 1/3 learning, 2 review; 3 also sets `relearning`), `queue` -1 to `suspended`, -2/-3 to `buried`, `due` to `newPosition` for new cards, `mature` = review and interval ≥ 21. `findCards ... rated:1` counts today's reviews; `findCards ... tag:leech` marks leeches.
3. History: `cardReviews` per deck the cards live in, since 90 days ago (row `[reviewTime, cardID, usn, buttonPressed, newInterval, previousInterval, newFactor, reviewDuration, reviewType]`). Old AnkiConnect without `cardReviews`: `getReviewsOfCards` for cards `rated:30`. If both fail, the snapshot has no history. Manual entries (ease 0, review type ≥ 4) are skipped. Per card: `recentReviews`, `recentFails` (ease 1), `lastReviewAt`, `lastEase`, `avgAnswerMs` (each answer capped at 60 s).
4. Writes `anki/snapshot-<lang>.json` and caches it.

```json
// anki/snapshot-zh.json (AnkiSnapshot, abridged)
{ "language": "zh", "syncedAt": 1790794800000, "reviewedToday": 42, "reviewsLast7d": 310, "matureCount": 812, "historyDays": 90,
  "cards": [{ "cardId": 1690000000001, "noteId": 1690000000000, "deck": "Chinese::HSK", "word": "印象", "reading": "yìnxiàng",
              "meaning": "impression", "interval": 3, "ease": 1900, "lapses": 6, "reps": 24, "status": "review", "stage": "review",
              "mature": false, "recentReviews": 9, "recentFails": 4, "lastReviewAt": 1790700000000, "lastEase": 1, "avgAnswerMs": 7400 }] }
```

Snapshots from 0.1.x lack `status`, `stage`, `newPosition`, history fields: `cardStage()` infers the stage (no reps = new, interval ≥ 1 = review, else learning).

**`ensureFresh(language, maxAgeMs)`**: returns the cached snapshot unless Anki is enabled, the language has a deck with a word field, and the snapshot is missing or older than `maxAgeMs`; then syncs. Never throws. `SayfernApp.refreshAnki` calls it with 6 h at startup and whenever a session is created or a reading session reopened.

**Word model (`aggregateWords`).** Cards are grouped by cleaned word (recognition and production count once).

- Status: `suspended` if every card is suspended; otherwise over active (non-suspended) cards: `known` if any is in review, `learning` if any is learning, else `new`. Buried cards count as active.
- `mature`: any active card mature. `newPosition`: lowest position among new cards.
- `lapses`, `recentReviews`, `recentFails` summed; ease = lowest ease among reviewed cards; answer time = review-weighted mean.
- `struggle` and `reasons` from `struggleScore` (not computed for new words):

```
score = 0.30 · (1 − e^(−lapses/4))
      + 0.30 · clamp01(((fails + 0.5)/(reviews + 5) − 0.10) / 0.40)      Beta prior: mean 10%, weight 5 answers
      + 0.15 · clamp01((2500 − ease)/1200)                                ease unknown (0) → 0
      + 0.10 · relearning now
      + 0.10 · leech tag
      + 0.05 · clamp01((avgMs/medianMs − 1.5)/1.5)                        only with ≥ 3 reviews; median of per-card means in the snapshot
```

Reasons (strongest weighted component first): `"N lapses"` (N ≥ 2), `"failed F of last R"` (component ≥ 0.25), `"ease X%"` (component ≥ 0.25), `"relearning now"`, `"leech"`, `"slow answers (X s)"`.

- Struggling = status not new or suspended and `struggle > 0.35`.
- `queryWords` sort orders: struggling and suspended by struggle desc (then lapses, then recency); known and learning by most recent review; new by introduction order (`newPosition`, then card id); all = learning, known, new, suspended. Limit default 20, max 1000.
- `checkWordsIn` matches the cleaned word, then the folded reading (tone marks, spaces and katakana/hiragana differences removed), preferring the most-known word when readings collide.
- `buildOverview`: counts per status, mature/young known words, `newRemaining`, `struggling`, `reviewedToday`, next 20 new words, top 5 struggling.

**Practice targets (`selectTargets`, S1-14).** From known/learning words: "recent" (reviewed in the last 7 days, newest first) and "difficult" (struggle ≥ 0.1, hardest first), interleaved one of each until `count` (the tutor uses `TARGET_COUNT` = 5); words the learner already used 3+ times in writing are skipped.

Tests: `anki.test.ts` (fake AnkiConnect through an injected fetch: config, ping, decks, fields, sync, batching, lookups, targets, unreachable with cached snapshot, enrichment, 90-day history and fallbacks, word queries, overview, 0.1.x snapshots, `ensureFresh` and shared sync), `connect.test.ts` (real sockets for each failure reason, Chromium error strings, the v0.2.1 deck-without-field regression), `words.test.ts` (struggle score, aggregation, deck and reading filters, limits).

### 5.7 `agent/`: `SayfernTutor`

**Purpose.** The tutor. System prompt, tools, streaming turn loop, openings, translation, correction retries, end-of-session summary.

| File | Contents |
|---|---|
| `src/core/agent/index.ts` | `SayfernTutor` (implements `Tutor`), re-exports `buildSystemPrompt`, `gatherPromptData`, `renderSystemPrompt`, `turnTools`. |
| `src/core/agent/deps.ts` | `TutorDeps` (`models`, `records`, `lang`, `library`, `anki`, `now`, `newId`, `ankiEnabled`) and `TutorOptions`. |
| `src/core/agent/turn.ts` | `runTurn`, `runOpening`, the loop (`runLoop`), `ankiReady`, `kickoffText`, `modelLabel`, constants `MAX_ITERATIONS` (5), `MAX_TOKENS` (1500), `MAX_SOURCES` (3), `TARGET_COUNT` (5). |
| `src/core/agent/prompt.ts` | `gatherPromptData`, `renderSystemPrompt`, `buildSystemPrompt`, `pickFollowUps`, `lastConversationVerdicts` (latest correct/incorrect verdict per point, quiz evidence skipped; also used by `getHome`); every tuning number (`TUNING` in `src/core/agent/tuning.ts`: follow-ups 3, catalogue 60, personal notes 1500 chars, Anki words 5 and 8, move-on 5 replies, unit point 4 exchanges, easy streak 3, level cut-offs, sentence caps). `countableCorrection` (`src/core/records/corrections.ts`) is the one meaning of "mistake" for pacing and quizzes. |
| `src/core/agent/tools.ts` | `record_evidence`, `search_library`, `update_checkpoint`, `turnTools`, `toolContext`, `matchLevel`, `TurnState`. |
| `src/core/agent/anki-tools.ts` | `anki_overview`, `anki_struggling`, `anki_vocabulary`, `anki_check_words`, `anki_lookup`, formatting helpers (`syncedLine`, `wordLine`, `overviewText`, `cardText`). |
| `src/core/agent/retry.ts` | `localRetryCheck`, `parseRetryJson`, `checkRetry`. |
| `src/core/agent/session.ts` | `translate`, `endSession`. |
| `src/core/agent/options.ts` | `requestOptions(model, answerTokens)`, `THINKING_HEADROOM` (4096). |
| `src/core/agent/text.ts` | `stripPasted`, `findOriginal`, `slugify`, `canonicalGrammarId`, small coercion helpers. |
| `src/core/agent/testkit.ts` | Test harness: `FakeAnki` (with stub `ensureNoteType` / `ensureDeck` / `addNotes`) and faux-provider setup (not a test file). |

The prompt and tools are described in section 10; the loop in section 11.3.

`requestOptions`: models that are not reasoning models, or can switch thinking off, get `{ maxTokens: answerTokens }`. Always-thinking models get `reasoning` clamped to `"low"` and `maxTokens + 4096`. Used for turns (1500), translation (800) and retry checks (200).

Tests: `turn.test.ts`, `prompt.test.ts`, `retry.test.ts`, `anki-tools.test.ts`, `options.test.ts` (see section 14).

---

## 6. Electron main and preload

`src/main/index.ts`, in order:

1. `dataDir = app.getPath("userData")` (on macOS `~/Library/Application Support/sayfern`; `SAYFERN_E2E_DATA=<dir>` overrides it for end-to-end checks).
2. `buildApp()` builds everything below (called at startup and again after "Erase all data"; the module-level `let sayfern` is replaced). `FileCredentialStore(join(dataDir, "credentials.json"), cipher)` with `safeStorage.encryptString` / `decryptString` (base64). The first read or write can trigger a macOS Keychain prompt for "sayfern Safe Storage" (Electron names the Keychain item after `app.name`, which must stay `sayfern`).
3. `createSayfernModels(credentials)`; if `SAYFERN_E2E_FAUX=1`, `installE2EFaux(models)` from `src/main/e2e.ts`.
4. `new SayfernApp({ dataDir, models, credentials, fetch: electronFetch (Chromium net.fetch on the default session), ankiFetch: Node fetch, emit → webContents.send(EVENT_CHANNELS[channel]), openExternal: shell.openExternal })`. With the e2e flag the app is also exposed as `globalThis.__sayfernE2E`.
5. `electronOnly`: `importDocs` (open dialog for txt/md/markdown/html/htm/xhtml/epub/pdf → `SayfernApp.importFiles`), `exportData` (save dialog in Downloads, default `sayfern-export-YYYY-MM-DD.json` → `exportTo`), `eraseAllData({ keepSignIns })` (`sayfern.eraseData`, then `buildApp()` + `init()`; the renderer reloads itself afterwards), `openExternal` (http/https only).
6. `registerIpc()`: for each `API_METHODS` entry, `ipcMain.handle("ipc:<method>")` calls `electronOnly[method]` or `sayfern[method]`, resolving `sayfern` on every call (it changes after an erase). While an erase runs, other calls wait for it. Events from a discarded instance are dropped (`emit` checks `built === sayfern`). Thrown errors are re-thrown as `new Error(errorText(err))` because only the message crosses IPC; the renderer strips Electron's "Error invoking remote method" prefix (`errorText` in `src/renderer/src/api.ts`).
7. Lifecycle: `requestSingleInstanceLock()` (a second launch focuses the first window), `whenReady` → `setUpBranding()` (About panel, dev Dock icon from `build/icon.png`, an app menu that is Electron's default with the app items labelled "Sayfern"; standard roles keep Edit shortcuts working) → `sayfern.init()` (errors logged, app still starts) → `registerIpc()` → `createWindow()` (title "Sayfern"; window icon on Linux).
8. Window: 1440×900 (min 980×640), `titleBarStyle: "hiddenInset"`, background `#F4F0E7`, preload `../preload/index.mjs`, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false` (ESM preload). `setWindowOpenHandler` opens http(s) in the browser and denies new windows. `will-navigate` guard: only hash changes of the current page are allowed; anything else (a file dropped on the window, a stray link) is prevented and web links open externally.

`src/preload/index.ts` builds one invoker per `API_METHODS` entry and the `on*` subscriptions (each returns an unsubscribe function), then `contextBridge.exposeInMainWorld("sayfern", api)`.

`src/main/e2e.ts`: `installE2EFaux`: registers pi-ai's faux provider (400 tokens/s) with 500 scripted steps: translation prompts return `(translation)`, retry checks return `{"ok": true, "feedback": "Good."}`, openings return a fixed Chinese line, other turns reply with text plus one `record_evidence` call (one `zh:le-completion` observation).

---

## 7. Disk layout

Everything lives under Electron `userData` (`~/Library/Application Support/sayfern/` on macOS; `./.sayfern-dev/` for `npm run smoke`).

```
credentials.json                encrypted (safeStorage); plain in .sayfern-dev
settings.json                   Settings (includes `localServers`: `{ llamacpp: { baseUrl, apiKey? } }`, key in plain text)
records/
  sessions/<sessionId>.json     SessionFile: meta, messages, transcript, targets
  quizzes/<quizId>.json         QuizFile: spec, status, alignment, provenance, items with keys and answers (section 16.3)
  corrections.json  grammar.json  observations.json  saved-words.json
  usage.json                    API-key model calls per local day and provider (section 5.1b; not exported)
  activity.json  levels.json  profile.json
  word-usage-zh.json  word-usage-ja.json  writing-zh.json  writing-ja.json
  *.corrupt-<ms>                unreadable file moved aside by JsonFile
dict/zh/  cedict.json meta.json
dict/ja/  jmdict.json meta.json
library/<docId>/  meta.json paragraphs.json index.json original.<ext>
anki/  config.json  snapshot-zh.json  snapshot-ja.json
sessions/                       v0.1 sessions, imported once into records/ (left in place)
```

Electron also keeps its own data here (for example Local Storage, which holds the renderer's `sayfern.inspector` and `sayfern.ruby.<lang>` flags). Only `records/` (quizzes under their own `quizzes` key), `anki/config.json`, settings and the library list go into an export.

---

## 8. IPC / API surface

Channel for every method: `ipc:<methodName>`, arguments in order. Core implementation is `SayfernApp` (`src/core/app/index.ts`) unless marked "main". The Stage 2 methods (review, quiz, decks) are listed in section 16 with their services.

| Method | Purpose | Implementation |
|---|---|---|
| `getSettings()` | Read settings | `SettingsStore.get` |
| `setSettings(patch)` | Shallow-merge settings | `SettingsStore.update` |
| `listProviders()` | Providers with auth state | `describeProviders` |
| `listModels()` | Models usable with current credentials; reads saved local servers again first | `refreshLocals`, `listAvailableModels` |
| `providerUsage(providerId)` | Plan windows, balance, local spend and billing page for a connected provider (section 5.1b) | `UsageService.forProvider` |
| `setApiKey(providerId, key)` | Store an API key | `credentials.modify` → `{ type: "api_key", key }` |
| `connectLocal(engine, baseUrl, apiKey?)` | Save a local server if it answers; returns its `ModelInfo[]` (section 5.1a) | `registerLocal` + `SettingsStore.update({ localServers })` |
| `disconnectLocal(engine)` | Forget a local server | `SettingsStore.update`, `models.deleteProvider` |
| `login(providerId)` | OAuth sign-in (see 11.2) | `models.login(id, "oauth", authInteraction, { getDeviceId })` |
| `cancelLogin()` | Abort sign-in, reject open prompts | `loginAbort.abort()` |
| `logout(providerId)` | Remove credentials | `models.logout` |
| `answerAuthPrompt(promptId, value)` | Answer a sign-in prompt (`null` cancels) | `pendingPrompts` |
| `listLanguages()` | `LanguageInfo[]` of registered packs | `lang.languages()` |
| `getHome(language)` | `HomeView`: resume, follow-ups, reading spot, targets, week stats, 5 recent sessions, levels, `needsPlacement` | records + library + anki |
| `listSessions(language)` | Sessions, newest first | `records.listSessions` |
| `getSession(id)` | `SessionView` | records + library |
| `newSession(opts)` | Create by kind: reading → `openReading`, practice with `unitId` → `startUnit`, practice with focus → `practiseGrammar`, placement → `startPlacement`, chat with a known `scenarioId` (`src/shared/scenarios.ts`) → role-play chat titled after the scenario, else create (starts an opening for practice and role-play) | `createAndOpen` / `viewWithOpening` |
| `renameSession(id, title)` | Rename (non-empty) | `records.updateSession` |
| `deleteSession(id)` | Delete session and its rows (no UI calls it yet) | `records.deleteSession` |
| `setDifficulty(id, difficulty)` | -2..2 ("Go easier / go harder"), clamped | `records.updateSession`; read by `difficultyBlock` |
| `newTopic(id, model)` | `{ requestId }`; the tutor opens a fresh topic | `tutor.runOpening({ newTopic: true })`, streamed like an opening; the kickoff carries a question from `TOPIC_QUESTIONS` picked by level (`pickQuestion`), its id saved in `SessionMeta.topicQuestions` |
| `send(id, { text, pastedSpans? }, model)` | Start a turn; returns `{ requestId }`; progress via `onChatEvent` | `startRequest` → `tutor.runTurn` |
| `abort(requestId)` | Stop a running turn | `AbortController` |
| `translate(messageId, model)` | Translate a tutor message (cached on it) | `tutor.translate` |
| `endSession(id)` | Mark ended, return `EndSummary` | `tutor.endSession` |
| `trackActivity(id, ms)` | Add active practice time (capped at 10 min per call) | `records.addActiveTime` |
| `checkRetry(correctionId, text, model)` | Judge a retry | `tutor.checkRetry` |
| `revealCorrection(id)` | Status `revealed` | `records.updateCorrection` |
| `disputeCorrection(id, note)` | Status `disputed` + note | `records.updateCorrection` |
| `annotate(language, text)` | Tokens with readings | `lang.annotate` |
| `lookup(language, word)` | Dictionary entries, Anki card, first use | `lang.lookup` |
| `dictionaryStatus(language)` | Installed?, size, license | `lang.dictionaryStatus` |
| `installDictionary(language)` | Download + index; progress via `onDictionaryProgress` | `lang.installDictionary` |
| `saveWord(input)` | Save a word with its sentence and source (dedupes on language + word + sentence) | `records.saveWord` |
| `listSavedWords(language)` / `deleteSavedWord(id)` | Saved words | records |
| `listGrammar(language)` | Catalogue with local counts | `records.listGrammar` |
| `getGrammar(id)` | `GrammarDetail` (observations newest first, corrections, sessions) | records |
| `disputeObservation(id, verdict, note)` | Change a verdict, keep the original | `records.disputeObservation` → `getGrammar` |
| `practiseGrammar(grammarId, opts?)` | New practice session titled `练习 <pattern>` / `練習 <pattern>`, with opening. `{ explain: true }` (Grammar "Explain again") sets `openWith: "explain"`: the kickoff asks for a fresh explanation and the prompt's session block switches to "explain and practise" (naming the pattern is allowed) | `createAndOpen` |
| `getCourse(language)` | `CourseView`: units by level with `status` (new / started / done), `solid`/`total`, `next`; `available: false` for Beta languages (no course) | `buildCourseView` (`src/shared/course`) over `listGrammar`, `getLevels`, sessions with `unitId` |
| `startUnit(unitId, opts?)` | New practice session on a course unit (`SessionMeta.unitId`), titled `练习 · <unit title>`, with opening. `{ explain: true }` ("Begin Lesson" under "Begin Course?") sets `openWith: "explain"`: the kickoff asks for a quick overview and the unit session block adds `unitOverview` (one line and one example per point, brief, not a lesson), then teaches each point in three steps (introduction, sample dialogue, question). Without it ("More practice") the block says to start the conversation at once with no overview, introductions or sample dialogues, and `dialogueBlock` is empty | `createAndOpen` |
| `listDocs(language)` | Library docs, newest first | `library.listDocs` |
| `importDocs(language, kind)` | File dialog then import | main → `importFiles` |
| `getDoc` / `getParagraphs` / `setCheckpoint` / `renameDoc` / `deleteDoc` | Library document access | `library.*` |
| `searchLibrary(language, query)` | Top 5 hits | `library.search` |
| `openReading(docId)` | Reuse the newest unfinished reading session for the doc or create one; opening if nothing was said yet | `viewWithOpening` / `createAndOpen` |
| `getProgress(language, range)` | `ProgressStats` (Anki part only when enabled) | `records.getProgress` |
| `ankiStatus()` | Config, ping result with failure reason, snapshot summaries | anki |
| `ankiSetConfig(config)` | Save config, return status | `anki.setConfig` |
| `ankiDecks()` / `ankiFields(deck)` | Deck names; field names of the deck's first note | anki |
| `ankiSync(language)` | Sync now, return status | `anki.sync` |
| `ankiOverview(language)` | `AnkiOverview` or `null` | `anki.overview` |
| `getProfile()` / `setProfile(patch)` | Learner profile | records |
| `getLevels(language)` | Current and history | `records.getLevels` |
| `setSelfLevel(language, level)` | One `self` estimate (medium confidence) for each of the three skills | `records.recordLevel` x3 |
| `startPlacement(language, band?)` | Placement session titled `水平测试` / `レベルチェック`, with opening. `band` (`LevelBand`: beginner, intermediate, advanced, picked in `components/PlacementStart.tsx`) is saved as `SessionMeta.levelBand`; `placementBlock` starts the diagnostic in that third of the level scale (`bandLevels`), and as a beginner it writes instructions in the learner's language and stops early if they know nothing | `createAndOpen` |
| `exportData()` | Save dialog then export | main → `exportTo` |
| `eraseAllData({ keepSignIns })` | Delete learner data and restart the backend (Settings > Data > Start over) | main → `eraseData`, `buildApp` |
| `openExternal(url)` | Open http(s) URL | main |

Events (main → renderer), `EVENT_CHANNELS`:

| Subscription | Channel | Payload |
|---|---|---|
| `onChatEvent` | `evt:chat` | `ChatEvent` |
| `onAuthEvent` | `evt:auth` | `AuthEventPayload` (`info`, `auth_url`, `device_code`, `progress`, `prompt_cancelled`) |
| `onAuthPrompt` | `evt:auth-prompt` | `AuthPromptPayload` (`text`, `secret`, `manual_code`, `select`) |
| `onDictionaryProgress` | `evt:dictionary-progress` | `DictionaryProgress` |

---

## 9. ChatEvent protocol

Every event carries `requestId` and `sessionId`.

| `type` | Payload | When |
|---|---|---|
| `user_saved` | `message: ChatMessage` | First event of a learner turn: the canonical stored learner message (replaces the renderer's optimistic `pending-*` copy). Not sent for openings. |
| `delta` | `text` | Streamed reply text. Openings start with an empty delta so the renderer shows the thinking state before the first token. Text from separate loop iterations is joined with a blank line. |
| `tool` | `activity: ToolActivity` | After each tool call finishes (name, one-line summary, ok). |
| `correction` | `correction: Correction` | From inside `record_evidence`, once per stored correction per turn (before that call's `tool` event). |
| `done` | `message` (saved tutor message), `view: SessionView` | Success. Always last. |
| `error` | `message`, `aborted`, `view?` | Failure or stop. Always last. `aborted` is true when the message is `"Stopped"` or the signal fired. `view` is present whenever the session still exists (the failed tutor message is saved in it with `error`). |

Order for a learner turn: `user_saved`, then any interleaving of `delta` / `correction` / `tool`, then exactly one `done` or `error`. The renderer treats `done`/`error.view` as canonical and drops its stream state.

---

## 10. The tutor: system prompt and tools

### 10.1 System prompt

Rebuilt from local records at the start of every turn (`buildPrompt` = `gatherPromptData` + `renderPrompt`). It has two parts (ADR 39):

- **System prompt** (the rows marked *system*): only what stays the same all session, so the provider caches it together with the whole history.
- **Notes for this reply** (the rows marked *notes*): everything that changes with the records. `runLoop` adds them as a last text block, starting with `[Sayfern notes for this reply]`, to the newest learner message, in the request only; the stored transcript never holds them (`withNotes`, `src/core/agent/cache.ts`). pi-ai marks the last block as the cache breakpoint, so the `onPayload` hook `notesOutOfCache` moves the mark to the learner's text before it. The next turn then reads the whole history from the cache and pays full price only for the new messages and the notes.

`renderSystemPrompt` / `buildSystemPrompt` return both parts as one text, for tests and the prompt snapshot. Blocks, in order; empty blocks are dropped:

| # | Block | Source |
|---|---|---|
| 1 | *system* Persona: "You are Sayfern, a warm, curious tutor...", reply mostly in the target language (slightly above level at the default difficulty), reply length by level (`lengthRule`: 2 to 3 linked sentences in the middle of the scale, 2 to 4 sentences above; 1 to 3 when the level is unknown; when a reply brings in a target it may grow to a hard cap of 6 / 8 sentences by level, 5 when unknown) ending with exactly one question, the one rule for bringing in a target (use it in a natural sentence, then ask the question whose most natural answer uses it; never name a pattern, show a formula, lecture, list or drill; only added when the prompt has targets), native-like use of every target (no stretched meanings), no comments on its own earlier questions, no translations, romanization or readings unless asked, answer English briefly and invite a retry in the target language. Beginners (`isBeginner`: no level yet, a level in the Beginner band, `levelBand`, or a placement chat started as a beginner) get `beginnerPersonaBlock` instead (ADR 40): the target language for example sentences and the question, their own language for meanings, short explanations, instructions, checks and encouragement; a hard rule that grammar is explained in their own language (what it does, where it goes), then one example with its meaning in brackets, also before a new grammar point is first used; outside placement, a 4-line sample dialogue (tutor, learner, tutor, learner, glossed) before a question that asks for a new kind of answer; at most `TUNING.beginnerNewWords` new words per reply, each glossed; 1 or 2 short sentences (cap 4 with a target); answer starts when they may lack words; less or more of their own language as they cope; writing in their own language is welcome; no romanization or readings unless asked. The one-question, bring-in, native-only and no-meta lines are shared constants | fixed text + `LanguageInfo` |
| 2 | *system* Language notes | `pack.promptNotes()` (script and register, the level scale; no level target and no translation or reading rule: the persona owns those) |
| 3 | *notes* Level | `records.getLevels().current`: "Current level estimates: reading HSK 3 (medium confidence); ..." or "Level: unknown. Start simple..." |
| 4 | *system* `# The learner` | Profile name, about, goal for this language, personal library notes (`kind: "personal"`, first 1500 chars) |
| 5 | *system* `# Session: ...` | Chat: open conversation; with `SessionMeta.scenarioId`, role-play (`roleplayBlock`): the scenario's scene and roles, stay in role, end each turn on the one question, offer a phrase when they are stuck, at the end step out of role with one or two lines of feedback and a new twist. Practice: focus pattern, model it after two misses. Course unit (practice with `unitId`): the unit's goal, every point with its id and note, topic ideas and core words (`unitPlan`; the learner's state per point is the *notes* block `# Unit progress`, `unitProgress`); work through the points one at a time, move on after two correct uses or about 4 exchanges (`TUNING.unitPointTurns`), each point is brought in with an introduction (the learner's language for beginners, the target language above, `introLanguage`), a sample dialogue (`dialogueBlock`: 4 lines, tutor and learner, glossed for beginners) and then the question; suggest the next unit at the end. Reading: doc title, checkpoint, paragraphs checkpoint-1 .. checkpoint+3 marked `¶n`, ask comprehension questions, use `search_library`, call `update_checkpoint`. Placement (`placementBlock`): 5 to 7 exchanges across reading, recognition, writing, starting in the picked band (`SessionMeta.levelBand`, `bandLevels`) or from easy tasks without one; a beginner band gets instructions in the learner's language, a check for any words at all and an early stop (lowest level, low confidence); record a level for all three skills from the language's scale; tell the result kindly. |
| 5a | *notes* `# Course (<basis>)` | Chat sessions only. Course languages: the suggested next unit (`nextUnit`: first unit not done from the learner's level on), its goal, up to 3 of its points not yet `independent` (bring in one at a time, model it first), its topic ideas, a pointer to the `course` tool. Beta languages: "There is no level-by-level course for <language>..." |
| 5b | *system* `# Pacing`, *notes* `# Pacing now` | Chat and practice sessions. The rules are in the system prompt from the first turn: answer first; stay while the learner is invested; move on after about `TUNING.moveOnTurns` exchanges, short replies or `TUNING.easyStreak` clean replies; a bridge or a harder angle that calls for the next grammar point, with a short pointer to `topic_change` (described on the tool). Unit sessions and role-plays get only the answer-first line: they move on per point or with the scene. The notes get the facts (`pacingFacts`), once the learner has replied on the current topic, from `computePacing` (counted locally): learner replies since the last tutor message with `topicStart`, earlier replies in a row with no `countableCorrection` (a grammar correction, not disputed), mean length of the last 3. At `moveOnTurns` replies or `easyStreak` clean replies it adds "The topic is used up: ... move on in this reply." |
| 6 | *notes* `# Grammar to revisit` | `pickFollowUps`: up to 3 points in state `introduced` or `with_help`, or whose latest conversation verdict (`lastConversationVerdicts`, quiz evidence skipped) is incorrect and from the last 14 days; skips the practice focus. Item 1 is the priority. |
| 7 | *notes* `# Words from their Anki reviews` | Session targets with status `pending` or `asked`; one or two per reply; never mention Anki |
| 8 | *notes* `# Anki knowledge (synced N h ago)` | Only when Anki is enabled and an overview exists: counts, 5 hardest words with their top reason, next 8 new words, use mostly known words, `anki_check_words` hint, hard words are targets, at most one new word per reply |
| 9 | *notes* `# Grammar ids` | Up to 60 catalogue rows `id \| pattern \| name`, and the id format `<lang>:<ascii-slug>` |
| 9a | *system* `# Notes for each reply` | The newest learner message ends with notes from Sayfern; the learner did not write them; follow them, never quote or mention them |
| 10 | *system* `# Feedback` | Correct real mistakes only; one observation per pattern attempt; retries and post-model sentences are not independent; spoken messages are transcripts. The `kind` decision rule, `original` as an exact substring, and `taught` live in the `record_evidence` parameter descriptions (`tools.ts`), not here |
| 11 | *system* `# Tool protocol` | Write reply first, then call `record_evidence` once at the end; corrections come only from that call; what to do on "No reply text yet"; other tools may be called before replying |

### 10.2 Tools

Offered per turn by `turnTools(deps, turn, { anki })`: `record_evidence`, `search_library`, `course` for languages with a course, the five Anki tools when `ankiReady` (Anki enabled and the language has a snapshot), `update_checkpoint` in reading sessions with a doc. Parameters are TypeBox schemas; enums use `StringEnum` (plain `enum`) so every provider, Google included, accepts them.

| Tool | Recording-only | Parameters | Effect / result |
|---|---|---|---|
| `record_evidence` | yes | `corrections?[]` { `original`, `corrected`, `explanation`, `kind`: grammar\|typo\|speaking (ADR 33), `grammar_id?` }; `observations?[]` { `grammar_id`, `pattern`, `name`, `span`, `verdict`: correct\|incorrect\|uncertain\|unassessed, `assistance`: independent\|prompted\|corrected_retry, `note?` }; `taught?[]` { `grammar_id`, `pattern`, `name`, `reading?`, `level?`, `explanation`, `examples[]` { `text`, `translation` } }; `topic_change?` (boolean: the reply moved to a new topic or a harder angle); `level?[]` { `skill`: reading\|recognition\|writing, `level`, `confidence`: low\|medium\|high, `evidence` } | `topic_change: true` marks the saved tutor message `topicStart` (openings and New topic always do), so pacing counts from there. Processed in order taught → observations → corrections → level. Grammar ids canonicalized to `<lang>:<slug>` (`canonicalGrammarId`). `taught` upserts points with `introduced: true`. Observations need a learner message (skipped in openings), create missing points, dedupe by deterministic id. Corrections need a learner message; `kind` is mapped (legacy vocabulary, phrasing → grammar; style → typo; default grammar), `speaking` on a typed message is stored as `typo`, and a `typo` on a spoken message (`TurnState.userSpoken`) is dropped; `original` is located in the learner text exactly or after normalization (`findOriginal`), skipped if not found or unchanged; stored idempotently; each new one emits a `correction` event once per turn. Levels are mapped onto the pack's scale (`matchLevel`, e.g. "hsk3" → "HSK 3"), invalid ones dropped; `by` is `placement` in placement sessions, else `observed`. Returns "Recorded." or "Recorded. Skipped ...". Activity like "Logged 1 correction, 2 observations". |
| `search_library` | no | `query`, `limit?` (1..8, default 4) | `library.search`; each hit is added to the turn's sources (deduped by doc + paragraph, quote truncated to 80 chars); the tutor message keeps up to 3 (`MAX_SOURCES`). Returns one line per hit with doc id, paragraph, title and snippet. |
| `course` | no | `action`: overview\|unit, `unit_id?` | Overview: basis, learner level, next unit, units one level around theirs with status and points used on their own. Unit (default: the next one): `unitText`. Activity "Looked at the course" / "Opened course unit: <title>". |
| `update_checkpoint` | yes | `paragraph` (integer ≥ 0) | `library.setCheckpoint(docId, paragraph, 0)`. Reading sessions only. |
| `anki_overview` | no | none | Synced line, word counts by status, struggling count, reviewed today, hardest words, next new words. |
| `anki_struggling` | no | `limit?` (1..100, default 20), `deck?` (includes subdecks) | Hardest words with reasons. |
| `anki_vocabulary` | no | `status?` known\|learning\|new\|struggling\|suspended\|all (default known), `search?`, `limit?` (1..100), `offset?` | Paged word lines with order note and "More: offset N". |
| `anki_check_words` | no | `words[]` (1..50) | Groups: Known, Learning, In their deck not studied yet, Suspended, Not in Anki. |
| `anki_lookup` | no | `word` | One card in detail (status, stage, interval, ease, lapses, reviews, recent answers, answer time, leech, last review). |

Every Anki tool result starts with "Anki snapshot from YYYY-MM-DD HH:MM UTC (N h ago)." or says the language has not been synced. Word lines look like `印象 · yìnxiàng · impression · known · 6 lapses, failed 4 of last 9`.

---

## 11. End-to-end flows

### 11.1 App startup and onboarding

1. Main constructs the credential store (safeStorage cipher), pi-ai models (plus faux provider with `SAYFERN_E2E_FAUX=1`) and `SayfernApp` (section 6).
2. `requestSingleInstanceLock()`; a second instance quits and the first window is focused.
3. `app.whenReady()` → `SayfernApp.init()`: import v0.1 sessions once (`settings.legacyImported`), and `refreshAnki(language)` for every registered language (background `ensureFresh(6 h)`).
4. `registerIpc()`, `createWindow()`; the preload exposes `window.sayfern`.
5. Renderer `main.tsx` loads fonts and `styles.css`; if there is no `window.sayfern` (plain browser) it installs `createMockApi()`; renders `<App>`.
6. `AppProvider` boot: `startChatStream()` subscribes to chat events (so openings are followed from the first delta); `getSettings` + `listLanguages`; then `refreshAuth` (`listProviders`, `listModels`, pick the saved model if still available else `pickDefaultModel`), `listSessions` per enabled language, `ankiStatus`.
7. Route: `settings.onboarded` false → `#/onboarding`; no hash → `#/today`.
8. Onboarding (`src/renderer/src/screens/Onboarding.tsx`): step 1 connect a model (`Connect`: API key or sign-in, section 11.2); step 2 pick languages and a level per language, or "find my level"; step 3 "Learn words with Anki" (S2-14: why Anki, then a shared deck on AnkiWeb per language, make one with the model, or decide later); step 4 optional "about you" text and a "Connect Anki" shortcut. In dev builds Settings > Preferences > Debug reopens it ("Close preview").
9. `finish()`: `setSelfLevel` for each chosen level, `setProfile({ about })`, `setSettings({ onboarded: true, languages, language })`; then either Settings > Anki, the deck generator (`#/decks`, when "make one with your model" was picked), a placement session (`startPlacement` for the first language set to "find my level", with the band picked under the select), or Today.

### 11.2 OAuth login

1. Renderer `Connect` calls `login(providerId)` and shows a log panel fed by `onAuthEvent` / `onAuthPrompt`.
2. `SayfernApp.login` aborts any previous login, gets or creates `settings.deviceId` (`getDeviceId`, a random UUID; Sign in with ChatGPT registers it as the agent host), and calls `models.login(providerId, "oauth", authInteraction(signal), { getDeviceId })`.
3. `authInteraction.notify`:
   - `auth_url`: rewrites `agent_name_hint=Pi` to `agent_name_hint=Sayfern` (OpenAI consent screen), opens the URL in the browser, emits `authEvent`.
   - `device_code`: opens the verification URL, emits `authEvent`.
   - other events are forwarded.
4. `authInteraction.prompt`: emits `authPrompt` with a new `promptId` and waits for `answerAuthPrompt(promptId, value)`; `null` rejects with "Cancelled". For `manual_code` prompts pi-ai races a local callback server; if the browser wins, pi-ai aborts the prompt and Sayfern emits `prompt_cancelled`.
5. The browser lands on pi-ai's local callback page, which `scripts/brand-oauth-page.mjs` replaced with the Sayfern page ("You're signed in.").
6. pi-ai stores the credential through `FileCredentialStore.modify` (encrypted). Refreshes later go through the same serialized `modify`.
7. `login` resolves; the renderer calls `refreshAuth()` to reload providers and models. `cancelLogin()` aborts and rejects pending prompts; "cancel" errors are not shown.

Anthropic subscription requests are sent by pi-ai with Claude Code identity headers and system line; OpenAI subscription tokens are sent to api.openai.com. See [decisions.md](decisions.md), ADR 2.

### 11.3 A chat turn

1. Renderer `Composer` (Enter sends; never while an IME is composing) calls `onSend({ text, pastedSpans })`. Pasted text is tracked from `onPaste` and kept only if still present.
2. `useChat.send` → `sendMessage` (`src/renderer/src/lib/chatStream.ts`): stores an optimistic `pending-<ts>` learner message in the per-session stream store, then `api.send(sessionId, input, model)`.
3. `SayfernApp.send`: session must exist, text non-empty, no opening running for the session, model resolvable (`models.getModel`); otherwise it throws before any event. Then `startRequest` creates `requestId` + `AbortController`, runs the turn detached, and returns `{ requestId }`.
4. `runTurn`: appends the learner message (`records.appendMessage`), emits `user_saved`, records learner words (pack `learnerWords` on the text minus pasted spans, target language only (ADR 30); marks matching targets `used`), selects Anki targets once per session if Anki is enabled (`ensureTargets`), loads the transcript.
5. `runLoop`: builds tools (`turnTools`) and the prompt (system prompt and notes, section 10.1), then up to `MAX_ITERATIONS` (5):
   1. `models.streamSimple(model, { systemPrompt, messages: withNotes(transcript, ...), tools }, { signal, ...requestOptions(model, 1500), onPayload: notesOutOfCache })`.
   2. `text_delta` → `delta` events (a blank-line separator when a new text block starts after earlier text); `done` gives the assistant message; an `error` event throws (`"Stopped"` when aborted).
   3. If the provider returned text without deltas, the text is emitted once.
   4. Tool calls run in order (`runTool`): unknown tool or thrown error → error tool result + failed activity; each emits `tool`.
   5. Assistant message and tool results are appended to the transcript; the iteration counts as committed.
   6. Stop if there were no tool calls, or if every call was recording-only and there is reply text (S1-27: no follow-up request just to acknowledge a write). Otherwise loop with the tool results. When a recording-only tool ran before any reply text, its result also carries `NO_REPLY_YET` ("No reply text yet."), because Sonnet 5.5 with adaptive thinking sometimes wrote the reply inside its thinking and then ended the turn empty. The result states a fact only; the tool protocol in the system prompt says what to do with it. An instruction in the tool result read as a prompt injection, and the model told the learner so (bench run 2026-10-08T05-41-04).
6. Empty final text with no failure becomes an error: "The model sent an empty reply. Try again, or pick another model."
7. Persistence: on failure with no completed iteration (or an empty reply) the transcript is reset to what it was before the turn, so the learner message is not left dangling for the provider; otherwise the transcript is kept up to the last committed iteration. The tutor message (`text`, `model`, `usage`, `toolActivity`, up to 3 `sources`, `error` = "Stopped" or the failure) is appended, usage added to the session, and on success pending targets that appear in the reply are marked `asked`.
8. `startRequest` reloads the session view: `done` with the message and view, or `error` (with `aborted` and the view). `abort(requestId)` fires the controller; the loop saves a "Stopped" message.
9. Renderer `chatStream.handle`: `user_saved` swaps in the canonical message; `delta`/`tool`/`correction` update the stream; `done`/`error` with a view clear the stream and publish the view to `useChat`, which replaces its state and refreshes the session list. An `error` without a view keeps the stream with an error line and a Retry button.
10. Transcript validity: an assistant message ending in tool calls is always followed by its tool results, and the next turn's user message follows those results (checked for pi-ai's Anthropic and OpenAI Responses conversions).

### 11.4 Openings (practice, reading, placement, role-play)

1. `newSession`/`practiseGrammar`/`startPlacement`/`openReading` call `createAndOpen` or reuse a session, then `viewWithOpening`.
2. An opening starts when the kind is practice, reading or placement (or the chat has a `scenarioId`), the session is not ended, it has no learner message and no successful tutor message, no opening is already running, and a default model exists (saved model if still available, else `pickDefaultModel`). Otherwise the view is returned as is.
3. The session id goes into `openings`; `startRequest` emits an empty `delta` first, then runs `runOpening`: select targets, then the same loop with a hidden user message `(The learner opened a <kind> session. Start.)` that goes only into the transcript. `record_evidence` observations and corrections are skipped (no learner message).
4. The renderer, subscribed since boot, follows events for a session it has no stream for. `send` is rejected while the opening runs.
5. Placement: the learner first picks a band (`PlacementStart`: Beginner, Intermediate, Advanced); the prompt asks for 5 to 7 exchanges from that band (fewer for a beginner who knows nothing) and a `record_evidence.level` entry for each skill; levels land in `levels.json` with `by: "placement"`, and `getHome` stops asking for placement once any estimate exists.

### 11.5 Correction retry, reveal and dispute

1. Corrections arrive as `correction` events and in `SessionView.corrections`. In `inline` mode `MessageList` shows a `CorrectionCard` under the learner message and highlights `original`; in `end` mode it shows "N notes saved for the end of this session" and the cards appear in `EndSessionSheet`.
2. Try again → `checkRetry(correctionId, text, model)`:
   1. `localRetryCheck`: with the pack's `normalize`, the retry contains the corrected text and no longer contains the original → ok without a model call.
   2. Otherwise a `completeSimple` call (200 answer tokens via `requestOptions`) with a strict-JSON system prompt; `parseRetryJson` accepts fenced or loose JSON. Feedback that would reveal the corrected text is replaced by a generic line.
   3. The retry is appended to `correction.retries`; status becomes `retried_ok` or `retried_wrong`.
   4. If the correction has a `grammarId`, an observation is recorded with `assistance: "corrected_retry"` and message id `<messageId>:retry<n>` (so it never counts as independent use).
3. Show answer → `revealCorrection` (status `revealed`); the card shows the diff, explanation and a link to the grammar point.
4. Not a mistake? → `disputeCorrection(id, note)` (status `disputed`, `disputeNote`). The highlight is removed. Nothing else changes (see roadmap backlog).
5. Grammar observations are disputed separately from the Grammar screen: `disputeObservation(id, verdict, note)` sets the new verdict and keeps `originalVerdict`; summaries use the current verdict.

### 11.6 Hover lookup and dictionary install

1. `AnnotatedText` calls `annotateCached(language, text)` (renderer promise cache) → `annotate` → `DefaultLanguageService.annotate` (LRU) → `pack.segment`. Streaming text renders plain until done.
2. Word tokens are hoverable (380 ms delay) and clickable (pinned). Anki target words get the fern underline. Ruby readings are rendered with `rubySegments` when enabled (Reader).
3. `openWordPopover` → `WordPopoverHost` → `lookupCached` → `lookup(language, word)`: dictionary entries (exact, then lemma), the Anki card if Anki is enabled (`findCard`, by word or reading), first-use date from word usage.
4. `needsDictionary` → `InstallDictionary`: `dictionaryStatus` for name/license/size, `installDictionary(language)`; progress events update a bar; on success the renderer clears cached lookups for that language and re-looks-up. Settings > Dictionaries offers the same install.
5. Save with sentence → `saveWord({ language, word, reading, definition, sentence, source })`; source is the tutor message (`kind: "session"`) or the library paragraph (`kind: "library"`).

### 11.7 Library import, reading session and checkpoints

1. Library screen "Add material" → `importDocs(language, kind)` → main open dialog → `importFiles` (each file: extension → format, read, `parseBytes`, store). Partial failures throw one message naming what was added and what failed; the screen reloads either way.
2. Reader (`#/reader/<docId>[/<paragraph>]`): `getDoc` (switches the workspace language to the doc's if enabled) and `openReading(docId)` (reuse or create the reading session, possibly starting an opening).
3. Paragraphs load in windows of 40 (`getParagraphs`), 6 above the target, with infinite scroll both ways; the initial target is the route paragraph or the checkpoint.
4. Setting a checkpoint in the page calls `setCheckpoint(docId, paragraph, 0)`; the tutor can move it with `update_checkpoint`.
5. Selecting text offers Ask (sends "About <selection> in paragraph N: ..." with the selection as a pasted span), Translate, and save.
6. The reading prompt includes the passage around the checkpoint; `search_library` hits become message sources, shown as chips that open the reader at that paragraph.
7. Today shows the most recently checkpointed doc as "continue reading" (`HomeView.reading`).

### 11.8 Anki sync, word model, targets and prompt block

1. Settings > Anki: toggle `enabled` (`ankiSetConfig`), then per language pick a deck (`ankiDecks`); `ankiFields(deck)` loads field names, and the UI preselects likely word/reading/meaning fields by name (Hanzi, Pinyin, English, 単語, ...). Mappings are saved even before the word field is set.
2. "Sync now" → `ankiSync(language)`; background refresh happens at startup and on session creation when the snapshot is older than 6 hours.
3. Snapshot → `aggregateWords` → words with status and struggle score (section 5.6), cached per snapshot object (`WeakMap`).
4. Targets: first turn or opening of a session with Anki enabled selects up to 5 (`selectTargets`), stored in the session file; status moves `pending` → `asked` (tutor used the word) → `used` (learner wrote it).
5. Prompt: target block plus the "Anki knowledge" block (section 10.1). Tools: the five `anki_*` tools when a snapshot exists.
6. Settings shows per deck: known / learning / still new / struggling counts and a "Hardest right now" list (`ankiOverview`). When unreachable, `AnkiTroubleshoot` shows the reason-specific fix, a `curl` check and "Test connection".

### 11.9 Progress stats

1. Progress screen → `getProgress(language, range)` → `records.getProgress` → `computeProgress` (section 5.3). No model calls.
2. Inputs: `activity.json` (fed by `trackActivity`), `writing-<lang>.json` and `word-usage-<lang>.json` (fed by `recordLearnerWords` on each learner message), grammar summaries, corrections, and the Anki snapshot when enabled.
3. Active time: `useActivityTracker` counts 1 s ticks only while the window is focused, visible and had input in the last 60 s, and reports every 15 s, on hide and on unmount.
4. Today's week numbers come from the same computation (`getHome` → `getProgress(language, "week")`).

### 11.10 Export

1. Settings > Data → `exportData()` → main save dialog (default `~/Downloads/sayfern-export-YYYY-MM-DD.json`).
2. `exportTo(path)` writes `{ app: "Sayfern", format: 1, exportedAt, settings (without deviceId and legacyImported), records: exportAll(), quizzes: QuizFile[], library: LibraryDoc[] (metadata only), anki: AnkiConfig }` atomically.
3. Not exported: credentials, transcripts, document text and originals, dictionaries, Anki snapshots. There is no import.

### 11.10a Erase all data

1. Settings > Data > Start over → "Erase…" → optional "Keep model sign-ins" (on by default) → type `erase` → `eraseAllData({ keepSignIns })`.
2. Main: `sayfern.eraseData` aborts in-flight turns and openings, and quiz generations (`quizzes.abortAll`), cancels sign-in, waits for idle and Anki refreshes, then deletes `ERASE_PATHS` (`records/` with quizzes, `library/`, `anki/`, legacy `sessions/`, `settings.json`) and `credentials.json` unless sign-ins are kept. With sign-ins kept, `settings.json` is rewritten with only the `deviceId` (ChatGPT sign-ins are registered against it).
3. Kept: `dict/` (downloaded dictionaries); Chromium's own files in `userData` are untouched.
4. Main builds a new `SayfernApp` (fresh caches and credential store) and `init()`s it. The renderer clears `localStorage`, sets the hash to `#/` and reloads; with no `onboarded` setting it lands on onboarding.
5. Mock API: sets `?onboarding=1` (or `?fresh=1` when sign-ins are kept) before the reload.

---

## 12. Renderer

Entry: `src/renderer/index.html` (CSP: scripts from self only) → `src/renderer/src/main.tsx` → `App.tsx`.

| Area | Files | Notes |
|---|---|---|
| Backend access | `src/renderer/src/api.ts` | `api`: a Proxy over `window.sayfern`, resolved lazily so the mock and the real bridge behave the same. `errorText()` strips Electron's IPC prefix. |
| Router | `src/renderer/src/router.ts` | Hash routes as plain strings: `today`, `session/<id>`, `library`, `reader/<docId>[/<p>]`, `grammar[/<id>]`, `progress`, `settings[/<tab>]`, `onboarding`, `review` (Corrections), `review/quizzes`, `quiz/<id>`. Helpers `reviewRoute`, `quizRoute`. `navigate` pushes history, `replaceRoute` replaces, `useRoute` subscribes. |
| App state | `src/renderer/src/context.tsx` | `AppProvider` / `useApp()`: settings (optimistic `updateSettings`), languages, current language (`setLanguage` leaves session/reader/grammar-detail routes), providers, models, chosen model (`setModel` persists), sessions per language, Anki status, `startSession`. Screens receive only `{ language, navigate }` as props. |
| Shell | `src/renderer/src/App.tsx` | Sidebar + screen; ⌘N new session, ⌘1..5 Today/Library/Grammar/Review/Progress (`NAV_KEYS`). `WordPopoverHost` rendered once. |
| Chat state | `src/renderer/src/lib/chatStream.ts`, `lib/useChat.ts` | Stream store outside React keyed by session (survives navigation); `useChat` merges stored view, stream, optimistic learner message and local correction overrides. |
| Themes | `lib/theme.ts`, `components/ThemePicker.tsx`, `styles/appearance.css` | `Settings.theme` (`light` default, `forest`, `ink`). `applyTheme` sets `<html data-theme>` (deleted for Light; the single source for CSS tokens and the feature sandbox) and caches the theme in localStorage; `main.tsx` applies the cache before React renders, `AppProvider` follows settings. `ThemePicker` (radio group with swatches) is in Settings > Preferences (Appearance group); `ThemeBlocks` (the language-block style, one block per theme with a swatch icon) is step 4 of the welcome page. Main sets `nativeTheme.themeSource` and the window background from `THEMES` at start and after `setSettings` (`refreshTheme` in `src/main/index.ts`). |
| Caches | `lib/cache.ts` | Promise caches for `annotate`, `lookup`, `translate`. |
| Hooks | `lib/hooks.ts` | `useDismiss`, `useActivityTracker` (S1-24), `useStoredFlag` (localStorage). |
| Formatting | `lib/format.ts`, `src/shared/ruby.ts` | Durations, tokens, cost, dates, labels; ruby segmentation (okurigana-aware for ja, per-character pinyin split for zh). |
| Mock backend | `src/renderer/src/dev/mockApi.ts` | Full in-memory `SayfernApi` with believable zh/ja data, simulated streaming, corrections and tool activity. Query switches: `?onboarding=1` (first run), `?fresh=1` (no records), `?anki=offline`. Stage 2 slots come from `dev/mockReview.ts`, `mockQuiz.ts` and `mockDecks.ts`, which share mutable state with `mockApi.ts` through `dev/mockWorld.ts`. Never loaded inside Electron. |

Screens (`src/renderer/src/screens/`):

| Screen | Route | What it does | Main API calls |
|---|---|---|---|
| `Today.tsx` | `today` | Resume card, start tiles (talk, continue reading or open the library, grammar), role-play tiles (`SCENARIOS`, `src/shared/scenarios.ts`: `newSession` with `scenarioId`), "Your activities" (built features, `FeatureActivities`), placement prompt, next course unit (course languages), follow-ups, week numbers, levels | `getHome`, `newSession`, `openReading`, `startPlacement`, `featureSurfaces` (via `useFeatureSurfaces`) |
| `Course.tsx` | `course` | Progress ring; dark "Up next" card with the unit's pattern chips; syllabus map (one dot per grammar point, by level and state; level tiles pick the level shown); the level's units as a responsive grid (segmented bar, pattern chips, "+N"); a unit opens a side drawer with every point (pattern, name, state) and the "Begin Course?" choice (Begin Lesson, More practice); Beta placeholder for languages without a course. `UnitStart` is still used by Today | `getCourse`, `startUnit` |
| `Session.tsx` | `session/<id>` | Conversation, Translate button on each tutor message, token/cost chip, end session, inspector (⌘I), rename by double-click, New topic and difficulty slider (`SessionTools`) | `getSession` (via `useChat`), `send`, `abort`, `setDifficulty`, `newTopic`, `renameSession`, `endSession`, `translate` |
| `Library.tsx` | `library` | Shelf, import by kind, debounced search, rename/delete, saved words | `listDocs`, `importDocs`, `searchLibrary`, `renameDoc`, `deleteDoc`, `listSavedWords`, `deleteSavedWord` |
| `Reader.tsx` | `reader/<docId>[/<p>]` | Paper page with ruby toggle, lookups, checkpoint, selection toolbar, reading chat pane | `getDoc`, `openReading`, `getParagraphs`, `setCheckpoint`, `saveWord` |
| `Grammar.tsx` | `grammar[/<id>]` | Catalogue with filters; detail with state ladder, counts, pattern card, every attempt (disputable; quiz attempts link to their quiz), "In quizzes: X of Y right", corrections; Practise / Explain again | `listGrammar`, `getGrammar`, `disputeObservation`, `practiseGrammar` |
| `Review.tsx` | `review`, `review/quizzes` | Header and tabs; `review/CorrectionsTab.tsx` (+ `CorrectionsItem`, `AnkiExportPanel`) and `review/QuizzesTab.tsx` (+ `QuizParts`) | review and quiz slots (section 16) |
| `Quiz.tsx` | `quiz/<id>` | Generating state, one question at a time, feedback, summary | `getQuiz` (polled while generating), `answerQuestion`, `finishQuiz`, `retryMistakes`, `deleteQuiz`, `cancelQuizGeneration` |
| `Progress.tsx` | `progress` | Week/month/all numbers, daily chart, first-used words, grammar states, corrections by kind, Anki | `getProgress` |
| `Settings.tsx` | `settings/<tab>` | Tabs, in order: about (profile, the default), languages (levels, placement), models, voice, anki, dictionaries, preferences (interface language, theme, auto-translate, updates), data (export) | many |
| `Onboarding.tsx` | `onboarding` | Three-step first run | `setSelfLevel`, `setProfile`, `startPlacement` |

Components (`src/renderer/src/components/`): `Sidebar` (logo that opens the language picker, home button for Today, nav incl. Review, 12 recent sessions, Settings, connection and Anki status), `Composer` (IME-safe input, paste tracking, disabled mic for Stage 3), `MessageList`, `CorrectionCard`, `EndSessionSheet`, `Inspector` (targets, grammar in play, sources, per-reply usage and tool activity), `AnnotatedText`, `WordPopover` (+ `InstallDictionary`), `ModelPicker` (grouped by provider; reasoning and image capability hints, F-04), `Connect` (providers, API keys, sign-in log and prompts), `ui.tsx` (`Switch`, `PopMenu`, doc kind labels, `Cover`), `icons.tsx` (`Icon`, `Fern`), `Placeholder`.

IME safety: every text input that submits on Enter checks `e.nativeEvent.isComposing || e.keyCode === 229` (and `Composer` also tracks composition events) so pinyin and kana input never sends half-composed text.

---

## 13. Styling

`src/renderer/src/styles.css` holds the tokens and the Stage 1 styles, "paper, fern and red pen". Each Stage 2 feature has its own stylesheet in `src/renderer/src/styles/` (`review.css` with `rv-` classes, `quiz.css` with `qz-`, `decks.css` with `dk-`), imported in `main.tsx` after `styles.css` and using the same tokens. Tokens on `:root`:

| Token | Value | Use |
|---|---|---|
| `--paper` | `#f4f0e7` | App background (also the window `backgroundColor`) |
| `--paper-2`, `--paper-3`, `--card`, `--white` | `#eae4d6`, `#efeadf`, `#fbf9f4`, `#fffefb` | Surfaces |
| `--ink`, `--ink-2`, `--ink-3`, `--muted` | `#1c1e1b`, `#3d403a`, `#4a4d46`, `#6b6d64` | Text |
| `--line`, `--line-2`, `--line-3` | `#e0d9ca`, `#dcd4c2`, `#e6dfd1` | Borders |
| `--fern`, `--fern-dark`, `--fern-soft`, `--fern-line`, `--fern-mid` | `#2e5b45`, `#1f4232`, `#e4ece3`, `#d0ddd2`, `#93b39c` | Primary accent, Anki underline, states |
| `--forest` | `#173e35` | Deep-green sidebar |
| `--seal`, `--seal-2`, `--seal-bg`, `--seal-line` | `#a63d22`, `#b8452a`, `#fbf6f1`, `#eacfc4` | Red pen: corrections, errors |
| `--sans` | Geist Sans | UI text |
| `--serif` | Instrument Serif | Display headings |
| `--mono` | Geist Mono | Numbers, code |
| `--zh`, `--ja` | Noto Serif SC, Noto Serif JP | CJK text (classes `zh`, `ja` from `LanguageInfo.fontClass`) |

Fonts are bundled through `@fontsource/*` imports in `main.tsx` (CSP allows only self and data: fonts). Light theme only. UI copy has no em dashes. The OAuth callback page (`scripts/brand-oauth-page.mjs`) repeats the palette inline.

---

## 14. Testing

Runner: `node:test` + `node:assert/strict` through `tsx --test "src/**/*.test.ts"` (`npm test`). One file: `npx tsx --test src/core/agent/turn.test.ts`. Tests use temp dirs and injected clocks; no network (except `LIVE=1`).

| File | Covers |
|---|---|
| `src/core/course/course.test.ts` | Course data (unique ids, levels on the scale and in order, canonical grammar ids, every level covered), full coverage of the HSK 3.0 and EGP lists, the capped overview, Beta languages, next unit for every course after Chinese, next unit and status, the `course` tool, unit session prompt and opening. |
| `src/core/agent/turn.test.ts` | Streaming and persistence; S1-27 single request with reply + `record_evidence`; `search_library` follow-up request and sources; dedupe of repeated `record_evidence`; follow-up when a recording tool comes before any text (with the `NO_REPLY_YET` nudge, absent when text came first); text joined across iterations; abort ("Stopped", no dangling user message); provider error rollback; partial rollback after a completed iteration; empty reply error; pasted spans excluded; target selection and asked/used marking; normalized correction matching; placement levels; taught points; openings; unknown session. |
| `src/core/agent/prompt.test.ts` | Prompt blocks: persona, level, learner, follow-ups skipping focus, targets, catalogue, tool protocol, reading passage, placement scale. |
| `src/core/agent/retry.test.ts` | `localRetryCheck`, `parseRetryJson`, local and model retry paths (no answer reveal), translation cache, `endSession` summary. |
| `src/core/agent/anki-tools.test.ts` | Anki tool gating, each Anki tool's output, a turn calling `anki_check_words`, the prompt's Anki block. |
| `src/core/agent/options.test.ts` | `requestOptions` for switchable vs always-thinking models. |
| `src/core/anki/*.test.ts` | See 5.6. `connect.test.ts` uses real local HTTP servers. |
| `src/core/lang/*.test.ts` | See 5.4. `live.test.ts` downloads real dictionaries only with `LIVE=1`. |
| `src/core/library/*.test.ts` | See 5.5. |
| `src/core/records/*.test.ts` | See 5.3. |
| `src/core/app/app.test.ts` | See 5.2. Runs the real `SayfernApp` with pi-ai's faux provider, an offline fetch and an event recorder. |
| `src/core/review/review.test.ts` | Sentence and revision, list order, chip counts and filters, cloze and situation drafts (batched call, fallback, junk tolerance), export (note type created once, duplicates, older AnkiConnect, rejected batch, invalid drafts, offline/disabled Anki). |
| `src/core/quiz/items.test.ts` | `validateItem` per format (repairs, drops incl. a key missing from four options), local grading, JSON salvage, length planning, levels and provenance. |
| `src/core/quiz/service.test.ts` | Generation (material, validation, no keys before answering, top-up, cancel, failures, stale "generating"), local and model grading, scoring, quiz evidence (prompted, never independent), retry mistakes, delete, options and estimates. |
| `src/core/quiz/app.test.ts` | Quiz slot bound on `SayfernApp`; quiz evidence on the grammar page; export and erase. |

Test doubles:

- **Faux provider**: pi-ai's `fauxProvider()` with scripted responses (`fauxAssistantMessage`, `fauxText`, `fauxToolCall`), `tokensPerSecond` for streaming, `state.callCount` to assert request counts.
- **`FakeAnki`** (`src/core/agent/testkit.ts`): an `AnkiService` over a settable card list that reuses the real pure word functions.
- **Fake AnkiConnect** (`src/core/anki/anki.test.ts`): a fetch function answering AnkiConnect actions from fake cards and reviews.
- **E2E hook**: `SAYFERN_E2E_FAUX=1` makes main install the scripted faux provider (`src/main/e2e.ts`) and expose `globalThis.__sayfernE2E`, for driving the built app without credentials (for example `SAYFERN_E2E_FAUX=1 npm run dev`). No driver script is checked in.
- **Smoke selftest**: `npm run smoke -- selftest` runs `SayfernApp` end to end offline in a temp dir (streamed turn with one request, correction and observations, grammar detail, progress, home, placement opening, export).

## 15. Build and dev scripts

| Command | What it does |
|---|---|
| `npm install` | Installs; `postinstall` runs `brand-oauth-page.mjs`, `install-electron` (Electron 44 no longer downloads its binary on install), then `brand-electron-app.mjs`. |
| `npm run dev` | `predev` repeats the patch and binary install; `electron-vite dev` (renderer with HMR, main/preload rebuilt). |
| `npm run build` | `electron-vite build` → `out/main/index.js`, `out/preload/index.mjs`, `out/renderer/`. |
| `npm run dist -- --<os> --<arch>` | `electron-vite build`, then electron-builder: `.dmg`, `.exe` or Linux `.tar.gz` in `dist/` ([packaging.md](packaging.md)). |
| `node scripts/flatpak.mjs local\|flathub <tar.gz> [owner/repo]` | Flatpak build folder from the Linux `.tar.gz` (`dist/flatpak/`, `dist/flathub/`). |
| `npm start` | `prestart` rebrands the dev bundle; `electron-vite preview` runs the built app. |
| `npm run typecheck` | `tsc --noEmit` for `tsconfig.node.json` and `tsconfig.web.json`. |
| `npm test` | All unit and integration tests. |
| `npm run smoke -- <cmd>` | `providers`, `login <p>`, `key <p> <key>`, `models [p]`, `chat <p> [model] "msg"`, `selftest`. Data in `./.sayfern-dev/`. |
| `npx vite --config vite.mock.config.ts` | Renderer in a browser at `http://localhost:5174` against the mock API (drops the CSP meta for Vite's dev client). `npx vite build --config vite.mock.config.ts` writes `out/mock-renderer/`. |

Requirements: Node ≥ 22.19 (`engines`). Packaging, CI releases, signing and Flathub: [packaging.md](packaging.md).

---

## 16. Stage 2: review, quizzes, Anki decks

Built in v0.5.0 (decks in v0.6.0). Feature IDs S2-01 to S2-16 are mapped to code in [`stage2.md`](stage2.md). The feature builder (S2-10..S2-13) was removed in 0.27.0 ([ADR 36](decisions.md)).

### 16.1 Foundation: API slots, services, routes

```
src/shared/stage2/review.ts   ReviewApi  + REVIEW_METHODS  ─┐
src/shared/stage2/quiz.ts     QuizApi    + QUIZ_METHODS    ─┼─► SayfernApi extends all four; METHOD_TABLE spreads the *_METHODS
src/shared/stage2/decks.ts    DeckApi    + DECK_METHODS    ─┘
                                   │
src/core/app/index.ts  SayfernApp: builds one Stage2Deps (src/core/stage2.ts), then
                         this.review   = new ReviewService(stage2);  bindSlot(this, this.review,   REVIEW_METHODS)
                         this.quizzes  = new QuizService(stage2);    bindSlot(this, this.quizzes,  QUIZ_METHODS)
                         this.decks    = new DeckService(stage2);    bindSlot(this, this.decks,    DECK_METHODS)
                                   │
src/main/index.ts      the IPC loop over API_METHODS finds the bound methods like any other
src/renderer/src/dev   mockApi.ts merges createReviewMock / createQuizMock / createDeckMock (all over mockWorld.ts)
```

- `Stage2Deps`: `dataDir`, `models`, `records`, `anki`, `library`, `lang`, `settings` (the concrete Stage 1 services), `resolveModel(ref)` (throws a learner-readable error), `emit(channel, payload)`, `now`, `newId`, `fetch?`, `credentials?` (the sign-ins store; decks keep the ElevenLabs key there).
- `bindSlot(target, service, methods)` defines each listed method on `SayfernApp` as a bound, non-enumerable property and throws at construction if the service lacks one. A slot interface plus its `Record<…, true>` table makes a missing or extra method a compile error.
- Slot files hold types plus tiny pure helpers both sides need (`REVIEW_KIND`, `clozeFront`). They are compiled by both TS projects, so no Node or DOM APIs.
- Renderer: Review in the sidebar (⌘4; Progress is ⌘5), `Review.tsx` with Corrections and Quizzes tabs, `Quiz.tsx`. Stylesheets in `src/renderer/src/styles/` (section 13).

### 16.2 Review: corrections review and Anki export (S2-01..S2-03)

| File | Contents |
|---|---|
| `src/core/review/index.ts` | `ReviewService` (`listReviewCorrections`, `draftAnkiCards`, `exportAnkiCards`), `MAX_CARDS` (100). |
| `src/core/review/list.ts` | `buildItem` (correction + learner message, session, grammar point), `sentenceAndRevision`, `reviewList` (filters, chip counts, grammar points; all local). |
| `src/core/review/cards.ts` | Pure card drafting: cloze (corrected sentence, fix as the gap, local English hint), recall drafts, note types `CLOZE_NOTE_TYPE` ("Sayfern Cloze", a real cloze type) and `RECALL_NOTE_TYPE` ("Sayfern Recall": Sentence, Prompt, Explanation, Source), `noteTypeFor`. |
| `src/core/review/situations.ts` | One strict-JSON `completeSimple` call for all selected situation cards (`requestOptions` headroom, 60 s abort), validated per card (no CJK, no answer, length), explanation-based fallback with the answer masked; `parseSituations` tolerates fences and junk. |

Flow:

1. `listReviewCorrections(filter)` reads the language's corrections, joins each with its context (`buildItem`), filters by kind (`grammar`, `typo`, `speaking`; one chip each), status, grammar point and search, and returns items newest first with chip counts.
2. Retry, reveal and dispute in the list call the Stage 1 methods `checkRetry`, `revealCorrection`, `disputeCorrection` (section 11.5).
3. `draftAnkiCards({ language, correctionIds, style }, model?)` skips disputed corrections. Cloze drafts are local; situation drafts make one model call, or fall back (`fallback: true`, `notice`).
4. `exportAnkiCards({ language, deck, cards })`: `ensureNoteType`, `ensureDeck`, duplicate check, `addNotes` (section 5.6). Notes are tagged `sayfern`, `sayfern::<kind>` and the grammar id. The recall type puts the sentence first so Anki's duplicate check is on the sentence. Added and duplicate cards set `Correction.exportedAt` (+ `ankiNoteIds`); the deck goes to `AnkiConfig.exportDecks[language]`. The result lists added, duplicate and failed cards.

| Method | Purpose |
|---|---|
| `listReviewCorrections(filter)` | Corrections of a language with sentence, revision, session and grammar; filtered; newest first; chip counts and grammar points computed locally. |
| `draftAnkiCards(input, model?)` | Editable card drafts (cloze local; situation one batched model call with fallback). |
| `exportAnkiCards(input)` | Adds cards with the Sayfern note types, skips duplicates, reports per card, marks corrections exported, remembers the deck. |

Disk: no new files. `records/corrections.json` (`exportedAt`, `ankiNoteIds`) and `anki/config.json` (`exportDecks`). Inside Anki: the two note types, created on first export.

Renderer: `screens/review/CorrectionsTab.tsx` (toolbar, list, selection), `CorrectionsItem.tsx` (one correction, inline retry/reveal/dispute, IME-safe), `AnkiExportPanel.tsx` (drafts cached per style and correction, editor, deck picker, export), `styles/review.css`.

### 16.3 Quizzes (S2-04..S2-09)

| File | Contents |
|---|---|
| `src/core/quiz/index.ts` | `QuizService` (implements `QuizApi`), `sanitizeSpec`, `toView` (strips keys of unanswered questions), `summarize` (local score), `quizSessionId` (`quiz:<id>`), `evidenceSpan`. |
| `src/core/quiz/material.ts` | Gathers material locally: corrections and earlier wrong quiz answers, Anki words (`anki.words`), grammar summaries, library paragraphs by chapter or around the checkpoint, profile goal, saved words. |
| `src/core/quiz/levels.ts` | HSK 2.0, HSK 3.0 and JLPT level names, vocabulary sizes and grammar descriptors; alignment and provenance text. No official word lists bundled. |
| `src/core/quiz/estimate.ts` | Format of each question, minutes ↔ question count. |
| `src/core/quiz/generate.ts` | Slot targets (a grammar point, a word, a correction or the passage), one strict-JSON request per 10 slots in parallel, one top-up request, `AbortController` per quiz. |
| `src/core/quiz/items.ts` | `QuizItem`, `validateItem` per format, local grading with `pack.normalize`. |
| `src/core/quiz/json.ts` | Salvages fenced, wrapped or truncated JSON. |
| `src/core/quiz/grade.ts` | Model grading for written and role-play answers (verdict, one line of feedback, a better version; "uncertain" on failure). |
| `src/core/quiz/store.ts` | `QuizStore`: one `JsonFile` per quiz under `records/quizzes/`. |

Generation:

1. `startQuiz(spec, model)` sanitizes the spec, resolves the model, gathers material, resolves the level, plans slots, stores a `generating` quiz and returns its view at once; generation continues in the background.
2. Each model batch is parsed (`json.ts`) and every item goes through `validateItem`: multiple choice needs exactly one key among distinct options (letter answers, option labels and duplicates are repaired; a key missing from four or more options or more than one acceptable option drops the item); cloze needs one gap and an answer; ordering tiles are cut locally from the answer sentence with the language pack and must join back to it; written and role-play need a model answer and a rubric (a default rubric is added).
3. Unusable slots get one top-up request; too few usable items fail the quiz with a readable error. `cancelQuizGeneration` aborts and deletes the unfinished quiz. A quiz left `generating` by a previous run becomes `failed` on read.

Answering and evidence:

1. `answerQuestion(quizId, questionId, response, model, { reveal? })` grades fixed formats locally (`normalize`, accepted alternatives; cloze also accepts the whole sentence; ordering is exact) and open formats with the model, then returns the view with the key and explanation.
2. `finishQuiz` scores locally and records one `GrammarObservation` per answered item linked to a grammar point: `origin: "quiz"`, `quizId`, `sessionId: "quiz:<quizId>"`, `messageId` = question id, `assistance: "prompted"`, id from `observationId(questionId, grammarId, span)`, so it is idempotent. Revealed answers are not evidence. Quiz text is never recorded as learner words.
3. `summarizeGrammar` keeps quiz evidence in `GrammarSummary.quiz` and never lets it make a point independent (section 5.3). `lastConversationVerdicts` skips it, so follow-ups on Today and in the prompt come from conversation only (section 10.1).
4. `retryMistakes` makes a new quiz from wrong and unsure answers (reshuffled, no model call). `deleteQuiz` deletes the file and its evidence (`deleteObservations({ sessionId })`).

| Method | Purpose |
|---|---|
| `quizOptions(language)` | Local counts per source, Anki state, grammar points, library docs, current level, exam systems |
| `quizChapters(docId)` | Headings of a library document with paragraph ranges |
| `estimateQuiz(spec)` | Question count, minutes, alignment and provenance (local) |
| `startQuiz(spec, model)` | Stores a generating quiz and generates in the background |
| `cancelQuizGeneration(quizId)` | Aborts and deletes the unfinished quiz |
| `getQuiz(quizId)` | Renderer view (no keys for unanswered questions) |
| `listQuizzes(language)` | Recent quizzes with local scores (failed ones hidden, removed after a day) |
| `answerQuestion(quizId, questionId, response, model, opts?)` | Grades one answer, returns the view with the key |
| `finishQuiz(quizId)` | Scores and records quiz evidence; idempotent |
| `retryMistakes(quizId)` | New quiz from wrong and unsure answers, no model call |
| `deleteQuiz(quizId)` | Deletes the quiz and its evidence |

`records/quizzes/<quizId>.json` (`QuizFile` in `store.ts`): `v`, `id`, `language`, `title`, `spec` (`QuizSpec`: `language`, `focus`, `sources`, `level`, `format`, `length`), `status`, `createdAt`, `finishedAt?`, `error?`, `model?`, `alignment` ("HSK 3 (HSK 2.0 levels)"), `provenance` ("… Not official exam material."), `exam?`, `level?`, `items` (`QuizItem`: `id`, `format`, `prompt`, `text?`, `choices?`, `tiles?`, `answer` (the key), `accepted`, `explanation`, `rubric?`, `grammarId?`, `word?`, `correctionId?`, `answered?` (`QuizAnswer`: `response`, `verdict`, `feedback`, `revealed?`, …)), `grammarLabels` (id → pattern, captured at creation), `retryOf?`, `evidenceAt?` (set by `finishQuiz`).

Renderer: `screens/review/QuizzesTab.tsx` (sentence builder, popovers, recent quizzes), `QuizParts.tsx`, `screens/Quiz.tsx`, `styles/quiz.css`. Grammar page: "Open quiz" links and the "In quizzes" line.

### 16.4 Anki deck generator (S2-14..S2-16)

| File | Contents |
|---|---|
| `src/shared/stage2/decks.ts` | `DeckApi` + `DECK_METHODS`, `DeckSpec`, `DeckProjectView`, `DECK_BATCH_SIZE` (25), `DECK_SAMPLE_SIZE` (5), `suggestDeckName`, `sharedDecksUrl`. |
| `src/core/decks/index.ts` | `DeckService`: options, estimate, projects (`startDeckProject`, `redoDeckSamples`, `approveDeckSamples`, `runDeckBatch`, `stopDeckBatches`), ElevenLabs account, `abortAll`; `sanitizeDeckSpec`. |
| `src/core/decks/prompts.ts` | Word-list and card prompts (rules condensed from /ankigen's Mandarin and Japanese references), `parseWords`, `parseCards`, `ask`. |
| `src/core/decks/cards.ts` | `checkCard` (target script, word in sentence incl. conjugated ja, reading checked against the dictionary then the reader, ruby via `src/shared/ruby.ts`), `VOCAB_NOTE_TYPE`, `noteFor`, `rubyHtml`. |
| `src/core/decks/tts.ts` | `edgeTts` (Edge read-aloud websocket with Sec-MS-GEC v2 from `edge-drm.ts`, constants from edge-tts 7.3.1), `elevenTts`, `elevenVoices`, `elevenSubscription`, `TtsError` (quota / auth / network). |
| `src/core/decks/store.ts` | `DeckStore`: `records/decks/<id>.json` (`JsonFile`), audio cache `records/deck-audio/<key>.mp3`. |
| `src/renderer/src/screens/Decks.tsx` | Form, ElevenLabs connect, project view (progress, samples front/back with audio, batches, latest cards). |

**Flow.**

1. `startDeckProject(spec, model)`: sanitize, resolve the model, check the audio choice, save a `planning` project, then in the background `pickWords` (up to 100 words per request, guided by `spec.request`, the learner's own words for what the deck covers; later requests say how many list items are already taken and continue from the next one; avoid list = chosen words + up to 150 linked Anki words; `checkWords` drops words already in Anki; two empty replies mark the list `exhausted`) and `writeSamples` (5 cards, checked, audio recorded) → `preview`. The renderer polls `getDeckProject` every second.
2. `redoDeckSamples(id, notes)` stores `guidance` (sent with every later word and card request) and writes new samples. `approveDeckSamples` → `ready`.
3. `runDeckBatch(id, model, { continuous })` → `generating`. Each batch: ping Anki first (no tokens or credits while it's closed), top up the word list, re-check known words, write cards for words without a sample card (one request, one retry for skipped or unusable words), record audio (4 cards at a time, cached by content hash), `ensureDeck`, `ensureNoteType(Sayfern Vocab)`, `storeMedia` for every clip, `addNotes`. Word statuses, the batch log and the latest 50 cards are saved; `remaining = size - added` (or the words left when exhausted). After the first card is added the deck is appended to `AnkiConfig.decks` for the language, so sync and the tutor see it. Continuous mode repeats until done, a batch adds nothing, a batch fails or `stopDeckBatches`.
4. A failed batch keeps the project `ready` with `lastError`. A restart mid-job turns `planning` into `preview` or `failed` and `generating` into `ready` on the next `getDeckProject`.

**Audio.** `clip()` tries ElevenLabs when chosen and connected (key from `credentials`, voice from `settings.elevenLabsVoice`, model `eleven_flash_v2_5`, `language_code`); a quota or auth error turns ElevenLabs off for the rest of the batch and counts fallbacks; otherwise or after that the Edge voice for the part (word or sentence) speaks. A clip that fails both ways leaves the card without that audio ("No audio: …" check). Edge runs on Node's global `WebSocket` (undici accepts the `Origin` and cookie headers), not Chromium, so the locked-down app session doesn't apply; ElevenLabs uses `deps.fetch` (`electronFetch`).

## 17. Languages and interface translation (v0.7.0)

**Learning languages.** `Language` (`src/shared/records.ts`) has 11 ids; `LANGUAGE_META` (`src/shared/languages.ts`) is the single table for names, glyph, `fontClass` (`zh`, `ja`, `ko`, `lt` Latin, `cy` Cyrillic), BCP 47 tag, script, level system and levels (HSK, JLPT, TOPIK, CEFR), reading name (zh/ja), AnkiWeb search, variety (Latin American Spanish, Brazilian Portuguese, Northern Vietnamese) and target-language session titles. `languageInfo(id)` turns it into a `LanguageInfo`; `leaksTargetScript(text, target, locale)` catches card prompts that leak the answer's script.

**Interface locales.** `src/shared/locales.ts`: `UiLocale` (en, zh-Hans, zh-Hant, ja, ko, vi, ru, fr, it, es, de, pt-BR, pt-PT), `matchOne` (zh-TW/HK/MO and Hant → zh-Hant, other zh → zh-Hans, bare pt and pt-BR → pt-BR, any other pt region → pt-PT), `matchLocale(tags)`, `effectiveLocale(chosen, tags)`. Main passes `app.getPreferredSystemLanguages()` as `SayfernAppDeps.systemLocales`; `SettingsStore.locale()` resolves `Settings.uiLocale` (`"system"` or a locale) against it. `systemLocale()` is on the API for the "Match system" option. Main's menu labels (`MENU_TEXT`) refresh after `setSettings`.

**Translation.** `src/shared/i18n/index.ts`: catalogs keyed by the English text (`CATALOGS`, one file per locale), `translate`, `translatePlural` (Intl.PluralRules; entries are a string or `{ one, few, many, other }`), `translateContext` (key `context\u0004English`), `msg` (marks constants), `translator(locale)` (a `Translator` with `t`, `tn`, `language`, `date`), `learningLanguageName` (Intl.DisplayNames). Renderer: `src/renderer/src/i18n.ts` (`t`, `tn`, `tj`, `tc`, `langName`, `intlLocale`); `AppProvider` calls `setLocale` before rendering and `App` remounts under `<Fragment key={locale}>` when it changes. `errorText()` translates fixed core errors. Core builds learner-visible text with the settings' translator (`translatorFor` / `explanationFor` in `stage2.ts`, `translatorOf` / `explainIn` for the tutor).

**Explanation language.** The interface language is the language the tutor explains in (`explanationBlock` in `agent/prompt.ts`), the target of translations (`ChatMessage.translationLang` invalidates old ones), and the language of quiz feedback, card fronts and deck definitions. Prompts use `promptName` ("Brazilian Portuguese").

**Keys and the catalog test.** `scripts/i18n-keys.ts` walks `src/renderer/src`, `src/core` and `src/shared` with the TypeScript parser and collects literal arguments of `t`, `tj`, `msg`, `tr` (the `t as tr` alias), `tn` (plural, key = "other" form), `tc`, and sentence-like `new Error("…")` in core. `src/core/i18n-catalogs.test.ts` checks every catalog has every key, no unused keys, matching placeholders, the locale's plural categories, and no em dashes. `I18N_LOCALE=de` limits it to one locale.

**Fonts.** `--ko`, `--lt`, `--cy` tokens and `.ko`, `.lt`, `.cy` classes for learning text; `html:lang(…)` rules swap `--serif` / `--sans` for CJK, Russian and Vietnamese interfaces (Instrument Serif and Geist ship Latin only).

## 18. Stage 3: voice (v0.8.0)

`VoiceService` (`src/core/voice/index.ts`) is bound like a Stage 2 slot (`VOICE_METHODS` from `src/shared/stage3/voice.ts`). It shares one `ElevenLabsAccounts` pool (`Stage2Deps.eleven`) with `DeckService`.

- **Accounts.** `settings.json` → `elevenLabsAccounts: [{ id, label, credential, keyHint, addedAt }]` in the order they are tried; each key is in `credentials.json` under `credential` (`"elevenlabs"` for the first, `"elevenlabs:<id>"` after). A v0.6 key with no list becomes the first account. Benches live in memory only.
- **speak.** Clean (messages only) → clip to 1,500 characters → cache key `sha(elevenlabs|voice|code|text)` or `sha(edge|voice|text)` → `records/voice-audio/<key>.mp3`. ElevenLabs Flash v2.5 through the pool, Edge (`edgeTts`) as the fallback. Bytes cross IPC; the renderer plays a blob URL (CSP `media-src blob:`).
- **transcribe.** `elevenStt` posts a hand-built multipart body to `/v1/speech-to-text` (`scribe_v2`, `language_code` = session language, no audio-event tags). Clip length is added to `voiceMs`.
- **Spoken turns.** `send(…, { spoken: true })` → `ChatMessage.spoken`, model content prefixed with `SPOKEN_MARKER` (`[spoken]`), rule in `FEEDBACK_RULES` (and `SPOKEN_MARKER`); the `speaking` / no-`typo` rule is in the `kind` parameter description.
- **Voice time.** `addVoiceTime` updates `SessionMeta.voiceMs` and `activity.json` (`voiceMs` on the day's entry); `computeProgress` sums it into `ProgressStats.voiceMs`.
- **Renderer.** `lib/voice.ts`: status store (`useVoiceStatus`), one player (`play`, `usePlayback`, `stopPlayback`), `Recorder` (MediaRecorder, 2-minute cap), `useAutoSpeak`. `components/Speak.tsx` renders listen and 0.7× buttons. Settings > Voice is `VoiceTab` in `screens/Settings.tsx`.


---

## 19. Course (v0.10.0)

A Duolingo-style path per learning language: units in textbook order, grouped by level, each with grammar points (ids the tutor records with `record_evidence`), topic ideas and core words. Nine languages have one. Chinese (`src/shared/course/zh.ts`) and English (`en.ts`) follow their source in full since v0.14.0: all 573 points of the HSK 3.0 grammar syllabus (92 units) and all 1,239 points of the English Grammar Profile (215 units), each point with `ref` to its source number. The others are core paths: since v0.11.0 Japanese (`ja.ts`: 32 units, JLPT N5 to N1 in Genki, then Quartet and Tobira order), Korean (`ko.ts`: 32 units, TOPIK 1 to 6 in Sejong and Yonsei order) and French (`fr.ts`: 32 units, CEFR A1 to C2 after the Référentiels); since v0.13.0 Spanish (`es.ts`, PCIC), Italian (`it.ts`, Profilo della lingua italiana), German (`de.ts`, Profile deutsch and the Goethe guides) and Portuguese (`pt.ts`, QuaREPE, European Portuguese since v0.14.0), 32 CEFR units each. Russian and Vietnamese are still Beta. Languages without a course are **Beta**: the tutor works, with no syllabus behind it; the language pickers show a Beta chip.

- **Data and status** (`src/shared/course/index.ts`, pure, shared with the mock backend): `COURSES`, `courseFor`, `isBeta`, `findUnit`, `unitStatus` (done = every point `independent`; started = any point seen or a unit session opened; else new), `nextUnit`, `buildCourseView`. Status is computed from grammar records, never by a model (S1-25), so quiz answers (never `independent`) cannot finish a unit.
- **Tutor** (`src/core/course/index.ts`): the `course` tool (its overview lists at most 40 open units: the learner's level, then the one above, then the one below) and `unitText` (core words joined with 、 for Chinese and Japanese, with commas for the others). The prompt's course block (chat) and course unit session block are in `prompt.ts`, with the pacing block (section 10.1).
- **API:** `getCourse(language)`, `startUnit(unitId)`; `NewSessionOptions.unitId`. A unit session is a practice session with `SessionMeta.unitId`; its kickoff is "(The learner started a course unit...)". Before a unit starts (Course screen or Today), `components/UnitStart.tsx` asks "Begin Course?". Begin Lesson = `startUnit(id, { explain: true })` → `openWith: "explain"`: the opening starts with a short summary of each point (a reminder that does not replace the learner's textbook), then each point comes with an introduction, a sample dialogue and a question. More practice = `startUnit(id)`: plain conversation on the unit, with no overview, introductions or sample dialogues.
- **Renderer:** `screens/Course.tsx` (route `course`, ⌘2), `styles/course.css` (`cr-`), a next-unit card on Today. `UnitView.points` carries each point's pattern, name and state (null = not seen) for the map, chips and drawer. Mock preview of any course: `?lang=en`.
- **Adding a course:** follow [`courses.md`](courses.md) (sources, unit rules, field style, steps). In short: write `src/shared/course/<lang>.ts` with units whose levels are on `LANGUAGE_META[lang].levels` and whose grammar ids are canonical (`<lang>:<ascii-slug>`), register it in `COURSES`, and add every unit title to the 12 catalogs. `src/core/course/course.test.ts` checks ids, levels and order.
