# Changelog

Sayfern follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.
While the major version is 0, minor versions add features and patch versions fix bugs.
Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [0.29.0] - 2026-10-10

### Added

- **Usage beside each provider.** The connect screen (Settings > Models, welcome page) shows what is left under each connected provider (ADR 38):
  - Claude Pro/Max and Sign in with ChatGPT: the 5-hour and weekly limits, with the percent left and the reset time.
  - DeepSeek: the account balance. OpenRouter: the credit left on the key, if the key has a limit.
  - OpenCode Go: the 5-hour, weekly and monthly limits.
  - Every API key: what Sayfern spent on this computer today and in the last 30 days, at list price. Google shows requests and tokens instead, because AI Studio's free tier does not report its limits.
  - A link to the provider's billing or usage page.
- **Usage log.** Every model call made with an API key (chat, quizzes, grading, decks, card drafts) is counted in `records/usage.json`. Subscription sign-ins and local models are not counted.
- **OpenCode Zen and OpenCode Go** as API-key providers.
- **API.** `providerUsage(providerId)`.

## [0.28.0] - 2026-10-10

### Added

- **Local models (llama.cpp).** Connect a `llama-server` on your own computer from the connect screen, in Settings or on the welcome page. Sayfern asks the server for its models and context size, and chats through its OpenAI-compatible API. No account or key is needed (a key is optional). Start the server with `--jinja`, so tool calls work. See [`docs/local-models.md`](docs/local-models.md) (ADR 37).
- **One engine table.** `LOCAL_ENGINES` (`src/core/local/engines.ts`) holds each engine's default URL, note and model listing, so Ollama, LM Studio, vLLM or MLX-LM are a small change. The guide lists notes for each.
- **API.** `connectLocal(engine, baseUrl, apiKey?)` saves a server only if it answers and returns its models. `disconnectLocal(engine)` removes it. Saved servers live in `settings.json` under `localServers`.
- **Docs.** New `docs/local-models.md`: install, model advice, troubleshooting, and how to add another engine.

## [0.27.0] - 2026-10-10

### Removed

- **Customize screen and AI feature builder.** The builder agent, its kit, feature versions and rollback, the review gate, the Customize screen, and the built tabs and Today activities are gone (S2-10..S2-13). Sayfern is open source and documented, so people change the code with a coding agent instead (ADR 36). Review, quizzes and Anki decks stay.
- **Extension system.** The extension host, Settings > Extensions, `listExtensions` and `setExtensionEnabled`, the `extensions/` folder, and the examples in `examples/extensions/` are gone (F-09). Existing `extensions/`, `extensions.json` and `builder/` folders in your data folder stay on disk and are ignored.
- **Feature sandbox.** The `sayfern-feature://` scheme, sandboxed feature frames, the feature SDK and RPC, the feature test runner and the headless `SAYFERN_E2E_BUILDER` check are gone. The docs `feature-builder.md`, `feature-sdk.d.ts` and `extensions.md` were deleted.
- **Window network lockdown.** It only kept feature frames offline. Main's downloads now use the default session.
- **Fireworks provider.** The Fireworks API key option is gone from the connect screen, the README and the website, because it was never tested. A saved Fireworks model falls back to the default pick.

### Changed

- **Website.** Feature card #6 now says Sayfern is open source and documented for coding agents, in all 12 site languages.

## [0.26.0] - 2026-10-10

### Changed

- **Translate one message at a time.** The Translate chip at the top of the session is gone. Each tutor message has its own Translate button, next to Copy, that shows or hides the translation of that message. "Translate the tutor automatically" (Settings) still shows every translation at the start; the button hides one.

### Fixed

- **Learner bubble too narrow.** Since the Copy button (0.22.0), the learner's bubble wrapped at about half the column. It now uses the full width again, and its limit went from 82% to 94% of the column (up to 1000 px).

## [0.25.0] - 2026-10-10

### Changed

- **New topic asks a real question.** The tutor now opens the new topic with a get-to-know-you question from a list of 263 (for example "What is the most memorable meal you've ever had?"), asked in the target language and in its own words. Each question has a CEFR level for how hard it is to answer, and the pick is at most two levels above the learner. "Go easier" lowers the limit, "go harder" leaves out questions below their level. Questions already asked in that language are skipped until all are used (ADR 35).

## [0.24.0] - 2026-10-09

### Changed

