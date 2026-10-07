# Benchmark: Sayfern vs Claude Code + skill

`bench/` measures what the same tutoring job costs and how well it is done in two harnesses:

- **Sayfern**: the app's core (`SayfernApp`), driven through its public API.
- **Claude Code + skill**: the `claude` CLI with the owner's `mandarin-thinking-practice` skill, the way it is used today.

Both use the same model, the same learner messages, the same Anki cards, the same reader and the same prior learning history. The suite answers, in order of importance:

1. **Context and plan-limit usage.** Tokens per request, fixed overhead, peak context, cache behaviour, and an estimate of subscription-limit usage.
2. **Tool-calling accuracy.** Whether Anki-dependent answers are grounded in the deck, and how many tool calls, round trips and tool errors it took.
3. **Grammar accuracy.** Whether real learner errors were caught with a correct fix, and whether correct sentences were wrongly "corrected".
4. **Conversation quality (Mandarin).** Whether the chat is engaging, whether the tutor moves on when a topic is exhausted (and stays when the learner is invested), and whether its questions and wording fit the learner's level.

## Quick start

```bash
npm run bench -- selftest     # offline check of the suite itself (~20 s, no tokens)
npm run bench -- doctor       # checks sign-ins, the skill, fixtures (no model calls)
npm run bench -- run --scenario zh-anki-grounding --reps 1   # first real run (~5 min)
npm run bench -- run          # everything: 7 scenarios × 2 arms × 2 reps (~60-120 min)
npm run bench -- judge        # grade the latest run; on a judged run, only verdicts that are missing (--all: re-grade everything)
```

The report lands in `bench/results/<run-id>/report.md`. `npm run bench -- report [run-id]` rebuilds it from the saved captures at any time.

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
- **Runner** (`bench/lib/runner.ts`). Order is scenario → repetition → arm, with arm order alternating each repetition. Consecutive blocks always belong to different arms, which is what makes utilization deltas attributable.

### Equivalent starting state

| Knowledge | Claude Code + skill gets it from | Sayfern gets it from |
|---|---|---|
| Learner background | the skill text, the wiki note | profile (`manifest.profile`) |
| Level | wiki note observations | self-assessed level (`manifest.selfLevel`) |
| Prior grammar (除了…还… prompted, time-word error) | wiki note | seeded sessions (`manifest.sayfernSeed`) |
| Anki cards and reviews | `anki_snapshot.py` on the collection | AnkiConnect sync of the same collection |
| Reader checkpoint | wiki note | library import + checkpoint at `reader.resumeAt` |

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
| Grammar caught (deterministic) | A gold error counts as caught when any accepted fix or key fragment appears in what the learner saw (reply + correction cards), punctuation and spaces ignored. Exact and reproducible, but misses fixes phrased differently. |
| Anki grounding (deterministic) | Replies must name at least `min` of the expected words (e.g. the 5 struggling words) and none of the forbidden ones (known words). |
| Judge metrics (optional) | A blinded `claude -p` grader (outside the proxy) scores: errors flagged, fix correct, false alarms on clean messages, Anki facts correct, behaviour checks, and the tutor's own Mandarin errors. |
| Judge: engagement / pacing / level (1-5) | Per session with `rate`, over the whole transcript (opening and all turns, not the end-of-session wrap-up). Mean per arm, with n. Anchors below. Judge-only. |
| Judge: moved on when it should | Turns with `gold.moveOn` where the judge returns `movedOn: true`: the reply, or an earlier reply in the same stretch on that topic, changed topic, opened a new angle or raised the challenge. Passes ÷ `moveOn` turns. |
| Judge: stayed when it should | Turns with `gold.stay` where the judge returns `stayed: true`: the reply answers what the learner asked and engages with what they raised, without changing the subject, dragging back to an old topic or leaving the question open. Passes ÷ `stay` turns. |
| Mean reply length | Characters per tutor reply to a learner turn in chat sessions, counted in code. Two numbers: Han characters only, and all characters. Feedback cards are not counted. |
| Mean question marks per reply | `？` and `?` per reply, counted in code. |
| Replies with exactly one question | Share of replies with exactly one `？` or `?`, counted in code. |

Conversation quality has its own report section after "Accuracy". The three deterministic reply numbers need no judge and always appear; the ratings and move-on rates show "not run" until `npm run bench -- judge`.

### Rating anchors (what the judge sees)

