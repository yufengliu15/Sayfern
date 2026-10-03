# Changelog

Sayfern follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.
While the major version is 0, minor versions add features and patch versions fix bugs.
Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Changed

- **Licence:** Sayfern is now licensed under the GNU General Public License v3.0 (GPL-3.0-only) instead of MIT. `LICENSE` holds the full GPL-3.0 text; `package.json` and the README say so.

### Fixed

- **Benchmark: unequal judge totals between arms** (run 2026-10-01T17-47-57 showed Anki facts 2/2 for Sayfern vs 3/4 for Claude Code). One Sayfern block's judge reply failed to parse, and the report counted only the verdicts that came back. Judge totals now come from the scenario's gold items, so both arms are always graded out of the same totals; missing verdicts show as ⚠ ungraded. The judge resends only the items still missing a verdict (up to three attempts), and `npm run bench -- judge <run>` re-grades only incomplete blocks (`--all` re-grades everything).

## [0.9.1] - 2026-10-03

### Fixed

- **Tool calls written into the reply** (owner screenshot with gpt-6.1-sol): the model sometimes writes `record_evidence` as text in its internal chat format (`<|assistant to=functions.record_evidence ... {json} ... Recorded.`) instead of calling the tool, and the learner saw all of it. Now the stream holds back anything from such a marker on, the saved reply keeps only the text before it, the written call is parsed and run as a real `record_evidence` call (recording-only tools only), and the stored transcript drops the noise so the model doesn't copy it next turn (`src/core/agent/leak.ts`).
- The tool protocol tells the tutor never to write tool calls, tool names or JSON in its reply.

## [0.9.0] - 2026-10-03

Owner TODO list, 2026-10-03: a "New topic" button and a "Go easier / go harder" slider in the chat; bulletproof corrections for GPT models (Sol and Astra could not trigger them; Sonnet works well); make the UI fill the space better.

### Added

- **New topic** button above the composer (conversation and practice sessions). The tutor drops the current topic and opens a fresh one, different from what the session has covered. It runs like an opening: a hidden kickoff in the transcript only, and `send` waits while it runs. API: `newTopic(sessionId, model)`; `Tutor.runOpening` takes `newTopic: true`.
- **Go easier / go harder** slider above the composer, five steps from "Much easier" to "Much harder", saved per session (`SessionMeta.difficulty`, -2..2; API `setDifficulty`). The system prompt gets a `# Difficulty` block (`difficultyBlock`) from the tutor's next reply. Harder means less common words, more complex grammar and harder topics, but never more than about one level above the learner's estimate, and the tutor eases off within the setting when the learner clearly struggles.
- **Evidence pass** for models that end their turn without calling `record_evidence` (OpenAI GPT models, by API key or ChatGPT sign-in, and other non-Claude models): after the reply, one tool-only request with `record_evidence` as the only tool and a hidden nudge. The reply is already shown; corrections arrive a moment later. The pass never fails the turn and stays out of the stored transcript. Claude models skip it (`needsEvidencePass` in `options.ts`; ADR 25).

### Changed

- Tool protocol: the tutor calls `record_evidence` on every turn that answers a learner message, with empty lists when there is nothing to record, so a missing call reliably means "forgot".
- `record_evidence` accepts lists sent as JSON text and a single object where a list was expected (some GPT models do this).
- The UI fills wide windows better: the chat column and composer grow from 700 px up to 1000 px with the window (`--chat-max`), learner bubbles and correction cards up to 760 px (`--bubble-max`), Today's main column up to 1120 px and its side column with the window, Grammar detail up to 1320 px, Settings up to 980 px, the deck generator up to 1180 px.

## [0.8.0] - 2026-10-03

Stage 3, first part: voice. Owner request, 2026-10-03: build voice support with ElevenLabs (text to speech first, then Scribe speech to text with push-to-talk), and let the learner connect several ElevenLabs accounts with a + button.

### Added

