# Architecture decisions

Short ADR-style records of the choices behind Sayfern. Each has context, the decision, and its consequences. All were made on 2026-09-30 during the Stage 1 build (v0.1.0 to v0.2.1) unless noted. When a decision changes, add a new entry that supersedes the old one instead of editing history.

Where each decision lives in code is noted under **Where**. The full design is in [`architecture.md`](architecture.md).

---

## ADR 1. Electron + React + TypeScript (not SwiftUI or Tauri)

- **Context.** Sayfern is a Mac app. Stage 2 includes an AI feature builder: learners prompt the model to write extensions, test them, preview, enable/disable and roll back. That code has to load at runtime.
- **Decision.** Electron with a React + TypeScript renderer and a Node main process.
- **Why.** JavaScript modules can be written to disk and hot-loaded (`import()` with a cache-busting query), while Swift code would need compiling with Xcode plus code signing on the learner's machine. Models write TypeScript/React better than Swift. The provider library (pi-ai, ADR 2) is TypeScript. Tauri would split the app between Rust and a web view and still need a JS runtime for pi-ai.
- **Consequences.** Larger app bundle and memory use. Access to Node for file storage, AnkiConnect and dictionaries. `safeStorage` for credentials (ADR 6). Packaging and signing are still to do (roadmap).
- **Where.** `src/main/`, `src/preload/`, `src/renderer/`, `electron.vite.config.ts`; runtime loading already used by `src/core/extensions/index.ts`.

## ADR 2. Model access through `@earendil-works/pi-ai`

- **Context.** The tutor must work with the models learners already pay for: API keys and subscriptions (Claude Pro/Max, ChatGPT), streaming, tool calls, and switching models mid-session.
- **Decision.** Use `@earendil-works/pi-ai` (MIT, the provider layer of the Pi coding agent, pinned to 0.99.1) instead of hand-written clients.
- **Why.** About 40 providers, OAuth sign-in with token refresh, streaming, tool calling, and provider-neutral transcripts that convert between providers.
- **Auth facts (September 2026).**
  - Anthropic banned subscription OAuth in third-party tools in February 2026, then reinstated it in May 2026 with a separate monthly "Agent SDK" credit per plan. pi-ai's Anthropic OAuth sends Claude Code identity headers and the Claude Code system line. Sayfern's copy says sign-in "uses your plan's Agent SDK credit" (`src/core/providers.ts` `NOTES`).
  - OpenAI "Sign in with ChatGPT" uses dynamic client registration; the token is sent to api.openai.com. It needs a stable per-install device UUID, stored as `settings.deviceId` (`SayfernApp.getDeviceId`).
  - pi-ai names itself "Pi" on OpenAI's consent screen. `SayfernApp.authInteraction` rewrites `agent_name_hint=Pi` to `agent_name_hint=Sayfern` in the auth URL (the smoke script does the same).
  - pi-ai's local OAuth callback page ("Authentication successful", Pi logo) is replaced with a Sayfern-branded page by `scripts/brand-oauth-page.mjs`, which patches `node_modules/@earendil-works/pi-ai/dist/utils/oauth-page.js` on `postinstall` and `predev`. It is idempotent (marker comment `/* sayfern-oauth-page */`).
- **Consequences.** Upgrading pi-ai can break the patch (the file path or exported names `oauthSuccessHtml` / `oauthErrorHtml` may change) or change auth behavior; re-run the smoke logins after an upgrade. Stage 1 registers six providers (`FACTORIES`); adding one is a one-line change once checked.
- **Where.** `src/core/providers.ts`, `src/core/app/index.ts` (`login`, `authInteraction`), `scripts/brand-oauth-page.mjs`, `scripts/smoke.ts`.

## ADR 3. Install the Electron binary explicitly

- **Context.** Electron 44 no longer downloads its binary in its own postinstall step, so a fresh `npm install` left no runnable Electron.
- **Decision.** `package.json` runs `install-electron` (the bin shipped by the `electron` package) in `postinstall` and again in `predev`.
- **Consequences.** `npm run dev` works right after cloning. CI or packaging must also run it (or `npm install` with scripts enabled).
- **Where.** `package.json` scripts.

