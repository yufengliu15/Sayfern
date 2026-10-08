# Session handoff (2026-10-07)

Nothing is committed. Version 0.15.0 (Course screen redesign: syllabus map, Up next card, unit grid, unit drawer; UnitView.points; mock ?lang=en). Screenshot helper: /tmp/egp-tools/shot.mjs (Chrome CDP).
Version 0.14.0 notes below. typecheck, npm test (305 pass, 0 fail), smoke selftest, bench selftest, mock build pass.

## v0.14.0: full-syllabus zh and en courses, European Portuguese

- `src/shared/course/zh.ts`: all 573 HSK 3.0 grammar points (GF 0025-2021), 92 units, ids `zh-hsk30-<lvl>-NN`.
- `src/shared/course/en.ts`: all 1,239 English Grammar Profile points, 215 units, ids `en-egp-<lvl>-NN`. EGP text NOT copied (owner choice): only numbers, levels, categories.
- Units = the source's own groups per level (owner choice), 3 to 12 points. `CourseGrammar.ref` = source number; course.test.ts checks full coverage.
- Grammar ids reused: zh 98 of 121, en 79 of 102. Old zh/en unit ids are gone (old unit sessions open without the unit block).
- Sources: /tmp/src-hsk (ivankra/hsk30 CSV + krmanik/HSK-3.0 official text), /tmp/src-egp (unofficial EGP xlsx copy). Build scripts: /tmp/egp-tools (skeleton.py, gen.py, dedupe.py). Writer outputs: /tmp/course-work/job-*.output.json. /tmp may be cleared.
- Notes written by Sonnet 5.5 subagents; I rewrote 100 thin C2 notes. Owner/teacher review still needed.
- Portuguese learning language = European (variety, voices pt-PT-RaquelNeural/DuarteNeural, quiz/deck prompts, tu, samples, pt.ts course).
- New UI locale pt-PT (`src/shared/i18n/pt-PT.ts`, locales.ts matchOne: bare pt / pt-BR -> pt-BR, other pt regions -> pt-PT). Converted by a subagent (lines 1-1040) and by me (the rest). Review wanted.
- `course` tool overview capped at 40 open units, learner's level first. Course screen clamps patterns to 3 lines.
- Docs: courses.md (full-syllabus vs core-path; the 2-4 point limit was an earlier agent's choice), roadmap ("Core path" vs "Full syllabus"), ADR 27, architecture 19, AGENTS.md, CHANGELOG.
- Not done: no site/pt-pt page; other languages are still core paths (next: Spanish against the PCIC); 102 new title translations unreviewed.

# Earlier handoff (2026-10-06)

Nothing is committed (AGENTS rule 12: commit only when the owner asks). Version is now 0.13.0.
typecheck, npm test (302 pass, 0 fail), smoke selftest and bench selftest all pass.

## v0.13.0 (later the same day): courses for es, en, it, de, pt

- `src/shared/course/{es,en,it,de,pt}.ts`, 32 CEFR units each (7/7/6/5/4/3), registered in `COURSES`.
- Spanish notes give Latin American use first (the tutor's variety); Portuguese notes give Brazilian use first.
- Titles reuse existing keys; only 6 new keys (5 `basis` + "Literary and formal style"), in all 11 catalogs.
- Beta example in tests is now Russian (`course.test.ts`, `prompt.test.ts`). Mock `UNIT_OPENERS` has the new languages.
- Docs: roadmap table, architecture section 19, courses.md (sources), ADR 26 note, AGENTS.md, CHANGELOG.
- Owner to review: level placement and notes of the five courses (written from memory of the sources, not checked online).
- Left: Russian and Vietnamese (Beta).

## Done this session

1. **v0.11.0: courses for Japanese, Korean and French** (each 32 units; these are no longer Beta)
   - `src/shared/course/ja.ts`: JLPT N5-N1 (7/10/6/5/4 units). Order: Genki I-II, then Quartet/Tobira, then common JLPT lists.
   - `src/shared/course/ko.ts`: TOPIK 1-6 (7/7/6/5/4/3). Order: Sejong Korean and Yonsei Korean. Ids are romanized endings (`ko:aseo-eoseo`).
   - `src/shared/course/fr.ts`: CEFR A1-C2 (7/7/6/5/4/3). Order: CEFR Référentiels (Beacco).
   - The courses reuse existing grammar ids (`ja:te-iru`, `ja:tai`, `ja:tara`, `ja:te-kara`, `ja:i-adj-past`, `ja:noni`, `ko:go-sipda`, `fr:passe-compose-etre`).
   - Registered in `COURSES` (`src/shared/course/index.ts`).
   - `unitText` (`src/core/course/index.ts`) joins core words with 、 only for zh and ja, and with ", " for other languages.
   - 61 new title and basis keys in all 11 catalogs. The agent wrote these translations; the owner has not reviewed them yet.
   - Tests that used Korean as the example Beta language now use Spanish. New course tests in `course.test.ts`.
   - The mock opens a unit in the unit's language (`UNIT_OPENERS` in `mockApi.ts`).
   - Docs updated: roadmap status table, architecture section 19, `courses.md` (sources per language), ADR 26 note, `AGENTS.md`.

2. **v0.12.0: "Go over this unit's grammar quickly first?" dialog**
   - `components/UnitStart.tsx` (styles `cr-ask` in `styles/course.css`). Opens from Course.tsx (unit card and Continue) and from the Up next card on Today.tsx.
   - Yes: `startUnit(unitId, { explain: true })` saves `openWith: "explain"` on the session.
   - `kickoffText` (`turn.ts`) has a unit + explain branch. `UNIT_OVERVIEW` in `prompt.ts` asks for one line and one example per point, brief, not a lesson, does not replace the textbook, then the conversation.
   - 4 new strings in all 11 catalogs. Tests in `course.test.ts` and `app.test.ts`. Docs: architecture API table and section 19, CHANGELOG.

## Open items

- **Not ours:** `site/*/index.html` (12 files) changed during the session. They lost the "Streaks and guilt" list item. Not touched or reverted. Ask the owner.
- **Not checked by eye:** the `UnitStart` dialog in the mock UI (`npx vite --config vite.mock.config.ts`, `#/course`).
- **Owner review:** the new translations, and the course level placement (levels are approximate).
- **No lint or format scripts:** the repo has none. You can suggest adding them.

## Next candidate: more courses (owner asked which are easiest) [es, en, it, de, pt done in v0.13.0]

Ranking (sources from memory, not checked online):

1. **Spanish:** PCIC (Instituto Cervantes). Free, detailed grammar by CEFR level. Close to French, so the unit outline and title keys carry over. Recommended next.
2. **English:** English Grammar Profile (Cambridge). Free, about 1,200 points with levels.
3. **Italian:** Profilo della lingua italiana (a book). Romance grammar, so French and Spanish carry over.
4. **German:** free Goethe exam guides cover A1-B1; Profile Deutsch for the higher levels. Needs a new outline.
5. **Portuguese:** weak sources (CAPLE is European, but the app teaches pt-BR). Can reuse the Romance outline.
6. **Russian:** TORFL minimums (books). The outline must follow cases and aspect.
7. **Vietnamese:** no grammar list. Hardest.

Helpers already in the repo:
- `CEFR_GRAMMAR` in `src/core/quiz/levels.ts`: one short grammar description per level, as a check for level placement.
- `GRAMMAR_ID_EXAMPLE` in `prompt.ts`: one sample id per language (`es:subjunctive-ojala`, ...). The new course must reuse it.

How to build a course: follow `docs/courses.md`. To list missing translation keys, use the helper `/tmp/missing.ts` (it may be gone) or `npx tsx scripts/i18n-keys.ts missing`, which shows only the first 20 per catalog.
