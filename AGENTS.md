# AGENTS.md

Entry point for coding agents (and humans) working on Sayfern. Read this first, then the deep docs linked at the end.

## What Sayfern is

A free, open-source (MIT) macOS app for learning languages (Chinese, Japanese, Korean, English, Spanish, French, German, Italian, Portuguese, Russian, Vietnamese) by chatting with an AI tutor that remembers what the learner is learning. The learner brings their own model (API key, or a Claude Pro/Max or ChatGPT subscription). All records stay on the Mac as JSON files. The interface is translated into 13 locales and follows the Mac's language unless the learner picks one; the tutor explains in the interface language.

- **Mission: from 1 to infinity.** Sayfern is for learners who already know some of the language and want to go much further through conversation. It does not try to replace a first course (0 to 1), but beginners are welcome: they may write in their own language, and placement starts from a band they pick (Beginner, Intermediate, Advanced). Keep new features aimed at the 1-to-infinity learner first. See ADR 29.
- **Version:** 0.22.0. Stage 1 (text learning) and Stage 2 (corrections review, Anki export, quizzes, AI feature builder, Anki onboarding page and deck generator) are built; v0.7.0 added nine learning languages and the translated interface; v0.8.0 started Stage 3 (listening, push-to-talk, several ElevenLabs accounts); v0.9.0 added New topic, the difficulty slider and the evidence pass for GPT models; v0.10.0 added the Course (Duolingo-style units) and pacing (the tutor moves on when a topic is used up); v0.11.0 added courses for Japanese, Korean and French (the other languages are Beta); v0.12.0 asks before a unit whether the tutor should go over its grammar quickly first; v0.13.0 added courses for Spanish, English, Italian, German and Portuguese (Russian and Vietnamese are still Beta); v0.14.0 made the Chinese and English courses follow the full HSK 3.0 grammar syllabus (573 points) and English Grammar Profile (1,239 points), switched Portuguese to European Portuguese and added a pt-PT interface; v0.15.0 redesigned the Course screen around the grammar points (syllabus map, unit grid, unit drawer); v0.16.0 added installers (.dmg, .exe, Flatpak) built by CI on every push to `main`; v0.17.0 stated the mission, lets beginners write in their own language and asks for a level band before placement; v0.17.1 counts only target-language words as learner words; v0.18.0 downloads every learning language's dictionary by itself; v0.19.0 added role-play scenarios on Today and lets Today, Course and Grammar use the full window width. v0.20.0 adds an English dictionary for every interface language (Open English WordNet, WikDict English–Chinese). v0.21.0 sorts corrections into grammar, typo and speaking (ADR 33). v0.22.0 adds a copy button on every chat message. Pronunciation assessment and audio quizzes are next: [`docs/roadmap.md`](docs/roadmap.md).
- **Owner:** Yufeng. Feature IDs (S1-xx, F-xx, S2-xx, S3-xx) come from the owner's project page; [`docs/stage1.md`](docs/stage1.md) maps S1/F IDs and [`docs/stage2.md`](docs/stage2.md) maps S2 IDs and [`docs/stage3.md`](docs/stage3.md) S3 IDs to code.

## Stack

| Layer | Tech |
|---|---|
| Shell | Electron 44 (`electron-vite` 5 for dev/build) |
| UI | React 19, TypeScript 5.9, `styles.css` (tokens) plus per-feature stylesheets in `styles/`, hash router, fonts via `@fontsource` |
| Logic | Plain Node (ESM, TypeScript) in `src/core` |
| Models | `@earendil-works/pi-ai` 0.99.1 (providers, OAuth, streaming, tools) |
| Language | `pinyin-pro`, `kuromoji` (IPADIC), `Intl.Segmenter`; dictionaries downloaded automatically: CC-CEDICT, JMdict (5 gloss languages), Kengdic, kaikki.org Wiktionary (Vietnamese), WikDict (read with `node:sqlite`), Open English WordNet (English) |
| i18n | Own, no dependency: `src/shared/i18n/` (English text as keys, one catalog per locale), `src/shared/locales.ts` |
| Library | `pdfjs-dist` (legacy build, in-process), `jszip` (EPUB, JMdict zip) |
| Storage | JSON files, atomic writes, per-file queues |
| Tests | `node:test` via `tsx --test` |

Node ≥ 22.19. Do not add dependencies without asking the owner.

## Run, test, build

```bash
npm install                      # also patches pi-ai's OAuth page and installs the Electron binary
npm run dev                      # the app (electron-vite dev)
npm run typecheck                # both TS projects (node + web)
npm test                         # all unit/integration tests (~35 s, no network)
npx tsx --test src/core/agent/turn.test.ts   # one file
npm run smoke -- selftest        # offline end-to-end run of SayfernApp with a fake provider
npm run smoke -- chat anthropic "你好！"      # real provider from the terminal (data in ./.sayfern-dev)
npx vite --config vite.mock.config.ts         # UI only, in a browser, mock backend: http://localhost:5174
                                              # add ?onboarding=1, ?fresh=1, ?anki=offline or ?lang=en
npm run build && npm start       # build to out/ and run the built app
npm run dist -- --mac --arm64    # installer in dist/ (.dmg; --win .exe, --linux .tar.gz); CI builds all on push to main (docs/packaging.md)
npm run bench -- selftest        # offline check of the Sayfern vs Claude Code benchmark (docs/benchmark.md)
npx electron-vite build && xvfb-run -a env SAYFERN_E2E_BUILDER=1 SAYFERN_E2E_DATA=$(mktemp -d) \
  node_modules/.bin/electron --no-sandbox out/main/index.js   # headless feature-sandbox check (Linux container)
```

