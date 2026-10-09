# Architecture decisions

Short ADR-style records of the choices behind Sayfern. Each has context, the decision, and its consequences. ADRs 1 to 17 were made on 2026-09-30 during the Stage 1 build (v0.1.0 to v0.3.1) unless noted; ADRs 18 to 21 come from the Stage 2 build (v0.5.0). When a decision changes, add a new entry that supersedes the old one instead of editing history.

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
- **Update (v0.9.0).** Models that skip the call get one tool-only evidence pass after the reply (ADR 25).

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

## ADR 18. Stage 2 API in per-feature slots, bound with `bindSlot`

Stage 2 build (v0.5.0, 2026-09-30 to 2026-10-01). Extends ADR 4 and ADR 15.

- **Context.** Stage 2 was built by three agents in parallel (review, quizzes, builder). One shared `SayfernApi`, `SayfernApp`, `mockApi.ts` and `styles.css` would have meant constant merge conflicts in the same files.
- **Decision.** Each feature owns a slot file in `src/shared/stage2/` (an interface plus a `Record<method, true>` table such as `REVIEW_METHODS`). `SayfernApi` extends the slot interfaces and `METHOD_TABLE` spreads the tables, so the compile-time "every method listed" check still holds. Each feature's core service (`src/core/review`, `quiz`, `builder`) takes one shared `Stage2Deps` and is bound onto `SayfernApp` with `bindSlot`, which throws at startup if a listed method is missing. The mock backend and the stylesheet are split the same way: `dev/mock{Review,Quiz,Builder}.ts` over a shared `dev/mockWorld.ts`, and `src/renderer/src/styles/{review,quiz,builder}.css` next to `styles.css` (which keeps the tokens).
- **Consequences.** Preload and main's IPC loop needed no per-method changes. The API checklist has a second path (slot → service → feature mock). `Stage2Deps` holds concrete Stage 1 classes rather than `contracts.ts` interfaces, a deliberate shortcut: Stage 2 services are app-internal, not extension points. The "one CSS file" rule of ADR 15 is replaced by "tokens in `styles.css`, one stylesheet per Stage 2 feature".
- **Where.** `src/shared/stage2/`, `src/shared/api.ts`, `src/core/stage2.ts`, `src/core/app/index.ts`, `src/renderer/src/dev/`, `src/renderer/src/styles/`.

## ADR 19. Quiz evidence is kept apart from conversation evidence (S2-09)

Stage 2 build (v0.5.0); follow-up fix 2026-10-01.

