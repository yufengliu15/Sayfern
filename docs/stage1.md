# Stage 1: text learning

Stage 1 = text learning for Chinese and Japanese. Built in v0.1.0 to v0.3.1. Source of truth for scope: the Sayfern project page (feature IDs S1-xx, F-xx). This file maps each feature to the code and records its status as of v0.3.1.

Deep reference: [`architecture.md`](architecture.md). Next work and known gaps: [`roadmap.md`](roadmap.md).

Later changes to Stage 1 features (Review in the sidebar moves Progress to ⌘5, built features run sandboxed, export includes quizzes and built features) are noted in [`stage2.md`](stage2.md).

## Modules

```
renderer (React)  ──window.sayfern──►  preload  ──ipc:<method>──►  main (Electron)
                                                                     │ window, dialogs, Keychain cipher, IPC table
                                                                     ▼
                         src/core (plain Node, no Electron, unit-tested)
   records/   RecordsStore      sessions, messages, corrections, grammar, observations, words, levels, profile, stats, export
   lang/      LanguageService   zh + ja packs: segmentation, readings, dictionaries (CC-CEDICT, JMdict), lookup
   library/   LibraryService    import txt/md/html/epub/pdf, paragraphs, checkpoints, CJK search
   anki/      AnkiService       AnkiConnect client, cached snapshots, word model, practice-target selection
   agent/     Tutor             system prompt, tools, streaming turn loop, translation, retries, end-of-session
   extensions/ ExtensionHost    loads user extensions (tools, prompt additions, language packs)
   app/       SayfernApp        wires the services above behind SayfernApi (main routes IPC to it)
   providers.ts                 pi-ai provider registry
```

Contracts (change deliberately, and update the mock API and docs with them):
- `src/shared/records.ts` domain types
- `src/shared/lang.ts` language/dictionary types
- `src/shared/api.ts` renderer ↔ main API (`SayfernApi`), channels `ipc:<method>`
- `src/core/contracts.ts` service interfaces between core modules

## Conventions

- TypeScript strict, ESM, extensionless relative imports. No Electron imports under `src/core`.
- Every core service is a class constructed with explicit deps: `new X({ dataDir, fetch?, now? })`. No globals, no singletons.
- Storage: JSON files under the service's `dataDir`, atomic writes (write tmp + rename), in-memory cache, writes serialized per file. Human-readable, exportable. (SQLite can replace this later behind the same interfaces.)
- Tests: `src/core/<module>/*.test.ts` with `node:test` + `node:assert/strict`. Run one module: `npx tsx --test src/core/<module>/*.test.ts`. All: `npm test`. Use temp dirs (`fs.mkdtempSync(os.tmpdir())`).
- Local dates use the machine's timezone (`YYYY-MM-DD`).
- Numbers shown to the learner are computed locally. Models record evidence; code counts it (S1-25, S1-26).
- Dependencies available: `@earendil-works/pi-ai`, `pinyin-pro`, `kuromoji`, `pdfjs-dist`, `jszip`, React. Do not `npm install` anything else; ask instead.
- UI copy: plain, short, no em dashes in UI strings. Colors and fonts come from `src/renderer/src/styles.css` tokens; no new colors without a reason.
- Every change bumps the version and adds a `CHANGELOG.md` entry (see `AGENTS.md`).

## Disk layout (under Electron `userData`)

```
credentials.json           encrypted with safeStorage
settings.json
records/                   RecordsStore dataDir (sessions/<id>.json and one file per record kind)
dict/zh, dict/ja           dictionaries
library/<docId>/           meta.json, paragraphs.json, index.json, original.<ext>
anki/                      config.json, snapshot-<lang>.json
extensions/<id>/           user extensions (package.json + index.js)
extensions.json            extension enabled flags
sessions/                  v0.1 sessions, imported once
```

