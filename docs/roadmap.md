# Roadmap

What comes after v0.3.1, and where each piece plugs into the code. Stage and feature IDs (S2-xx, S3-xx) come from the owner's project page; wireframes for every stage are in `design/wireframes` in the owner's copy of the repo (not in this checkout).

| Stage | Scope | Status |
|---|---|---|
| 1 | Text learning for Chinese and Japanese | Built: v0.1.0 to v0.3.1. Feature status in [`stage1.md`](stage1.md). |
| 2 | Corrections review, Anki export, quizzes, AI feature builder | Next |
| 3 | Voice | Later |

---

## Stage 2

### Corrections review tab

A place to review past corrections across sessions (filter by kind, status, grammar point; retry old ones).

- Data already exists: `Correction` records with status, retries and dispute notes (`records/corrections.json`), `RecordsStore.listCorrections({ language, sessionId?, grammarId? })`.
- Add a `SayfernApi` method (for example a list across sessions with filters) following the API checklist in `AGENTS.md`, a route in `src/renderer/src/router.ts`, a screen in `src/renderer/src/screens/`, and a sidebar entry in `src/renderer/src/components/Sidebar.tsx`.
- Reuse `CorrectionCard` (`variant="sheet"`) for retry, reveal and dispute.

### Correction-to-Anki export

Turn corrections (and saved words) into Anki notes.

- AnkiConnect's `addNote` / `addNotes` actions through `AnkiConnectService.call` in `src/core/anki/index.ts` (add methods to the `AnkiService` interface in `src/core/contracts.ts`).
- Needs a target deck and note type choice in Settings > Anki (`AnkiTab` in `src/renderer/src/screens/Settings.tsx`) and a field mapping similar to `AnkiDeckMapping`.
- Sources: `Correction` (original, corrected, explanation, the learner sentence from the session) and `SavedWord` (word, reading, definition, sentence).

### Configurable quizzes (including HSK / JLPT)

- Question material: Anki words (`AnkiService.words`), saved words, grammar catalogue and observations, library paragraphs. Level lists (HSK, JLPT) would be new bundled or downloadable data, like dictionaries (`src/core/lang/dictionary.ts` shows the download/index/persist pattern).
- Scoring must be local (ADR 9); model use limited to generating or judging items, recorded as evidence like `record_evidence`.
- New session kind or a separate screen: `SessionKind` in `src/shared/records.ts`, `sessionBlock` in `src/core/agent/prompt.ts`, `OPENING_KINDS` in `src/core/app/index.ts`.

### AI feature builder

Learners prompt the model to build extensions: the model gets source and docs access, writes code, tests it, previews it, and the learner can enable, disable and roll back.

- Runtime loading exists: `FileExtensionHost` (`src/core/extensions/index.ts`) imports ES modules from `<userData>/extensions/<id>/` with a cache-busting query and reloads on toggle. The extension API is documented in [`extensions.md`](extensions.md).
- The placeholder screen is `src/renderer/src/screens/Customize.tsx` (route `customize`, "SOON" in the sidebar).
- Missing pieces: a builder agent loop (can reuse `models.streamSimple` and the tool pattern in `src/core/agent/turn.ts`) with tools to read docs and examples, write files into a staging folder, run a test harness, and install; versioned folders for rollback; a sandbox or at least a review step (extensions currently run with full app privileges); unloading language packs without a restart (see backlog).
- UI extension points (panels, buttons) do not exist yet; today extensions contribute tools, prompt additions and language packs only.

---

## Stage 3: voice

Speech in and out, pronunciation playback and pronunciation assessment, with separate providers for speech-to-text, text-to-speech and assessment. Candidates: ElevenLabs, Azure Speech, OpenAI audio, Cartesia, local Whisper. None chosen yet.

- Provider layer: a new core module next to `src/core/providers.ts` with its own interfaces in `src/core/contracts.ts` (STT, TTS, assessment), credentials through the same `FileCredentialStore`.
- Composer: the mic button already exists, disabled with "Voice arrives in Stage 3" (`src/renderer/src/components/Composer.tsx`).
- Playback: tutor messages (`MessageList`) and word popovers (`WordPopover`) are the natural places for play buttons.
- Records: pronunciation results would be new evidence types alongside observations; S1-24 practice time currently counts text practice only (`SessionMeta.activeMs`).

---

## Known gaps and backlog

Verified against the v0.3.1 code. Each item says where a fix would go.