- **Settings > Voice** (new tab). ElevenLabs accounts with a + button: name (optional) and API key, checked with ElevenLabs before it is stored. Each account shows its key hint, credits left this month, reset date and health (out of credits, key refused). Accounts can be reordered and removed. Also: which service reads aloud (ElevenLabs or the free Microsoft voices), the ElevenLabs voice, playback speed (0.8× to 1.25×), "Read tutor replies aloud", "Send right after transcribing" and a sample to try.
- **Several ElevenLabs accounts** (`src/core/voice/accounts.ts`, `ElevenLabsAccounts`). Sayfern tries them in the learner's order. An account that runs out of credits sits out until its credits reset; a rate limit sits out a minute; a refused key or a missing permission sits out ten minutes for that job only (text to speech or speech to text). Deck audio (S2-16) uses the same pool. Keys stay encrypted in `credentials.json`; `Settings.elevenLabsAccounts` keeps the order, names and key hints. A v0.6 key becomes the first account automatically.
- **Listening (S3-01, S3-02).** A listen button and a 0.7× slow button on every tutor message and in the word popover. Optional auto-read of each new tutor reply. Text is cleaned first (Markdown, links, and for Chinese, Japanese and Korean the romanised readings and glosses in brackets). Whole messages are sent without a language code so mixed-language replies sound right; words and sentences keep it. ElevenLabs falls back to the free Edge voices when no account can speak. Clips are cached in `records/voice-audio/` (about 600 kept).
- **Talking (S3-01).** The composer's mic records (click to start and stop, or hold and release; Esc cancels; two-minute limit), ElevenLabs Scribe (`scribe_v2`) transcribes with the session's language, and the text lands in the box to check, or is sent at once. Works in sessions and in the reader. macOS asks for microphone access once (`requestMicrophone`).
- **Spoken messages.** `send` takes `spoken: true`; the learner message is stored with `spoken` and shows a "Spoken" tag. The model sees a `[spoken]` marker and a prompt rule: ignore punctuation, treat a right-sounding wrong character as a likely transcription slip, never judge pronunciation from text (S3-04).
- **Voice practice time (S3-04).** Recording and listening time is counted apart from text practice: `SessionMeta.voiceMs`, `ActivityEntry.voiceMs`, `ProgressStats.voiceMs`. Progress shows it under Active practice.
- Dev builds: `scripts/brand-electron-app.mjs` also sets Sayfern's microphone prompt text (`NSMicrophoneUsageDescription`) and re-signs the bundle (macOS may ask once more for Keychain access).
- API slot `src/shared/stage3/voice.ts` (`VoiceApi`, `VOICE_METHODS`): `voiceStatus`, `addElevenLabsAccount`, `removeElevenLabsAccount`, `moveElevenLabsAccount`, `setVoicePrefs`, `speak`, `transcribe`, `trackVoiceActivity`; `VoiceService` in `src/core/voice/`. Dev mock in `dev/mockVoice.ts` (any key starting with `sk` connects; `sk_empty` is out of credits).

### Changed

- Decks: "Disconnect" became "Manage accounts" (Settings > Voice). `connectElevenLabs` adds an account; `disconnectElevenLabs` removes all of them; `elevenLabsStatus` adds up credits over every account.
- The renderer's Content-Security-Policy allows `blob:` media (played clips).
- `TtsError` carries the HTTP status (429 is a rate limit, not an empty account).

### Not done yet

- Pronunciation assessment (S3-04), listening and spoken quiz formats (S3-05), a live speech-to-speech mode, other providers (S3-06).
- Not tried on the owner's Mac with real ElevenLabs keys and a real microphone.

## [0.7.0] - 2026-10-02

Eleven learning languages and a fully translated interface in twelve locales. Owner request, 2026-10-01: keep the core languages (Tagalog and Arabic dropped), detect the system language, and let the learner pick both the interface language and the language they learn, in any pairing.

### Added

**Languages to learn**
- Korean, English, Spanish, French, German, Italian, Brazilian Portuguese, Russian and Vietnamese join Chinese and Japanese. `src/shared/languages.ts` (`LANGUAGE_META`) holds each language's names, glyph, font class, script, level system and target-language session titles.
- Levels: HSK and JLPT as before, TOPIK 1 to 6 for Korean, CEFR A1 to C2 for the rest. Quiz exam styles: TOPIK, Cambridge, DELE, DELF, Goethe, CILS, TORFL, and CEFR for Portuguese and Vietnamese (`src/core/quiz/levels.ts`).
- Language packs: `SpacedPack` (Intl.Segmenter words, French and Italian elision split, dictionary-checked lemmas from `lemma.ts`), `KoreanPack` (particle and ending stripping), `VietnamesePack` (joins syllables into dictionary words). Learner words, hover lookup and the reader work for every language.
- Offline dictionaries, downloaded on demand, chosen for the pair (learning language, interface language) with English glosses as the fallback:
  - Japanese: JMdict with English, German, Russian, Spanish or French glosses.
  - Korean: Kengdic (Korean to English).
  - Vietnamese: English Wiktionary's Vietnamese entries (kaikki.org).
  - English, Spanish, French, German, Italian, Portuguese, Russian: WikDict bilingual dictionaries (read with `node:sqlite`).
  - Chinese: CC-CEDICT as before.
