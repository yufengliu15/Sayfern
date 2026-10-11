
## 21:35 | main
Bubble widened (row full-width, `--bubble-max` → min(1000px,94%)) and per-message translate button added beside Copy (top chip removed; "Hide translation" in 12 catalogs needs native review), bumped to 0.26.0 with docs; typecheck ok, npm test 327 pass/0 fail/2 not run; mock-verified, uncommitted.
## 21:43 | main
Removing the Customize feature entirely (user: app is open source, users can modify via harness) by spawning 3 subagents on claude-sonnet-5-5 after scoping with the user through ask_user prompts; removal still in progress, not yet verified.
## 21:43 | main
Spawned 3 subagents on claude-sonnet-5-5 to remove the Customize feature (still running, unverified) and began the version bump to 0.27.0 across `package.json`, `package-lock.json`, and `README.md`.
## 21:45 | main
Removed the AI feature builder (Customize) and the user extension system from Sayfern's core, main, preload, shared, scripts, and examples, deleting `src/core/builder/`, `src/core/extensions/`, `examples/`, `src/main/features.ts`, and the builder shared files; node typecheck is clean and `npm test` passes (302 pass, 0 fail, 2 skipped), but the web typecheck and the Electron app were not run, and `src/renderer/index.html` still has a stale `frame-src` entry for the feature scheme that the renderer agent must remove.
## 21:45 | main
Removed the AI feature builder (Customize) and user extension system from Sayfern's renderer and i18n: deleted 8 files (Customize, FeatureHost, FeatureFrame, FeatureNav, FeatureReview, FeatureActivities, mockBuilder, builder.css), removed 137 unused keys from each of the 12 catalogs, and added a new Erase-hint translation to all 12 that needs native-speaker review; tsc web is clean and `npm test` passes (302 pass, 0 fail, 2 skipped), but `openExtensionsFolder` still lives in shared api.ts and main/index.ts for the core agent to remove, and the mock server was not run.
## 21:46 | main
Removed the AI feature builder and user extension system from docs and design: deleted 4 files (feature-builder.md, feature-sdk.d.ts, extensions.md, Customize.dc.html), updated AGENTS, README, CHANGELOG (0.27.0), architecture, stage1/2, roadmap, packaging, decisions (ADR 36, ADR 21 superseded), wireframes and theme-mapping; code, tests and typecheck untouched, with leftover code-side claims (mockBuilder, `.cust*`, features.ts, will-frame-navigate guard) pending the code agents.
## 21:50 | main
Removed the Customize screen, AI feature builder, and extension system across backend, UI, docs, and tests (116 files, ~9,700 lines; version 0.27.0), replaced website card #6 with an "OPEN" card in all 12 locales, and corrected ADR 36 to GPL-3.0-only; uncommitted, and the real Electron app was not run, with the network-lockdown removal, leftover old data on disk, and native-speaker translation review pending the user's decision.
## 21:59 | main
Removed the Fireworks API key option from providers.ts, 12 app catalogs, README, architecture doc, Welcome wireframe, 12 website pages (FAQ and models list), and added a CHANGELOG entry under 0.27.0; typecheck and tests pass (302/0/2) but the real app was not run, and nothing is committed.