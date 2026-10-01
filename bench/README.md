# bench/

Sayfern vs Claude Code + skill: context usage, plan-limit usage, tool-calling and grammar accuracy on identical scripted sessions. Full documentation: [`docs/benchmark.md`](../docs/benchmark.md).

```bash
npm run bench -- selftest   # offline check of the suite (~20 s)
npm run bench -- doctor     # setup check, no model calls
npm run bench -- run        # full run, report in bench/results/<run-id>/report.md
```

| Path | What |
|---|---|
| `bench.ts` | CLI: run, report, judge, doctor, snapshot-private, list, selftest |
| `bench.config.json` | defaults (model, prices, arms); override in `bench.config.local.json` (gitignored) |
| `lib/proxy.ts`, `lib/wire.ts` | recording proxy for the Anthropic Messages API |
| `lib/anki.ts` | Anki collection builder/reader, fake AnkiConnect server |
| `lib/arms/` | harness adapters (Sayfern, Claude Code) |
| `lib/runner.ts`, `lib/score.ts`, `lib/judge.ts`, `lib/report.ts` | running, scoring, judging, reporting |
| `scenarios/` | scripted learner sessions with gold annotations |
| `fixtures/synthetic/` | public fixture set; `fixtures/private/` is your gitignored snapshot |
| `test/` | selftest: mock API, stand-in `claude` CLI, stand-in skill |
