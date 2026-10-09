# Benchmark: Sayfern vs Claude Code + skill

`bench/` measures what the same tutoring job costs and how well it is done in two harnesses:

- **Sayfern**: the app's core (`SayfernApp`), driven through its public API.
- **Claude Code + skill**: the `claude` CLI with the owner's `mandarin-thinking-practice` skill, the way it is used today.

Both use the same model, the same learner messages, the same Anki cards, the same reader and the same prior learning history. The suite answers, in order of importance:

1. **Context and plan-limit usage.** Tokens per request, fixed overhead, peak context, cache behaviour, and an estimate of subscription-limit usage.
2. **Tool-calling accuracy.** Whether Anki-dependent answers are grounded in the deck, and how many tool calls, round trips and tool errors it took.
3. **Grammar accuracy.** Whether real learner errors were caught with a correct fix, and whether correct sentences were wrongly "corrected".
4. **Conversation quality (Mandarin).** Whether the chat is engaging, whether the tutor moves on when a topic is exhausted (and stays when the learner is invested), and whether its questions and wording fit the learner's level.
5. **Course unit teaching.** Whether the tutor teaches the exact grammar points of one course unit: a correct quick overview, then each point used and invited in the conversation.

## Quick start

```bash
npm run bench -- selftest     # offline check of the suite itself (~20 s, no tokens)
npm run bench -- doctor       # checks sign-ins, the skill, fixtures (no model calls)
npm run bench -- run --scenario zh-anki-grounding --reps 1   # first real run (~5 min)
npm run bench -- run --judge  # everything: 8 scenarios × 2 arms × 3 reps (5 for zh-pacing), then the judge (about 2.5-4 h)
npm run bench -- judge        # grade the latest run; on a judged run, only verdicts that are missing (--all: re-grade everything)
```

The report lands in `bench/results/<run-id>/report.md`. `npm run bench -- report [run-id]` rebuilds it from the saved captures at any time. It also takes a path, so you can re-score a copy of an old run (`npm run bench -- report /tmp/copy/<run-id>`) without touching the original.

### One-time setup

1. **Sayfern sign-in:** `npm run smoke -- login anthropic` (Claude Pro/Max). The benchmark uses `.sayfern-dev/credentials.json` in place, so token refreshes are kept.
2. **Claude Code sign-in for a clean profile:** `claude setup-token`, then `export CLAUDE_CODE_OAUTH_TOKEN=...`. With the token set, each run gets a fresh `CLAUDE_CONFIG_DIR`: no personal CLAUDE.md, plugins, MCP servers or other skills leak into the measurement, and no benchmark sessions land in your history. Without it, the arm runs with your normal `~/.claude` (`isolation: "user"`), which measures "Claude Code as you actually have it".
3. **Skill:** the default path is `~/.codex/skills/mandarin-thinking-practice`. Point elsewhere in `bench/bench.config.local.json`:
   ```json
   { "arms": [{ "id": "claude-code", "skill": "~/path/to/mandarin-thinking-practice" }] }
   ```