Details and JSON examples: [`architecture.md` section 7](architecture.md#7-disk-layout).

## Feature map and status (v0.3.1)

Status: **Done** = implemented as scoped. **Partial** = works, with a missing piece or a known bug (see notes and the roadmap backlog).

| ID | Feature | Status | Where | Notes |
|---|---|---|---|---|
| S1-01 | Language workspaces | Done | `settings.languages` / `settings.language`, sidebar language picker, per-language records | Language type is fixed to `zh` and `ja`. |
| S1-02 | Session history, resume | Partial | `records` sessions; Today resume card (`HomeView.resume`); sidebar recent list | Sidebar shows the 12 most recent sessions, Today 5; no full history view. `deleteSession` exists in the API but no UI uses it. |
| S1-03 | Personal tutor context | Done | `LearnerProfile` (name, about, goals) in Settings > About you and onboarding; `kind: "personal"` library docs → prompt (`personalContext`, 1500 chars) | |
| S1-04 | Level assessment | Done | Self level (`setSelfLevel`), placement session (`startPlacement`), `record_evidence.level`, `levels.json` history | Onboarding places only the first language set to "find my level". Before placement the learner picks a band (Beginner, Intermediate, Advanced; v0.17.0, ADR 29). |
| S1-05 | Adaptive conversation | Done | `src/core/agent/prompt.ts` (level, learner, session kind, follow-ups, targets, Anki knowledge, catalogue) | |
| S1-06 | Inline corrections | Done | `record_evidence.corrections`, `CorrectionCard`: retry → reveal, inline or end-of-session (`feedbackMode`) | |
| S1-07 | Hover lookup | Done | `lang.annotate` + `lang.lookup`, `AnnotatedText`, `WordPopover`, dictionary install from the popover | Chinese segmentation is greedy longest match. JMdict download never verified live. |
| S1-08 | Optional translations | Done | `tutor.translate`, cached on the message; Translate toggle and Preferences auto-translate | |
| S1-09 | Save word with sentence | Done | `records.saveWord` from the popover and the reader selection; listed in Library | |
| S1-10 | Library | Done | `FileLibraryService` import of txt, md, html, epub, pdf with a text layer | Scanned PDFs import empty with a warning (no OCR); multi-column and vertical PDFs parse poorly. |
| S1-11 | Read with tutor | Done | Reading session (`openReading`), `Reader.tsx`, checkpoints (UI and `update_checkpoint`), passage in the prompt | |
| S1-12 | Source-grounded explanations | Done | `search_library` tool, `ChatMessage.sources` (max 3), source chips open the reader at the paragraph | |
| S1-13 | Anki connection | Done | AnkiConnect (add-on 2055492159) via Node fetch, classified failures + troubleshooting (0.1.1), cached snapshots. 0.2: full-deck sync (status, new-queue order, leech tag, 90-day `cardReviews` history), `ensureFresh` in the background (6 h) | AnkiConnect URL is not editable in the UI. |
| S1-14 | Anki-informed practice | Done | `anki.selectTargets` (recent + struggle-ranked) → prompt; target status pending/asked/used. 0.2: word model (`anki/words.ts`: `aggregateWords`, `struggleScore`), "Anki knowledge" prompt block, tools `anki_overview` / `anki_struggling` / `anki_vocabulary` / `anki_check_words` / `anki_lookup`, Settings overview | |
| S1-15 | Grammar catalogue | Done | Grammar points upserted by the tutor (`taught`, observations); Grammar screen | |
| S1-16 | Usage history | Done | Observations with session and message refs; Grammar detail lists every attempt | |
| S1-17 | Counts & rates | Partial | `records.listGrammar` / `summarizeGrammar` (local) | Catalogue list doesn't refresh after a dispute until the screen reloads. |
| S1-18 | Assistance states | Done | `introduced` / `with_help` / `independent`; corrected retries recorded as `corrected_retry` | |
| S1-19 | Targeted practice | Done | `practiseGrammar` (practice session with an opening) + follow-ups in the prompt (never names the pattern). "Explain again" = `practiseGrammar(id, { explain: true })` → `openWith: "explain"` (0.2.2) | |
| S1-20 | Revisable judgments | Partial | `disputeObservation` (verdict changed, original kept); `disputeCorrection`; `typo` and `speaking` corrections are not grammar errors (ADR 33) | A disputed correction still counts in Progress, its note is never given to the tutor, and the linked observation keeps its verdict. |
| S1-21 | Structured corrections | Done | `corrections.json` from day one (original, corrected, explanation, kind, grammar id, retries, status) | |
| S1-22 | Words first used | Done | `records.recordLearnerWords`, `word-usage-<lang>.json`; Progress and word popover show first use | |
| S1-23 | Total/distinct words | Partial | `writing-<lang>.json`; learner words only; tutor text, pasted spans and own-language words excluded (ADR 30) | Retry after a failed turn re-sends the learner message and counts its words twice. |
| S1-24 | Practice time | Done | `useActivityTracker` (focused, visible, input in the last 60 s) → `trackActivity` → `activity.json` | Text practice only. |
| S1-25 | Local analytics | Done | `records.getProgress` / `computeProgress`, no model calls | |
| S1-26 | Recording-only tool | Done | `record_evidence` stores data; code updates stats | |
| S1-27 | Efficient writes | Done | One batched tool call after the reply; no follow-up request; deterministic ids dedupe | |
| F-04 | Capability awareness | Done | `ModelInfo` (reasoning, image input, context window) in the model picker | |
| F-05 | Tool-accessible ops | Done | Tools: `record_evidence`, `search_library`, `anki_*` (when Anki is on and synced), `update_checkpoint` (reading) | |
| F-07 | Observable cost | Done | Per-message usage and tool activity in the inspector; session token/cost chip | Cost is at list price; subscription sign-ins bill differently. |
| F-08 | Extensible languages | Partial | `LanguagePack` interface, `registerPack`, extensions can register packs | Records, settings and UI are typed for `zh` and `ja`; disabled packs stay loaded until restart. |
| F-09 | Extension foundation | Done | `FileExtensionHost` + [`extensions.md`](extensions.md) + `examples/extensions/` | No sandbox: extensions run with full privileges. |
| F-10 | Mac interface | Done | Sidebar / main / inspector, ⌘N, ⌘1..4, ⌘I, hidden-inset title bar; app icon and "Sayfern" in the Dock and menu bar (0.3.1) | No packaged, signed build yet. |
| F-11 | Local data & export | Done | `exportData` → one JSON file. 0.3.0: Settings > Data > Start over (`eraseAllData`) | No import; transcripts and document text are not exported. |

## Build phases (history)

All four phases are complete (git history `phase 1` to `phase 4`, then v0.1.1, v0.2.0, v0.2.1, v0.2.2, v0.3.0, v0.3.1).

1. Core services in parallel: records, lang, library + anki. Renderer Session + Today against a mock API.
2. Agent loop (uses real core services). Renderer Library/Reader, Grammar, Progress, Settings, Onboarding.
3. Main-process wiring (IPC for every `SayfernApi` method), preload, extensions host, smoke script.
4. Integration: typecheck, tests, faux-provider end-to-end run, screenshots, review.