Before you finish any change: `npm run typecheck` and `npm test` must pass.

## Repo map

```
src/shared/        types + the renderer ↔ main contract (api.ts). No runtime deps.
  stage2/          per-feature API slots merged into SayfernApi: review.ts, quiz.ts, builder.ts (+ builder-sdk.ts: SDK JS/CSS), decks.ts
  stage3/          Stage 3 slot: voice.ts (VoiceApi, VOICE_METHODS)
  course/          Duolingo-style course per language: index.ts (types, COURSES, isBeta, unit status, buildCourseView), zh.ts (92 units, all 573 HSK 3.0 points), ja.ts (32 JLPT units),
                   ko.ts (32 TOPIK units); en.ts (215 units, all 1,239 EGP points); es, fr, it, de, pt .ts (32 CEFR units each)
  ruby.ts          ruby segments (pinyin per character, okurigana outside), used by the renderer and deck cards
  scenarios.ts     role-play scenarios on Today (SCENARIOS: scene for the prompt, title, icon)
  languages.ts     LANGUAGE_META: per learning language names, script, font class, levels, titles
  locales.ts       UI locales, system-language matching (matchLocale, effectiveLocale)
  i18n/            translate / translatePlural / translateContext / msg / Translator + one catalog per locale
src/core/          all logic, plain Node, NO electron imports
  contracts.ts     interfaces between core modules
  stage2.ts        Stage2Deps (shared deps for Stage 2 services) + bindSlot
  app/             SayfernApp facade (implements the API) + SettingsStore
  agent/           tutor: prompt, tools, streaming turn loop, retries, translation, end of session
  course/          the `course` tutor tool and unit text for the prompt
  records/         JSON-file RecordsStore: sessions, corrections, grammar, words, levels, stats, export
  lang/            language packs (zh, ja; spaced.ts: SpacedPack, KoreanPack, VietnamesePack; lemma.ts), dictionaries
                   (cedict, jmdict, wordlists.ts: WikDict, Kengdic, kaikki), lookup with per-locale dictionary choice
  library/         txt/md/html/epub/pdf import, paragraphs, checkpoints, BM25 search
  anki/            AnkiConnect client, snapshots, word model + struggle score (words.ts)
  extensions/      user extension host (+ builder-managed features behind the review gate)
  review/          S2-01..03: corrections review list, Anki card drafts (cloze/situation), export
  quiz/            S2-04..09: material, levels, slot planning, generation, item validation, grading, quiz files
  builder/         S2-10..13: builder agent + kit, feature store/versions, manifest checks, sandbox assets, RPC, test runner
  decks/           S2-14..16: Anki deck generator: word list, checked cards (Sayfern Vocab note type), text to speech, batches
  voice/           S3-01..04: ElevenLabs account pool (accounts.ts), Scribe speech to text (stt.ts), VoiceService (speak, transcribe, voice time)
  providers.ts     pi-ai provider registry; credential-file-store.ts: credentials file
src/main/          Electron main: window, dialogs, safeStorage cipher, IPC table; features.ts: sandbox sessions +
                   test runner; e2e.ts: test hooks (SAYFERN_E2E_FAUX, SAYFERN_E2E_BUILDER)
src/preload/       generic bridge: window.sayfern
src/renderer/      React UI; src/renderer/src/dev/mockApi.ts is the in-browser backend, with Stage 2 mock slots
                   dev/mock{Review,Quiz,Builder,Decks}.ts over the shared dev/mockWorld.ts
  src/styles.css   tokens + Stage 1 styles; src/styles/{review,quiz,builder,decks}.css: one stylesheet per Stage 2 feature
scripts/           smoke.ts, brand-oauth-page.mjs, brand-electron-app.mjs, i18n-keys.ts (collects translation keys), flatpak.mjs (Flatpak build folders)
build/             app icon: icon.svg (source), icon.png, icon.icns; entitlements.mac.plist (packaged macOS app)
flatpak/           Flatpak manifest, launcher, .desktop, metainfo (ca.sayfern.Sayfern)
.github/workflows/ release.yml (installers + GitHub release on push to main), pages.yml (website)
examples/          example extensions: chengyu-of-the-day (main-side tool), measure-word-drill (sandboxed tab + activity)
bench/             benchmark vs Claude Code + skill: recording proxy, fake AnkiConnect, scenarios, report
docs/              architecture, decisions, roadmap, stage1/stage2 feature maps, extensions API; builder kit docs:
                   feature-builder.md (the builder's guide) and feature-sdk.d.ts (sandbox SDK types), read by the builder model
```

## Contracts