- Tutor, quiz, deck, card-situation and builder prompts for every language (`LANGUAGE_RULES`, `CARD_RULES`, `WORD_FORM`), Edge voices for every language, and AnkiWeb shared-deck searches per language.

**Interface languages**
- English, Simplified Chinese, Traditional Chinese, Japanese, Korean, Vietnamese, Russian, French, Italian, Spanish, German and Brazilian Portuguese. Every interface string is translated (about 1,270 per locale).
- The interface follows the Mac's preferred languages by default (`app.getPreferredSystemLanguages()`, `matchLocale`). Settings > Preferences > Interface language and the welcome page let the learner pick one; `Settings.uiLocale` stores it (`"system"` or a locale). The macOS menu labels follow it too.
- The interface language is also the explanation language: the tutor explains grammar and corrections in it, translations go into it, and quiz feedback, card prompts and deck definitions are written in it.
- i18n without a dependency (`src/shared/i18n/`): English text is the key; `t`, `tn` (Intl.PluralRules), `tj` (element placeholders), `tc` (same word, different meaning) and `msg` (module constants) in the renderer; a `Translator` in core for text it builds. Fixed core errors are translated when shown (`errorText`).
- `scripts/i18n-keys.ts` collects the keys; `src/core/i18n-catalogs.test.ts` fails when a string is missing from any catalog or a placeholder differs.
- Fonts: `--ko`, `--lt` and `--cy` tokens for Korean, Latin and Cyrillic learning text, and per-locale serif and sans stacks for CJK, Russian and Vietnamese interfaces.

### Changed

- Learner data stays the same shape; new fields are optional (`Settings.uiLocale`, `ChatMessage.translationLang`). Cached translations made in another language are redone.
- First run no longer preselects Chinese and Japanese.
- Dev mock: every language has basic data (zh and ja keep the rich mock).

## [0.6.1] - 2026-10-01

Fixes from the benchmark judge (run `2026-10-01T17-47-57`): the tutor did not bring back the previous session's mistakes, and often asked two questions per reply.

### Fixed

- **Revisiting grammar across sessions.** "Grammar to revisit" now lists recent misses first (most recent first), numbered, with the learner's own words and when it happened ("Last missed in an earlier session (2 h ago): ..."). The tutor is told to make item 1 the priority within its first two replies, and may refer back to the earlier session once (never repeating the old correction). A later correct use clears the miss line. The home screen's follow-up list uses the same order.
- **One question per reply.** The persona rule now says exactly one question mark per reply, never two questions.

### Changed

- Bench: the judge's reply is parsed by scanning for top-level JSON objects (handles code fences, prose, braces inside strings, and replies split over several objects) and retried once when nothing usable comes back. The selftest covers these cases.

## [0.6.0] - 2026-10-01

Anki on the welcome page and an Anki deck generator (S2-14 to S2-16). Feature map: `docs/stage2.md`.

### Added

