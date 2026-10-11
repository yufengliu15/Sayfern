# Local models (v0.28.0)

Sayfern can talk to a model that runs on your own computer. Nothing leaves your Mac, and no API key or subscription is needed. In v0.28.0 the supported engine is **llama.cpp** (`llama-server`). The code is built so that more engines are a small change: see [Add another local inference engine](#add-another-local-inference-engine). Why it is built this way: ADR 37 in [`decisions.md`](decisions.md).

## User guide

### 1. Install llama.cpp

On macOS, use Homebrew:

```bash
brew install llama.cpp
```

You can also download a release build from <https://github.com/ggml-org/llama.cpp/releases>. Unpack it and run `llama-server` from the folder.

### 2. Start the server

```bash
llama-server -hf <repo>:<quant> --jinja -c 16384 --port 47823
```

- `-hf <repo>:<quant>` downloads the model from Hugging Face on the first run. Example: `-hf unsloth/Qwen3-8B-GGUF:Q4_K_M`. To use a file you already have, use `-m path/to/model.gguf`.
- `--jinja` is **required**. It makes the server use the model's own chat template. Without it, tool calling does not work, and Sayfern uses tool calls to record corrections, grammar and levels (`record_evidence`).
- `-c 16384` sets the context size (in tokens). The tutor prompt is long, and it grows with your records and the chat history. Use **16384 or more**. With a small context, replies fail or the tutor forgets the start of the chat.
- `--port 47823` sets the port. llama-server uses 8080 by default, but Sayfern uses 47823 so that it does not conflict with other local services such as Anki. Sayfern expects `http://127.0.0.1:47823/v1`.
- Optional: `--api-key <secret>` makes the server ask for a key. Type the same key in Sayfern.

Wait until the log says the server is listening.

### 3. Connect Sayfern

1. Open **Settings > Models** (or the connect step on the welcome page).
2. Pick **llama.cpp**.
3. Check the URL. The default is `http://127.0.0.1:47823/v1`. If you started the server with another port or on another computer, change it.
4. Type the API key only if you started the server with `--api-key`.
5. Click **Connect**. Sayfern saves the server only if it answers.
6. Pick the model in the model menu. Sayfern shows the model the server serves, with the context size from `/props` (8192 if the server does not say).

Sayfern asks the server for the model list at startup and each time it lists models, so a model you change later shows up without a restart. If the server is down at startup, the engine stays connected with an empty list until the server is back.

The API key, if you type one, is saved as plain text in `settings.json` on your Mac (`localServers`), not in the encrypted `credentials.json`. Use it only for a key that guards a local server.

### 4. Choose a model

- Use an **instruct** (chat) model, not a base model.
- It must handle **tool calls**. Families that work well in llama.cpp today include Qwen3 and Gemma 3. Check the model card for "tool use" or "function calling".
- It must be good at the language you learn. A model that is strong in English can be weak in Korean or Vietnamese. Try a short chat first.
- **Quality varies.** Small models (about 4B or less) make poorer corrections, miss mistakes, and sometimes mark correct text as wrong. Bigger models (8B and up) do better. Sayfern shows what the model records, so check corrections you doubt, and use the dispute button.
- Quantizations like `Q4_K_M` are a good balance of size and quality. A bigger quantization needs more memory.

### Troubleshooting

| Problem | Cause and fix |
|---|---|
| "Connection refused" | The server is not running, or the port is different. Start `llama-server`, then check the URL (`curl http://127.0.0.1:47823/v1/models` should print JSON). |
| Connects, but the model list is empty | The model is still loading. Wait for the server log to show it is ready, then connect again. |
| The tutor answers, but no corrections or levels appear | Tool calls are ignored. Start the server with `--jinja`. Also try a model that supports tool calls. |
| "401" or "Unauthorized" | The server has `--api-key`. Type the same key in Sayfern. |
| Replies are slow | Use a smaller model or a smaller quantization, and make sure the GPU is used (Apple Silicon uses Metal by default). A very large `-c` also costs memory and time. |
| An error about context size, or the tutor forgets the chat | The context is too small. Start with a bigger `-c` (16384 or more). Long chats need more. |
| Wrong language, or replies in the wrong script | The model is weak in your language. Try another model. |

To check the server by hand:

```bash
curl http://127.0.0.1:47823/v1/models
curl http://127.0.0.1:47823/props
```

## Developer guide

### How it works

- **`src/core/local/engines.ts`** has `LOCAL_ENGINES`, a table keyed by `LocalEngineId` (`src/shared/types.ts`, today `"llamacpp"`). Each entry has `id`, `name`, `defaultUrl`, `docsUrl`, `note`, and `listModels(baseUrl, apiKey, fetch)`, which returns pi-ai `Model` objects.
- **`src/core/local/index.ts`** registers one pi-ai provider for each saved server (`createProvider` with `fetchModels`). Chat uses pi-ai's OpenAI completions API (`openAICompletionsApi`). The URL and the optional key sit in `settings.json` under `localServers` (not in `credentials.json`). With no key, Sayfern sends a placeholder, because the OpenAI client refuses an empty key. Requests go through Node's `fetch` (like AnkiConnect), because the server is on localhost.
- **llama.cpp listing.** `GET <baseUrl>/models` gives the model ids. `GET <root>/props` (the URL without `/v1`) gives `default_generation_settings.n_ctx` (the context size) and `modalities.vision`. Reasoning is off, cost is zero, and the reply limit is the smaller of the context and 8192 tokens. Its `compat` flags are: no `store`, no `developer` role, no reasoning effort, no strict tool schemas, usage in streaming on, and `max_tokens`.
- **API methods** `connectLocal(engine, baseUrl, apiKey?)` and `disconnectLocal(engine)`. `connectLocal` saves the server only if it answers (it rejects with the server's error), and returns its models. `logout` on a local engine calls `disconnectLocal`.
- **Refresh.** `refreshLocals` reads every saved server again at startup and in `listModels`. A server that is down keeps its last list.
- **`ProviderInfo.local`** (`engine`, `baseUrl`, `defaultUrl`, `docsUrl`) tells the connect screen (`Connect.tsx`, `LocalCard`) to show a URL field. `describeProviders` always lists local engines, connected or not.
- **Evidence.** Models that are not Claude get the evidence pass (`needsEvidencePass` in `src/core/agent/options.ts`), so a local model records evidence through the extra tool-only request after its reply (ADR 25).

### Add another local inference engine

Most engines speak the OpenAI chat API, so this is mostly a table entry.

1. **Widen `LocalEngineId`** in `src/shared/types.ts` (for example `"llamacpp" | "ollama"`). Typecheck then lists every place that needs the new id.
2. **Add an entry to `LOCAL_ENGINES`** in `src/core/local/engines.ts`: `id`, `name`, `defaultUrl` (with the `/v1` part), `docsUrl`, and a short `note` (what to start, and the flag or setting tool calling needs).
3. **Implement `listModels`** for that server's API. Return a pi-ai `Model` (api `openai-completions`) for each chat model, with `contextWindow` (the real context size, if the server tells it) and `input: ["text"]`. Ask the server live, never keep a fixed list. If the context size is not known, use a safe default.
4. **Pick the pi-ai `compat` flags** that match the server. These are the thinking format (how the server returns reasoning), whether the server accepts the `developer` role (most local servers need `system`), and strict tool schemas (turn off if the server rejects `strict`). Wrong flags show up as 400 errors or missing tool calls. Check by running a real chat with `npm run smoke`.
5. **Translate the `note`** in all 12 catalogs (it is a `msg("…")`; the engine `name` stays as is). Run `npx tsx scripts/i18n-keys.ts missing` for the list.
6. **Add tests** in `src/core/local/` with a fake `fetch`: the model list, the context size, a server that is down, and `connectLocal` saving nothing when the server does not answer.
7. **Update the docs**: this file, the CHANGELOG, and the version (AGENTS.md rule 10).

If an engine does not speak the OpenAI chat API, it needs another pi-ai API. pi-ai ships many under `node_modules/@earendil-works/pi-ai/dist/api` (for example `anthropic-messages`, `bedrock-converse-stream` and Google). Use the matching API in the provider, and keep the same table.

### Notes for other engines

Check each one against the engine's own docs before you code. Defaults change.

| Engine | Default URL | Model list | Tool calling | Notes |
|---|---|---|---|---|
| Ollama | `http://127.0.0.1:11434/v1` | `GET /v1/models`, or `GET /api/tags` | Needs a model that supports tools | OpenAI-compatible layer ([docs](https://docs.ollama.com/api/openai-compatibility)). The API key is required by clients but ignored. Context size: `POST /api/show` with the model name (the model info has the context length). Ollama's default context window is small, so tell the learner to raise it (`OLLAMA_CONTEXT_LENGTH` or the app setting). |
| LM Studio | `http://127.0.0.1:1234/v1` | `GET /v1/models` (OpenAI-compatible) | Supported for models with tool use | Its own REST API lists more: `GET /api/v0/models` gives loaded state and `max_context_length`, and a newer `GET /api/v1/models` exists ([docs](https://lmstudio.ai/docs/developer/rest/endpoints)). The server must be started in the app. A model must be loaded, or LM Studio loads it on the first request. |
| vLLM | `http://127.0.0.1:8000/v1` | `GET /v1/models`, which includes `max_model_len` | Start with `--enable-auto-tool-choice --tool-call-parser <parser>`; the parser must match the model ([docs](https://docs.vllm.ai/en/stable/features/tool_calling/)) | Serves one model per process. A chat template may be needed for some models. Needs a GPU in most set-ups. |
| MLX-LM server | `http://127.0.0.1:8080/v1` | `GET /v1/models` | Supported for models whose template has tool calls ([docs](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/SERVER.md)) | Start with `mlx_lm.server --model <path or repo>`. Uses port 8080 by default; start it with `--port` to pick another. Apple Silicon only. |
| SGLang | `http://127.0.0.1:30000/v1` | `GET /v1/models` | Start with `--tool-call-parser <parser>` ([docs](https://docs.sglang.io/docs/advanced_features/tool_parser)) | Started with `python -m sglang.launch_server --model-path <model> --port 30000`. |
| Jan | `http://127.0.0.1:1337/v1` | `GET /v1/models` | Depends on the model | Jan runs llama.cpp inside. The local API server must be started in Jan, and it needs an API key ([docs](https://www.jan.ai/docs/desktop/api-server)). The key field in Sayfern is for this. |

For all of these, an engine can serve several models, or only one. The model list decides what the learner sees. If the engine needs a model to be loaded first, say so in the `note`.