- **One place per tutor rule.** The tutor's instructions said many things two or three times (how to bring in a target, never name the pattern, the correction kinds, "copy `original` exactly", "call record_evidence once", the explanation language, the level target). Each rule is now written once, and contradictions are gone (ADR 34). The system prompt is 15 to 31% shorter, depending on the session.
- **Tuning numbers in one object.** `TUNING` (`src/core/agent/tuning.ts`) holds every number that steers the tutor, each marked as measured or not.
- **One meaning of "mistake".** Pacing now uses `countableCorrection` (`src/core/records/corrections.ts`), like quizzes: a disputed grammar correction no longer counts as a mistake.
- **Pacing.** The topic move-on now says "about 5 exchanges", which matches the count in code (it said "4 to 6"). Unit sessions and role-plays no longer get this rule next to their own.

### Added

- **Prompt snapshot test.** It renders the prompt for eight situations and fails if a prompt goes over its size budget, if a rule appears twice, or if a key rule goes missing.

## [0.23.1] - 2026-10-09

### Fixed

- **Benchmark scoring.** The deterministic grammar check now ignores markdown (a fix in **bold** counted as missed, so Claude Code showed 33% where the judge showed 96%). It also accepts more correct fixes (for example 我已经学习三个小时了, and 因为 or 由于) and finds the fix from the learner's own text. The Anki check no longer fails a reply because a forbidden word is part of a longer phrase (喜欢 in 你喜欢机器人).
- **Benchmark blocks with errors.** A block that stopped on an error (for example a rate limit) is now marked invalid. The judge skips it, and the report leaves it out of every mean and rate and lists it under Errors.

### Added

- **Benchmark evidence metrics.** A new "Evidence (Sayfern only)" section reads the stored corrections and observations after each block: corrections without a grammar id, cards per error turn, extra cards, "incorrect" observations on clean turns, and tag accuracy against new grammar ids in the gold.
- **Benchmark gold and repetitions.** Gold for the turns that had none (including the 把 sentence the tutor missed in zh-level-fit). Default repetitions go from 2 to 3, and zh-pacing runs 5. Rates show the range across repetitions, and pacing is also counted per conversation.

## [0.23.0] - 2026-10-09

### Added

- **Themes.** Sayfern now has three colour themes: Light (the default), Forest Night and Ink. Pick one in Settings > Appearance or in step 4 of the welcome page ("Pick a theme", before "Bring your materials"). Each option shows a small preview. The choice applies at once, is saved in settings, and also sets the window background and the native scrollbars and menus. Built feature frames follow the theme too.

### Changed

- **Corrections always show inline.** The Inline / After session switch is gone from the chat header and from Settings > Preferences. Corrections show under your message as you chat, also in older sessions that used After session. The summary at the end of a session already lists them.

## [0.22.0] - 2026-10-09

### Added

- **Copy a message.** Every tutor message has a copy button next to the speaker. Your own messages show one to the left of the bubble when you point at it. It copies the whole message.

### Fixed

- **The Dock says Sayfern, not Electron, when you run from source.** macOS showed the dev bundle's folder name. The bundle now has a translated display name, which macOS shows instead.

## [0.21.1] - 2026-10-09

### Fixed

- **Select chat text from anywhere.** A drag can now start anywhere in the chat, also between lines or in a message's margin, not only on a letter. Dragging across words no longer opens the word popup, and a drag inside one word no longer pins it. Hovering and clicking a word work as before.

## [0.21.0] - 2026-10-09

### Added

- **Speaking corrections.** When you talk to the tutor, it can now point out things people write but do not say aloud, such as reading "lol" or "etc." as letters.

### Changed

- **Corrections have three kinds: grammar, typo and speaking.** Grammar means the sentence does not make grammatical sense (this includes wrong words and word order). Typo means the sentence makes sense but looks wrong written out: spelling, capitals, punctuation, spacing. Old vocabulary and phrasing corrections become grammar, and old style suggestions become typos, in Review, Progress and exports.
- **Spoken messages get no typo corrections.** Their spelling, capitals and punctuation come from the speech recognition, not from you.
- **Only grammar corrections keep a topic going and feed quizzes.** A typo no longer stops the tutor from moving on, and quizzes no longer ask about typos.

## [0.20.0] - 2026-10-09

### Added

- **An English dictionary for every interface language.** Open English WordNet (English definitions, 9 MB) for English, Korean and Vietnamese interfaces, and as the fallback for the others; WikDict English–Chinese (5 MB) for Chinese interfaces. Lookups show up to 3 senses per part of speech, the most used one first. It downloads by itself like the other dictionaries, and English words are recounted with it (ADR 32).