| # | Gap | Where it lives / where to fix |
|---|---|---|
| 1 | **Retry after a failed turn duplicates the learner message.** The failed turn keeps its saved learner message; Retry sends the same text again as a new message, so the conversation shows it twice and words are counted twice (S1-23). | `retryLast` in `src/renderer/src/lib/chatStream.ts` calls `send` again; `runTurn` in `src/core/agent/turn.ts` always appends. Fix with a retry API that reuses the existing learner message (skip `appendMessage` and `recordLearnerWords`). |
| 2 | **Retry on a failed opening does nothing.** Openings have no learner message and no stored input, so `retryLast` returns without sending. | `useChat.retry` / `retryLast` in the renderer; needs an API to restart an opening (for example re-running `viewWithOpening`, which already restarts when the only tutor messages have errors). |
| 3 | ~~Grammar "Explain again" is rejected.~~ **Fixed in 0.2.2:** the request rides in the opening (`SessionMeta.openWith = "explain"`). | |
| 4 | **Disabled extension language packs stay loaded until restart.** | `LanguageService.registerPack` has no unregister; `FileExtensionHost.loadAll` in `src/core/extensions/index.ts`. |
| 5 | **No context trimming.** Every turn sends the full transcript; very long sessions will hit context limits and cost more. | `runLoop` in `src/core/agent/turn.ts` (`transcript`). The prompt already carries long-term memory (ADR 16), so older turns can be dropped or summarized. |
| 6 | **Packaged app untested; no packaging or signing.** kuromoji's dictionary path (`defaultKuromojiDicPath`, overridable through `SayfernAppDeps.kuromojiDicPath`, which main never passes) and pdf.js CMaps/standard fonts (`loadPdfJs` in `src/core/library/pdf.ts`) are resolved from `node_modules` paths that may not work inside an asar. There is no electron-builder config, signing or notarization. | `src/core/lang/ja.ts`, `src/core/library/pdf.ts`, `src/main/index.ts`, new build config. |
| 7 | **JMdict download URL resolution never verified live.** GitHub was blocked in the build environment; only fixtures were tested (`live.test.ts` exists but is skipped without `LIVE=1`). | `JmdictProvider.fetchRows` in `src/core/lang/jmdict.ts`. Run `LIVE=1 npx tsx --test src/core/lang/live.test.ts`. |
| 8 | **Chinese segmentation is greedy longest match.** Forward maximum matching against CC-CEDICT mis-splits some phrases; without the dictionary it falls back to `Intl.Segmenter`. | `ChinesePack.splitHan` in `src/core/lang/zh.ts`. |
| 9 | **PDFs with columns or vertical text parse poorly; no OCR.** Lines are grouped by baseline in content order; scanned PDFs import empty with a warning. | `toLines` / `toParagraphs` in `src/core/library/pdf.ts`. |
| 10 | **Grammar catalogue counts don't refresh after a dispute until reload.** The detail view updates; the list loaded on mount does not. | `GrammarScreen` in `src/renderer/src/screens/Grammar.tsx` (list effect depends only on `language`). |
| 11 | **Disputing a correction changes only its status.** The dispute note is never shown to the tutor (the card says "the tutor will take your note into account"), the correction still counts in Progress corrections, and the related grammar observation keeps its verdict. | `disputeCorrection` in `src/core/app/index.ts`, `computeProgress` in `src/core/records/stats.ts`, `gatherPromptData` in `src/core/agent/prompt.ts`, copy in `CorrectionCard.tsx`. |
| 12 | **Sessions can't be deleted from the UI, and history shows only recent sessions.** `deleteSession` exists in the API but nothing calls it; the sidebar lists 12 recent sessions and Today 5. Empty sessions are hidden after a day but their files stay. | `Sidebar.tsx`, `SayfernApi.deleteSession`, `JsonRecordsStore.listSessions`. |
| 13 | **AnkiConnect URL can't be changed in the UI.** The troubleshooting copy suggests changing "the address Sayfern uses", but `AnkiConfig.url` is only editable in `anki/config.json`. | `AnkiTab` in `src/renderer/src/screens/Settings.tsx`. |
| 14 | **Onboarding placement covers one language.** If several languages choose "find my level", only the first gets a placement session; "Connect Anki" skips placement. | `finish` in `src/renderer/src/screens/Onboarding.tsx`. |
| 15 | **No data import.** Export exists (F-11) but there is no way to restore it; transcripts and document text are not exported. | `SayfernApp.exportTo`, `JsonRecordsStore.exportAll`. |
| 16 | **Full scans on some reads.** `getProgress` reads every session file; `findMessageSession` may scan every session. Fine now, slow with years of data. | `src/core/records/store.ts`, `src/core/app/index.ts`. |
| 17 | **Repository state.** Nothing is committed to git yet in the owner's repo (this checkout has local commits). | Commit and tag `v0.3.1`. |
