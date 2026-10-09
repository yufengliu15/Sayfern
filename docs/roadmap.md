# Roadmap

What comes after v0.5.0, and where each piece plugs into the code. Stage and feature IDs (S2-xx, S3-xx) come from the owner's project page; wireframes for every stage are in `design/wireframes` in the owner's copy of the repo (not in this checkout).

| Stage | Scope | Status |
|---|---|---|
| 1 | Text learning (Chinese and Japanese; nine more languages and 12 interface locales in v0.7.0) | Built: v0.1.0 to v0.3.1 (v0.4.0 added the benchmark). Feature status in [`stage1.md`](stage1.md). |
| 2 | Corrections review, Anki export, quizzes, AI feature builder | Built: v0.5.0. Feature status in [`stage2.md`](stage2.md). Follow-ups below. |
| 3 | Voice | Partly built: v0.8.0 (listening, talking, several ElevenLabs accounts). Assessment and audio quizzes next. |

---

## Courses per language (v0.10.0)

The Course screen and the tutor's syllabus come from one data file per language (`src/shared/course/<lang>.ts`, see [architecture section 19](architecture.md#19-course-v0100); how to write one: [`courses.md`](courses.md)). Native support is a lot of work per language (a textbook order to follow, grammar ids, notes, topics, words, 12 translations of every unit title), so it comes one language at a time. Until then the language is **Beta** in the interface: the tutor works, but results may vary.

| Language | Course | Order to follow |
|---|---|---|
| Chinese | Full syllabus (v0.14.0): 92 units, all 573 points | HSK 3.0 grammar syllabus (GF 0025-2021, appendix A), levels 1 to 9 |
| Japanese | Core path (v0.11.0), 32 units | Genki I and II, then Quartet / Tobira; JLPT order (no official grammar list) |
| Korean | Core path (v0.11.0), 32 units | Sejong Korean / Yonsei; TOPIK order |
| English | Full syllabus (v0.14.0): 215 units, all 1,239 points | English Grammar Profile (Cambridge, CEFR); levels and categories only, own wording |
| Spanish | Core path (v0.13.0), 32 units | Plan Curricular del Instituto Cervantes (PCIC); notes give Latin American use first |
| French | Core path (v0.11.0), 32 units | CEFR Référentiels (Beacco) |
| German | Core path (v0.13.0), 32 units | Profile deutsch, Goethe-Zertifikat guides |
| Italian | Core path (v0.13.0), 32 units | Profilo della lingua italiana, CILS / PLIDA order |
| Portuguese | Core path (v0.13.0), 32 units; European Portuguese since v0.14.0 | QuaREPE descriptors (Camões). Sources are weaker |
| Russian | Beta | TORFL lexical and grammar minimums |
| Vietnamese | Beta | No common standard yet |

**Full syllabus** means every point of the source list is in the course once, at the source's level, and `course.test.ts` checks it. **Core path** means the most important points per level, about 100 per course (15 to 25% of a full inventory), in themed units of 2 to 4 points; the levels were placed from memory of the sources and still need a check against them. Next: a full-syllabus pass for the other languages (the PCIC for Spanish is free and detailed), then a native-speaker or teacher review per language.

---

## Stage 2 (built in v0.5.0 and v0.6.0)

### What shipped

- **Review > Corrections (S2-01..S2-03).** Every correction across sessions with kind, status, grammar and search filters, hide-and-retry, and export of selected corrections to Anki as cloze or situation cards through Sayfern's own note types (ADR 20). `src/core/review/`.
- **Quizzes (S2-04..S2-09).** A sentence-style quiz builder (focus, sources, level incl. HSK 2.0/3.0 and JLPT, formats, length), batched generation with local validation of every item, local grading of fixed formats and model grading of open ones, and quiz evidence kept apart from conversation (ADR 19). `src/core/quiz/`.
- **Customize: the feature builder (S2-10..S2-13).** The learner's model reads a builder kit, writes a feature, tests it and finishes; sandboxed tabs and Today activities, live preview, sealed versions with rollback, and a review gate for full-access code (ADR 21). `src/core/builder/`, `src/main/features.ts`.
- **Anki decks (S2-14..S2-16, v0.6.0).** A welcome-page step that pushes Anki (shared decks on AnkiWeb or a generated deck), and a deck generator with checked readings, local ruby, ElevenLabs or Edge audio, added straight to Anki in batches (ADR 22). `src/core/decks/`.
- **Foundation.** Per-feature API slots bound with `bindSlot` (ADR 18), Review nav (⌘4, Progress ⌘5), per-feature stylesheets and mock slots.