- **Context.** Quiz answers are linked to grammar points and should count as practice, but a quiz question is a prompt: answering "除了…还…" in a multiple-choice item says little about using the pattern unprompted. Mixing them in would inflate rates and states (ADR 9's numbers would stop meaning "in conversation").
- **Decision.** `finishQuiz` records observations with `origin: "quiz"`, `quizId`, `sessionId: "quiz:<id>"`, `assistance: "prompted"` and deterministic ids. `summarizeGrammar` counts them separately (`GrammarSummary.quiz`); they never change conversation counts, rate or `lastUsedAt`, never make a point "independent" (a correct quiz answer can at most move "introduced" to "with help"). Follow-ups on Today and in the tutor prompt use conversation verdicts only (`lastConversationVerdicts`), so a quiz answer can't hide a recent conversation miss or steer what the tutor brings back. Revealed answers are not evidence; quiz text is never learner words.
- **Consequences.** The Grammar page shows quiz results on their own line ("In quizzes: X of Y right"). Deleting a quiz deletes its evidence. Model-made quiz items are trusted only after local validation (`validateItem`); when an item is ambiguous, such as a multiple-choice key missing from four or more options, it is dropped rather than repaired.
- **Where.** `src/core/quiz/index.ts` (`finishQuiz`), `src/core/records/grammar.ts` (`isQuizObservation`, `summarizeGrammar`), `src/core/agent/prompt.ts` (`lastConversationVerdicts`), `src/core/quiz/items.ts`.

## ADR 20. Anki export through Sayfern-owned note types (S2-03)

Stage 2 build (v0.5.0).

- **Context.** The roadmap first planned a note type and field mapping in Settings > Anki. Learners' note types vary (names, fields, languages of the Anki UI), and mapping a cloze card onto an arbitrary type is fragile.
- **Decision.** Export creates and reuses two note types of its own through AnkiConnect: "Sayfern Cloze" (a real cloze type) and "Sayfern Recall" (Sentence, Prompt, Explanation, Source; the sentence first so Anki's duplicate check is on the sentence). The deck is chosen in the export panel and remembered per language (`AnkiConfig.exportDecks`). Cloze drafts are built locally; situation prompts use one batched model call with a local fallback. Duplicates are checked before adding; notes are tagged `sayfern`, `sayfern::<kind>` and the grammar id. The learner's wrong sentence never appears on a card.
- **Consequences.** Works with any collection and locale, no setup. If a learner edits a Sayfern note type in Anki, adding fails per card with Anki's message; Sayfern does not repair it. No Settings field for the export deck.
- **Where.** `src/core/review/cards.ts`, `situations.ts`, `src/core/review/index.ts`, `src/core/anki/index.ts` (`ensureNoteType`, `ensureDeck`, `addNotes`).

## ADR 21. Feature builder trust model: sandboxed UI, approve-before-run full access

Owner decision, 2026-09-30 ("Sandboxed UI + review"); hardened in review before v0.5.0. Supersedes the "no sandbox" note of F-09 for built features.

- **Context.** The builder (S2-10..S2-13) lets the learner's model write code that Sayfern then runs. Hand-installed extensions (ADR 1, `docs/extensions.md`) run with full app privileges; doing the same for model-written code would hand the model the learner's Mac account.
- **Decision.**
  - **Sandboxed UI.** Built screens and activities run in `<iframe sandbox="allow-scripts">` from `sayfern-feature://<id>/v<n>/`, with a strict CSP (`default-src 'none'`, scripts only from the feature, `connect-src 'none'`, no eval) and reach Sayfern only through a small SDK whose calls are allowlisted in the renderer and validated again in core.
  - **Network-locked sessions.** The app window's default session points at a dead proxy, keeps WebRTC on that proxy, and gives sub-frames no permissions; sub-frames can't navigate outside `sayfern-feature:`. Main's own HTTP uses a separate `sayfern-net` session.
  - **Sandboxed test runner.** Feature tests are unapproved code, so they never run in the app process: a hidden, sandboxed, preload-less window on an in-memory locked-down session runs them (8 s limit). The `node --permission` child-process runner is only for unit tests, smoke and dev (it does not block the network). Counts come from the runner, never the model.
  - **Approve before run.** Code that needs full access (tutor tools, prompt additions, language packs) runs only after the learner reads it in the review sheet and approves that exact version. Every script outside `ui/` is flagged as full access. Such code may import only its own files statically (no `require`, computed `import()`, `eval`, `new Function`, `node:vm`, `process.dlopen`).
  - **Frozen approved copies.** Approval stores the content hash and freezes a read-only copy in `approved/<hash>/`. The host loads full-access code only from that copy, re-hashing it at every load, never from `versions/` (which builds write to). Versions are sealed (hashed, never rewritten) when their build ends; a per-feature lock and exclusive version folders stop two builds from sharing a version.
- **Consequences.** UI-only features need no review and can't read files or reach the network. Approved full-access code still has full access: the static checks are textual and the human review is the real boundary. Feature frames share the app's renderer process (no Node, context isolation on). Verified headless in Electron 44 on Linux (`SAYFERN_E2E_BUILDER=1`, `--no-sandbox` only because the container runs as root); the macOS OS sandbox is still to check. Hand-installed extensions are unchanged.
- **Where.** `src/core/builder/` (`paths.ts` CSP, `manifest.ts`, `store.ts`, `rpc.ts`, `runner.ts`, `index.ts`), `src/core/extensions/index.ts` (`setManagedSource`, review gate in `loadOne`), `src/main/features.ts`, `src/main/index.ts`, `src/renderer/src/components/FeatureFrame.tsx`, `docs/extensions.md`.

## ADR 22. Anki deck generator: AnkiConnect, local checks, free voices from Node (S2-14..S2-16)

Owner request, 2026-10-01: the welcome page should push Anki hard (shared decks or a generated deck), and generating should work like /ankigen but with Sayfern's tooling, with ElevenLabs audio when the learner connects an account and edge-tts voices otherwise.

- **Context.** /ankigen builds a standalone `.apkg` with Python (genanki, edge-tts) and relies on the model's self-check for readings. Sayfern already talks to Anki through AnkiConnect, has CC-CEDICT and JMdict, pinyin-pro and kuromoji, and knows which words the learner has in Anki.
- **Decision.**
  - **Straight into Anki** through AnkiConnect (owner choice): a new deck per project and a Sayfern-owned note type, "Sayfern Vocab" (same reasoning as ADR 20). No `.apkg` writer and no new dependency. Anki must be open to add cards; planning and samples work without it.
  - **Form and preview, then batches** (owner choice), not a chat: the model only writes words and card text as strict JSON. Sayfern checks every card (dictionary reading first, then the reader, the model's reading only when nothing contradicts it), builds the ruby itself, and drops cards it can't use. Batches of 25, saved after each one; the word list grows as batches need it, instead of curating 2000 words up front.
  - **Skip known words** using the cached snapshot (`checkWords`), and follow the new deck in `AnkiConfig.decks` after its first batch so the tutor uses it.
  - **Audio.** ElevenLabs with the learner's own key (stored like an API-key sign-in, `credentials.json`, encrypted), Flash v2.5; Edge's read-aloud voices otherwise and as the fallback when credits run out. Edge is spoken from Node over its websocket protocol (ported from edge-tts 7.2.8: Sec-MS-GEC token, `Origin` header), so no Python is needed.
- **Consequences.** Readings of words missing from the dictionary still depend on the reader and the model (the card says so). The Edge service is unofficial: if Microsoft changes the handshake, bump the constants in `tts.ts` from the latest edge-tts; cards are still added without audio meanwhile. A deck made here can't be shared as a file from Sayfern (Anki can export it). Credit estimates count one credit per character, which overestimates Flash.
- **Where.** `src/core/decks/`, `src/shared/stage2/decks.ts`, `src/core/anki/index.ts` (`storeMedia`), `src/renderer/src/screens/Decks.tsx`, `Onboarding.tsx` (`AnkiStep`).

## ADR 32. An English dictionary for every interface language (v0.20.0)

Owner request, 2026-10-09: add an English dictionary.

- **Context.** English had a dictionary only with an interface in a WikDict language (es, fr, de, it, pt, ru, ja). With an English, Chinese, Korean or Vietnamese interface it had none, so ADR 31 skipped it and ADR 30 fell back to the short word lists.
- **Decision.**
  1. **Open English WordNet** (2025 edition, CC BY 4.0, 9 MB JSON zip from the project's GitHub release) as the English–English dictionary: definitions in English, which suits the 1-to-infinity learner (ADR 29). It is the only choice for English, Korean and Vietnamese interfaces and the last fallback for the others. Up to 3 senses per part of speech (lookups show 3); the part of speech with the most senses first.
  2. **WikDict English–Chinese** for zh-Hans and zh-Hant interfaces (5 MB, 30,743 words, simplified and traditional mixed).
  3. **Dictionaries know their gloss language** (`glossLanguage`). WordNet's glosses are English, the language learned: they never mark words as own-language, and the "same meaning" check runs only with bilingual dictionaries. This also fixes a German speaker learning Spanish with only the Spanish–English fallback installed: English gloss words no longer count as their own language.
- **Consequences.** Every learning language now has a dictionary for every interface language, so ADR 31 downloads one for everyone. WordNet has no function words (the, of, I): lookups find nothing for them, and the filter takes them from the built-in English list. WordNet costs 16 MB on disk and about 94 MB of memory when loaded. No English–Korean or English–Vietnamese pair exists yet (roadmap gap 24).
- **Where.** `OewnProvider`, `parseOewn`, `OEWN_URL`, `glossLanguage` in `src/core/lang/wordlists.ts`; `choices` and `wordIndex` in `src/core/lang/index.ts`.

## ADR 31. Dictionaries are required and download by themselves (v0.18.0)

Owner request, 2026-10-08: dictionaries should be mandatory to install.

- **Context.** ADR 30 tells the learner's own language from the target language with the dictionary; without one, short built-in lists decide, and rare own-language words slip through. Dictionaries were optional and installed by hand.
- **Decision (owner choice: auto-install, no gate).** After onboarding, Sayfern downloads the preferred dictionary of every language the learner learns, in the background, one at a time: at startup, and when the languages or the interface language change. Sessions are never blocked; the built-in lists cover the download time, then the language's words are recounted. Pairs with no dictionary (English with a Chinese, Korean or Vietnamese interface) keep the lists. A failed download stays on the status and is tried again at the next startup.
- **Consequences.** 4 to 22 MB of download per language. A loaded dictionary costs memory (WikDict Spanish–English: about 80 MB of heap, plus about 10 MB for the gloss-word set ADR 30 builds on first use); a dictionary is loaded only when its language is used (session, lookup) or recounted, but a fresh download stays loaded until the app quits. A failure keeps the old Install button as a retry.
- **Where.** `ensureDictionaries`, `setSettings`, `installDictionary` in `src/core/app/index.ts`; Settings > Dictionaries subtitle.

## ADR 30. Only the target language counts as learner words (v0.17.1)

Owner report, 2026-10-08: a beginner's own language must never count toward their learned words. With ADR 29, beginners write in their own language, and in Latin-script pairs every English word became a "Spanish word you wrote".

- **Context.** `learnerWords` returned every word-like token. Chinese and Japanese packs already dropped Latin letters, but a Japanese clause counted as Chinese, English counted in Korean and Russian sessions, and in Latin-script pairs nothing separated the two languages.
- **Decision (owner rule).** Use the dictionaries, in code only (owner choice: no help from the tutor model).
  1. **Script first.** A word in the wrong script never counts (Latin in Korean or Russian; in Chinese, a clause with kana).
  2. **Per word, from the dictionary.** Target only: counts. In both languages with the same meaning (the dictionary's glosses for it contain the word itself: hotel, chocolate, no): counts, since the word works the same in both. Own language only: never counts.
  3. **Unclear words follow their clause.** Single letters, words in neither list, and words in both with another meaning (Spanish a = to) count only when the clause has no own-language words, or fewer than target words. Clauses split at sentence ends and at commas, colons, brackets, quotes and dashes, where learners switch language.
  4. **Sources.** Target: the installed dictionary's headwords and lemmas, plus built-in common words (`common-words.ts`, which also cover contractions some dictionaries lack). Own: words used in the dictionary's glosses (the gloss language is the interface language) plus the interface language's common words. Without a dictionary, the lists decide alone.
  5. **Clean up once.** At startup, `SayfernApp` recounts every stored learner message per language with the new filter (`recountLearnerWords`) and rebuilds word usage. It runs again only when the key changes: `WORD_FILTER_VERSION` or the installed dictionary (installing one recounts that language).
- **Consequences.** "Words you wrote", distinct words and "Words you used for the first time" drop for learners who wrote in their own language; first-use dates can move later. Anki targets already marked `used` stay as they were. Known limits: roadmap gap 27.
- **Where.** `learnerWords`, `side`, `keepTarget` in `src/core/lang/spaced.ts`; `src/core/lang/common-words.ts`; `glossWord`, `glossWordsOf` in `wordlists.ts`; `wordIndex` in `src/core/lang/index.ts`; `ChinesePack.learnerWords`; `recountLearnerWords` in `src/core/records/store.ts`; `recountWords`, `WORD_FILTER_VERSION` in `src/core/app/index.ts`.

## ADR 29. Mission: from 1 to infinity; beginners may use their own language; a level band before placement (v0.17.0)

Owner report, 2026-10-08: Sayfern is not the best tool to take a learner from zero to their first words (0 to 1). It is best at taking someone who already knows some of the language much further (1 to infinity). A placement chat in a language the owner did not know at all went badly: the tutor wrote in the language and expected answers.

- **Context.** Placement always ran 5 to 7 exchanges of rising difficulty in the target language, with no idea where to start. The persona told the tutor to invite every learner who wrote in another language back to the target language, even a learner with no words yet.
- **Decision.**
  1. **Mission (1 to infinity).** Sayfern is for learners who know some of the language and want to keep going through conversation, up to advanced. Absolute beginners are welcome, but the app does not try to replace a first course: it points them to the first course unit, the most common words in Anki, and very simple chat. The welcome page's Anki step already says this ("Sayfern assumes you can read some words").
  2. **Beginners may write in their own language.** When the learner is a beginner (lowest quarter of the scale, `isBeginner`), the persona says writing in the interface language is welcome, not a mistake: the tutor answers in very simple target language, shows how to say what they meant, and may add a short gloss for a key word. Other learners keep the old rule.
  3. **A level band before placement.** Before a placement chat, the learner picks Beginner, Intermediate or Advanced (`LevelBand`, saved as `SessionMeta.levelBand`). Each band is a third of the level scale (`bandLevels`: CEFR A1-A2, B1-B2, C1-C2). The diagnostic starts in that band. As a beginner it is gentle: instructions in the learner's language, a check for any words at all, and an early stop with the lowest level when they know nothing.
- **Consequences.** Placement estimates still come from `record_evidence` (S1-25): the band only sets the start, never a level. A beginner's own-language words were then recorded as learner words; ADR 30 fixes that. Sessions without a band (old ones, `newSession({ kind: "placement" })`) keep the old diagnostic.
- **Where.** `README.md`, `AGENTS.md` (mission); `LevelBand`, `LEVEL_BANDS` in `src/shared/records.ts`; `bandLevels` in `src/shared/languages.ts`; `placementBlock`, `isBeginner`, `otherLanguageRules` in `src/core/agent/prompt.ts`; `startPlacement(language, band)`; `components/PlacementStart.tsx` (Today, Settings > Languages, Onboarding).

## ADR 28. Packaging with electron-builder; CI releases on push to main; Flatpak from the tar.gz (v0.16.0)

Owner request, 2026-10-07: a .dmg, an .exe and a Flathub-ready Flatpak, built automatically after each push to `main`.

- **Decision.**
  1. **electron-builder** (owner choice over Electron Forge): one config for dmg, NSIS and tar.gz. `productName` names only the bundle; `app.name` stays `sayfern` (ADR 17).
  2. **One CI machine per OS and CPU** (macOS arm64 and x64, Windows x64, Linux x64): `@napi-rs/canvas` (pdf.js) is a native package per platform, so cross-builds would ship the wrong binary.
  3. **A release only for a new version.** Every push builds artifacts; the `release` job publishes `v<version>` only when that release does not exist, with the CHANGELOG section as notes (ADR 13 already makes every change bump the version).
  4. **macOS ad-hoc signature** until there is an Apple Developer ID: unsigned bundles are "damaged" on Apple silicon.
  5. **The Flatpak repackages the release tar.gz** on the Electron base app instead of building from source on Flathub (that would need every npm package as an offline source). `scripts/flatpak.mjs` writes the CI and the Flathub variants from one manifest; `x-checker-data` lets Flathub's bot follow new releases.
- **Consequences.** Learners see Gatekeeper and SmartScreen warnings until signing is set up. Flathub needs a public repository and a one-time manual submission. No ARM builds for Windows and Linux yet. Each push to `main` uses macOS CI minutes (10 times the Linux rate on private repositories).
- **Where.** `electron-builder.yml`, `build/entitlements.mac.plist`, `.github/workflows/release.yml`, `flatpak/`, `scripts/flatpak.mjs`, `docs/packaging.md`.

## ADR 27. Full-syllabus courses for Chinese and English; European Portuguese (v0.14.0)

Owner request, 2026-10-07: build complete courses for Chinese and English that follow the HSK and the English Grammar Profile fully (the themed courses covered about 100 points each); teach European Portuguese instead of Brazilian; add a European Portuguese interface.

- **Decision.**
  1. **Every source point, once, at its level.** zh: the 573 points of the HSK 3.0 grammar syllabus. en: the 1,239 points of the English Grammar Profile. Each `CourseGrammar` carries `ref` (its source number); a test checks the coverage.
  2. **Units follow the source's own groups** inside each level (owner choice), 3 to 12 points each, instead of can-do themes: the units are easy to check against the source, and title translations stay few (102 new titles). Repeated titles inside a level ("Adverbs" at HSK 7-9) are told apart by their patterns.
  3. **EGP text is not copied** (owner choice): only numbers, levels and categories; every name, note and example is Sayfern's own.
  4. **New unit ids** (`zh-hsk30-…`, `en-egp-…`); grammar ids reuse the old ones where a source point matches (98 of 121 for zh, 79 of 102 for en), so old records still count. The rest were items inside list points (最 in a list of degree adverbs) or patterns the source does not list on their own.
  5. **Portuguese = European Portuguese** (`pt-PT`: variety, Edge voices `pt-PT-RaquelNeural` / `pt-PT-DuarteNeural`, quiz and deck prompts, `tu` with the learner); QuaREPE now matches the variety. A `pt-PT` interface locale joins `pt-BR`.
- **Consequences.** Old Chinese and English unit sessions (`zh-hsk2-04`, `en-a1-01`) no longer match a unit: they still open, without the unit block. A unit is done only when every point is `independent`, so full-syllabus units take longer. The tool overview is capped at 40 units. Notes were model-written and need a teacher's review.
- **Where.** `src/shared/course/zh.ts`, `en.ts`, `pt.ts`; `CourseGrammar.ref`; `overviewText` in `src/core/course/index.ts`; `src/shared/locales.ts`, `src/shared/i18n/pt-PT.ts`; `LANGUAGE_META.pt`; `docs/courses.md`.

## ADR 26. Course per language: units in textbook order, status from records (v0.10.0)

Owner report, 2026-10-06: conversations feel dull; the tutor stays on simple topics far too long and does not know when to move on. Asked for a per-language plan of where a learner should be at each level, based on the textbooks, shown Duolingo-style, with languages that have no plan marked Beta.

- **Context.** The tutor knew a level label ("HSK 3") but not what comes at that level or next. Its grammar catalogue held only points the learner had already used, so nothing pulled it forward. The persona also fixed every reply at 1 to 3 short sentences, and nothing told it when a topic was used up.
- **Decision.**
  1. **One data file per language** (`src/shared/course/<lang>.ts`): units in the order of one well-known textbook or syllabus, grouped by level, each with grammar points, topic ideas and core words. Titles, goals and notes are written for Sayfern; the textbook gives only the order. Grammar ids are the ids `record_evidence` already uses, so old records count.
  2. **Status from records only** (S1-25): a unit is done when every point is `independent`; started when any point was seen or a unit session opened. No model ever marks a unit done, and quiz answers cannot finish one (S2-09).
  3. **All units open.** No locks: "Up next" (first unit not done from the learner's level on) is a suggestion. Learners who know more than the placement says are not blocked.
  4. **The tutor sees little by default.** Chat prompts carry only the next unit and up to 3 of its open points; the full course is behind the `course` tool, and a course unit session gets the whole unit. This keeps the per-turn prompt small.
  5. **Beta = no course.** Native support costs a lot per language (order, ids, notes, 12 translations of every title), so it comes one language at a time. Languages without a file show a Beta chip and keep the old behavior.
  6. **Pacing by counted facts.** The prompt states how many learner replies the topic has run and how many were clean (`computePacing`, from stored messages and corrections); at 5 replies or 3 clean ones it tells the tutor to move on. `record_evidence.topic_change` restarts the count (`ChatMessage.topicStart`). Reply length grows with the level (`lengthRule`).
- **Consequences.** Only Chinese has a course in v0.10.0; Japanese, Korean and French followed in v0.11.0; Spanish, English, Italian, German and Portuguese in v0.13.0 (Russian and Vietnamese stay Beta). Adding a language is data plus translations, no code ([`courses.md`](courses.md)). Unit and grammar ids are now a contract: renaming one orphans records and sessions. The benchmark measures the effect (engagement, pacing, level fit; `zh-pacing`, `zh-level-fit`).
- **Update (v0.10.1).** The pacing runs exposed empty replies: Sonnet 5.5 wrote its reply inside its thinking, called `record_evidence` first, then ended the turn. When a recording-only tool runs before any reply text, its result now says the learner has not seen a reply (`NO_REPLY_YET`).
- **Where.** `src/shared/course/`, `src/core/course/`, `src/core/agent/prompt.ts` (`courseBlock`, `pacingBlock`, `computePacing`, `lengthRule`, unit session block), `tools.ts` (`topic_change`, `course` tool), `turn.ts` (`topicStart`, `NO_REPLY_YET`), `src/renderer/src/screens/Course.tsx`, `components/BetaChip.tsx`; tests in `src/core/course/course.test.ts`, `prompt.test.ts`, `turn.test.ts`.

## ADR 25. Evidence pass for models that skip record_evidence (v0.9.0)

Owner report, 2026-10-03: corrections never appear with GPT Sol and Astra (ChatGPT sign-in); Sonnet records them well.

- **Context.** pi-ai only offers `toolChoice` "auto" or "none", so a tool call can't be forced. GPT models treat their final answer as the end of the turn: after writing the reply they rarely call `record_evidence`, and the old prompt let them skip it "if there is nothing to record".
- **Decision.** (1) The prompt asks for the call on every learner turn, empty when there is nothing to record. (2) When a learner turn ends with reply text and no `record_evidence` call, models that need it (`needsEvidencePass`: everything except Claude) get one more request with `record_evidence` as the only tool and a hidden nudge (`EVIDENCE_NUDGE`). Its text is ignored; its call runs like any other; its usage counts. The nudge and the pass never enter the stored transcript. Any failure is swallowed: the reply stands. (3) Tool arguments sent as JSON text are parsed.
- **Consequences.** GPT turns cost one extra small request when the model skips the call. Corrections show up after the reply text instead of with it. Claude behaves as before (one request per turn).
- **Update (v0.9.1).** GPT can also write the call into its reply text in its internal chat format (`<|assistant to=functions.record_evidence ...{json}`). `leak.ts` finds the marker; the stream holds text back from it, the reply and the transcript keep only what comes before, and the JSON is run as a real call to a recording-only tool. A salvaged `record_evidence` counts, so no evidence pass follows.
- **Where.** `src/core/agent/turn.ts` (`evidencePass`), `leak.ts`, `options.ts` (`needsEvidencePass`), `prompt.ts` (`TOOL_PROTOCOL`), `text.ts` (`arr`, `obj`); tests in `turn.test.ts`, `options.test.ts`.

## ADR 24. Voice: ElevenLabs account pool, Scribe push-to-talk, Edge fallback (v0.8.0)

Owner request, 2026-10-03: voice output first (ElevenLabs text to speech), then voice input with ElevenLabs Scribe (same key, push to talk, transcript fed into the text session); allow several ElevenLabs accounts with a + button.

- **Decision.**
  - **One account pool** (`ElevenLabsAccounts`) for deck audio and voice, accounts tried in the learner's order. Benching is per account for credits (until the reset date when known, else 6 h), one minute for 429, and per job (tts or stt) for a refused key or missing permission, so a key without Speech to Text still reads aloud. Network failures stop at once instead of burning through every account.
  - **Transcript into the text flow**, not a separate voice conversation: a spoken message is a normal learner message with `spoken: true`, so corrections, evidence and statistics work unchanged. The model gets a `[spoken]` marker and a rule not to treat transcription slips as errors; transcription is never evidence of pronunciation (S3-04).
  - **Text left in the box by default** (owner can turn on "Send right after transcribing"). With auto-read and auto-send on, the session becomes a spoken conversation without a realtime API.
  - **Slow playback in the player** (`playbackRate` with pitch kept), not a second synthesis: no extra credits, works with both services.
  - **Multipart body built by hand** for Scribe so it works through Electron's `net.fetch` (the renderer has no network; audio crosses IPC as bytes).
  - **Whole messages without a language code**: tutor replies mix the target language with explanations; words and sentences keep it.
- **Consequences.** Voice settings and accounts are global, not per language. Speaking time is clip length, listening time is play time; neither is idle-filtered. The cache is bounded by file count, not size. Scribe is told the session's language, which may hurt code-switching (the learner asking something in English).
- **Where.** `src/core/voice/` (`accounts.ts`, `stt.ts`, `index.ts`), `src/shared/stage3/voice.ts`, `src/renderer/src/lib/voice.ts`, `components/Speak.tsx`, `Composer.tsx`, Settings > Voice.

## ADR 23. Eleven learning languages, twelve interface locales, no i18n dependency (v0.7.0)

Owner request, 2026-10-01: support English, Chinese, Japanese, Korean, Vietnamese, Russian, French, Italian, Spanish, German and Portuguese as learning languages (Tagalog and Arabic dropped: models are weaker there), localize the interface, follow the system language by default, allow any pairing. Owner choices: full parity now (offline dictionaries for every language), Simplified and Traditional Chinese interfaces.

- **Decision.**
  - **Own i18n, English text as keys** (gettext style) instead of a library: no new dependency, missing translations fall back to readable English, and core and the renderer share one implementation. Plurals through `Intl.PluralRules`, language names through `Intl.DisplayNames`, context keys for the rare same-word cases.
  - **Explanation language = interface language.** One setting instead of two; a Russian speaker learning Japanese gets explanations in Russian. Prompts name the language explicitly.
  - **Full parity enforced by a test**: every key in every catalog. Catalogs were written by a model per locale with a shared brief (register, Anki's own terms, no em dashes) and should get a native-speaker pass.
  - **Dictionaries per pair, downloaded on demand**, preferring glosses in the interface language: JMdict (5 gloss languages), WikDict bilingual SQLite (read with built-in `node:sqlite`, so no SQLite dependency), Kengdic, kaikki.org Wiktionary for Vietnamese; English glosses as the fallback.
  - **Lightweight morphology**: `Intl.Segmenter` plus rule-based lemmas checked against the dictionary, instead of per-language analyzers.
- **Consequences.** Lemmas for inflected Spanish, Russian or Korean words are approximate (unknown forms fall back to the surface word). zh, ko and vi glosses are English only; English as the learning language has no dictionary when the interface is zh, ko or vi. The kaikki.org URL is marked deprecated upstream. Changing an English string means updating every catalog (12 since v0.14.0).
- **Where.** `src/shared/languages.ts`, `locales.ts`, `i18n/`; `src/core/lang/`; `scripts/i18n-keys.ts`; `src/core/i18n-catalogs.test.ts`.
