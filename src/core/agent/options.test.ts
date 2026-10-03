import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileCredentialStore } from "../credential-file-store";
import { createSayfernModels } from "../providers";
import { needsEvidencePass, requestOptions, THINKING_HEADROOM } from "./options";

const models = createSayfernModels(new FileCredentialStore(join(mkdtempSync(join(tmpdir(), "sayfern-opt-")), "c.json")));
const model = (provider: string, id: string) => {
  const m = models.getModel(provider, id);
  assert.ok(m, `${provider}/${id} in catalog`);
  return m;
};

test("requestOptions: models that can turn thinking off keep the plain cap", () => {
  assert.deepEqual(requestOptions(model("anthropic", "claude-sonnet-4-5"), 1500), { maxTokens: 1500 });
  assert.deepEqual(requestOptions(model("openai", "gpt-5.5"), 200), { maxTokens: 200 });
  assert.deepEqual(requestOptions(model("openai", "gpt-4.1"), 800), { maxTokens: 800 });
});

test("requestOptions: always-thinking models get low effort and headroom", () => {
  // claude-sonnet-5-5 is the default Anthropic pick; without this it thinks at "high" inside a 200-token retry check.
  assert.deepEqual(requestOptions(model("anthropic", "claude-sonnet-5-5"), 200), { maxTokens: 200 + THINKING_HEADROOM, reasoning: "low" });
  assert.deepEqual(requestOptions(model("openai", "gpt-5"), 1500), { maxTokens: 1500 + THINKING_HEADROOM, reasoning: "low" });
  // Only "high" exists: clamp up rather than send an unsupported level.
  assert.deepEqual(requestOptions(model("openai", "gpt-5-pro"), 1500), { maxTokens: 1500 + THINKING_HEADROOM, reasoning: "high" });
});

test("evidence pass: on for GPT models (API and ChatGPT sign-in), off for Claude anywhere", () => {
  assert.equal(needsEvidencePass({ api: "openai-responses", id: "gpt-5" }), true);
  assert.equal(needsEvidencePass({ api: "openai-codex-responses", id: "gpt-6-sol" }), true);
  assert.equal(needsEvidencePass({ api: "anthropic-messages", id: "claude-sonnet-4-5" }), false);
  assert.equal(needsEvidencePass({ api: "bedrock-converse-stream", id: "anthropic.claude-sonnet-4-5" }), false);
});