| | 1 | 3 | 5 |
|---|---|---|---|
| **Engagement** (varied, curious, personal follow-ups, not an interview) | Scripted interview: formulaic questions, same shape every turn, little reaction to what the learner said. | Polite and on topic, reacts to some content, but follow-ups are generic and predictable. | Reads like a curious person: builds on the learner's details, shares something of its own, varies turn shape, makes the learner want to write more. |
| **Pacing** (moves on when it should, stays when it should) | Stuck on one easy topic for most of the chat, or changes topic every turn and drops what the learner cares about. | Moves on, but late; or sometimes moves on while the learner's question is unresolved. | Follows the learner's own topic changes, develops what they care about, raises the challenge or changes topic as soon as the topic is exhausted, leaves no question open. |
| **Level fit** (questions and wording suit the learner's level; the fixture learner is HSK 3) | Far off: baby questions repeated (for example 你喜欢吃什么？ every turn), or wording far above the learner. | Mixed: some turns fit, others are clearly too easy or too hard. | Wording at the level with a few new words just above it; questions need opinions, reasons, comparisons or plans; no needless simplification. |

2 and 4 are in between. The judge is told the learner level (`learnerLevel` in the scenario, else `selfLevel` in the fixture manifest) and that the learner's messages are a script that cannot react to the tutor.

`report.md` also has per-scenario tables, per-step context curves, and capture checks (wire tokens must be ≥ harness-reported tokens; lower means traffic bypassed the proxy).

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

Scenario files (`bench/scenarios/*.json`) describe only what the learner does:

```jsonc
{
  "id": "zh-example", "title": "…", "description": "…", "language": "zh",
  "fixtures": "synthetic",               // optional pin
  "sessions": [{
    "mode": "chat",                      // chat | reading | practice
    "prompt": "…",                       // optional: Claude Code's opening message
    "openChecks": ["The tutor …"],       // judge checks on the opening
    "turns": [{
      "text": "我去了图书馆昨天。",
      "gold": {
        "errors": [{ "id": "time-order", "original": "我去了图书馆昨天", "accept": ["我昨天去了图书馆"], "key": ["昨天去了图书馆"], "pattern": "time word before the verb" }],
        "clean": false,                  // true: any correction is a false alarm
        "anki": { "expect": ["选择"], "min": 1, "forbid": ["朋友"], "fact": "…" },
        "checks": ["The tutor …"],
        "moveOn": true,                  // topic exhausted: by this reply the tutor should have moved on or raised the challenge
        "stay": true                     // learner invested or asked something: the reply should engage, not change subject
      }
    }],
    "end": true,                         // end the session the way a learner would
    "checks": ["…"],                     // judge checks over the whole session
    "rate": ["engagement", "pacing", "level"]  // optional: 1-5 judge ratings over the whole session
  }]
}
```

A turn cannot have both `moveOn` and `stay`. A scenario may also set `learnerLevel` (a string told to the judge); without it the fixture's `selfLevel` is used. `moveOn` is judged over the stretch of conversation so far, so mark every turn from the point where the topic is exhausted: a later reply that still lingers fails, an earlier reply that already moved on passes all of them.

Pick `accept`/`key` strings that only appear when the fix is shown, never in the learner's own text.

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

- **Scripted learner.** Messages are fixed, so they may not answer the tutor's exact question. Both arms get the same script; the judge checks look at tutor behaviour, not conversational flow.
- **A scripted learner cannot follow the tutor's topic change.** In `zh-pacing` the learner's messages 2-7 are written to read naturally after almost any tutor question, and the pivot to the robot dog comes from the learner. If the tutor moves on early, the learner's next answer may not match the new question. The judge is told not to penalize that and to judge what the tutor chose to do. The benchmark cannot measure whether the learner enjoys the new topic.
- **Ratings are subjective.** Engagement, pacing and level are 1-5 judge opinions. Use means over several repetitions and both arms, compare arms only to each other, and read the transcripts (`blocks/*/block.json`) before quoting a gap of under one point. The `movedOn` and `stayed` verdicts are yes/no and sharper, but still the judge's reading.
- **The judge can tell the arms apart.** Visible formats differ (Sayfern correction cards vs prose notes), which can sway engagement ratings. Ratings of a whole session leave out the end-of-session wrap-up, which differs most between arms.
- **Reply-style numbers reflect the system prompt as much as quality.** Reply length and question count are counted in code, but "shorter" is not "better". Read them next to the ratings.
- **Model variance.** Run at least 2 repetitions (default) and read ranges in the per-scenario tables before quoting ratios.
- **Limit units are an estimate.** Anthropic does not publish how plan limits weigh token kinds. The utilization headers are the direct measurement; use limit units for fine-grained comparisons and headers to confirm direction.
- **Judge denominators come from the scenarios, not the judge's reply.** Each arm is graded out of the same gold items (errors, clean turns, Anki facts, checks). If the judge skips an item or its reply can't be parsed (after up to three attempts, resending only what is missing), the item counts as ungraded and not passed, and the report flags it with ⚠. Before this, a failed judge call shrank one arm's totals (run 2026-10-01T17-47-57: Anki facts 2/2 vs 3/4).
- **Deterministic grammar scoring** undercounts fixes phrased differently from the gold strings, equally for both arms. The judge is the complement.
- **Visible feedback formats differ** (Sayfern correction cards vs prose notes), so the judge can guess the arm. It is still graded against the same gold answers.
- **Fixture realism.** Synthetic fixtures understate Claude Code's reading costs; use `--fixtures private` for claims about real use.

## Troubleshooting

- `Sayfern can't use anthropic/<model>`: sign in with `npm run smoke -- login anthropic`, or pick a model from `npm run smoke -- models anthropic` with `--model`.
- Claude Code errors with 401 through the proxy: set `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) and use `isolation: "clean"`. As a last resort, run both arms with API keys (`ANTHROPIC_API_KEY`, and `npm run smoke -- key anthropic <key>`); token metrics stay valid, utilization headers disappear.
- `count_tokens probe failed`: fixed-context rows show "–"; everything else is unaffected.
- A run was interrupted: completed blocks are on disk; `npm run bench -- report <run-id>` reports them.