### Fixed

- **Definitions in English no longer count as the learner's own language when they are not.** The word filter now knows each dictionary's gloss language. English glosses mark own-language words only for an English speaker, and never when English is the language learned.

## [0.19.0] - 2026-10-09

### Added

- **Role-play a situation.** Today has 16 everyday scenes under the start tiles: order at a restaurant, order a coffee, ask a shop assistant, at the checkout, ask for directions, check in at a hotel, buy a train ticket, see a doctor, book by phone, return something, meet someone new, job interview, rent a flat, at the airport, at the pharmacy, talk to a neighbour. Pick one and the tutor sets the scene and plays the other person (the server, the cashier, the doctor) at your level. Corrections work as in any chat. When the scene ends, the tutor steps out of role, says what went well and offers a new twist.

### Changed

- **Today, Course and Grammar use the full window width.** On wide screens these pages no longer stop at a fixed width and leave an empty strip on the right. The start tiles, the role-play tiles and the course units fill the extra space; on small windows they wrap as before.

## [0.18.0] - 2026-10-08

### Changed

- **Dictionaries are required and download by themselves.** After the welcome page, Sayfern downloads the dictionary of every language you learn (4 to 22 MB each), one at a time, in the background: at startup if one is missing, and when you add a language or change the interface language. You can practise during the download; your words are recounted with the dictionary when it finishes. A failed download shows in Settings > Dictionaries with a retry. English with a Chinese, Korean or Vietnamese interface has no dictionary yet and keeps the built-in word lists (ADR 31).

### Fixed

- **Startup no longer loads every language to recount words.** The one-time recount from 0.17.1 loaded each language's dictionary (and the Japanese tokenizer) at every startup, even for languages you do not learn. It now checks first, without loading anything, and loads a language only when it has stored words to recount under a new filter key.

## [0.17.1] - 2026-10-08

### Fixed

- **Words in the learner's own language no longer count as learned words.** Since beginners may write in their own language (0.17.0), English words in a Spanish session counted as Spanish words you wrote. Now only words of the language you learn count (ADR 30):
  - Words in the wrong script never count (English in a Korean or Russian session; a Japanese clause in a Chinese session).
  - In languages written in the Latin alphabet, each word is checked against the dictionary. A word only in your own language never counts. A word in both languages with the same meaning (hotel, no) counts. Unclear words follow the rest of their clause.
  - Without a dictionary, built-in lists of common words decide. Installing the dictionary makes the check better.
- **Stored words are recounted once.** At startup, Sayfern recounts the words of every message you wrote with the new check and rebuilds "Words you wrote" and first uses. It runs again after you install a dictionary for that language.

## [0.17.0] - 2026-10-08

### Added

- **Mission: from 1 to infinity.** Sayfern is for learners who already know some of a language and want to go much further through conversation. It does not try to replace a first course (0 to 1), but beginners are welcome. Written down in the README, `AGENTS.md` and ADR 29.
- **Pick a band before placement.** "5-minute chat" (Today), "Find my level" (Settings > Languages) and "Not sure" (welcome page) now ask Beginner, Intermediate or Advanced first. Each card shows the levels it covers (a third of the scale: A1-A2, B1-B2, C1-C2). The band is saved on the session (`SessionMeta.levelBand`, `startPlacement(language, band)`), and the diagnostic starts there instead of guessing.
- **Gentle placement for beginners.** A placement chat started as a beginner writes its instructions in the learner's language, first checks whether they know any words at all, and stops after 2 or 3 tasks if they do not (lowest level, low confidence). It then suggests where to start.

### Changed

- **Beginners may write in their own language.** At the bottom quarter of the scale (or in a beginner placement chat), the tutor no longer asks the learner to switch back to the target language. It answers in very simple target language, shows how to say what they meant, and may add a short gloss for a key word. Other learners keep the old rule.

## [0.16.2] - 2026-10-08

### Fixed

- **Fewer unnatural sentences from the tutor.** In bench run `2026-10-08T05-41-04` the judge found 9 Mandarin errors in Sayfern's replies against 2 for Claude Code. Most came from targets forced into a short reply: 敢 and 需要 from the course unit ("我也很敢说错", "敢不敢早点回家休息"), an Anki word ("你今天和朋友一起去食堂的吗"). At HSK 3 a reply had 2 or 3 sentences to answer, bridge, use a target and ask one question, so the target went into the question. The targets stay the same; a reply that brings one in may now grow to set up a natural context for it, with a hard cap of 4, 6 or 8 sentences by level (5 when the level is unknown; `lengthRule`). The persona also says to use each target with its real meaning, and not to comment on its own earlier questions.
- **The "no reply yet" note no longer reads as a prompt injection.** The model took the instruction inside the `record_evidence` result for an injection and told the learner so. The result now says only "No reply text yet."; the tool protocol in the system prompt says what to do.

