# Writing a course

How the courses were built and the steps to build one for another language. There are two kinds: **full-syllabus** courses (Chinese and English since v0.14.0) and **core-path** courses (Japanese, Korean, French in v0.11.0; Spanish, Italian, German, Portuguese in v0.13.0). Read this before you add or change a course. Why the design is like this: [ADR 26](decisions.md#adr-26-course-per-language-units-in-textbook-order-status-from-records-v0100). Where the code lives: [architecture section 19](architecture.md#19-course-v0100).

## What a course is

A course is one data file per learning language: an ordered list of units, grouped by level. Each unit has grammar points, a goal, a few topic ideas and a few core words.

| Kind | Units | Check |
|---|---|---|
| **Full syllabus** (zh, en) | Every point of an official list, once, at its level. Units follow the source's own groups (word class, tense, modal verb...) inside each level; a group with fewer than 3 points at a level joins "More grammar at this level", a group over 12 points is split. Each point has `ref` (its number in the source). | `course.test.ts` checks that every source number appears exactly once. |
| **Core path** (ja, ko, fr, es, it, de, pt) | The most important points per level, about 100 per course, in can-do themed units of 2 to 4 points. The 2 to 4 limit was a choice of the first course writer (an agent, v0.10.0) to keep units conversational; it is not a rule for full-syllabus courses. | Ids, levels and order only. |

Three parts of Sayfern read it:

| Reader | What it uses |
|---|---|
| The tutor's prompt (`courseBlock`, `prompt.ts`) | In chat sessions: the next unit (first unit not done from the learner's level on), its goal, up to 3 of its points the learner does not use alone yet, its topic ideas |
| The `course` tool (`src/core/course/index.ts`) | Overview of units near the learner's level; one unit in full (`unitText`) with the learner's state per point |
| Course unit sessions (`sessionBlock`, `prompt.ts`) | The whole unit: goal, every point with its note, topics, words |
| The Course screen (`screens/Course.tsx`) | Unit titles, patterns, status (done / started / new) |

Code decides every status from the grammar records (S1-25): a unit is done when every one of its points is `independent`. So the grammar ids in the course must be the ids the tutor records.

A language with no course is **Beta**. Nothing else is needed for Beta: `isBeta` is true when `COURSES` has no entry.

## Step 1. Pick the order to follow