## ADR 4. Plain-Node core behind interfaces; `SayfernApp` facade; thin main

- **Context.** Most logic (records, agent loop, parsing, Anki) has nothing to do with Electron, and Electron-bound code is slow to test.
- **Decision.** All logic lives in `src/core`, never imports `electron`, and talks across modules through the interfaces in `src/core/contracts.ts`. Services are classes constructed with explicit dependencies (`dataDir`, `fetch`, `now`). `SayfernApp` wires them and implements the renderer API; `src/main/index.ts` is a loop over `API_METHODS` plus four Electron-only methods (dialogs, shell).
- **Consequences.** The whole app runs in plain Node: `scripts/smoke.ts` and `src/core/app/app.test.ts` construct `SayfernApp` directly, and the test suite runs in seconds without Electron. Adding an API method touches a fixed checklist (see `AGENTS.md`). Main needs an Electron-only method only for native UI.
- **Where.** `src/core/contracts.ts`, `src/core/app/index.ts`, `src/main/index.ts`, `src/shared/api.ts`.

## ADR 5. JSON files instead of SQLite

- **Context.** Learning records need durable, concurrent-safe storage.
- **Decision.** One JSON file per record kind (and per session), atomic writes (temp file + rename), per-file promise queues for read-modify-write, in-memory caches.
- **Why.** Native modules (better-sqlite3 and similar) complicate Electron builds and rebuilding per Electron ABI. Data volumes are small (one learner). Files are human-readable and make export trivial.
- **Consequences.** Whole-file rewrites on every change; fine at current sizes, but `getProgress` and `findMessageSession` scan all sessions. Only one process may write (ADR 14). A corrupt file is moved aside (`*.corrupt-<ms>`) and replaced by defaults. SQLite can replace this behind `RecordsStore` without touching callers.
- **Where.** `src/core/records/io.ts` (`JsonFile`), `src/core/library/json-file.ts`, `src/core/anki/json-file.ts`, `src/core/app/settings.ts`.

## ADR 6. Credentials encrypted with Electron `safeStorage`

- **Decision.** `FileCredentialStore` takes an optional cipher; main passes one backed by `safeStorage.encryptString` / `decryptString`, whose key lives in the macOS Keychain. The file is written with mode 0600.
- **Consequences.** macOS may ask to allow "sayfern Safe Storage" the first time (click Always Allow). If Keychain access is denied, reading credentials fails. The smoke script stores plain JSON in the gitignored `.sayfern-dev/`.
- **Where.** `src/core/credential-file-store.ts`, `src/main/index.ts`.

## ADR 7. Recording-only tools (S1-26, S1-27)

- **Context.** The tutor records evidence (corrections, grammar observations, taught patterns, level estimates) every turn. A normal tool call costs a second model request just to acknowledge the write, and the model sometimes calls it twice.
- **Decision.** The tutor writes its reply first, then calls `record_evidence` once. Tools marked `recordingOnly` just store data: when every tool call in a step is recording-only and the reply already has text, the loop ends without a follow-up request. Record ids are deterministic (`correctionId`, `observationId`), so a retried or repeated call dedupes. The model never computes numbers; code counts the evidence (ADR 9).
- **Transcript validity.** The stored transcript ends with assistant(toolCall) → toolResult, and the next turn appends a user message after the tool result. This sequence was verified against pi-ai's Anthropic and OpenAI Responses conversions.
- **Consequences.** One request per ordinary turn. If the model calls a recording tool before writing any text, the loop does continue so the learner gets a reply. Extensions can declare `recordingOnly` tools with the same semantics.
- **Where.** `src/core/agent/turn.ts` (`runLoop`), `src/core/agent/tools.ts`, `src/core/records/ids.ts`, tests in `src/core/agent/turn.test.ts`.

## ADR 8. Low effort plus headroom for always-thinking models

- **Context.** Found in review: some reasoning models cannot switch thinking off (for example claude-sonnet-5-5, the gpt-5 family). With no reasoning level set, pi-ai leaves them at the provider default and thinking tokens count against `maxTokens`, so a 1500-token reply or a 200-token retry check often came back empty or truncated.
- **Decision.** `requestOptions(model, answerTokens)`: for models that cannot turn thinking off, request the lowest supported effort (clamped `"low"`) and add `THINKING_HEADROOM` (4096) output tokens. An empty final reply is reported as an error instead of saving a blank bubble.
- **Where.** `src/core/agent/options.ts`, `src/core/agent/turn.ts`, `src/core/agent/options.test.ts`.