### Stage 2 follow-ups

Review and Anki export:
- **Saved words as an export source** (nice-to-have, not built). The draft/export pipeline is per correction; it needs a second source kind on `AnkiCardDraft` and `exportedAt` on `SavedWord`. `src/core/review/cards.ts`, `src/shared/stage2/review.ts`.
- No Settings > Anki field for the export deck; it is chosen and remembered in the export panel.
- Cloze hints for phrases rely on the grammar point name or a generic hint; only single words get a dictionary gloss (the learner can edit every hint).
- The review list doesn't reuse Stage 1's `CorrectionCard` (it follows the wireframe's sentence-level layout), so retry UI exists twice; both call the same API methods.

Quizzes:
- No downloadable HSK/JLPT word lists; level guidance is descriptors, vocabulary sizes and the learner's own catalogue. `levels.ts` notes where a list provider would plug in (dictionary download pattern).
- Polling `getQuiz` every 800 ms instead of a `quiz` event channel; fine for 20 to 60 s generations.
- Evidence is recorded on finish (or "End quiz"); an abandoned quiz records nothing.
- "Show me the answer" counts as wrong in the score but is not grammar evidence.
- "Quiz me on my mistakes" reuses the same items reshuffled; fresh items on the same points would need a model call.
- Builder popovers support Tab/Shift+Tab and Escape, not arrow keys.
- The Review header still reads "Quizzes" (wireframe: "Quick quiz").
- The mock grades written answers by keyword and seeds evidence only for the "my mistakes" quizzes.

Anki decks (v0.6.0):
- **Try it for real on the Mac**: a real model, Anki with AnkiConnect, both voice services. Only unit tests, a live Edge clip from the container and the mock UI were run.
- No official HSK/JLPT word lists: the model chooses words (with the level's descriptor and word count). A bundled or downloadable list would make big decks more reliable.
- Edge voice constants (`CHROMIUM_FULL_VERSION`, token) come from edge-tts 7.2.8 and may need bumping; there's no clock-skew retry yet.
- Images on cards (an /ankigen option) are not built.
- The sample preview plays audio from data: URLs; batches don't show audio in the app.
- A generated deck is followed automatically; nothing syncs it right away (the next sync or session start does).

Feature builder:
- **Check on macOS:** the OS sandbox (the Linux e2e needed `--no-sandbox` because the container runs as root) and font fallback inside feature frames.
- `run_tests` also loads main-side modules that `test.js` imports, in the sandboxed page; main-side code that needs `node:` APIs can't be unit-tested by the builder.
- Surfaces beyond tab and activity (statistics widgets, dictionaries, importers, integrations, quiz formats or grading rules) are not implemented; hand-installed extensions' surfaces are ignored.
- Results from sandboxed features stay per feature: they don't feed grammar evidence or Progress (they are exported).
- One build at a time per feature. No token or cost cap per build beyond the 25-iteration cap; usage is stored per turn but not shown.
- "Ask for changes" sends a compact history (prompts and outcomes) plus the file list, not the full previous transcript.
- Rolling back to an unapproved full-access version is blocked only while the feature is on (turning it on then asks for review).
- A test can fake its own result object; test counts measure what the model's tests claim.

---

## Stage 3: voice

### Built in v0.8.0 (ADR 24)

- **S3-01 / S3-02:** listen and slow buttons on tutor messages and in the word popover, optional auto-read, push-to-talk mic with ElevenLabs Scribe in sessions and the reader. `src/core/voice/`, `src/renderer/src/lib/voice.ts`.
- **S3-03 (partly):** text to speech and speech to text are separate jobs; text to speech can be ElevenLabs or the free Edge voices. Several ElevenLabs accounts, tried in order.
- **S3-04 (partly):** voice practice time is counted apart (`voiceMs`); spoken messages are flagged and never treated as pronunciation evidence.

### Next

- **Try it for real on the Mac**: real keys, real microphone (the dev bundle gets `NSMicrophoneUsageDescription` from `scripts/brand-electron-app.mjs`; packaged builds need it in the packager config), Chinese tones and Japanese readings with Flash v2.5.
- **Pronunciation assessment (S3-04):** a separate provider (Azure Speech is the candidate); results as a new evidence type next to observations.
- **Audio quizzes (S3-05):** listening and spoken formats in `src/core/quiz/` (`QuizFormat`), using `speak` and `transcribe`.
- **Other providers (S3-06):** OpenAI audio, Cartesia, local Whisper behind the same `speak` / `transcribe` methods; a direct speech-to-speech mode.
- **Smaller gaps:** voice settings are global (not per language); the clip cache is bounded by count; Scribe always gets the session language (code-switching untested); listening and speaking time is not idle-filtered; the Edge voice constants may need bumping.

---

## Known gaps and backlog

Verified against the v0.5.0 code. Each item says where a fix would go.

| # | Gap | Where it lives / where to fix |
|---|---|---|
| 1 | **Retry after a failed turn duplicates the learner message.** The failed turn keeps its saved learner message; Retry sends the same text again as a new message, so the conversation shows it twice and words are counted twice (S1-23). | `retryLast` in `src/renderer/src/lib/chatStream.ts` calls `send` again; `runTurn` in `src/core/agent/turn.ts` always appends. Fix with a retry API that reuses the existing learner message (skip `appendMessage` and `recordLearnerWords`). |
| 2 | **Retry on a failed opening does nothing.** Openings have no learner message and no stored input, so `retryLast` returns without sending. | `useChat.retry` / `retryLast` in the renderer; needs an API to restart an opening (for example re-running `viewWithOpening`, which already restarts when the only tutor messages have errors). |
| 3 | ~~Grammar "Explain again" is rejected.~~ **Fixed in 0.2.2:** the request rides in the opening (`SessionMeta.openWith = "explain"`). | |
| 4 | **Disabled extension language packs stay loaded until restart.** Same for approved built features that register a language pack. | `LanguageService.registerPack` has no unregister; `FileExtensionHost.loadAll` in `src/core/extensions/index.ts`. |
| 5 | **No context trimming.** Every turn sends the full transcript; very long sessions will hit context limits and cost more. | `runLoop` in `src/core/agent/turn.ts` (`transcript`). The prompt already carries long-term memory (ADR 16), so older turns can be dropped or summarized. |
| 6 | ~~Packaged app untested; no packaging or signing.~~ **Packaging added in 0.16.0** ([packaging.md](packaging.md)): CI builds a .dmg, an .exe and a Flatpak on every push to `main`. kuromoji's dictionary, pdf.js and the builder kit load from the packaged app (checked on macOS). Still open: Developer ID signing and notarization, Windows SmartScreen signing, a check by hand on Windows and Linux, auto-update. | `electron-builder.yml`, `.github/workflows/release.yml`, `flatpak/`. |
| 7 | ~~JMdict download URL resolution never verified live.~~ **Verified 2026-10-02** on the owner's Mac: JMdict with German glosses installed (129,073 entries) through the GitHub releases API. | `LIVE=1 npx tsx --test src/core/lang/live.test.ts` re-checks it. |
| 8 | **Chinese segmentation is greedy longest match.** Forward maximum matching against CC-CEDICT mis-splits some phrases; without the dictionary it falls back to `Intl.Segmenter`. | `ChinesePack.splitHan` in `src/core/lang/zh.ts`. |
| 9 | **PDFs with columns or vertical text parse poorly; no OCR.** Lines are grouped by baseline in content order; scanned PDFs import empty with a warning. | `toLines` / `toParagraphs` in `src/core/library/pdf.ts`. |
| 10 | **Grammar catalogue counts don't refresh after a dispute until reload.** The detail view updates; the list loaded on mount does not. | `GrammarScreen` in `src/renderer/src/screens/Grammar.tsx` (list effect depends only on `language`). |
| 11 | **Disputing a correction changes only its status.** The dispute note is never shown to the tutor (the card says "the tutor will take your note into account"), the correction still counts in Progress corrections, and the related grammar observation keeps its verdict. Review only keeps disputed corrections out of Anki export. | `disputeCorrection` in `src/core/app/index.ts`, `computeProgress` in `src/core/records/stats.ts`, `gatherPromptData` in `src/core/agent/prompt.ts`, copy in `CorrectionCard.tsx`. |
| 12 | **Sessions can't be deleted from the UI, and history shows only recent sessions.** `deleteSession` exists in the API but nothing calls it; the sidebar lists 12 recent sessions and Today 5. Empty sessions are hidden after a day but their files stay. | `Sidebar.tsx`, `SayfernApi.deleteSession`, `JsonRecordsStore.listSessions`. |
| 13 | **AnkiConnect URL can't be changed in the UI.** The troubleshooting copy suggests changing "the address Sayfern uses", but `AnkiConfig.url` is only editable in `anki/config.json`. | `AnkiTab` in `src/renderer/src/screens/Settings.tsx`. |
| 14 | **Onboarding placement covers one language.** If several languages choose "find my level", only the first gets a placement session; "Connect Anki" skips placement. | `finish` in `src/renderer/src/screens/Onboarding.tsx`. |
| 15 | **No data import.** Export exists (F-11, now with quizzes and built features' data) but there is no way to restore it; transcripts, document text and built feature code are not exported. | `SayfernApp.exportTo`, `JsonRecordsStore.exportAll`. |
| 16 | **Full scans on some reads.** `getProgress` reads every session file; `findMessageSession` may scan every session. Fine now, slow with years of data. | `src/core/records/store.ts`, `src/core/app/index.ts`. |
| 17 | ~~Repository state: nothing committed in the owner's repo.~~ **Resolved:** the v0.4.0 baseline is committed and tagged `v0.4.0` in the owner's repo. | Commit and tag `v0.5.0` the same way. |
| 18 | ~~Session stop button misstyled.~~ **Fixed in 0.5.0:** the reader marker rule is scoped to `div.stop`. | |
| 19 | **Unused placeholder styles.** The `.cust*` rules for the old Customize placeholder are still in `styles.css`. | `src/renderer/src/styles.css`. |
| 20 | **Partial `addNotes` batches.** If AnkiConnect rejects a batch after adding part of it, the per-note fallback reports those notes as "already there" with no note id stored. Rare: duplicates and empty fields are filtered first. | `AnkiConnectService.addNotes` in `src/core/anki/index.ts`. |
| 21 | **Edited Sayfern note types aren't repaired.** If the learner renames or deletes fields of "Sayfern Cloze" / "Sayfern Recall" in Anki, adding fails per card with Anki's message. | `ensureNoteType` in `src/core/anki/index.ts`, `src/core/review/cards.ts`. |
| 22 | **Mock Anki word counts include builder nouns.** `mockBuilder.ts` adds six measure-word nouns to the zh mock Anki cards (unless `?fresh=1`), which shifts mock counts on other screens. | `src/renderer/src/dev/mockBuilder.ts`. |
| 23 | **Translations need a native-speaker pass.** All 12 catalogs were model-written (v0.7.0; pt-PT in v0.14.0). Some phrasing around placeholders is stiff (language names arrive capitalized and in the nominative; sentence fragments joined in code). | `src/shared/i18n/<locale>.ts`; joins in `Settings.tsx` (audio credits), `QuizzesTab.tsx` (mad-lib). |
| 24 | **Dictionary gaps for new languages.** zh, ko and vi glosses are English only; English with a Korean or Vietnamese interface (and an English one) gets English definitions only (Open English WordNet), and English–Chinese WikDict mixes simplified and traditional characters; the kaikki.org Vietnamese URL is deprecated upstream; WikDict and kaikki downloads were checked live once (2026-10-01), JMdict German glosses on the owner's Mac (2026-10-02). | `choices` in `src/core/lang/index.ts`, `src/core/lang/wordlists.ts`. |
| 25 | **Lemmas are rule-based.** Spanish, Portuguese, Italian, French, German, Russian and Korean forms are reduced with suffix rules and irregular tables, checked against the dictionary; forms the rules miss look up as the surface word. | `src/core/lang/lemma.ts`. |
| 26 | **Fonts for new scripts unchecked on macOS.** Korean (AppleMyungjo), Cyrillic (PT Serif) and Vietnamese (Georgia) stacks were only seen in Linux Chromium. | `--ko`, `--lt`, `--cy` and `html:lang()` rules in `styles.css`. |
| 27 | **Target-language filter limits (ADR 30).** A Chinese speaker's kanji-only clause in a Japanese session counts as Japanese (no kana to tell them apart). Without a dictionary the common-word lists are short (about 120 to 290 words per language), so a rare own-language word in a clause with target words counts. Words shared with the same meaning (hotel, no) count even inside an own-language sentence, by owner rule. | `learnerWords` in `src/core/lang/ja.ts`, `src/core/lang/spaced.ts`, `src/core/lang/common-words.ts`. |
