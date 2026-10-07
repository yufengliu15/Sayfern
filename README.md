# Sayfern

Conversational language learning for free. A Mac app with an AI tutor that remembers what you're learning.

**Version:** 0.10.1 ([changelog](CHANGELOG.md)). **Status:** Stage 1 (text learning), Stage 2 (corrections review, Anki export, quizzes, AI feature builder, Anki deck generator) and the first part of Stage 3 (listen to the tutor and words, talk instead of typing, with your ElevenLabs accounts or free voices). Learn Chinese, Japanese, Korean, English, Spanish, French, German, Italian, Portuguese, Russian or Vietnamese, with the app in any of 12 interface languages (it follows your Mac's language by default). Feature status: [`docs/stage1.md`](docs/stage1.md), [`docs/stage2.md`](docs/stage2.md), [`docs/stage3.md`](docs/stage3.md). What's next: [`docs/roadmap.md`](docs/roadmap.md).

## Run it

Needs Node 22.19+ on macOS.

```bash
npm install
npm run dev
```

The first launch opens **onboarding**: connect one model provider, pick your languages and levels (or take a short placement chat), then optionally link Anki.

| Provider | Sign in with a subscription | API key |
|---|---|---|
| Anthropic | Claude Pro/Max (uses the plan's monthly Agent SDK credit) | yes |
| OpenAI | Sign in with ChatGPT | yes |
| OpenRouter | OpenRouter sign-in | yes |
| DeepSeek, Fireworks, Google | | yes |

Credentials are encrypted with Electron `safeStorage` (key held in the macOS Keychain) and stored in `~/Library/Application Support/sayfern/`. The first time, macOS may ask to allow access to "sayfern Safe Storage". Click **Always Allow**. It may ask once more after the first `npm run dev` of v0.3.1, because the dev app is re-signed with the Sayfern name and icon.

- **Dictionaries** (CC-CEDICT for Chinese, JMdict for Japanese) download on first use: from **Settings > Dictionaries**, or from the install button in the word lookup popover.
- **Anki** needs the [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on (code `2055492159`) and Anki running. Link a deck per language in **Settings > Anki**. Sayfern syncs every card (new ones too) and 90 days of review history, refreshing in the background when the snapshot is over 6 hours old. The tutor knows which words you know, are learning, will learn next and struggle with, and keeps to your known vocabulary. The last sync is cached, so all of this still works while Anki is closed. Can't connect? Settings > Anki shows the reason and a fix. If another app holds AnkiConnect's port, `sudo lsof -i :8765` shows which one.
- **Review** (⌘4) lists every correction across sessions with filters and retries, and turns the ones you pick into Anki cards (cloze or situation prompts, with Sayfern's own note types). **Quizzes** (Review > Quizzes) are built from your mistakes, Anki words, grammar, library or saved words, at your level or an HSK/JLPT level; fixed formats are graded on your Mac, and quiz answers count as practice apart from conversation.
- **Anki decks**: the welcome page explains why vocabulary in Anki makes everything easier, links to shared decks on AnkiWeb, and Sayfern can make a new deck with your model: words at your level, readings checked in the dictionary, ruby, example sentences and audio (ElevenLabs or free Microsoft voices), added straight to Anki in batches of 25.
- **Customize** builds features from a description, with your model: practice tabs and Today activities that run in a sandboxed frame, tested before you turn them on, with every version kept for rollback. Code that would run with full app access only runs after you read and approve that exact version. See [`docs/feature-builder.md`](docs/feature-builder.md).
- **Extensions** go in `~/Library/Application Support/sayfern/extensions/`. See [`docs/extensions.md`](docs/extensions.md). They run with full app privileges: only install ones you trust.
- **Export** everything as one JSON file from **Settings > Data**. **Start over** (same tab) erases all your data; dictionaries and extensions stay, and you can keep your model sign-ins.

## Test without the UI

```bash
npm test                                   # unit + integration tests
npm run smoke -- selftest                  # offline end-to-end check with a fake provider
npm run smoke -- login anthropic           # or: login openai, or: key <provider> <api-key>
npm run smoke -- chat anthropic "你好！"   # streams a reply and prints recorded corrections
npm run smoke -- models anthropic
npm run bench -- run                       # Sayfern vs Claude Code + skill benchmark (docs/benchmark.md)
```

The smoke script runs the same core as the app, with its own data and plain-text credentials in `./.sayfern-dev/` (gitignored).

## Layout

```
src/core/          plain Node, no Electron, unit-tested
  app/             SayfernApp: wires the services below behind the SayfernApi surface
  records/         sessions, corrections, grammar, words, levels, stats, export (JSON files)
  lang/            Chinese + Japanese packs, dictionaries, lookup
  library/         import txt/md/html/epub/pdf, reading checkpoints, search
  anki/            AnkiConnect client, cached snapshots, word model (words.ts), note export
  agent/           the tutor: prompt, tools, streaming turns, retries, summaries
  review/          Stage 2: corrections review, Anki card drafts and export
  quiz/            Stage 2: quiz generation, validation, grading, quiz evidence
  builder/         Stage 2: feature builder agent, versions, sandbox assets and RPC, test runner
  decks/           Stage 2: Anki deck generator (word list, checked cards, text to speech, AnkiConnect)
  extensions/      user extension host
  providers.ts     model providers (pi-ai)
src/main/          Electron main: window, dialogs, Keychain-backed credentials, IPC table
src/preload/       generic bridge exposing SayfernApi as window.sayfern
src/renderer/      React UI (runs against a mock API in a plain browser: npx vite -c vite.mock.config.ts)
src/shared/        types and the renderer ↔ main API contract (Stage 2 slots in src/shared/stage2/)
examples/          example extensions (chengyu-of-the-day, measure-word-drill)
docs/              architecture, decisions, roadmap, Stage 1 and 2 feature maps, extension API, builder guide
scripts/           smoke test, OAuth page and dev app branding
build/             app icon (icon.svg source, icon.png, icon.icns)
```

Model access goes through [`@earendil-works/pi-ai`](https://github.com/badlogic/pi-mono/tree/main/packages/ai) (MIT), the provider layer behind the Pi coding agent. It handles OAuth sign-in, token refresh, streaming and ~40 providers.

## Docs

- [`AGENTS.md`](AGENTS.md): start here if you're changing the code (human or coding agent).
- [`docs/architecture.md`](docs/architecture.md): how everything fits together, module by module.
- [`docs/decisions.md`](docs/decisions.md): why it's built this way.
- [`docs/roadmap.md`](docs/roadmap.md): Stage 2 follow-ups, Stage 3, and known gaps.
- [`docs/stage1.md`](docs/stage1.md): Stage 1 features and their status.
- [`docs/stage2.md`](docs/stage2.md): Stage 2 features and their status.
- [`docs/stage3.md`](docs/stage3.md): Stage 3 (voice) features and their status.
- [`docs/extensions.md`](docs/extensions.md): writing extensions, surfaces, versions and the review gate.
- [`docs/feature-builder.md`](docs/feature-builder.md): the guide the feature builder reads (and you can too).
- [`docs/benchmark.md`](docs/benchmark.md): benchmark vs Claude Code + skill.

## License

Copyright (C) 2026 Yufeng Liu

Sayfern is free software, licensed under the [GNU General Public License v3.0](LICENSE) (GPL-3.0-only). You can use, study, share and change it; if you distribute a modified version, it must stay under the same licence with its source available.