## ADR 9. Numbers shown to learners are computed locally (S1-25)

- **Decision.** Models record evidence; ordinary code derives every count, rate, state and statistic (grammar counts and states, words written, first uses, active time, progress, Anki word statuses and struggle scores). No model call is involved in Progress or Today numbers.
- **Consequences.** Numbers are reproducible and cheap. Evidence quality still depends on the model's judgments, which learners can dispute (S1-20).
- **Where.** `src/core/records/stats.ts`, `src/core/records/grammar.ts`, `src/core/anki/words.ts`.

## ADR 10. AnkiConnect over Node's fetch, with classified failures

- **Context.** v0.1.0 reached AnkiConnect through Chromium's network stack; system proxy/PAC settings could intercept `127.0.0.1`, and a 3 s timeout reported busy or backgrounded Anki as unreachable.
- **Decision (v0.1.1).** Main passes Node's `fetch` as `ankiFetch`; timeouts are 8 s per call and 20 s for bulk calls. Failures are classified as `refused`, `timeout` (usually macOS App Nap), `forbidden` (HTTP 403, `webCorsOriginList`) or `not_ankiconnect` (something else on the port), and Settings > Anki shows a specific fix, a copyable App Nap command, a `curl` check and "Test connection".
- **Real incident.** The owner's Obsidian wiki dashboard (a Python LaunchAgent) was squatting on port 8765, so AnkiConnect could not bind. The dashboard was moved to port 43917. When AnkiConnect seems missing, check what owns the port with `sudo lsof -i :8765`.
- **Where.** `src/core/anki/index.ts` (`call`, `classifyFetchError`, `AnkiUnreachableError`), `src/main/index.ts` (`ankiFetch`), `src/renderer/src/screens/Settings.tsx` (`AnkiTroubleshoot`), `src/core/anki/connect.test.ts`.

## ADR 11. v0.2.0 Anki model: full snapshot and word-level view

- **Decision.**
  - Sync pulls every card of the linked decks, including new and suspended ones, with status, new-queue position, leech tag, and 90 days of review history via `cardReviews` (fallback `getReviewsOfCards` for 30 days, then no history).
  - Cards are aggregated into words (recognition and production count once) with status known / learning / new / suspended and a struggle score in 0..1 with short reasons.
  - Tutor tools `anki_overview`, `anki_struggling`, `anki_vocabulary`, `anki_check_words`, `anki_lookup`, offered only when Anki is on and the language has a snapshot.
  - A compact "Anki knowledge" block in every prompt (counts, hardest words, next new words) with i+1 guidance.
  - Background refresh at startup and on session creation when the snapshot is more than 6 hours old; never blocks.
- **Consequences.** The tutor can stay within known vocabulary and weave in hard words. 0.1.x snapshots still load (stages inferred). Practice targets use struggle scores.
- **Where.** `src/core/anki/index.ts`, `src/core/anki/words.ts`, `src/core/agent/anki-tools.ts`, `src/core/agent/prompt.ts` (`ankiBlock`), `src/core/app/index.ts` (`refreshAnki`, `ANKI_MAX_AGE_MS`).

## ADR 12. v0.2.1: keep deck mappings without a word field

- **Context.** Bug: Settings saved a deck before its fields were chosen, and config normalization dropped mappings with no word field, so the deck dropdown snapped back to "Choose a deck".
- **Decision.** `normalizeConfig` keeps any mapping with a valid language and deck. Sync (`pull`) and `ensureFresh` require a word field and ask for it. The UI preselects likely word / reading / meaning fields by name after a deck is picked.
- **Where.** `src/core/anki/index.ts` (`normalizeConfig`, `pull`), `src/renderer/src/screens/Settings.tsx` (`DeckMapping`), regression test in `src/core/anki/connect.test.ts`.

## ADR 13. Semantic versioning with a Keep a Changelog file

