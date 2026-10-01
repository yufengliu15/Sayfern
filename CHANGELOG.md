# Changelog

Sayfern follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.
While the major version is 0, minor versions add features and patch versions fix bugs.
Format based on [Keep a Changelog](https://keepachangelog.com/).

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