**Welcome page: learn words with Anki (S2-14)**
- New step 3, "Learn words with Anki" (marked strongly recommended): Sayfern assumes you can read some words; it can start you from zero, but learning vocabulary with Anki alongside is much easier and faster, and we recommend memorizing at least the 1,500 most common words first. Two paths: "Use a shared deck" (a button per chosen language opens AnkiWeb's shared decks searched for that language) or "Make one with your model" (finishing the welcome page opens the deck generator). Also explains AnkiConnect, with "Connect Anki now" and "Decide later".
- Settings > Preferences > Debug (dev builds only, `import.meta.env.DEV`): "Show welcome page" reopens the welcome page, with "Close preview".

**Anki deck generator (S2-15)**
- New screen `#/decks` (from the welcome page and Settings > Anki > Get a deck): "What do you want to learn?" in your own words (for example "top 1,500 most common words according to SUBTLEX-CH", "the most common foods", "common sayings"; one-click examples; a number in it offers to set the deck size), level (from zero, HSK 1-6, N5-N1), size (10 to 2000 cards), order (most useful first or grouped by theme), deck name, "skip words already in my Anki", audio and model. Shows batches, minutes and audio characters, computed locally.
- The model chooses the words, following the request (a named word list or corpus is followed in its order, continued from where the last request stopped; sayings and set phrases up to 16 characters are allowed, with ruby word by word), and avoiding words already in the learner's linked Anki decks, from the last sync. It writes 5 sample cards to approve; the learner can ask for changes, and those notes go with every later request. Then batches of 25 cards: the word list is topped up as needed, Anki is checked before any tokens are spent, and progress is saved after every batch, so a big deck can be finished over several sittings ("Keep going until it's done" runs batch after batch).
- Sayfern's tooling on every card: the reading is checked against CC-CEDICT or JMdict and fixed when the model got it wrong (the card says so), conjugated Japanese words are found in their sentence, ruby for the word and the whole sentence is built locally (pinyin-pro / kuromoji, okurigana outside the ruby), HTML is escaped, and cards with no usable sentence or reading are dropped.
- New "Sayfern Vocab" note type (front: word and sentence; back: ruby, reading, meaning, sentence with ruby, translation, notes, audio), tagged `sayfern`, `sayfern::deck` and the level. After the first batch Sayfern follows the new deck (Settings > Anki lists it under the language as "Also following"), so the tutor practises its words.

**Audio for deck cards (S2-16)**
- ElevenLabs: connect your own account with an API key (stored encrypted with the model sign-ins), pick a voice, see credits left this month. Uses Flash v2.5. When credits run out or the key stops working, the rest of the batch uses the free voices and the project says so.
- Free Microsoft Edge voices (the service /ankigen uses through edge-tts), spoken directly from Node: a different voice for the word and the sentence. Clips are cached in `records/deck-audio/`, so samples and retries never pay twice.

### Changed

- `AnkiService.storeMedia` (AnkiConnect `storeMediaFile`). `Stage2Deps.credentials`. `Settings.elevenLabsVoice`.
- The ruby splitter moved from `src/renderer/src/lib/ruby.ts` to `src/shared/ruby.ts` (used by the renderer and the deck cards).
- Settings > Anki edits only the first deck of each language; other followed decks stay and can be removed with "Stop following".
- Renderer CSP allows `media-src 'self' data:` (sample card audio).
- "Erase all data" also stops deck jobs.

## [0.5.0] - 2026-10-01

Stage 2: review, quizzes and the feature builder (S2-01 to S2-13). Feature map: `docs/stage2.md`.

### Added

**Review > Corrections (S2-01, S2-02)**
- Every correction across sessions, newest first: the learner's sentence with the problem struck in red pen, the fixed sentence with the change highlighted, the explanation, kind, date, and links to the session and the grammar point. Status chips: "Fixed on retry", "Answer shown", "Not fixed yet", "In Anki". Disputed corrections stay visible, dimmed, with the learner's note.
- Filters: kind chips (All / Grammar / Vocabulary / Phrasing, with style suggestions under Phrasing) with locally computed counts, search (sentence, fix, explanation, session title, grammar pattern or name), status (to practise, fixed on retry, not in Anki yet, not a mistake) and grammar point.
- "Hide answers and retry" (remembered) hides every fix behind an inline, IME-safe retry box with Check and Show answer. Each correction also has "Try again" and "Not a mistake?". These reuse `checkRetry`, `revealCorrection` and `disputeCorrection`; "Show answer" never downgrades a correction already fixed on retry.

**Anki export of corrections (S2-03)**
- "Select for export" and a "Make Anki cards" panel: Fill the gap (cloze) or Situation → sentence, Front/Back preview, "Card i of N" (arrow keys too), an editor for every field, a deck picker (existing decks plus the last one used for the language) and "Add N cards to Anki". The result reports added, already there and failed cards. Drafts and edits survive errors, style switches and selection changes. Disputed corrections can't be selected.
- Cloze cards are built locally: the corrected sentence with the fix as the gap and an English hint (grammar point name, dictionary gloss, or a hint by kind). Situation prompts come from one batched model call, with an explanation-based fallback (answer masked) when there is no model or the reply is unusable. The learner's wrong version never appears on a card.
- Sayfern creates and reuses its own note types, "Sayfern Cloze" and "Sayfern Recall", so export works with any note types or locale. It creates the deck if needed, checks duplicates first, and tags notes `sayfern`, `sayfern::<kind>` and the grammar id. Exported corrections remember `exportedAt` and their note ids; the deck is remembered per language (`AnkiConfig.exportDecks`).

**Quizzes (S2-04 to S2-09)**
- Review > Quizzes: a builder written as a sentence ("Quiz me on grammar from my mistakes, at my level, as mixed formats, for 10 questions.") with popovers for focus, source, level, format and length. Sources show local counts and are disabled with a reason when empty. Shows "About N minutes", a format preview, recent quizzes with scores and an exam provenance banner.
- Focus: grammar, vocabulary, real-life scenes, exam prep or a mix. Sources: previous mistakes (chat corrections and earlier wrong quiz answers), Anki words (this week's, hardest, all), chosen grammar points, a library book or chapter, personal learning targets, saved words. Levels: current level, HSK 1-6 (HSK 2.0), HSK 1-6 and 7-9 (HSK 3.0), JLPT N5-N1. Formats: multiple choice, fill the gap, sentence order (tiles), written answers, role-play; by question count or target minutes.
- Generation: one strict-JSON request per 10 questions (parallel), one top-up request for unusable slots, cancellable. Every item is validated locally: multiple choice needs exactly one key among distinct options, cloze one gap, ordering tiles are cut locally from the answer sentence and must join back to it, open formats need a model answer and a rubric.
- Grading: fixed formats on this Mac with the language pack's `normalize()`; written and role-play answers by the model (correct, incorrect or uncertain, one line of feedback, a better version), "uncertain" when the model can't be reached.
- Quiz screen (`quiz/<id>`): one question at a time, keys 1-4, Enter to check and continue, Backspace removes the last tile, hover lookup (hidden for word questions until answered), end early, and a summary with score, grammar to look at again, "Quiz me on my mistakes" (no model call) and delete.
- Provenance: every quiz states what it is aligned to ("HSK 3 (HSK 2.0 levels)", "JLPT N4", "your level") and "Not official exam material."
- Finishing a quiz records grammar evidence as quiz practice (`origin: "quiz"`, `quizId`, `sessionId: "quiz:<id>"`, `assistance: "prompted"`). Revealed answers are not evidence. Quizzes are in the data export (`quizzes`) and removed by "Erase all data".

**Customize: the feature builder (S2-10 to S2-13)**
- Describe a feature and Sayfern builds it with the learner's model: it reads a read-only builder kit (guide, SDK reference, public extension types, examples), writes files into a draft version, runs the feature's tests and finishes. A live checklist (counts from code) shows progress; Stop any time; "Ask for changes" builds a new version of the same feature.
- Sandboxed feature UIs: `tab` surfaces (a sidebar entry) and `activity` surfaces (a tile under "Your activities" on Today). Pages load from `sayfern-feature://<id>/v<n>/…` into `<iframe sandbox="allow-scripts">` with a strict CSP, and reach Sayfern only through `window.sayfern`: context, Anki words, grammar, saved words, lookup, annotate, per-feature storage (256 KB) and practice results. A Sayfern stylesheet makes features look native. Live preview of the draft in Customize.
- Feature tests run where the UI runs: a hidden, sandboxed window on a locked-down, in-memory session with no network, killed after 8 s. Pass and fail counts come from the runner, not the model.
- Review gate: versions with code that runs with full app access (tutor tools, prompt additions, language packs) show "Needs your review". The review sheet lists every file, flags every script outside `ui/` as full access, and offers "I've read this code, turn it on". The approval stores the version's hash and freezes a read-only copy in `approved/<hash>/`; the extension host loads full-access code only from that copy and only when its hash matches. Full-access code may import only its own files statically (no `require`, computed `import()`, `eval`, `new Function`, `node:vm`, `process.dlopen`).
- Versions: every build is a new sealed (hashed, never rewritten) version. Turn on, turn off, roll back, discard a draft, delete a feature.
- Hand-installed extensions are listed in Customize ("Installed by hand") with on/off switches.
- Second example extension `examples/extensions/measure-word-drill` (tab and activity, 12 tests). Builder guide `docs/feature-builder.md` and SDK types `docs/feature-sdk.d.ts`; `docs/extensions.md` documents surfaces, the SDK, versions, the review gate and the trust model.

**Foundation**
- Review in the sidebar (⌘4) with Corrections and Quizzes tabs; Progress moves to ⌘5. Routes `review`, `review/quizzes`, `quiz/<id>` and `feature/<id>/<surface>`.
- Mock backend: Stage 2 slots (`dev/mockReview.ts`, `mockQuiz.ts`, `mockBuilder.ts`) over a shared `dev/mockWorld.ts`, with more corrections in both languages, a seeded measure-word drill, and simulated model delays.
- Headless Electron check of the feature sandbox: `SAYFERN_E2E_BUILDER=1` with `SAYFERN_E2E_DATA=<dir>` (`src/main/e2e.ts`).

### Changed
- Stage 2 API methods live in per-feature slots (`src/shared/stage2/review.ts`, `quiz.ts`, `builder.ts`) merged into `SayfernApi`; core services in `src/core/review`, `quiz` and `builder` are bound onto `SayfernApp` with `bindSlot` (`src/core/stage2.ts`). New event channel `evt:builder`.
- Stage 2 screens have their own stylesheets in `src/renderer/src/styles/` next to `styles.css`.
- Grammar summaries keep quiz evidence apart: counts, rate and last use are conversation only; quiz answers go to `GrammarSummary.quiz`. A correct quiz answer can move a point from "introduced" to "with help", never to "on your own". The Grammar page links quiz attempts to their quiz and shows "In quizzes: X of Y right."
- `AnkiService` can create note types, decks and notes (`ensureNoteType`, `ensureDeck`, `addNotes`).
- "Erase all data" stops quiz generations and builds first, and also removes what built features stored (`builder/data/`); built features stay, like `extensions/`. "Export your data" includes quizzes, built features and their data.
- The app window's session has no network: feature frames can't reach the web, loopback (in production) or STUN/TURN, and get no permissions. Main's own HTTP (dictionary downloads) uses a separate `sayfern-net` session. Sub-frames can't navigate outside `sayfern-feature:`.
- Customize is no longer a placeholder (the "SOON" badge is gone); the Settings > Extensions tip points to it.

### Fixed
Found in review before this release:
- Follow-ups on Today and in the tutor prompt use conversation evidence only (`lastConversationVerdicts`), so a quiz answer can't hide a recent miss in conversation or steer what the tutor brings back.
- Multiple-choice items whose key is missing from four or more options are dropped instead of repaired, so a quiz can't show two right-looking options.
- Builder hardening: tests no longer run in-process under `node:vm` (escapable); full-access code is checked statically and loaded from a frozen approved copy; two quick builds of one feature can't race into one version folder (per-feature lock, exclusive version folders); erase stops running builds; test durations use the injected clock.

Also fixed:
- Session composer: the Stop button picked up the reader's "you stopped here" marker styles (negative margins, dashed line). The reader rule is now scoped to its marker.

## [0.4.0] - 2026-09-30

### Added
- Benchmark suite (`bench/`, `npm run bench`) comparing Sayfern with Claude Code + the `mandarin-thinking-practice` skill on identical scripted sessions: same model, learner messages, Anki cards, reader and prior history. A recording proxy captures every model request from both harnesses (tokens, cache, fixed system + tool overhead via `count_tokens`, tool calls and errors, plan-utilization headers); a fake AnkiConnect serves both from one Anki collection. Reports context and estimated plan-limit usage, Anki grounding and grammar-correction accuracy (deterministic, plus an optional blinded judge). Five Chinese scenarios, a public synthetic fixture set, `snapshot-private` for your real wiki/Anki/reader, and an offline `selftest`. See `docs/benchmark.md`.

### Changed
- `npm run typecheck` also checks `bench/`.
- Every benchmark request uses one model (default `claude-sonnet-5-5`): Claude Code's background and subagent models are pinned via environment variables, and the report warns if another model appears on the wire.

## [0.3.1] - 2026-09-30

### Added
- App icon: the Sayfern fern on the sidebar green (`build/icon.svg`, `icon.png`, `icon.icns`).

### Changed
- The app is called "Sayfern" instead of "Electron" in the Dock, menu bar, Cmd-Tab, About panel and menu items. In dev, `scripts/brand-electron-app.mjs` renames and re-signs node_modules' `Electron.app` (macOS may ask once more for Keychain access: choose Always Allow). The internal name stays `sayfern`, so data and saved sign-ins are untouched.

### Fixed
- Docs named the Keychain prompt "Electron Safe Storage"; it is "sayfern Safe Storage".

## [0.3.0] - 2026-09-30

### Added
- Settings > Data > Start over: "Erase all data" deletes every session, correction, grammar record, saved word and level, the library, settings and the Anki link, then opens onboarding. Downloaded dictionaries and installed extensions stay. "Keep model sign-ins" (on by default) keeps API keys and subscription sign-ins. Confirm by typing `erase`.

### Changed
- Main builds the backend in `buildApp()` and resolves it on every IPC call, so it can be rebuilt after an erase without restarting the app (restarting would also stop `npm run dev`).

## [0.2.2] - 2026-09-30

### Fixed
- Grammar: "Explain again" always failed with "The tutor is still starting this session". It started a practice session and sent a message while the tutor's opening was still running. The request now goes into the opening itself: the tutor opens with a fresh explanation and a new example, then invites you to use the pattern.

## [0.2.1] - 2026-09-30

### Fixed
- Settings > Anki: choosing a deck did nothing. The deck was saved without a word field, and the config loader silently dropped mappings with no word field, so the dropdown snapped back to "Choose a deck". Decks are now kept while their fields are chosen, and sync asks for the word field if it's missing.

### Added
- Developer documentation: `AGENTS.md` (entry point for coding agents), `CLAUDE.md`, `docs/architecture.md`, `docs/decisions.md`, `docs/roadmap.md`; `docs/stage1.md` now shows a status per feature.

### Changed
- Settings > Anki: after you pick a deck, Sayfern preselects the likely word, reading and meaning fields (for example Hanzi, Pinyin, English). You can still change them.

## [0.2.0] - 2026-09-30

### Added
- Anki: the tutor now knows your whole vocabulary. Sync pulls every card of the linked decks (new cards included), each card's status (new, learning, review, suspended, buried), its place in the new-card queue, the leech tag and 90 days of review history.
- Anki word model: cards are grouped by word (recognition + production count once) into known, learning, new and suspended words, with a struggle score from lapses, recent "again" answers, low ease, relearning, leeches and slow answers, plus short reasons ("8 lapses", "failed 4 of last 9").
- Tutor tools: `anki_overview`, `anki_struggling`, `anki_vocabulary` (paged lists; "new" is in the order you will learn them) and `anki_check_words` (does the learner know these words?). `anki_lookup` shows the new card details. All results say when Anki was last synced.
- Tutor prompt: a short "Anki knowledge" block (word counts, hardest words, next new words) with guidance to stay within known vocabulary, check unfamiliar words, weave hard words in naturally and introduce at most one new word per reply.
- Settings > Anki: each deck card shows known / learning / still new / struggling counts and a collapsible "Hardest right now" list.
- Background refresh: Anki syncs at startup and when a session starts if the snapshot is more than 6 hours old, without blocking the app. "Sync now" still works.

### Changed
- Practice targets: the "difficult" half now comes from struggle scores instead of lapses and ease alone.
- Anki tools are only offered to the model when Anki is on and the language has been synced.
- Snapshots cached by 0.1.x keep working; statuses are inferred until the next sync.

## [0.1.1] - 2026-09-30

### Fixed
- Anki: Sayfern now talks to AnkiConnect with Node's fetch instead of Chromium's network stack, so system proxy settings can't intercept `127.0.0.1`.
- Anki: timeouts raised (8 s per call, 20 s for bulk syncs). Busy or backgrounded Anki was being reported as unreachable after 3 s.

### Added
- Anki troubleshooting in Settings > Anki: the exact reason a connection failed (not running, asleep because of macOS App Nap, blocked, wrong app on the port), a fix for each, a copyable App Nap command, a Terminal check, and a "Test connection" button.

## [0.1.0] - 2026-09-30

First Stage 1 build: text learning for Chinese and Japanese.

### Added
- Onboarding, Today, Session, Library + Reader, Grammar, Progress, Settings screens.
- Sign in with Claude Pro/Max or ChatGPT, or use API keys (pi-ai provider layer).
- Tutor with inline or end-of-session corrections, retry before reveal, and disputes.
- Hover lookup with pinyin/kana and CC-CEDICT / JMdict dictionaries; save words with their sentence.
- Grammar catalogue with every attempt, correct/incorrect/uncertain counts and assistance states.
- Library import (txt, md, html, epub, pdf with a text layer), reading checkpoints, tutor-assisted reading.
- Anki (AnkiConnect) practice targets, placement chat, local progress stats, JSON export, extension host.