## [0.16.1] - 2026-10-07

### Added

- **Benchmark: course unit scenario** (`bench/scenarios/08-course-unit.json`, `zh-course-unit`). Shows what Sayfern's course tooling adds over plain Claude Code. The learner works through HSK 3.0 unit `zh-hsk30-3-12` ("Complex sentences", 7 points) with a quick overview first. Sayfern opens it with `startUnit`; Claude Code keeps its skill without a course and gets the unit's patterns in the learner's first message (`prompts.open.unit` / `unit-explain`). New session mode `unit` (`unit`, `explain`).
- **Benchmark: simulated learner** (`bench/lib/learner.ts`). A session can set `learner` (turns, persona, plan) instead of fixed turns: a model (`learner.model`, default `claude-haiku-5-5`, outside the proxy) writes each message after reading the tutor's reply, and reports the mistakes it made on purpose, which become the gold. `zh-course-unit` uses it for 20 messages, with five planned mistakes on unit patterns and three points kept out until the tutor brings them in. The report has a "Simulated learner" section. The judge's `claude -p` call moved to `bench/lib/claude-cli.ts`, shared with the learner.
- **Benchmark: per-point judge verdicts and a teaching rating.** For unit sessions the judge returns, per grammar point, `explained` (opening overview), `modeled` and `elicited` (conversation after the opening), and a 1-5 `teaching` rating. The report has a new "Course unit teaching" section with totals and a table per point. Missing point verdicts count as ungraded and are asked again. See `docs/benchmark.md`.

### Changed

- **Benchmark run log names the arm on every line.** Block headers and step lines start with `[Sayfern]` or `[Claude Code + skill]` (green and magenta on a terminal; `run.log` stays plain), and steps read `session 1 · turn 3` instead of `s1 turn 3`, which looked like an arm name.

## [0.16.0] - 2026-10-07

### Added

- **Installers, built on every push to `main`** (`.github/workflows/release.yml`): a macOS `.dmg` for Apple silicon and for Intel, a Windows `.exe` (NSIS) and a Linux `.tar.gz` plus a `.flatpak` bundle. When `package.json` has a new version, the run also publishes a GitHub release `v<version>` with them and this changelog's section as notes. See `docs/packaging.md`.
- `electron-builder.yml` (new dev dependency `electron-builder`) and `npm run dist`. The macOS app has an ad-hoc signature until a Developer ID is set up.
- Flatpak and Flathub files in `flatpak/` (app ID `ca.sayfern.Sayfern`) and `scripts/flatpak.mjs`, which writes the CI build folder and the Flathub submission folder.

### Fixed

- Packaged builds now ship the feature builder's kit, so `list_kit` is no longer empty there (roadmap gap 6). A test checks that `electron-builder.yml` lists every kit file.

## [0.15.0] - 2026-10-07

### Changed

- **Course screen redesign**, built for the full-syllabus courses and the whole window width:
  - A **syllabus map**: one dot per grammar point (573 for Chinese, 1,239 for English), grouped by level and colored by the learner's state (new, introduced, with help, on your own), with the next unit's points marked. Each level tile shows its count and picks the level shown below; hovering a dot shows its pattern and unit.
  - A dark **Up next** card with the unit's patterns as chips, its progress and the Continue button.
  - The level's units as a **responsive grid** instead of one long column: numbered cards with a segmented bar (one segment per point), the patterns as chips (state colors, "+N" for the rest) and the points used on their own.
  - A **unit drawer** that lists every point with its pattern, name and state, and asks "Go over this unit's grammar quickly first?" there (no second dialog).
  - An overall progress ring in the header.
- `UnitView.points`: each point's pattern, name and state, computed in `buildCourseView`.

### Added

- Mock backend: `?lang=<code>` starts in another learning language, to preview its course.

## [0.14.0] - 2026-10-07

### Added