- **Context.** The owner asked for explicit versioning.
- **Decision.** `MAJOR.MINOR.PATCH`. While the major version is 0, minor versions add features and patch versions fix bugs. Every change bumps `package.json` (and `package-lock.json`) and the version line in `README.md`, and adds a `CHANGELOG.md` section in Keep a Changelog format (Added / Changed / Fixed).
- **Where.** `package.json`, `CHANGELOG.md`, `README.md`.

## ADR 14. Single instance and a navigation guard

- **Context.** Two app processes would write the same JSON files and clobber each other (ADR 5). Separately, dropping a file (for example a PDF) on the window navigated the renderer away from the app, leaving `window.sayfern` exposed to that page.
- **Decision.** `app.requestSingleInstanceLock()`; a second launch focuses the existing window. A `will-navigate` handler allows only hash changes within the current page and opens web links in the browser; `setWindowOpenHandler` denies new windows.
- **Where.** `src/main/index.ts`.

## ADR 15. UI design language and a mock-backed renderer

- **Decision.** "Paper, fern and red pen": paper `#F4F0E7`, ink `#1C1E1B`, fern `#2E5B45`, deep-green sidebar `#173E35`, red pen `#A63D22`. Instrument Serif for display, Geist Sans for UI, Geist Mono for numbers, Noto Serif SC / JP for CJK, all bundled through `@fontsource` (the CSP blocks remote fonts). No em dashes in UI copy. The renderer runs against a complete mock API in a plain browser (`npx vite --config vite.mock.config.ts`, switches `?onboarding=1`, `?fresh=1`, `?anki=offline`), so UI work needs neither Electron nor credentials.
- **Consequences.** Every API change must also be made in the mock (`src/renderer/src/dev/mockApi.ts`), or the mock server breaks at type level. Design wireframes for all stages live in `design/wireframes` in the owner's copy (Design Component `.dc.html` sources; the live canvas link is in its README); that folder is not in this checkout.
- **Where.** `src/renderer/src/styles.css`, `src/renderer/src/main.tsx`, `src/renderer/src/dev/mockApi.ts`, `vite.mock.config.ts`.

## ADR 16. Prompt rebuilt from records every turn; openings use a hidden kickoff

Recorded from the code (not from a separate discussion).

- **Decision.** The system prompt is rebuilt at the start of every turn from local records (levels, profile, follow-up grammar, targets, Anki overview, catalogue, reading passage), so the tutor "remembers" without long transcripts. Practice, reading and placement sessions open with the tutor speaking first: main starts a turn whose user message `(The learner opened a <kind> session. Start.)` exists only in the provider transcript.
- **Consequences.** Memory lives in records, not in the context window. The transcript itself is not trimmed yet (roadmap). A learner message sent while an opening is running is rejected.
- **Where.** `src/core/agent/prompt.ts`, `src/core/agent/turn.ts` (`runOpening`, `kickoffText`), `src/core/app/index.ts` (`viewWithOpening`).

## ADR 17. Display name "Sayfern", internal name `sayfern`; rebrand the dev Electron.app

- **Context.** In `npm run dev` the app runs inside node_modules' `Electron.app`, so macOS showed "Electron" and Electron's icon in the Dock, menu bar and Cmd-Tab. Electron names both the userData folder and the Keychain item for `safeStorage` (`<app.name> Safe Storage`, set in `ElectronBrowserMainParts::PostCreateMainMessageLoop`) after `app.name`.
- **Decision.** Keep `app.name` = `sayfern` (package.json `name`, no `productName`, no `app.setName`) so existing data and encrypted credentials stay reachable. Show "Sayfern" through the menu labels and About panel, and in dev patch `Electron.app`'s Info.plist and icon with `scripts/brand-electron-app.mjs`, re-signing ad hoc because the edit breaks Electron's signature. Icon: the sidebar fern on the sidebar green, source `build/icon.svg`.
- **Consequences.** After the first rebrand macOS may ask again for Keychain access (the code signature changed); Always Allow fixes it. The process in Activity Monitor is still "Electron" in dev. A future packager config must set the bundle name and icon but must not change `app.name`.
- **Where.** `src/main/index.ts` (`setUpBranding`), `scripts/brand-electron-app.mjs`, `build/`, `package.json` scripts.