| Contract | File | Rule |
|---|---|---|
| Renderer ↔ main API | `src/shared/api.ts` (`SayfernApi`, `API_METHODS`, `ChatEvent`, `EVENT_CHANNELS`) | Every method is one `ipc:<method>` channel. `METHOD_TABLE` must list every method (compile-time check). |
| Stage 2 API slots | `src/shared/stage2/review.ts` (`ReviewApi`, `REVIEW_METHODS`), `quiz.ts` (`QuizApi`, `QUIZ_METHODS`), `builder.ts` (`BuilderApi`, `BUILDER_METHODS`, `BuilderEvent`, `FEATURE_RPC_METHODS`, `FEATURE_LIMITS`, `FEATURE_SCHEME`), `decks.ts` (`DeckApi`, `DECK_METHODS`); Stage 3: `src/shared/stage3/voice.ts` (`VoiceApi`, `VOICE_METHODS`) | `SayfernApi` extends the five slot interfaces; each slot's `*_METHODS` table must list its methods (compile-time check) and is spread into `METHOD_TABLE`. `bindSlot` copies them onto `SayfernApp` and throws at startup if one is missing. |
| Feature SDK (sandbox) | `src/shared/stage2/builder-sdk.ts` (`FEATURE_SDK_JS`, `FEATURE_SDK_CSS`), `docs/feature-sdk.d.ts`, `FEATURE_RPC_METHODS` | What built features can call. Public: built features depend on it. Every RPC method is validated again in core (`src/core/builder/rpc.ts`). |
| Domain types | `src/shared/records.ts`, `src/shared/lang.ts`, `src/shared/types.ts` | Types only (plus `LANGUAGES`, `SKILLS`). Stored JSON follows these shapes, so changes need a migration or optional fields. |
| Core interfaces | `src/core/contracts.ts` | `RecordsStore`, `LanguageService`, `LanguagePack`, `DictionaryProvider`, `LibraryService`, `AnkiService` (incl. `ensureNoteType`, `ensureDeck`, `addNotes`, `storeMedia`), `Tutor`, `TutorTool`, `ToolContext`, `ExtensionHost`. Extensions and built features depend on `ToolContext` and `LanguagePack`: treat them as public (they are in the builder kit). |

## How it works in one minute

1. Main (`src/main/index.ts`) builds `SayfernApp` and registers `ipc:<method>` for every `API_METHODS` entry. The preload exposes them as `window.sayfern`.
2. The renderer calls `api.send(sessionId, { text, pastedSpans }, model)`. `SayfernApp.send` returns a `requestId` at once and runs the turn detached.
3. `runTurn` (`src/core/agent/turn.ts`) saves the learner message, records learner words, picks Anki targets once per session, rebuilds the system prompt from records (`prompt.ts`), and streams the model through pi-ai. Tool calls run between iterations (max 5); `record_evidence` stores corrections, grammar observations, taught patterns and level estimates.
4. Progress arrives as `ChatEvent`s on `evt:chat`: `user_saved`, `delta`, `tool`, `correction`, then `done` (with the canonical `SessionView`) or `error`. `src/renderer/src/lib/chatStream.ts` keeps in-flight turns outside React; `useChat` merges them with the stored view.
5. Everything the learner sees as a number comes from `src/core/records/stats.ts`, `grammar.ts` and `src/core/anki/words.ts`.

Stage 2 services (`ReviewService`, `QuizService`, `BuilderService`, `DeckService`) get one `Stage2Deps` and their slot methods are bound onto `SayfernApp`, so IPC treats them like any other method. Quiz generation and deck projects are polled (`getQuiz`, `getDeckProject`); builds stream `BuilderEvent`s on `evt:builder`. Built feature UIs load from `sayfern-feature://` into sandboxed iframes and call back through `featureCall`.

