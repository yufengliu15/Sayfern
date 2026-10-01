@AGENTS.md

Must-know rules:
- `src/core` never imports `electron`; numbers shown to learners are computed in code, never by a model.
- Changing the API means `src/shared/api.ts` → `SayfernApp` → `src/renderer/src/dev/mockApi.ts` → UI; every change bumps the version and adds a `CHANGELOG.md` entry.
- Run `npm run typecheck` and `npm test` before finishing. Do not commit unless asked.