- **Full-syllabus Chinese course.** `src/shared/course/zh.ts` now has every point of the HSK 3.0 grammar syllabus (GF 0025-2021, appendix A): 573 points in 92 units, levels 1 to 9, at the syllabus level and in its order. Units follow the syllabus groups (word classes, phrases, fixed patterns, complements, complex sentences, questions, emphasis, spoken patterns) inside each level.
- **Full-syllabus English course.** `src/shared/course/en.ts` now has every point of the English Grammar Profile: 1,239 points in 215 units, A1 to C2, grouped by the profile's categories. Only its numbers, levels and categories are used; every name, note and example is written for Sayfern.
- `CourseGrammar.ref`: the point's number in the source (`HSK 3.0 #57`, `EGP 412`). A test checks that each course covers its source list exactly once.
- **European Portuguese interface** (`pt-PT`, "Português (Portugal)"). macOS regions other than Brazil (pt-PT, pt-AO, ...) now pick it; bare `pt` and `pt-BR` keep Brazilian.
- 102 new unit titles and course sources in all 12 catalogs.

### Changed

- **Portuguese is now European Portuguese** as a learning language: the tutor's variety and address (`tu`), quiz and deck prompts, Edge voices (`pt-PT-RaquelNeural`, `pt-PT-DuarteNeural`), samples, and the Portuguese course notes and words. The course source line is now "QuaREPE descriptors".
- The `course` tool's overview lists at most 40 open units, the learner's level first, with the first patterns of each.
- The Course screen clamps a unit's pattern list to three lines (full list on hover).
- `docs/courses.md` describes full-syllabus and core-path courses; the roadmap marks the other courses as core paths.

### Removed

- The old Chinese (37) and English (32) themed units and their titles. Sessions started from them still open, without the unit block. Grammar ids were reused, so recorded progress still counts.

## [0.13.0] - 2026-10-06

### Added

- **Courses for Spanish, English, Italian, German and Portuguese.** These five languages are no longer Beta. Each course has 32 units on the CEFR scale (7, 7, 6, 5, 4, 3 from A1 to C2), built by following `docs/courses.md`:
  - Spanish (`src/shared/course/es.ts`): the Plan Curricular del Instituto Cervantes. Notes give Latin American use first, as the tutor does. Reuses `es:subjunctive-ojala`.
  - English (`src/shared/course/en.ts`): the English Grammar Profile. Reuses `en:present-perfect`.
  - Italian (`src/shared/course/it.ts`): the Profilo della lingua italiana. Reuses `it:passato-prossimo`.
  - German (`src/shared/course/de.ts`): Profile deutsch and the Goethe-Zertifikat guides. Reuses `de:dative-prepositions`.
  - Portuguese (`src/shared/course/pt.ts`): QuaREPE levels in the order of Brazilian textbooks. Notes give Brazilian use first. Reuses `pt:personal-infinitive`.
- Unit titles reuse the existing title keys where the theme is the same, so only six new strings (five course sources and "Literary and formal style") were added to all 11 catalogs.
- The mock backend opens units of the new courses in their language.

### Changed

- Russian and Vietnamese are now the only Beta languages. Tests that used Spanish as the example Beta language now use Russian.

## [0.12.0] - 2026-10-06

### Added