Practice, reading and placement sessions open with a tutor turn started by main (hidden kickoff message in the transcript only). Full flows: [`docs/architecture.md` section 11](docs/architecture.md#11-end-to-end-flows).

## Data on disk

`~/Library/Application Support/sayfern/` (Electron `userData`): `credentials.json` (encrypted), `settings.json`, `records/` (one JSON file per session in `records/sessions/`, one per quiz in `records/quizzes/`, one per deck project in `records/decks/`, cached deck audio in `records/deck-audio/`, one file per record kind), `dict/`, `library/<docId>/`, `anki/`, `extensions/`, `extensions.json`, `builder/features/<id>/` (versions, approved copies, `feature.json`; kept by erase) and `builder/data/<id>/` (feature storage and results; erased). The smoke script uses `./.sayfern-dev/` with plain-text credentials. Layout and JSON examples: [`docs/architecture.md` section 7](docs/architecture.md#7-disk-layout).

## Where to change what

| If you need to... | Touch |
|---|---|
| Add or change an API method | Stage 1 surface: `src/shared/api.ts` (`SayfernApi` + `METHOD_TABLE`) → `src/core/app/index.ts` (`SayfernApp`) or `electronOnly` in `src/main/index.ts` if it needs dialogs/shell → `src/renderer/src/dev/mockApi.ts` → the UI. Stage 2 feature: its slot in `src/shared/stage2/<feature>.ts` (interface + `*_METHODS`) → its service in `src/core/<feature>/index.ts` (bound by `bindSlot`) → `src/renderer/src/dev/mock<Feature>.ts` → the UI. Preload and main's IPC loop pick both up automatically; a new event channel also needs `EVENT_CHANNELS` and an `on*` line in `src/preload/index.ts`. |
| Change what the tutor is told | `src/core/agent/prompt.ts` (`renderSystemPrompt` blocks, `gatherPromptData`); tests in `prompt.test.ts` |
| Add a tutor tool | `src/core/agent/tools.ts` (`turnTools`) or `anki-tools.ts`; decide `recordingOnly`; update the tool protocol text in `prompt.ts` if the model needs to know |
| Change the turn loop, streaming, errors, abort | `src/core/agent/turn.ts`; tests in `turn.test.ts` and `src/core/app/app.test.ts` |
| Change token caps / reasoning effort | `src/core/agent/options.ts`, constants in `turn.ts` |
| Change which models get the evidence pass | `needsEvidencePass` in `src/core/agent/options.ts`; the pass itself is `evidencePass` / `EVIDENCE_NUDGE` in `turn.ts` |
| Change when the tutor moves on, or reply length | `pacingBlock` / `computePacing` (`MOVE_ON_TURNS`, `EASY_STREAK`) and `lengthRule` in `src/core/agent/prompt.ts`; `topic_change` in `record_evidence` (`tools.ts`) sets `ChatMessage.topicStart` in `runLoop` (`turn.ts`) |
| Add or change a language's course | Follow [`docs/courses.md`](docs/courses.md). `src/shared/course/<lang>.ts` + `COURSES` in `src/shared/course/index.ts` (no course = Beta); unit titles in all 12 catalogs; checks in `src/core/course/course.test.ts`; tool and unit text in `src/core/course/index.ts`; course block and unit session block in `prompt.ts`; UI `screens/Course.tsx`; status list in `docs/roadmap.md` |
| Change when dictionaries download | `ensureDictionaries` (and its triggers in `init`, `setSettings`) in `src/core/app/index.ts`; ADR 31 |
| Change what counts as the target language (learner words) | `learnerWords`, `side`, `keepTarget` in `src/core/lang/spaced.ts`, `src/core/lang/common-words.ts`, `ChinesePack.learnerWords`; bump `WORD_FILTER_VERSION` (`src/core/app/index.ts`) so stored words are recounted (`recountLearnerWords`); ADR 30 |
| Change placement or the beginner rules | `placementBlock`, `isBeginner`, `otherLanguageRules` in `src/core/agent/prompt.ts`; bands: `LevelBand` (`src/shared/records.ts`), `bandLevels` (`src/shared/languages.ts`); UI `components/PlacementStart.tsx` (Today, Settings > Languages, Onboarding) |
| Add or change a role-play scenario (Today) | `SCENARIOS` in `src/shared/scenarios.ts` (title and description in all 12 catalogs, a new icon in `components/icons.tsx` and `ScenarioIcon`); the prompt block is `roleplayBlock` in `prompt.ts`, the opening line `kickoffText` in `turn.ts` |
| Change "New topic" or the difficulty slider | `kickoffText` (`newTopic`) in `turn.ts`, `difficultyBlock` in `prompt.ts`, `SayfernApp.newTopic` / `setDifficulty`, `components/SessionTools.tsx`, `requestNewTopic` in `lib/chatStream.ts` |
| Store a new kind of record | `src/core/records/store.ts` (+ `files.ts` shape, `exportAll`), the `RecordsStore` interface, types in `src/shared/records.ts` |
| Change a progress number | `src/core/records/stats.ts` (`computeProgress`) or `grammar.ts` (`summarizeGrammar`) |
| Add a model provider | `FACTORIES` (and `NOTES`, `LOGIN_LABELS`) in `src/core/providers.ts`; default pick in `src/shared/models.ts` |
| Change voice (playback, mic, ElevenLabs accounts) | Slot `src/shared/stage3/voice.ts`; `src/core/voice/` (`VoiceService`, `ElevenLabsAccounts` shared with decks, `elevenStt`); renderer `lib/voice.ts` (status store, player, `Recorder`, `useAutoSpeak`), `components/Speak.tsx`, the mic in `Composer.tsx`, `VoiceTab` in `screens/Settings.tsx`; mock `dev/mockVoice.ts` |
| Change sign-in behavior | `SayfernApp.login` / `authInteraction` in `src/core/app/index.ts`; UI in `src/renderer/src/components/Connect.tsx` |
| Add a learning language | Widen `Language` / `LANGUAGES` in `src/shared/records.ts`; add `LANGUAGE_META` in `src/shared/languages.ts`; a pack in `src/core/lang/` (often just `SpacedPack`) and a dictionary choice in `DefaultLanguageService.choices`; lemma rules in `lemma.ts`; prompt rules (`LANGUAGE_RULES` in `quiz/generate.ts`, `CARD_RULES` / `WORD_FORM` in `decks/prompts.ts`), `EDGE_VOICES`, `SPOKEN_CHARS`, CEFR grammar in `quiz/levels.ts`, `LEGACY_ENCODINGS`; renderer samples in `lib/samples.ts` and `COMPOSER_PLACEHOLDER`; a font class if the script is new. Typecheck lists most of these (`Record<Language, …>`). |
| Add an interface language | `UiLocale` / `UI_LOCALES` and `matchOne` in `src/shared/locales.ts`, a catalog `src/shared/i18n/<locale>.ts` registered in `CATALOGS`, `MENU_TEXT` in `src/main/index.ts`, a `html:lang()` font stack in `styles.css` if the script needs one. `src/core/i18n-catalogs.test.ts` checks the catalog is complete. |
| Add or change UI text | Wrap it: `t("…")`, `tn(n, one, other)`, `tj` for element placeholders, `tc(context, "…")` when one English word means two things, `msg("…")` for module constants (translate with `t()` where shown); core text built for the learner goes through `tr.t` (`translatorFor(deps)` / `translatorOf(deps)`). Then add the translation to all 12 catalogs: `npx tsx scripts/i18n-keys.ts missing` lists what is missing, and the catalog test fails until it is done. |
| Improve segmentation or readings | `src/core/lang/zh.ts`, `src/core/lang/ja.ts`; ruby split in `src/shared/ruby.ts` (renderer and Anki deck cards) |
| Support a new import format | `src/core/library/index.ts` (`FORMATS`, `parseBytes`) + a parser file; `IMPORT_EXTENSIONS` in `src/main/index.ts` |
| Change search ranking | `src/core/library/search.ts` (bump `DocIndex.v` if the index format changes) |
| Change Anki sync or the word model | `src/core/anki/index.ts` (`pull`, `history`, `toCard`), `src/core/anki/words.ts` (`struggleScore`, `aggregateWords`, `queryWords`) |
| Change Anki troubleshooting | `classifyFetchError` in `src/core/anki/index.ts`, `AnkiTroubleshoot` in `src/renderer/src/screens/Settings.tsx` |
| Benchmark Sayfern vs Claude Code, add a scenario | `bench/scenarios/*.json`, `bench/lib/`; see [`docs/benchmark.md`](docs/benchmark.md). If you change `SayfernApi` or `record_evidence`, run `npm run bench -- selftest` |
| Change the extension API | `src/core/extensions/index.ts` (`ExtensionApi`, `normalizeTool`) and `docs/extensions.md`; keep `examples/extensions/` working |
| Add a screen | `src/renderer/src/router.ts` (route + `parseRoute` + `normalize`), `App.tsx` switch (and `NAV_KEYS` for a ⌘ shortcut), `components/Sidebar.tsx` `NAV` |
| Change the corrections review list or filters | `src/core/review/list.ts` (`buildItem`, `reviewList`); UI `screens/review/CorrectionsTab.tsx`, `CorrectionsItem.tsx`; slot `src/shared/stage2/review.ts` |
| Change Anki card drafts or export | `src/core/review/cards.ts` (cloze, hints, note types `CLOZE_NOTE_TYPE` / `RECALL_NOTE_TYPE`), `situations.ts` (batched model call + fallback), `ReviewService.exportAnkiCards`; AnkiConnect calls in `src/core/anki/index.ts` (`ensureNoteType`, `ensureDeck`, `addNotes`); UI `AnkiExportPanel.tsx` |
| Change quiz material, levels or the format plan | `src/core/quiz/material.ts`, `levels.ts` (HSK 2.0/3.0, JLPT descriptors), `estimate.ts` (formats, minutes → count), `generate.ts` (slot targets, batched requests, top-up) |
| Change quiz item validation or grading | `src/core/quiz/items.ts` (`validateItem`), `json.ts` (salvage), `grade.ts` (model grading), `QuizService.answerQuestion`; tests in `items.test.ts`, `service.test.ts` |
| Change how quiz answers count as evidence | `QuizService.finishQuiz` (observations), `isQuizObservation` / `summarizeGrammar` in `src/core/records/grammar.ts`, `lastConversationVerdicts` in `src/core/agent/prompt.ts` (follow-ups) |
| Change the builder agent, its tools or the kit | `src/core/builder/agent.ts` (`runBuilderLoop`, tools, `builderSystemPrompt`, `MAX_BUILD_ITERATIONS`), `kit.ts` (`KIT_FILES`, `KIT_DIRS`), `docs/feature-builder.md`, `docs/feature-sdk.d.ts` |
| Change feature versions, approvals or the review gate | `src/core/builder/store.ts` (`FeatureStore`, versions, `approved/<hash>/`), `manifest.ts` (`checkMainSideCode`, `fullAccessFiles`), `BuilderService.approveFeature` / `enableFeature`, `FileExtensionHost.setManagedSource` / `loadOne` in `src/core/extensions/index.ts`; UI `components/FeatureReview.tsx`, `screens/Customize.tsx` |
| Change the feature sandbox (scheme, CSP, network) | Core: `parseFeatureUrl`, `featureHeaders` (CSP) in `src/core/builder/paths.ts`, `BuilderService.serveAsset`. Electron: `src/main/features.ts` (`lockDownAppSession`, test session, `netSession`), scheme registration and `will-frame-navigate` in `src/main/index.ts`, `frame-src` in `src/renderer/index.html`. Re-run the headless e2e (Run, test, build) |
| Change what built features can call (SDK / RPC) | `FEATURE_RPC_METHODS`, `FEATURE_LIMITS` in `src/shared/stage2/builder.ts`, SDK in `builder-sdk.ts`, validation in `src/core/builder/rpc.ts` (`FeatureRpc`), renderer forwarding in `components/FeatureFrame.tsx`, types in `docs/feature-sdk.d.ts`, the fake SDK in `runner.ts` (`defaultSeed`) |
| Change how feature tests run | `src/core/builder/runner.ts` (test page, `parseTestOutput`, `runTestsInChildProcess` fallback), `createElectronTestRunner` in `src/main/features.ts` |
| Change the app name shown or the icon | `setUpBranding` in `src/main/index.ts`, `scripts/brand-electron-app.mjs`, `build/icon.*` (keep `app.name` as `sayfern`) |
| Change colors or fonts | Tokens at the top of `src/renderer/src/styles.css`; fonts imported in `src/renderer/src/main.tsx`; the sandbox stylesheet for built features is `FEATURE_SDK_CSS` in `src/shared/stage2/builder-sdk.ts` (keep its variables in step) |
| Style a Stage 2 screen | `src/renderer/src/styles/review.css`, `quiz.css`, `builder.css` (imported in `main.tsx`, after `styles.css`) |
| Change window, navigation or IPC wiring | `src/main/index.ts` (`buildApp` builds the backend; `sayfern` is replaced after an erase, so never capture it) |
| Change the welcome page's Anki step | `AnkiStep` in `src/renderer/src/screens/Onboarding.tsx` (`sharedDecksUrl` in `src/shared/stage2/decks.ts`); dev-only "Show welcome page" in `PreferencesTab` (`screens/Settings.tsx`) |
| Change deck generation (words, cards, checks, batches) | `src/core/decks/prompts.ts` (prompts), `cards.ts` (`checkCard`, `VOCAB_NOTE_TYPE`, `noteFor`), `index.ts` (`DeckService`: `pickWords`, `writeCards`, `runOneBatch`, `followDeck`); UI `screens/Decks.tsx`; tests `src/core/decks/decks.test.ts` |
| Change deck audio (ElevenLabs, Edge voices) | `src/core/decks/tts.ts` (`edgeTts`, `EDGE_VOICES`, edge-tts constants, `elevenTts`, `ELEVEN_MODEL`), `DeckService.clip`; ElevenLabs key in `credentials.json` under `elevenlabs`, voice in `Settings.elevenLabsVoice` |
| Change packaging, installers, signing or the release workflow | `electron-builder.yml`, `build/entitlements.mac.plist`, `.github/workflows/release.yml`, `flatpak/`, `scripts/flatpak.mjs`; see [`docs/packaging.md`](docs/packaging.md). New files the app reads at runtime from the repo (like the builder kit) must be in `files` |
| Change what "Erase all data" deletes | `ERASE_PATHS` and `eraseData` in `src/core/app/index.ts` (also stops quiz generations and builds); test in `app.test.ts` |

## Invariants and rules

1. **Layering.** `src/core` never imports `electron`. Core services take explicit deps (`dataDir`, `fetch`, `now`); no singletons. The renderer reaches the backend only through `window.sayfern` (use `api` from `src/renderer/src/api.ts`).
2. **Locally computed numbers (S1-25).** Models record evidence; code computes every count, rate, state and stat. Never ask a model for a number shown to the learner.
3. **Recording-only tool pattern (S1-26, S1-27).** The tutor writes its reply first, then calls `record_evidence` once (on every learner turn, with empty lists when there is nothing to record). Models that skip it (GPT) get one tool-only evidence pass after the reply (`needsEvidencePass`, ADR 25). When every tool call in a step is `recordingOnly` and there is reply text, the loop ends without a follow-up request. Record ids are deterministic (`src/core/records/ids.ts`) so repeated calls dedupe. Keep the transcript valid: assistant(toolCall) → toolResult → next user message.
4. **Learner words.** Only the learner's own writing in the target language counts: pasted spans are removed (`stripPasted`), tutor text never counts, and words of the learner's own language never count (`learnerWords` filters by script and dictionary, ADR 30). If you change that filter, bump `WORD_FILTER_VERSION` in `src/core/app/index.ts` so stored words are recounted.
5. **Every turn ends with exactly one `done` or `error` ChatEvent**, and `error` carries a fresh `view` whenever the session exists. Failed or stopped replies are saved on the tutor message (`error`), never thrown.
6. **Storage writes** go through the existing atomic helpers (`JsonFile`, `writeJsonAtomic`). One process only (single-instance lock).
7. **Openings.** Practice, reading and placement sessions start with a tutor turn from main; `send` is rejected while it runs. To make the tutor open a certain way, put it on the session (`SessionMeta.openWith`, read by `kickoffText` and `sessionBlock`), never send right after creating the session.
8. **UI copy:** plain, short, no em dashes, in every locale. Every learner-visible string goes through `t`/`tn`/`tj`/`tc`/`msg` and has a translation in all 12 catalogs (the catalog test enforces it). Language names come from `langName()` (Intl.DisplayNames), numbers and dates from the locale. Colors and fonts from the `styles.css` tokens only. Stage 1 styles live in `styles.css`; each Stage 2 feature has its own stylesheet in `src/renderer/src/styles/` (`review.css` `rv-`, `quiz.css` `qz-`, `builder.css` `cz-`/`frv-`/`fh-`, `decks.css` `dk-`), using the same tokens. Put new feature styles in the feature's file, not in `styles.css`.
9. **API change checklist:** `src/shared/api.ts` (`SayfernApi` + `METHOD_TABLE` / `API_METHODS`) or the feature's slot in `src/shared/stage2/` (interface + `*_METHODS`) → `SayfernApp` / the bound Stage 2 service (or main `electronOnly`) → main IPC (automatic) → `mockApi.ts` or the feature's `dev/mock*.ts` → UI → tests.
10. **Every change bumps the version** (semver; while 0.x, minor = features, patch = fixes) in `package.json` + `package-lock.json` + the `README.md` version line, and adds a `CHANGELOG.md` entry (Keep a Changelog: Added / Changed / Fixed).
11. **Docs:** if you change behavior described in `docs/`, update the doc in the same change. Code wins over docs.
12. **Git:** do not commit or push unless the owner asks.
13. **Quiz evidence is kept apart (S2-09).** Quiz answers are recorded as observations with `origin: "quiz"`, `sessionId: "quiz:<id>"`, `assistance: "prompted"`. They never count as independent use, never enter conversation counts, rates or `lastUsedAt` (`GrammarSummary.quiz` holds them), never decide follow-ups (`lastConversationVerdicts`), and quiz text is never recorded as learner words. Check new grammar logic with `isQuizObservation`.
14. **Built code runs only inside its boundary (owner decision 2026-09-30).** Feature UIs and tests run sandboxed (opaque-origin iframe or hidden sandboxed window, CSP, no network, no permissions) and reach Sayfern only through validated RPC. Full-access code (`main` / `index.js`) runs only after the learner approves that exact hash, from the frozen `approved/<hash>/` copy. Never load builder code from `versions/` in the main process, never run `test.js` in-process, and never widen the feature session's network or permissions.
15. **Quiz items are validated locally.** Never keep a model item that fails `validateItem` (exactly one multiple-choice key among distinct options, one cloze gap, tiles that join back to the answer, rubric for open formats). Drop rather than guess.

## Gotchas

- **pi-ai patch.** `scripts/brand-oauth-page.mjs` overwrites `node_modules/@earendil-works/pi-ai/dist/utils/oauth-page.js` on `postinstall` and `predev`. After upgrading pi-ai, check the file still exists and exports `oauthSuccessHtml` / `oauthErrorHtml`, then test a real sign-in (`npm run smoke -- login anthropic`).
- **App name vs display name.** `app.name` must stay `sayfern` (package.json `name`, no `productName`): it names the userData folder and the Keychain item `sayfern Safe Storage` that encrypts credentials. Changing it, even its case, strands saved sign-ins. The learner-facing name "Sayfern" comes from the menu labels and About panel (`setUpBranding` in `src/main/index.ts`) and, in dev, from `scripts/brand-electron-app.mjs`, which renames node_modules' `Electron.app` (CFBundleName, icon) and re-signs it ad hoc on `postinstall`, `predev` and `prestart`.
- **App icon.** Edit `build/icon.svg`, then regenerate `build/icon.png` (1024 px, transparent corners) and `build/icon.icns` (Pillow: `Image.open("icon.png").save("icon.icns")`). The next `npm run dev` repatches the dev bundle.
- **Electron binary.** Electron 44 does not download itself on install; `install-electron` runs in `postinstall` and `predev`. If `npm install --ignore-scripts` was used, run `npx install-electron`.
- **IME-safe inputs.** Chinese, Japanese, Korean and Vietnamese are typed through an IME. Any input that submits on Enter must ignore key events while composing: check `e.nativeEvent.isComposing || e.keyCode === 229` (see `Composer.tsx`).
- **AnkiConnect port conflicts.** AnkiConnect listens on 127.0.0.1:8765. If something else owns the port (this happened: a Python LaunchAgent), AnkiConnect can't bind and Sayfern reports `refused` or `not_ankiconnect`. Check with `sudo lsof -i :8765`. `timeout` usually means macOS App Nap. Anki calls use Node's fetch (`ankiFetch`), not Chromium's.
- **safeStorage prompt.** The first credential read/write can make macOS ask to allow "sayfern Safe Storage" in the Keychain. Deny it and credentials can't be read. The smoke script uses plain JSON in `.sayfern-dev/` instead.
- **Two TS projects.** `src/shared` is compiled by both `tsconfig.node.json` and `tsconfig.web.json`: keep it free of Node and DOM APIs.
- **Translation keys are the English text.** Changing an English string (even punctuation) makes a new key: update all 12 catalogs, or the catalog test fails. Keys in core thrown errors count only for literal sentences (`new Error("Pick a level.")`); errors with interpolated values stay English. Placeholders like `{language}` get a language name capitalized by `languageName()`, which reads oddly mid-sentence in some locales: translators phrase around it.
- **Explanation language = interface language.** Model prompts name it with `promptName` ("Brazilian Portuguese"), from `settings.explanationLanguage()`. Stage 2 services use `explanationFor(deps)` / `translatorFor(deps)` (English when settings are absent, as in tests).
- **Mock API drift.** `mockApi.ts` implements `SayfernApi`; a new method without a mock implementation fails typecheck.
- **Extension imports are cached by URL.** The host adds `?v=<generation>`; reloading happens on toggle or restart, not on file change.
- **Tests with timers.** Many core services take `now`; use it instead of `Date.now()` so tests can control time.
- **The app window's session has no network.** `lockDownAppSession` (`src/main/features.ts`) points the default session at a dead proxy (`127.0.0.1:9`; loopback too in production) and denies subframe permissions, so feature frames can't phone home. Anything in main that needs Chromium's network must use `electronFetch` / `netSession()` (`sayfern-net` partition); Anki uses Node's fetch. In dev, loopback stays reachable for the Vite server.
- **Feature e2e and `--no-sandbox`.** `SAYFERN_E2E_BUILDER=1` (run the sandbox checks in `src/main/e2e.ts`, prints PASS lines) and `SAYFERN_E2E_DATA=<dir>` (throwaway userData) are test hooks only. `--no-sandbox` is only for the root Linux container (`xvfb-run`); never add it to app launch scripts. Still to check on macOS: OS sandbox and font fallback in frames.
- **Builder kit location.** The builder reads the kit from the repo (`findKitRoot` walks up from the module) or `SAYFERN_KIT_DIR`. Packaged builds carry it inside `app.asar` at the same paths (`files` in `electron-builder.yml`; a test in `builder.test.ts` checks the list).
- **Node test-runner fallback is not a sandbox for the network.** `runTestsInChildProcess` (`node --permission`) is for unit tests, smoke and dev only; the app always injects the Electron runner (`setTestRunner`).
- **Mock world is shared.** `dev/mockWorld.ts` holds the mock's corrections, grammar, Anki cards and sessions for `mockApi.ts` and the three Stage 2 mocks; `mockBuilder.ts` adds six measure-word nouns to the zh Anki cards (not with `?fresh=1`).
- **`.stop` CSS collision.** The reader's `.stop` rule in `styles.css` also matches the composer's `.send.stop` button; the builder composer neutralizes it locally (`.cz-comp .send.stop`). Check the session Composer's stop button before reusing the class.
- **Edge voices are unofficial.** `edgeTts` speaks Edge's read-aloud websocket protocol (ported from edge-tts 7.2.8). If it starts failing with 403s, copy `CHROMIUM_FULL_VERSION` (and anything else changed) from the latest edge-tts `constants.py`/`drm.py`. Deck cards are still added without audio when both voice services fail.
- **Generated decks are followed.** After a deck's first batch, `DeckService` appends it to `AnkiConfig.decks` for the language. Settings > Anki edits only the first mapping per language; the others show as "Also following".
- **Releases come from the version.** A push to `main` publishes the GitHub release `v<version>` only if it does not exist, with the `CHANGELOG.md` section as notes. Forget the version bump and the push builds artifacts but no release.
- **Known gaps.** Before "fixing" odd behavior, check the backlog in [`docs/roadmap.md`](docs/roadmap.md#known-gaps-and-backlog): some are known (retry duplicates the learner message, disputes don't reach the tutor).

## Debugging

- A provider misbehaves: reproduce outside the UI with `npm run smoke -- chat <provider> [model-id] "text"`; it prints deltas, tool activity, usage and recorded corrections.
- Test a turn without credentials: `pi-ai`'s `fauxProvider()` scripts replies and tool calls (see `src/core/app/app.test.ts`, `scripts/smoke.ts selftest`). The built app can run with a scripted faux provider: `SAYFERN_E2E_FAUX=1` (`src/main/e2e.ts`).
- UI work: run the mock server; `src/renderer/src/dev/mockApi.ts` simulates streaming, corrections and tool activity.
- Anki: Settings > Anki shows the failure reason; outside the app, `curl -s http://127.0.0.1:8765 -X POST -d '{"action":"version","version":6}'` should print a version.
- Records are plain JSON: open the files under `records/` to see exactly what the tutor stored.

## Deep docs

- [`docs/architecture.md`](docs/architecture.md): every module (Stage 2 in section 16), disk layout with JSON examples, the full API table, ChatEvent and builder event protocols, prompt and tools, end-to-end flows, renderer, testing, scripts.
- [`docs/decisions.md`](docs/decisions.md): why (Electron, pi-ai, JSON storage, recording-only tools, Anki transport, versioning, ...).
- [`docs/roadmap.md`](docs/roadmap.md): Stage 2 follow-ups, Stage 3, and the known-gaps backlog with pointers.
- [`docs/stage1.md`](docs/stage1.md): Stage 1 feature map and status.
- [`docs/stage2.md`](docs/stage2.md): Stage 2 feature map and status.
- [`docs/courses.md`](docs/courses.md): how to write a language's course (sources, units, grammar ids, translations, checks).
- [`docs/extensions.md`](docs/extensions.md): extension API, surfaces, versions, review gate, trust model.
- [`docs/feature-builder.md`](docs/feature-builder.md), [`docs/feature-sdk.d.ts`](docs/feature-sdk.d.ts): builder kit (what the builder model reads).
- [`docs/packaging.md`](docs/packaging.md): installers, the release workflow, signing, Flatpak and Flathub.
- [`docs/benchmark.md`](docs/benchmark.md): benchmark vs Claude Code + skill (context, limits, accuracy, conversation quality).
- [`CHANGELOG.md`](CHANGELOG.md): version history.
