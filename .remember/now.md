
## 13:25 | main
Removed the Inline/After-session toggle from `Session.tsx` header (plus `setMode`, `FeedbackMode` import, 3 catalog strings in 12 catalogs, `architecture.md` row, 0.23.0 CHANGELOG note; typecheck ok, tests 322 pass), session summary already exists via `endSession`; Settings > Preferences "Corrections" still has Inline/After default, awaiting user decision on removing it.
## 13:27 | main
Removed the Corrections Inline/After-session setting from Settings > Preferences: dropped `feedbackMode` from `Settings` types/mock/benchmark/test, the `setFeedbackMode` API method, `MessageList.tsx` prop and "N notes saved" line, `.endnote` CSS, 6 unused strings in 12 catalogs, and docs (`architecture.md`, `stage1.md` S1-06, CHANGELOG 0.23.0); typecheck ok, tests 322 pass, not run in app, uncommitted, `SessionMeta.feedbackMode` kept for old JSON compat.
## 13:36 | main
Started Sayfern language-teaching accuracy review: read benchmark files, asked user 3 clarifying questions, spawned 2 subagents to rank prior accuracy fixes and propose next steps; results pending, nothing ranked yet.
## 13:38 | main
Completed read-only Sayfern accuracy audit (v0.6–0.23): 20 fixes inventoried, impact ranked on bench runs R1–R5, sprawl measured (bare-chat prompt ~6.2k chars, ~42 rules), consolidation plan proposed (rules table, prompt snapshot test, TUNING obj, modelQuirks module); no repo files changed, 0.17–0.23 unbenchmarked, R5 course rep2 errored.
## 13:42 | main
Read-only Sayfern accuracy review of benchmark runs 0.6.0–0.16.2 (no repo edits, no benchmark rerun): found CC det-grammar scorer bug (`norm()` ignores `*`, CC 33% vs judge 96%), 0.16.2 course-unit numbers invalid (rep 2 hit session limit, dead blocks still graded), G1 silent miss of unannotated 把 error (S 2/2 reps), 10/25 corrections with null grammarId, pacing moveOn fell 6/6→1/6 (n=2 convs, possible regression, unproven), tutor Mandarin errors fell 9→1; 0.17–0.23 unbenchmarked.
## 13:42 | main
Read-only audit of Sayfern prompt/bench code and benchmark results, no edits: confirmed `norm()` in `bench/lib/score.ts:6` ignores `*` (CC 33% det score invalid) and 10 corrections lack `grammarId`; ranked past prompt fixes by measured impact, found overlapping rules across `prompt.ts`, and proposed 3-step plan (fix bench first, consolidate rules, code-side accuracy fixes), awaiting user go-ahead to start Step A.
## 13:56 | main
Started the Sayfern bench-harness overhaul (8 tasks: markdown-strip in `bench/lib/score.ts` `norm()`, widen zh gold accepts, word-match `forbid`, invalid-block exclusion, Sayfern evidence metrics, gold for `07-level-fit.json`, reps 3/5, offline rescore of runs 2026-10-08T12-55-11 and 05-41-04); so far only read AGENTS.md, docs/benchmark.md and bench code plus one file write, no tests or re-score run yet, incomplete.
## 13:58 | main
Finished the offline Sayfern bench-harness overhaul (8 tasks across `bench/lib/score.ts`, `runner.ts`, new `evidence.ts`, `report.ts`, scenarios, `bench/bench.ts`, selftest, `docs/benchmark.md`), with typecheck, `npm test` (322 pass) and selftest passing and both runs re-scored offline; new `zh-level-fit` turn 2 gold and widened accepts still need native-speaker check, and the paid baseline run (`npm run bench -- run --judge`, est. $19–22) has not been started.
## 13:59 | main
Summarized the Sayfern bench-harness Step A work (0.23.1: scorer, invalid-block exclusion, evidence section, gold and repetition updates, typecheck/selftest/322 tests passing) and asked whether to run the paid baseline (`npm run bench -- run --judge`, est. $19–22) or only the Sayfern arm (~$4.5) or start Step B duplicate-text cleanup first, with no commit made and no paid run started, and the new `zh-level-fit` turn 2 gold and widened accepts still need native-speaker check.
## 14:02 | main
Answered whether prompting alone can beat the plain model (no: the model's knowledge sets the ceiling, and conflicting rules lowered v0.16.1 to 9 errors, down to 1 after the fix), recommended Step B duplicate-rule cleanup, zero-cost code checks for the 40% of corrections with no grammar id, and an optional separate check pass as a learner toggle; no code changed, nothing run.
## 14:13 | main
Sayfern tutor prompt refactor: Step 0 before-snapshots saved to /tmp/prompt-before (chat 4.8k–8.5k chars, tools 4.6k), edits to prompt.ts/tools.ts/turn.ts begun but unverified, after-snapshots, tests, and docs still pending; nothing committed.
## 14:13 | main
Sayfern tutor prompt refactor finished: prompts 15–31% shorter with each rule in one place (`prompt.ts`, `tools.ts`, new `tuning.ts`, `corrections.ts`), typecheck and tests pass (323/325, 2 skipped), benchmark not run, nothing committed, and wording changes (unit move-on 4→5, role-play move-on removal) need the user's review.
## 14:17 | main
Independent review of the Sayfern tutor prompt refactor (read-only): typecheck passes, tests 323 pass/0 fail/2 skipped, and verdict is do-not-merge yet because "bring in a target" leaks into placement/reading (`prompt.ts:597-599`), the "or ask them to use it" sub-rule was dropped, and unit move-on changed 4→5 by coupling to `TUNING.moveOnTurns`; fixes are proposed, not applied.
## 14:19 | main
Step B prompt refactor done: review fixes applied (placement target leak, dropped "don't name the pattern" rule, unit pacing restored to `unitPointTurns: 4` in `tuning.ts`), typecheck and 323 tests pass, version 0.24.0 + CHANGELOG added, prompts 13–31% smaller; uncommitted, benchmark not run (~$1–2, awaiting go-ahead).