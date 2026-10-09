# Stage 2: review, quizzes, the feature builder and Anki decks

Stage 2 = corrections review, Anki export, quizzes, the AI feature builder (built in v0.5.0) and the Anki onboarding page and deck generator (v0.6.0). Source of truth for scope: the Sayfern project page (feature IDs S2-xx). This file maps each feature to the code and records its status as of v0.5.0.

Deep reference: [`architecture.md` section 16](architecture.md#16-stage-2-review-quizzes-feature-builder). Decisions: ADRs 18 to 22 in [`decisions.md`](decisions.md). Follow-ups and known gaps: [`roadmap.md`](roadmap.md).

## Modules

```
renderer (React)  ──window.sayfern──►  preload  ──ipc:<method>──►  main (Electron)
  Review (⌘4): Corrections | Quizzes                                  │ sayfern-feature:// handler, locked-down sessions,
  Quiz screen, Customize, feature tabs and activities                 │ sandboxed test windows (src/main/features.ts)
  FeatureFrame: <iframe sandbox> + SDK bridge                         ▼
                         SayfernApp (src/core/app) binds the Stage 2 slots (bindSlot, src/core/stage2.ts)
   review/    ReviewService     corrections review list, Anki card drafts, export (S2-01..03)
   quiz/      QuizService       material, levels, generation, validation, grading, quiz evidence (S2-04..09)
   builder/   BuilderService    builder agent + kit, versions, review gate, sandbox assets, RPC, test runner (S2-10..13)
   decks/     DeckService       Anki deck generator: word list, checked cards, text to speech, AnkiConnect (S2-15..16)
              uses: records/, anki/, lang/, library/, extensions/ (managed features), settings
```

Contracts (change deliberately, and update the feature's mock and the docs with them):
- `src/shared/stage2/review.ts` (`ReviewApi`, `REVIEW_METHODS`)
- `src/shared/stage2/quiz.ts` (`QuizApi`, `QUIZ_METHODS`)
- `src/shared/stage2/builder.ts` (`BuilderApi`, `BUILDER_METHODS`, `BuilderEvent` on `evt:builder`, `FEATURE_RPC_METHODS`, `FEATURE_LIMITS`, `FEATURE_SCHEME`) and `builder-sdk.ts` (the SDK served to feature frames)
- `src/shared/stage2/decks.ts` (`DeckApi`, `DECK_METHODS`, `DECK_BATCH_SIZE`, `suggestDeckName`, `sharedDecksUrl`)
- Public for built features: `docs/feature-sdk.d.ts`, `docs/feature-builder.md`, `docs/extensions.md`, and the builder kit files listed in `src/core/builder/kit.ts`

## Conventions added in Stage 2

- One slot, one service, one mock, one stylesheet per feature: `src/shared/stage2/<f>.ts`, `src/core/<f>/`, `src/renderer/src/dev/mock<F>.ts` (over `mockWorld.ts`), `src/renderer/src/styles/<f>.css` (tokens from `styles.css`).
- Quiz evidence is prompted practice: `origin: "quiz"`, kept apart in summaries, never independent, never a follow-up signal (ADR 19).
- Model-written quiz items are validated locally and dropped when ambiguous.
- Built code runs sandboxed; full-access code runs only after the learner approves that exact hash, from a frozen copy (ADR 21).

## Disk layout additions (under Electron `userData`)

```
records/quizzes/<quizId>.json          one file per quiz (erased with records/, exported under "quizzes")
records/observations.json              quiz evidence rows: origin "quiz", quizId, sessionId "quiz:<id>"
records/corrections.json               exportedAt, ankiNoteIds on exported corrections
anki/config.json                       exportDecks: { zh?, ja? }
builder/features/<id>/feature.json     versions, approvals, build turns (kept by "Erase all data")
builder/features/<id>/versions/<n>/    the extension folder of version n
builder/features/<id>/approved/<hash>/ read-only copy of an approved full-access version
builder/data/<id>/storage.json         per-feature storage, ≤ 256 KB (erased)
builder/data/<id>/results.json         practice results, ≤ 2000 rows (erased)
records/decks/<id>.json                one file per deck project: spec, word list with status, samples, batches (erased)
records/deck-audio/<key>.mp3           cached text-to-speech clips (erased)
credentials.json                       "elevenlabs" api_key entry when connected (kept with sign-ins)
settings.json                          elevenLabsVoice
anki/config.json                       decks[]: a generated deck is added as an extra mapping after its first batch
```

Inside Anki: note types "Sayfern Cloze" and "Sayfern Recall", created on first export, and "Sayfern Vocab" (generated decks) with audio files `sayfern-<key>.mp3` in the media folder.

## Feature map and status (v0.6.0)

Status: **Done** = implemented as scoped. **Partial** = works, with a missing piece (see notes and the roadmap's Stage 2 follow-ups).

| ID | Feature | Status | Where | Notes |
|---|---|---|---|---|
| S2-01 | Corrections review | Done | `ReviewService.listReviewCorrections`, `src/core/review/list.ts`; `screens/review/CorrectionsTab.tsx`, `CorrectionsItem.tsx`; route `review` (⌘4) | Disputed corrections stay visible, dimmed. Doesn't reuse `CorrectionCard`. |
| S2-02 | Filters and retries | Done | Kind chips (grammar, typo, speaking), status, grammar and search filters in `list.ts`; "Hide answers and retry"; reuses `checkRetry`, `revealCorrection`, `disputeCorrection` | Counts computed locally. |
| S2-03 | Selected Anki export | Partial | `draftAnkiCards` (`cards.ts` cloze, `situations.ts` batched model call + fallback), `exportAnkiCards`; `AnkiService.ensureNoteType` / `ensureDeck` / `addNotes`; `AnkiExportPanel.tsx` | Corrections only: saved words as a source not built. Export deck chosen in the panel, no Settings field. |
| S2-04 | Quiz focus | Done | `QuizSpec.focus` (grammar, vocabulary, scenes, exam prep, mix); `screens/review/QuizzesTab.tsx` | |
| S2-05 | Quiz sources | Done | `src/core/quiz/material.ts`: mistakes (corrections + earlier wrong quiz answers), Anki words, grammar points, library book or chapter (`quizChapters`), personal targets, saved words; counts in `quizOptions` | Sources with nothing to quiz are disabled with a reason. |
| S2-06 | Levels and exams | Partial | `src/core/quiz/levels.ts`: current level, HSK 2.0, HSK 3.0, JLPT; alignment and provenance on every quiz | No official word lists bundled or downloadable; descriptors and vocabulary sizes only. |
| S2-07 | Formats and length | Done | `estimate.ts`: multiple choice, fill the gap, sentence order, written, role-play; count or minutes | |
| S2-08 | Generation and grading | Done | `generate.ts` (batches of 10, parallel, one top-up, cancel), `items.ts` (`validateItem`, local grading), `json.ts`, `grade.ts` (model grading, "uncertain" fallback); `screens/Quiz.tsx` (route `quiz/<id>`) | Polls `getQuiz` while generating. Multiple-choice items with a key missing from 4+ options are dropped (0.5.0 follow-up fix). |
| S2-09 | Linked results and provenance | Done | `finishQuiz` → observations with `origin: "quiz"`, `assistance: "prompted"`; `summarizeGrammar` (`GrammarSummary.quiz`); `lastConversationVerdicts` for follow-ups; Grammar page "In quizzes" line and quiz links | Never "independent"; follow-ups use conversation only (0.5.0 follow-up fix). Evidence recorded on finish only. |
| S2-10 | Prompt-to-feature builder | Done | `BuilderService.buildFeature`, `src/core/builder/agent.ts` (`runBuilderLoop`, 8 tools), `kit.ts`; `screens/Customize.tsx`, `evt:builder` | Kit not shipped in packaged builds yet. No cost cap beyond 25 iterations. |
| S2-11 | Sandboxed feature UIs | Partial | `sayfern-feature://` (`paths.ts` `parseFeatureUrl`, `featureHeaders`; `serveAsset`), SDK (`builder-sdk.ts`, `FeatureRpc` in `rpc.ts`), `FeatureFrame.tsx`, `FeatureNav.tsx` (tabs), `FeatureActivities.tsx` (Today), `screens/FeatureHost.tsx`; lockdown in `src/main/features.ts` | Surfaces: tab and activity only. macOS OS sandbox not yet verified (Linux headless e2e passes). |
| S2-12 | Test, preview and review | Done | Tests: `runner.ts` + `createElectronTestRunner` (hidden sandboxed window, 8 s); live preview of the draft; review sheet `FeatureReview.tsx` + `featureFiles`, `approveFeature`, `checkMainSideCode` (`manifest.ts`), host gate in `src/core/extensions/index.ts` | Builder can't unit-test main-side code that needs `node:` APIs. |
| S2-13 | Versions, enable, roll back | Done | `FeatureStore` (`store.ts`): sealed versions, `approved/<hash>/`; `enableFeature`, `disableFeature`, `rollbackFeature`, `discardDraft`, `deleteFeature` | Rollback to an unapproved full-access version is allowed while off; turning it on asks for review. |
| S2-14 | Welcome page: learn words with Anki | Done | Step 3 `AnkiStep` in `screens/Onboarding.tsx` (shared decks via `sharedDecksUrl`, or the generator), styles `styles/decks.css`; dev-only "Show welcome page" in Settings > Preferences | AnkiWeb search link uses `?search=<language>`. |
| S2-15 | Anki deck generator | Done | Free-text request (`DeckSpec.request`: source, theme or kind of item, e.g. "top 1,500 by SUBTLEX-CH", "common sayings"); `DeckService` (`src/core/decks/index.ts`): `pickWords`, `writeCards`, `runBatches`; `prompts.ts`; `cards.ts` (`checkCard`, `VOCAB_NOTE_TYPE`, `noteFor`); `store.ts`; `screens/Decks.tsx` (routes `decks`, `decks/<id>`), `dev/mockDecks.ts` | Model reads the dictionary only through Sayfern's checks (no tool loop). No HSK/JLPT lists bundled: words come from the model. Not tried with a real model and Anki yet. |
| S2-16 | Deck audio | Done | `tts.ts`: `edgeTts` (Edge read-aloud websocket, Sec-MS-GEC), `elevenTts` / `elevenVoices` / `elevenSubscription`; `connectElevenLabs` etc. on `DeckService`; `AnkiService.storeMedia` | Edge constants copied from edge-tts 7.2.8 and may need bumping. Credits estimate counts 1 credit per character (Flash often costs less). |

Related Stage 1 changes: F-10 navigation is now ⌘1..5 (Review ⌘4, Progress ⌘5); F-09 built features run sandboxed or behind the review gate (hand-installed extensions still run with full privileges); F-11 export includes quizzes and built features' data, and "Erase all data" also removes `builder/data/`.

## Build history

Built by three agents in parallel on top of a shared foundation, then merged and reviewed (git history):

1. Foundation: API slots, `bindSlot`, services, routes, Review nav, mock world (`527af98`).
2. Review: corrections review, filters and retries, Anki export (`cbbcefb`).
3. Quizzes: builder, generation with local validation, local and model grading, quiz evidence kept apart (`080465c`).
4. Feature builder: Customize, sandboxed feature UIs, versions and review gate (`ef54a26`).
5. Review fixes: sandboxed test runner, frozen approved code, build lock, network lockdown (`afdab81`); quiz follow-ups (`lastConversationVerdicts`, dropping ambiguous multiple-choice items), released as v0.5.0.
6. v0.6.0: Anki step on the welcome page, the deck generator (`DeckService`, Sayfern Vocab note type, reading checks) and deck audio (ElevenLabs, Edge voices); `storeMedia` on the Anki service, `credentials` on `Stage2Deps`.
