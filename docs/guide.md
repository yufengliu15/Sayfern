# User guide

How to set up and use Sayfern. For how the code works, see [`architecture.md`](architecture.md).

## First launch

The first launch opens **onboarding**: connect one model provider, pick your languages and levels (or take a short placement chat), then optionally link Anki. Before a placement chat, you pick Beginner, Intermediate or Advanced, so the chat starts at the right place.

## Model providers

| Provider | Sign in with a subscription | API key |
|---|---|---|
| Anthropic | Claude Pro/Max (uses the plan's monthly Agent SDK credit) | yes |
| OpenAI | Sign in with ChatGPT | yes |
| OpenRouter | OpenRouter sign-in | yes |
| DeepSeek, Google, OpenCode Zen, OpenCode Go | | yes |
| llama.cpp (local) | No account: Sayfern talks to your own `llama-server` | no key (optional) |

**Usage.** Each connected provider shows what is left: the 5-hour and weekly limits for Claude Pro/Max and ChatGPT sign-ins (and the 5-hour, weekly and monthly limits for OpenCode Go), the balance for DeepSeek and OpenRouter, and for every API key what Sayfern spent on this computer. Anthropic and OpenAI API keys cannot report a balance, so a link opens the billing page.

**Local models.** Run a model on your own computer with [llama.cpp](https://github.com/ggml-org/llama.cpp) and pick **llama.cpp** on the connect screen. Nothing leaves your computer. Start the server with `llama-server -hf <repo>:<quant> --jinja -c 16384` (`--jinja` is needed for tool calls). Details, model advice and fixes: [`local-models.md`](local-models.md).

**Credentials** are encrypted with Electron `safeStorage` (key held in the macOS Keychain) and stored in `~/Library/Application Support/sayfern/`. The first time, macOS may ask to allow access to "sayfern Safe Storage". Click **Always Allow**.

## Dictionaries

CC-CEDICT for Chinese, JMdict for Japanese, Open English WordNet or WikDict for English, and WikDict, Kengdic and Wiktionary for the others (4 to 22 MB each). They download by themselves for every language you learn: after the welcome page, at startup if one is missing, and when you add a language or change the interface language. Sayfern needs them for lookups and to tell your own language apart from the one you learn. A failed download shows in **Settings > Dictionaries** with a retry.

## Anki

Anki needs the [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on (code `2055492159`) and Anki running. Link a deck per language in **Settings > Anki**.

- Sayfern syncs every card (new ones too) and 90 days of review history, and refreshes in the background when the snapshot is over 6 hours old.
- The tutor knows which words you know, are learning, will learn next and struggle with, and keeps to your known vocabulary.
- The last sync is cached, so all of this still works while Anki is closed.
- Can't connect? Settings > Anki shows the reason and a fix. If another app holds AnkiConnect's port, `sudo lsof -i :8765` shows which one.

**Anki decks.** The welcome page explains why vocabulary in Anki makes everything easier and links to shared decks on AnkiWeb. Sayfern can also make a new deck with your model: words at your level, readings checked in the dictionary, ruby, example sentences and audio (ElevenLabs or free Microsoft voices), added straight to Anki in batches of 25.

## Review and quizzes

**Review** (⌘4) lists every correction across sessions with filters and retries, and turns the ones you pick into Anki cards (cloze or situation prompts, with Sayfern's own note types).

**Quizzes** (Review > Quizzes) are built from your mistakes, Anki words, grammar, library or saved words, at your level or an HSK/JLPT level. Fixed formats are graded on your computer, and quiz answers count as practice apart from conversation.

## Your data

Everything stays on your computer as JSON files (on macOS, in `~/Library/Application Support/sayfern/`). Export everything as one JSON file from **Settings > Data**. **Start over** (same tab) erases all your data; dictionaries stay, and you can keep your model sign-ins.