Follow one widely used textbook series or official syllabus, so the order matches what learners and teachers expect. Write the source in `basis`. The planned sources per language are in the table in [`roadmap.md`](roadmap.md#courses-per-language-v0100).

- Chinese used the **HSK Standard Course** (HSK 1 to 6) and the **HSK 3.0 grammar syllabus** for 7 to 9.
- Japanese used **Genki I and II** for N5 and N4, **Quartet** and **Tobira** for N3, and the common JLPT grammar lists for N2 and N1 (the JLPT has no official list).
- Korean used the **Sejong Korean** and **Yonsei Korean** series in TOPIK order. Grammar ids are romanized endings: `ko:eun-neun`, `ko:aseo-eoseo`.
- French used the **CEFR Référentiels** for French (Beacco) and the order of common A1 to C2 textbooks.
- Spanish used the **Plan Curricular del Instituto Cervantes** (PCIC). The tutor writes Latin American Spanish by default (`LANGUAGE_META.es.variety`), so notes give that use first and name the Spain form where it differs.
- English used the **English Grammar Profile** (Cambridge) for the level of each point.
- Italian used the **Profilo della lingua italiana** and the order of the CILS and PLIDA syllabuses.
- German used **Profile deutsch** and the grammar lists in the **Goethe-Zertifikat** guides (A1 to B1).
- Portuguese used the **QuaREPE** descriptors (Camões). Since v0.14.0 the app teaches European Portuguese, the variety QuaREPE describes: `tu`, `estar a` + infinitive, the pronoun after the verb in plain statements.
- The Romance and Germanic courses share most unit titles with French (same can-do themes), so a new CEFR course often needs only its `basis` translated. Reuse a title key only if it fits the unit's meaning.
- If sources disagree on where a pattern goes, pick the more common place and do not try to be exact. Say in the file header that levels are approximate.
- Use the textbook for the **order and level** only. Write every title, goal, note and topic in your own words. Do not copy textbook text, dialogues, word lists or exercise wording.

## Full-syllabus courses (v0.14.0)

Chinese and English follow their source list in full:

- **Chinese:** the HSK 3.0 grammar syllabus (国际中文教育中文水平等级标准, GF 0025-2021, appendix A): 573 points, levels 1 to 9. The point list came from `ivankra/hsk30` (`hsk30-grammar.csv`), checked against the official text with sample sentences (`krmanik/HSK-3.0`). `ref` is the point's index, `HSK 3.0 #1` to `#573`.
- **English:** the English Grammar Profile (Cambridge, English Profile): 1,239 points, A1 to C2. Only each point's number, level and category are used; its can-do statements and learner examples are © Cambridge and are not copied. `ref` is `EGP 1` to `EGP 1239`.

How they were built: a script cut each level into units from the source groups (`/tmp/egp-tools/skeleton.py` in the v0.14.0 session; unit ids `zh-hsk30-<level>-NN`, `en-egp-<level>-NN`). Writers (subagents) wrote one `id`, `pattern`, `name` and `note` per point, and a goal, topics and words per unit, reusing the grammar ids the tutor already records. A checker made sure every point got exactly one entry, in order. Ids that two writers both used got the later unit's level as a suffix (`en:should-have-b2`).

Source quirks kept as they are: the EGP lists some points twice (`could` for ability, EGP 1218 / 1219); HSK 3.0 lists 了, 着 and 过 both as particles and as aspect. Each copy is its own point, so the course stays one-to-one with the source.

## Step 2. Cut the levels into units (core-path courses)

- Each level on the language's scale (`LANGUAGE_META[lang].levels`) must have at least one unit. The test checks this.
- Chinese has about 6 units per level (HSK 1 to 5), 4 at HSK 6 and 3 at HSK 7-9. Japanese has 7, 10, 6, 5, 4 (N5 to N1: Genki puts most of the core grammar at N5 and N4); Korean and every CEFR course have 7, 7, 6, 5, 4, 3. Use fewer units at the top, where the material is register and style more than new grammar.
- A unit is one **can-do theme** that groups grammar that is used together: "Days, dates and times", "Compare things", "Make an argument". Do not group by grammar category alone ("all complements").
- Put units in the order a learner meets them. Levels must never go back in the list (the test checks this).
- Each grammar point appears in **one unit only** (the test checks for duplicates). If a pattern comes back at a higher level with a new use, give the new use its own id (`zh:bi-comparison` at HSK 2, `zh:bi-degree` at HSK 3).

## Step 3. Write each unit

```ts
{
  id: "zh-hsk2-04",                       // <lang>-<level slug>-<two-digit index>; never change it once shipped
  level: "HSK 2",                         // exactly a value from LANGUAGE_META[lang].levels
  title: msg("Compare things"),           // learner-facing, 2 to 5 words, wrapped in msg()
  goal: "Compare people, prices and places, and pick the best.",   // English, one can-do sentence, for the tutor
  grammar: [
    { id: "zh:bi-comparison", pattern: "A 比 B + Adj", name: "comparisons with 比",
      note: "他比我高; never 比…很高." },
  ],
  topics: ["buying clothes", "two cities you know", "family members' ages"],   // English, 3 situations
  words: ["比", "贵", "便宜", "高"],         // target language, 5 to 8 core words
}
```

| Field | Rules |
|---|---|
| `id` | Stable. Sessions store it (`SessionMeta.unitId`), so a renamed id orphans old unit sessions. |
| `level` | A value on the scale, written exactly ("HSK 7-9", "N4", "B1"). |
| `title` | Short, plain, no em dashes, no grammar jargon. It is a translation key: every title needs all 12 catalogs. |
| `goal` | What the learner can do after the unit. The tutor reads it; the learner does not. |
| `grammar[].id` | `<lang>:<ascii-slug>`, lowercase, hyphens. It must already be canonical (`canonicalGrammarId(id, lang) === id`, the test checks it). **Search the repo first** (`grep -rhoE '"zh:[a-z0-9-]+"' src bench`) and reuse ids the tutor and fixtures already use (`zh:time-before-verb`, `zh:chule-hai`, `zh:yinwei-suoyi`, ...), so old records count toward the course. |
| `grammar[].pattern` | The surface form in the target language with A/B/V/Adj slots, as the Grammar screen shows it. |
| `grammar[].name` | Short English name, the same style as the tutor's catalogue. |
| `grammar[].note` | One English line for the tutor: how the pattern is used and the typical learner mistake, with a short example in the target language. Not a lesson. |
| `topics` | Situations where the grammar comes up naturally in conversation. Personal, everyday, at the level. |
| `words` | Core words for the theme, at or below the unit's level. |

## Step 4. Register and translate

1. Add the course to `COURSES` in `src/shared/course/index.ts`.
2. Wrap `basis` and every `title` in `msg()`.
3. Run `npx tsx scripts/i18n-keys.ts missing` and add every new key to all 12 catalogs in `src/shared/i18n/`. Unit titles are lesson titles: translate the meaning (read the unit's goal and grammar), keep them short, and use the terms each catalog already uses. For v0.10.0, three subagents translated the catalogs in parallel (CJK, de/fr/es/it, pt-BR/ru/vi), then a person checked the odd ones.
4. Update the status table in `docs/roadmap.md` (Beta → Built, unit count).

## Step 5. Check

```bash
npx tsx --test src/core/course/course.test.ts   # ids, levels, order, canonical grammar ids, every level covered
npx tsx --test src/core/i18n-catalogs.test.ts   # every title translated
npm run typecheck && npm test
npx vite --config vite.mock.config.ts           # open #/course and #/course?fresh=1 in the mock UI
```

Then read the prompt the tutor gets: `buildSystemPrompt` in a test, or `npm run smoke -- chat anthropic "…"` with a level set. Check that the course block names a sensible next unit for an early and a late learner.

To check that the tutor uses the course well in real conversations, the benchmark has Mandarin scenarios for pacing and level fit (`zh-pacing`, `zh-level-fit`, see [`benchmark.md`](benchmark.md)). Write similar scenarios for a new language if you want numbers for it.

## Things to keep stable

- Unit `id`s and grammar ids: records and sessions point at them.
- Status comes only from records. Never add a field the model sets to mark a unit done.
- Every unit stays open (no locks). "Up next" is a suggestion.
- Quiz answers can never finish a unit (they never make a point `independent`, S2-09).
