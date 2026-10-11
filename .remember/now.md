
## 23:42 | main
Built a provider usage tracker in SayfernApp: usage log and model wrapper, live fetchers for provider endpoints, OpenCode Zen and Go added to the provider list, typed response shapes, usage line on the provider card, translations in all 12 catalogs, and tests (request-count assertion only, after fixing wrong token-count expectations).
## 23:44 | main
SayfernApp usage tracker finished: v0.29.0 bump, ADR 38, CHANGELOG/README/AGENTS/arch docs, usage log reuses `records/dates.ts` helpers, 320 pass/2 skip, typecheck clean, EN/RU UI checked in mock app; uncommitted, real provider endpoints untested (manual sign-in check needed before release), 14 new strings need native translation review, connect screen "monthly Agent SDK credit" text stale pending user OK.