4. `python3` must be on PATH (the skill's `anki_snapshot.py` needs it).

Both arms sign in to the **same** Claude subscription, so the plan-utilization headers describe one account.

**One model everywhere.** `model` in `bench.config.json` (default `claude-sonnet-5-5`, override with `--model`) is used by Sayfern, by Claude Code's main loop, and by the judge. Claude Code normally sends some background and subagent requests to a smaller model; the Claude Code arm's `env` pins those to the same model (`ANTHROPIC_DEFAULT_HAIKU_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL`). If any other model still appears on the wire (for example, a future CLI version ignores these variables), the report opens with a warning, and "Capture checks" shows which arm.

**Except the simulated learner.** Scenarios with a `learner` session have a model play the learner (`learner` in `bench.config.json`, default `claude-haiku-5-5`). Like the judge, it runs through `claude -p` outside the proxy, so its calls never count for either arm, and it is not the benchmark model on purpose: it plays a learner, not a tutor.

## How it works

```
                      ┌──────────── recording proxy (127.0.0.1) ────────────┐
 Sayfern core ───────▶│ logs every /v1/messages request + response:          │──▶ api.anthropic.com
 claude -p ──────────▶│ usage, cache, system/tools/messages size, tool calls, │
  (ANTHROPIC_BASE_URL)│ tool errors, anthropic-ratelimit-* headers            │
                      └───────────────────────────────────────────────────────┘
 Sayfern ──AnkiConnect──▶ fake AnkiConnect ◀── same SQLite collection ──▶ skill's anki_snapshot.py
```

- **Recording proxy** (`bench/lib/proxy.ts`). Both harnesses talk to the model only through it: Claude Code via the documented `ANTHROPIC_BASE_URL`, Sayfern by giving its Anthropic provider the proxy as base URL (`bench/lib/arms/sayfern.ts`). Auth headers pass through and are never written to disk. On the first request of each arm and scenario it calls the free `count_tokens` endpoint to get the exact size of the fixed context (system prompt + tool definitions).
- **Fixture sandbox** (`bench/lib/fixtures.ts`). Each block gets a fresh copy of the fixture set: a wiki note, HSK grammar notes, a deck JSON, a graded reader and an Anki collection built from `anki-deck.json` (review times are relative to "now", so the data never goes stale).
- **Anki.** The canonical fixture is an Anki SQLite collection, because that is what the skill reads. The fake AnkiConnect server (`bench/lib/anki.ts`) serves the same collection to Sayfern and logs every call. Both see the same struggling words (checked by `doctor`).
- **Arms** (`bench/lib/arms/`). Thin adapters. Sayfern: settings, profile, level, Anki link and sync, reader import and checkpoint, then prior history seeded through normal tutor turns with an offline scripted model. Claude Code: the skill is copied into `<sandbox>/workspace/.claude/skills/` with path rewrites so it reads the sandbox instead of your real wiki and Anki, then one `claude -p --output-format stream-json` process per learner message, `--resume`-ing the session.
- **Simulated learner** (`bench/lib/learner.ts`). For sessions with `learner`, each learner message is written after the tutor's reply: the learner model gets the persona, the plan (including the mistakes to make), the level and everything the learner saw so far (replies and correction cards), and answers with its message plus the mistakes it made on purpose. Code keeps only reported mistakes whose text is really in the message; those become the turn's gold, and a message with none is a clean turn. Text and gold are saved on each step in `block.json`, so reports rebuild without the learner.
- **Runner** (`bench/lib/runner.ts`). Order is scenario → repetition → arm, with arm order alternating each repetition. Consecutive blocks always belong to different arms, which is what makes utilization deltas attributable.

### Equivalent starting state

| Knowledge | Claude Code + skill gets it from | Sayfern gets it from |
|---|---|---|
| Learner background | the skill text, the wiki note | profile (`manifest.profile`) |
| Level | wiki note observations | self-assessed level (`manifest.selfLevel`) |
| Prior grammar (除了…还… prompted, time-word error) | wiki note | seeded sessions (`manifest.sayfernSeed`) |
| Anki cards and reviews | `anki_snapshot.py` on the collection | AnkiConnect sync of the same collection |
| Reader checkpoint | wiki note | library import + checkpoint at `reader.resumeAt` |
| Course unit (unit sessions) | the learner's first message: unit level, title and patterns (`prompts.open.unit` / `unit-explain` in `bench.config.json`); the skill has no course | `startUnit` (the unit's goal, notes, topics, words and the learner's state per point) |

## Metrics

All token numbers come from the wire, summed over the model requests of a block (setup excluded). Harness-reported numbers are only used as a cross-check.

| Metric | Definition |
|---|---|
| Prompt tokens processed | `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` per request, summed. Everything the model read. |
| Peak context | Largest prompt of any single request. |
| Fixed context | `count_tokens(system + tools) − count_tokens(empty)`, exact, from the first request. "…of which tool definitions" isolates `tools`. |
| **Limit units** | API-price-weighted tokens expressed as input tokens of the benchmark model: `(input·p_in + cache_write_5m·p_cw + cache_write_1h·p_cw1h + cache_read·p_cr + output·p_out) / p_in(model)`. Prices in `bench.config.json`. This is the plan-limit estimate: it assumes limits weigh token kinds roughly like API prices. Side requests on cheaper models (Claude Code's Haiku calls) count at their own price. |
| API-price equivalent | The same sum in USD. What the run would cost on an API key. |
| Plan utilization delta | Change of every `anthropic-ratelimit-*utilization*` response header across a block. Direct evidence from the subscription, but coarse, and polluted by any other use of the account during the run. Blank when a window reset in between. |
| Model requests / extra round trips | Requests per block; requests beyond the first in a step are tool-loop round trips. |
| Tool calls / tool errors | `tool_use` blocks in responses; `tool_result` blocks with `is_error` in the next request. Permission denials (Claude Code) are listed separately. |
| Grammar caught (deterministic) | A gold error counts as caught when any accepted fix or key fragment appears in what the learner saw (reply + correction cards). Punctuation, spaces and markdown markers (`*`, `_`, backticks, `|`, `#`, `>`) are ignored, so a fix in **bold** counts. Besides the listed strings, the scorer derives a key from each `accept` string: the part that differs from the learner's text, plus two characters after it. This is how the fixes of the simulated learner (whose gold carries context around the change) match a shorter card. 因为 and 由于 count as the same fix. A fragment that is only the learner's own text never counts. Exact and reproducible, but misses fixes phrased differently. |
| Anki grounding (deterministic) | Replies must name at least `min` of the expected words (e.g. the 5 struggling words) and none of the forbidden ones (known words). A forbidden word counts only when it stands alone as a listed word (between list or sentence punctuation) in a sentence that also names an expected word, or as a cell in a table row. 喜欢 inside 你喜欢机器人 is not a hit, and "the six words you reviewed today were right" is not a hit. |
| Judge metrics (optional) | A blinded `claude -p` grader (outside the proxy) scores: errors flagged, fix correct, false alarms on clean messages, Anki facts correct, behaviour checks, and the tutor's own Mandarin errors. |
| Judge: engagement / pacing / level (1-5) | Per session with `rate`, over the whole transcript (opening and all turns, not the end-of-session wrap-up). Mean per arm, with n. Anchors below. Judge-only. |
| Judge: moved on when it should | Turns with `gold.moveOn` where the judge returns `movedOn: true`: the reply, or an earlier reply in the same stretch on that topic, changed topic, opened a new angle or raised the challenge. Passes ÷ `moveOn` turns. |
| Judge: stayed when it should | Turns with `gold.stay` where the judge returns `stayed: true`: the reply answers what the learner asked and engages with what they raised, without changing the subject, dragging back to an old topic or leaving the question open. Passes ÷ `stay` turns. |
| Judge: teaching (1-5) | Course unit sessions: how well the tutor teaches the unit's points through the conversation after the opening. Anchors below. |
| Judge: points explained / used / invited / brought in | Course unit sessions, per grammar point of the unit. Explained: the opening overview names the point, says what it does and gives a correct example. Used (`modeled`): a tutor reply after the opening uses the pattern correctly itself (repeating the learner's sentence in a correction does not count). Invited (`elicited`): a tutor reply after the opening asks a question or sets up a situation whose natural answer uses the pattern. Brought in: used or invited. Hits ÷ points × repetitions, plus a table per point. |
| Evidence (Sayfern only) | Read from the block's stored records after the run (`sayfern-data/records`), only for the benchmark's own learner messages (seeded history is left out). Counted in code: new corrections and the share without a `grammarId`; correction cards per gold-error turn; extra cards (cards beyond the gold errors of a turn, on every turn that has gold, clean or not); "incorrect" observations on gold-clean turns; tag accuracy (a gold error that names a `grammarId`, where a stored correction or "incorrect" observation on that message used it). Claude Code keeps no records, so it shows –. |
| Per-repetition range | Rate rows show the mean over all valid blocks, then `reps 80–100%`: the lowest and highest rate of one repetition (summed over the scenarios in it). Shown with two or more repetitions. Use it to see noise before quoting a gap. |
| Pacing per conversation | Next to the per-turn rates, "moved on / stayed, whole conversation" counts a conversation as a pass only when every marked turn passed. |
| Mean reply length | Characters per tutor reply to a learner turn in chat and unit sessions, counted in code. Two numbers: Han characters only, and all characters. Feedback cards are not counted. |
| Mean question marks per reply | `？` and `?` per reply, counted in code. |
| Replies with exactly one question | Share of replies with exactly one `？` or `?`, counted in code. |

Conversation quality has its own report section after "Accuracy". The three deterministic reply numbers need no judge and always appear; the ratings and move-on rates show "not run" until `npm run bench -- judge`. "Course unit teaching" follows it and appears once a unit session is judged.

### Rating anchors (what the judge sees)

| | 1 | 3 | 5 |
|---|---|---|---|
| **Engagement** (varied, curious, personal follow-ups, not an interview) | Scripted interview: formulaic questions, same shape every turn, little reaction to what the learner said. | Polite and on topic, reacts to some content, but follow-ups are generic and predictable. | Reads like a curious person: builds on the learner's details, shares something of its own, varies turn shape, makes the learner want to write more. |
| **Pacing** (moves on when it should, stays when it should) | Stuck on one easy topic for most of the chat, or changes topic every turn and drops what the learner cares about. | Moves on, but late; or sometimes moves on while the learner's question is unresolved. | Follows the learner's own topic changes, develops what they care about, raises the challenge or changes topic as soon as the topic is exhausted, leaves no question open. |
| **Level fit** (questions and wording suit the learner's level; the fixture learner is HSK 3) | Far off: baby questions repeated (for example 你喜欢吃什么？ every turn), or wording far above the learner. | Mixed: some turns fit, others are clearly too easy or too hard. | Wording at the level with a few new words just above it; questions need opinions, reasons, comparisons or plans; no needless simplification. |
| **Teaching** (course units only: the unit's points taught through the conversation after the opening) | The unit is dropped after the opening: ordinary chat, or a lecture or drill with no real conversation. | About half the points come up; some prompts feel artificial ("make a sentence with X"), or corrections of unit points only give the fixed sentence. | Nearly every point comes up, one at a time, at a sensible pace: used by the tutor in a natural sentence, then invited with a question; corrections tie back to the pattern; never feels like a drill. |

2 and 4 are in between. The judge is told the learner level (`learnerLevel` in the scenario, else `selfLevel` in the fixture manifest) and that the learner's messages are a script that cannot react to the tutor.

`report.md` also has per-scenario tables, per-step context curves, and capture checks (wire tokens must be ≥ harness-reported tokens; lower means traffic bypassed the proxy).

## Invalid blocks

A block is invalid when any step had an error (rate limit such as "You've hit your session limit", provider error, aborted turn) or the block itself failed. Invalid blocks are not judged, and the report leaves them out of every mean, rate and range. They are listed under "Errors" as `excluded`, with their cost. Their rows stay in the per-scenario tables (marked ⚠). Before this rule, a block cut short by a limit was graded and averaged (run 2026-10-08T12-55-11, `zh-course-unit` rep 2: teaching = 1 for both arms). Run the missing block again to replace it.

## Scenarios

| Id | What it isolates |
|---|---|
| `zh-chat-corrections` | 6 turns, 5 gold errors, 1 clean message. Per-turn cost and correction accuracy. |
| `zh-anki-grounding` | Questions only the deck can answer. Tool-calling cost and grounding. Pinned to the synthetic fixtures (gold depends on that deck). |
| `zh-reading` | Resume the reader at the checkpoint. Cost of reading material in context. |
| `zh-continuity` | Two sessions. Carrying history forward (除了…还…, last session's mistakes) and what it costs. |
| `zh-long-chat` | 12 turns. How context per request grows with conversation length. Also rated for engagement, pacing and level. |
| `zh-pacing` | 10 turns. Lunch topic with short, easy, correct answers (turns 5-7 are `moveOn`), then the learner pivots to the robot dog and a heritage family story with longer messages and a question back (turns 8-10 are `stay`). Two real errors (`pp-order`, `bi-hen-pacing`). Rated for engagement, pacing and level. |
| `zh-level-fit` | 6 turns of solid HSK 3-4 writing (虽然…但是…, 把, 除了…还…, 越来越, 只有…才…). Do the tutor's questions rise to opinions, reasons, comparisons and plans? Rated for engagement and level. |
| `zh-course-unit` | What Sayfern's course tooling adds over plain Claude Code. One course unit, HSK 3.0 "Complex sentences" (`zh-hsk30-3-12`, 7 points), with a quick overview first. Sayfern teaches from its course (`startUnit`: the unit's notes, topics, words and the learner's state per point); Claude Code gets only the patterns the learner types, because the skill has no course. A simulated learner writes the 20 messages, so it answers the tutor and tries the patterns the tutor invites. Its plan: 5 mistakes on unit patterns (不是…或者, 就 before the subject twice, 为了 for a reason, 只有…就), and 3 points (A是A就是, 由于…所以, 了…就) kept out until the tutor brings them in. Judged per point (explained, used, invited) and rated for teaching, engagement and level. |

Scenario files (`bench/scenarios/*.json`) describe only what the learner does:

```jsonc
{
  "id": "zh-example", "title": "…", "description": "…", "language": "zh",
  "fixtures": "synthetic",               // optional pin
  "reps": 5,                             // optional: repetitions for this scenario (default: reps in bench.config.json, 3); --reps overrides it
  "sessions": [{
    "mode": "chat",                      // chat | reading | practice | unit
    "unit": "zh-hsk30-3-12",             // unit mode: a course unit id from src/shared/course
    "explain": true,                     // unit mode: the learner asks for a quick overview first
    "prompt": "…",                       // optional: Claude Code's opening message
    "openChecks": ["The tutor …"],       // judge checks on the opening
    "learner": { "turns": 20, "persona": "…", "plan": ["…"] },  // optional: a simulated learner writes the turns (then no "turns")
    "turns": [{
      "text": "我去了图书馆昨天。",
      "gold": {
        "errors": [{ "id": "time-order", "original": "我去了图书馆昨天", "accept": ["我昨天去了图书馆"], "key": ["昨天去了图书馆"], "grammarId": "zh:time-before-verb", "pattern": "time word before the verb" }],
        "clean": false,                  // true: any correction is a false alarm
        "anki": { "expect": ["选择"], "min": 1, "forbid": ["朋友"], "fact": "…" },
        "checks": ["The tutor …"],
        "moveOn": true,                  // topic exhausted: by this reply the tutor should have moved on or raised the challenge
        "stay": true                     // learner invested or asked something: the reply should engage, not change subject
      }
    }],
    "end": true,                         // end the session the way a learner would
    "checks": ["…"],                     // judge checks over the whole session
    "rate": ["engagement", "pacing", "level"]  // optional: 1-5 judge ratings over the whole session (+ "teaching" for units)
  }]
}
```

A session has either fixed `turns` or a `learner`, never both. With a `learner`, gold comes from the mistakes the learner reports, so write the planned mistakes into `plan` (what to get wrong, how often), not into gold. A unit session always gets the per-point verdicts: the judge reads the unit's points from the course, so scenarios do not repeat them. The unit must exist in the scenario language's course (checked on load). A turn cannot have both `moveOn` and `stay`. A scenario may also set `learnerLevel` (a string told to the judge); without it the fixture's `selfLevel` is used. `moveOn` is judged over the stretch of conversation so far, so mark every turn from the point where the topic is exhausted: a later reply that still lingers fails, an earlier reply that already moved on passes all of them.

Pick `accept`/`key` strings that only appear when the fix is shown, never in the learner's own text. Accept the minimal correct fix and its natural variants (for example `我已经学习三个小时了` and `我已经学了三个小时`). `grammarId` (a catalogue id from `src/shared/course`, or a list of ids that are all right) is optional. It feeds the tag accuracy in "Evidence (Sayfern only)". Give every learner turn gold: the errors, or `clean: true`. A turn without gold counts for nothing.

## Fixtures

- **`synthetic`** (committed, public, original content). A 57-card deck with 5 clearly struggling words, a wiki note in the skill's format, an HSK 3 grammar digest (~14 KB), and a plain-text reader. It is deliberately **conservative toward Claude Code**: your real HSK notes are 33-132 KB each and the real reader is a scanned PDF, both of which cost the skill far more context than the synthetic versions.
- **`private`** (gitignored). A snapshot of your real sources for realistic numbers:
  ```bash
  npm run bench -- snapshot-private --resume-at "真好！张太太想。"
  npm run bench -- run --fixtures private
  ```
  It reads the source paths from your wiki note's frontmatter (`reader_pdf`, `anki_collection`, `anki_deck`, `deck_json`, `grammar_notes`), copies them into `bench/fixtures/private/`, and rewrites absolute paths to the sandbox. Review `manifest.json` afterwards: the Sayfern seed history defaults to the synthetic one. Snapshots age (review dates are real); re-snapshot for fresh data. Nothing is written back to your wiki or Anki.

## Surviving version changes

The measurement never looks inside either harness: it reads the Anthropic Messages API wire format, AnkiConnect calls, and the text shown to the learner. What can break, and how it fails:

| Change | Effect | Fix |
|---|---|---|
| Sayfern API (`SayfernApi`) | `npm run typecheck` fails in `bench/lib/arms/sayfern.ts` | update the adapter |
| `record_evidence` arguments | setup fails: "Seeding … recorded nothing" | update `sayfernSeed` in the manifest |
| Claude Code CLI flags or stream-json shape | block errors, or empty replies in the report | update `bench/lib/arms/claude-code.ts` |
| Skill text or paths | `doctor` / run log: "rewrites matched nothing" | update `rewrites` in the config |
| Skill not triggered | report warns "skill was never invoked" | adjust `prompts.open` |
| Traffic bypasses the proxy | capture check shows wire < reported, or 0 requests | fix base-URL routing |
| New models | wrong weights in limit units | add a price row (longest prefix wins) |

Every run records the Sayfern version, `claude --version`, the skill's content hash, node and platform in `meta.json`, so results from different versions can be compared side by side. `npm run bench -- selftest` exercises the whole pipeline offline (mock API, stand-in CLI) and should pass after any change to `bench/` or the Sayfern API.

## Output files

`bench/results/<run-id>/` (gitignored):

| File | Content |
|---|---|
| `report.md` | the report |
| `summary.json` | every metric per block, machine-readable |
| `wire.jsonl` | one record per HTTP exchange with the model API (no auth headers) |
| `bodies/` | raw request/response bodies (`--no-bodies` to skip; they contain the fixture data) |
| `anki.jsonl` | every AnkiConnect call |
| `blocks/<arm>__<scenario>__rep<n>/` | `block.json` (steps, replies, feedback), the sandbox, Sayfern's data dir, Claude Code's workspace and `claude-stream.jsonl` |
| `judge.json` | judge verdicts, when run |
| `meta.json`, `run.log` | versions, settings, progress log |

## Threats to validity

- **Scripted learner** (every scenario except `zh-course-unit`). Messages are fixed, so they may not answer the tutor's exact question. Both arms get the same script; the judge checks look at tutor behaviour, not conversational flow.
- **A scripted learner cannot follow the tutor's topic change.** In `zh-pacing` the learner's messages 2-7 are written to read naturally after almost any tutor question, and the pivot to the robot dog comes from the learner. If the tutor moves on early, the learner's next answer may not match the new question. The judge is told not to penalize that and to judge what the tutor chose to do. The benchmark cannot measure whether the learner enjoys the new topic.
- **Ratings are subjective.** Engagement, pacing and level are 1-5 judge opinions. Use means over several repetitions and both arms, compare arms only to each other, and read the transcripts (`blocks/*/block.json`) before quoting a gap of under one point. The `movedOn` and `stayed` verdicts are yes/no and sharper, but still the judge's reading.
- **The judge can tell the arms apart.** Visible formats differ (Sayfern correction cards vs prose notes), which can sway engagement ratings. Ratings of a whole session leave out the end-of-session wrap-up, which differs most between arms.
- **Reply-style numbers reflect the system prompt as much as quality.** Reply length and question count are counted in code, but "shorter" is not "better". Read them next to the ratings.
- **Model variance.** The default is 3 repetitions (5 for `zh-pacing`, whose pacing verdicts are the noisiest). Read the `reps` range next to each rate and the per-scenario tables before quoting a gap. A gap smaller than the range is noise.
- **Limit units are an estimate.** Anthropic does not publish how plan limits weigh token kinds. The utilization headers are the direct measurement; use limit units for fine-grained comparisons and headers to confirm direction.
- **Judge denominators come from the scenarios, not the judge's reply.** Each arm is graded out of the same gold items (except sessions with a simulated learner, where gold comes from that block's learner messages) (errors, clean turns, Anki facts, checks). If the judge skips an item or its reply can't be parsed (after up to three attempts, resending only what is missing), the item counts as ungraded and not passed, and the report flags it with ⚠. Before this, a failed judge call shrank one arm's totals (run 2026-10-01T17-47-57: Anki facts 2/2 vs 3/4).
- **The simulated learner (`zh-course-unit`).** Each arm and repetition has its own conversation, so the number of gold errors and clean turns differs per block: compare rates, not counts. Read "Simulated learner" in the report for how many planned mistakes each arm met. The learner model is obedient, so it tries a pattern as soon as it is invited, more readily than a real learner; this lifts "invited" outcomes for both arms, and the judge still grades only the tutor. It can also make mistakes it did not plan; a tutor that catches one gets a false alarm on a "clean" turn, so read flagged clean turns in the transcripts. Use 3 or more repetitions.
- **Deterministic grammar scoring** undercounts fixes phrased differently from the gold strings (for example a tutor that adds a word, or uses a synonym the scorer does not know), equally for both arms. The judge is the complement. Review the `accept` lists when a transcript shows a correct fix that was rejected.
- **Visible feedback formats differ** (Sayfern correction cards vs prose notes), so the judge can guess the arm. It is still graded against the same gold answers.
- **Fixture realism.** Synthetic fixtures understate Claude Code's reading costs; use `--fixtures private` for claims about real use.

## Troubleshooting

- `Sayfern can't use anthropic/<model>`: sign in with `npm run smoke -- login anthropic`, or pick a model from `npm run smoke -- models anthropic` with `--model`.
- Claude Code errors with 401 through the proxy: set `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) and use `isolation: "clean"`. As a last resort, run both arms with API keys (`ANTHROPIC_API_KEY`, and `npm run smoke -- key anthropic <key>`); token metrics stay valid, utilization headers disappear.
- `count_tokens probe failed`: fixed-context rows show "–"; everything else is unaffected.
- A run was interrupted: completed blocks are on disk; `npm run bench -- report <run-id>` reports them.
