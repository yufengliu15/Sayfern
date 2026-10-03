@AGENTS.md

Must-know rules:
- `src/core` never imports `electron`; numbers shown to learners are computed in code, never by a model.
- Changing the API means `src/shared/api.ts` (or the feature's slot in `src/shared/stage2/`) → `SayfernApp` (or the Stage 2 service bound with `bindSlot`) → `src/renderer/src/dev/mockApi.ts` (or the feature's `dev/mock*.ts`) → UI; every change bumps the version and adds a `CHANGELOG.md` entry.
- Quiz evidence stays apart from conversation evidence; AI-built code runs sandboxed, and full-access code only after the learner approves that exact version.
- Run `npm run typecheck` and `npm test` before finishing. Do not commit unless asked.