- **Quick grammar overview before a course unit.** When the learner picks a unit (Course screen or the Up next card on Today), a dialog asks "Go over this unit's grammar quickly first?". Yes: the tutor's opening starts with a short summary, one line and one example per grammar point, then starts the conversation. The summary is a reminder and does not replace the learner's textbook. No: the unit opens as before.
- `startUnit(unitId, { explain })`; the choice is saved on the session as `openWith: "explain"` (the same field Grammar's "Explain again" uses), so it rides in the opening (`kickoffText`, `UNIT_OVERVIEW` in the unit session block of `prompt.ts`).
- `components/UnitStart.tsx` (styles `cr-ask` in `styles/course.css`), four new strings in all 11 catalogs.
- Tests: the overview prompt and kickoff for a unit session, and `startUnit` saving the choice.

## [0.11.0] - 2026-10-06

### Added

- **Courses for Japanese, Korean and French.** These three languages are no longer Beta: each has a Course screen, the `course` tutor tool and the course block in the prompt, like Chinese. Each course has 32 units, built by following `docs/courses.md`:
  - Japanese (`src/shared/course/ja.ts`): JLPT N5 to N1, in the order of Genki I and II, then Quartet and Tobira. It reuses the grammar ids the tutor already records (`ja:te-iru`, `ja:tai`, `ja:tara`, `ja:te-kara`, `ja:i-adj-past`, `ja:noni`).
  - Korean (`src/shared/course/ko.ts`): TOPIK 1 to 6, in the order of the Sejong Korean and Yonsei Korean series, with romanized grammar ids (`ko:go-sipda`, `ko:aseo-eoseo`, ...).
  - French (`src/shared/course/fr.ts`): CEFR A1 to C2, after the CEFR Référentiels for French. It reuses `fr:passe-compose-etre`.
- Every new unit title and course source, translated in all 11 catalogs.
- Tests: next unit at the learner's level for the three new courses, and the Korean course block in the prompt.

### Changed

- The `course` tool's unit text joins core words with commas for languages that do not use 、 (only Chinese and Japanese use 、).
- Tests that used Korean as the example Beta language now use Spanish.
- The mock backend opens a course unit in the unit's language, not always in Chinese.

## [0.10.2] - 2026-10-06

### Added

- **`docs/courses.md`**: how to write a language's course, so future work follows the Chinese one: picking the textbook order, cutting levels into units, the rules for every field (stable ids, reusing the grammar ids the tutor records, own wording, no copied textbook text), registering and translating, and the checks to run.
- **ADR 26** in `docs/decisions.md`: why the course works the way it does (one data file per language, status from records only, all units open, a small prompt with the full course behind a tool, Beta for languages without a course, pacing from counted facts).
- Links to both from `AGENTS.md`, `docs/architecture.md` (section 19, test table) and `docs/roadmap.md`.

## [0.10.1] - 2026-10-06

### Fixed

- **Empty tutor replies** (bench `zh-pacing`, run 2026-10-06T17-15-47: 3 of 20 Sayfern turns, 1 more in run 2026-10-06T17-05-36). Sonnet 5.5 with adaptive thinking sometimes wrote its reply inside its thinking, called `record_evidence`, read "Recorded." and ended the turn, so the learner saw "The model sent an empty reply". When a recording-only tool runs before any reply text, its result now tells the model the learner has not seen a reply yet and asks for one (`NO_REPLY_YET` in `src/core/agent/turn.ts`); the tool protocol also says thinking is never shown. Re-run (2026-10-06T19-20-35, 3 reps): 0 empty replies in 30 turns.
- **Benchmark: `npm run bench -- doctor` failed on its second run** ("table col already exists"): the sandbox from the last run was reused. It is now cleared first.

## [0.10.0] - 2026-10-06

Owner feedback, 2026-10-06: conversations feel dull. The tutor stays on simple topics far too long and does not know when to move on. Asked for a per-language plan of where a learner should be at each level (from the textbooks), shown Duolingo-style, with languages that have no plan marked Beta.

### Added

- **Course** (Chinese): 37 units from HSK 1 to HSK 7-9 in the HSK Standard Course order (HSK 3.0 syllabus for 7-9). Each unit has a goal, grammar points with the ids the tutor already records, topic ideas and core words (`src/shared/course/`). A new **Course** screen (⌘2; the other shortcuts move up by one) shows the path by level, with each unit Done, In progress or New, counted from your grammar records, and the unit to do next. Every unit is open. Starting one opens a practice session in which the tutor works through the unit's points one at a time. Today shows the next unit.
- **`course` tutor tool**: the tutor can look at the course (where you stand, the next unit, any unit's grammar, topics and words) when it wants to move on.
- **Beta languages**: languages without a course (all but Chinese for now) show a Beta chip in the language pickers. The tutor still works, with no level-by-level plan, so results may vary. `docs/roadmap.md` lists which textbook order each language will follow.
- **Benchmark: conversation quality.** Judge ratings (1 to 5) for engagement, pacing and level fit; per-turn checks that the tutor moved on when the topic was used up and stayed when the learner was invested; reply length and questions per reply. New scenarios `zh-pacing` and `zh-level-fit`; `zh-long-chat` is rated too.

### Changed

- **Pacing.** The tutor answers the learner first, then moves on when a topic is used up: after about 4 to 6 exchanges, short replies, or several replies with no mistakes. It moves to a new topic or a harder angle that calls for the next grammar point. Counts come from the session's messages and corrections (`computePacing`); `record_evidence` takes `topic_change` so the count restarts after the tutor moves on (`ChatMessage.topicStart`).
- **The tutor knows what comes next.** In conversations, the prompt names the next course unit and up to 3 of its points you don't use on your own yet, to bring in one at a time.
- **Reply length follows the level**: 1 or 2 short sentences for beginners, 2 or 3 linked sentences in the middle, up to 4 sentences for advanced learners (was always 1 to 3).
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
