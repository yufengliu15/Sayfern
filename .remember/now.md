
## 00:12 | main
Added English-English WordNet dictionary provider w/ gloss-language field, updated filter & tests (all passing), docs & version updates pending.
## 00:13 | main
Added role-play scenario feature (16 tiles, 33 strings × 12 catalogs) to Today screen, widened Grammar & Course screens to fill window, tests pass (318), version 0.19.0 — pending commit & native translation review.
## 00:13 | main
Added English dicts (WordNet/WikDict) for interface langs, fixed word-filter definition-language tracking bug, bumped to v0.20.0 (concurrent v0.19.0 conflict), updated ADR 32 & docs (architecture/roadmap/README/AGENTS.md), 318 tests pass — pending commit & merge with concurrent session.
## 00:16 | main
Refactored correction types to 3-category system (grammar/typo/speaking), mapped legacy correction kinds, updated type definitions, set subagent model (claude-sonnet-5-5), spawned subagents — pending subagent execution.
## 00:18 | main
Completed renderer corrections (grammar/typo/speaking): CorrectionCard, Progress, review screens, 12 i18n catalogs (added Typo/Speaking, removed Style/Phrasing/Vocabulary), styles (corr-light), icons, mocks — tsc/catalog tests pass.
## 00:19 | main
Migrated correction kinds (grammar/typo/speaking) in core: tools.ts enum/spoken detection, prompt.ts rules/pacing, store.ts legacy codec, stats/material/cards/list; v0.21.0 (ADR 33), 322/324 pass.
## 00:20 | main
Fixed 2 version-ref comments in correction-kinds migration (v0.19→v0.21), verified (typecheck, tests 322/324), pending commit.
## 00:32 | main
Fixed chat text selection to work from anywhere in message area (modified `.convo` in styles.css, added drag-popup handling in AnnotatedText.tsx), v0.21.1, tests 322/0 pass, pending user testing & commit.
## 00:35 | main
Added copy button to all chat messages (MessageList.tsx) & fixed Dock display name to 'Sayfern' (brand-electron-app.mjs), v0.22.0, tests 322/0 pass, pending commit & user testing.