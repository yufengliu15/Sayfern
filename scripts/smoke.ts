/**
 * Terminal smoke test, independent of the Electron UI. Runs the same SayfernApp
 * as the desktop app, with data and a plain-JSON credential file in
 * ./.sayfern-dev (gitignored). Handy when a provider misbehaves in the app.
 *
 *   npm run smoke -- providers
 *   npm run smoke -- login anthropic        # Claude Pro/Max sign-in
 *   npm run smoke -- login openai           # Sign in with ChatGPT
 *   npm run smoke -- key openai sk-...      # store an API key
 *   npm run smoke -- models [provider]
 *   npm run smoke -- chat <provider> [model-id] "你好！"
 *   npm run smoke -- selftest               # offline end-to-end check with a fake provider
 */
import assert from "node:assert/strict";
import { exec } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type AuthInteraction } from "@earendil-works/pi-ai";
import { SayfernApp } from "../src/core/app";
import { FileCredentialStore } from "../src/core/credential-file-store";
import { createSayfernModels } from "../src/core/providers";
import type { ChatEvent } from "../src/shared/api";
import { pickDefaultModel } from "../src/shared/models";

const [cmd, ...args] = process.argv.slice(2);

function makeApp(dataDir: string, onChat?: (e: ChatEvent) => void) {
  const credentials = new FileCredentialStore(join(dataDir, "credentials.json"));
  const models = createSayfernModels(credentials);
  const app = new SayfernApp({
    dataDir,
    models,
    credentials,
    emit: (channel, payload) => {
      if (channel === "chat") onChat?.(payload as ChatEvent);
    },
  });
  return { app, models, credentials };
}

const rl = () => createInterface({ input: process.stdin, output: process.stdout });

const interaction = (signal: AbortSignal): AuthInteraction => ({
  signal,
  notify(e) {
    if (e.type === "auth_url") {
      e = { ...e, url: e.url.replace(/([?&]agent_name_hint=)Pi(?=&|$)/, "$1Sayfern") };
      console.log(`\nOpen this URL to sign in (trying to open your browser):\n${e.url}\n`);
      exec(`${process.platform === "darwin" ? "open" : "xdg-open"} "${e.url}"`);
    } else if (e.type === "device_code") console.log(`Enter code ${e.userCode} at ${e.verificationUri}`);
    else console.log(`· ${e.message}`);
  },
  async prompt(p) {
    const r = rl();
    try {
      if (p.type === "select") {
        p.options.forEach((o, i) => console.log(`  ${i + 1}. ${o.label}${o.description ? ` (${o.description})` : ""}`));
        const n = Number(await r.question(`${p.message} [1-${p.options.length}]: `));
        return p.options[Math.max(0, n - 1)]!.id;
      }
      return await r.question(`${p.message} `);
    } finally {
      r.close();
    }
  },
});

async function main() {
  const devDir = join(process.cwd(), ".sayfern-dev");
  switch (cmd) {
    case "providers": {
      const { app } = makeApp(devDir);
      for (const p of await app.listProviders()) {
        console.log(`${p.connected ? "●" : "○"} ${p.id.padEnd(12)} ${p.connected ?? ""} ${p.oauthLabel ? `[${p.oauthLabel}]` : ""}`);
      }
      return;
    }
    case "login": {
      const id = args[0];
      if (!id) throw new Error("usage: login <provider>");
      const { app, models } = makeApp(devDir);
      const deviceId = await app.getDeviceId();
      await models.login(id, "oauth", interaction(new AbortController().signal), { getDeviceId: () => deviceId });
      console.log(`✓ signed in to ${id}`);
      process.exit(0);
    }
    case "key": {
      const [id, key] = args;
      if (!id || !key) throw new Error("usage: key <provider> <api-key>");
      await makeApp(devDir).app.setApiKey(id, key);
      console.log(`✓ stored key for ${id}`);
      return;
    }
    case "models": {
      const { app } = makeApp(devDir);
      const list = (await app.listModels()).filter((m) => !args[0] || m.provider === args[0]);
      for (const m of list) console.log(`${m.provider}/${m.id}  ${m.name}`);
      console.log(`\n${list.length} models. Default pick: ${pickDefaultModel(list)?.id ?? "none"}`);
      return;
    }
    case "chat": {
      const [provider, maybeModel, ...rest] = args;
      if (!provider) throw new Error('usage: chat <provider> [model-id] "message"');
      let final: ChatEvent | undefined;
      const { app } = makeApp(devDir, (e) => {
        if (e.type === "delta") process.stdout.write(e.text);
        else if (e.type === "tool") console.log(`\n  [tool] ${e.activity.summary}`);
        else if (e.type === "done" || e.type === "error") final = e;
      });
      await app.init();
      const available = (await app.listModels()).filter((m) => m.provider === provider);
      const explicit = maybeModel && available.find((m) => m.id === maybeModel);
      const info = explicit || pickDefaultModel(available);
      const text = (explicit ? rest : [maybeModel, ...rest]).filter(Boolean).join(" ") || "你好！我昨天去了北京玩了。";
      if (!info) throw new Error(`No models available for ${provider}. Log in or add a key first.`);
      const { meta } = await app.newSession({ language: "zh" });
      console.log(`→ ${info.provider}/${info.id}\nYou: ${text}\nTutor: `);
      await app.send(meta.id, { text }, { provider: info.provider, id: info.id });
      await app.whenIdle();
      if (final?.type === "error") throw new Error(final.message);
      if (final?.type === "done") {
        const u = final.message.usage;
        if (u) console.log(`\n\n✓ ${u.input} in / ${u.output} out tokens, est. $${u.cost.toFixed(4)}`);
        for (const c of final.view.corrections) console.log(`  ✎ ${c.original} → ${c.corrected} (${c.kind}): ${c.explanation}`);
        if (!final.view.corrections.length) console.log("  (no corrections recorded)");
      }
      return;
    }
    case "selftest":
      return selftest();
    default:
      console.log('commands: providers | login <p> | key <p> <key> | models [p] | chat <p> [model] "msg" | selftest');
  }
}

/** Offline: faux provider through SayfernApp end to end. */
async function selftest() {
  const dir = mkdtempSync(join(tmpdir(), "sayfern-selftest-"));
  try {
    const events: ChatEvent[] = [];
    const { app, models } = makeApp(dir, (e) => events.push(e));
    const faux = fauxProvider({ provider: "faux", tokensPerSecond: 400, tokenSize: { min: 1, max: 2 } });
    models.setProvider(faux.provider);
    await app.init();
    const model = faux.getModel();
    const ref = { provider: model.provider, id: model.id };
    await app.setSettings({ model: ref });
    const step = (msg: string) => console.log(`✓ ${msg}`);

    // A turn with reply text + one record_evidence call
    const { meta } = await app.newSession({ language: "zh" });
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxText("听起来很好玩！你昨天在北京做了什么？"),
          fauxToolCall("record_evidence", {
            corrections: [
              { original: "我去了北京昨天", corrected: "我昨天去了北京", explanation: "Time words come before the verb.", kind: "grammar", grammar_id: "zh:time-before-verb" },
            ],
            observations: [
              { grammar_id: "zh:time-before-verb", pattern: "Subj + time + V", name: "time before verb", span: "我去了北京昨天", verdict: "incorrect", assistance: "independent" },
              { grammar_id: "zh:le-completed", pattern: "V + 了", name: "completed action 了", span: "去了", verdict: "correct", assistance: "independent" },
            ],
          } as never),
        ],
        { stopReason: "toolUse" },
      ),
    ]);
    await app.send(meta.id, { text: "我去了北京昨天。" }, ref);
    await app.whenIdle();
    const mine = events.filter((e) => e.sessionId === meta.id);
    const deltas = mine.filter((e) => e.type === "delta").length;
    assert.equal(mine[0]?.type, "user_saved");
    assert.ok(deltas > 1, "reply streamed in several deltas");
    assert.ok(mine.some((e) => e.type === "tool"), "tool activity event");
    assert.ok(mine.some((e) => e.type === "correction"), "correction event");
    const done = mine.at(-1);
    assert.equal(done?.type, "done");
    assert.equal(faux.state.callCount, 1, "recording-only tool call needs no follow-up request");
    step(`turn streamed (${deltas} deltas) and finished with done`);

    const view = (await app.getSession(meta.id))!;
    assert.equal(view.messages.length, 2);
    assert.equal(view.corrections.length, 1);
    assert.equal(view.corrections[0].corrected, "我昨天去了北京");
    assert.deepEqual(view.grammarInPlay.map((g) => g.point.id).sort(), ["zh:le-completed", "zh:time-before-verb"]);
    step("correction and observations recorded");

    const detail = await app.getGrammar("zh:time-before-verb");
    assert.equal(detail?.observations.length, 1);
    assert.equal(detail?.corrections.length, 1);
    assert.equal(detail?.summary.counts.incorrect, 1);
    step("grammar detail");

    const progress = await app.getProgress("zh", "week");
    assert.ok(progress.wordsWritten > 0, "words counted");
    assert.equal(progress.corrections.total, 1);
    assert.equal(progress.sessions, 1);
    const home = await app.getHome("zh");
    assert.equal(home.resume?.session.id, meta.id);
    assert.ok(home.followUps.some((g) => g.point.id === "zh:time-before-verb"));
    step(`progress: ${progress.wordsWritten} words written, ${progress.distinctWords} distinct`);

    // Opening: the tutor speaks first in a placement session
    faux.setResponses([fauxAssistantMessage("我们先轻松地聊五分钟。你周末喜欢做什么？")]);
    const placement = await app.startPlacement("zh");
    await app.whenIdle();
    const opening = events.filter((e) => e.sessionId === placement.meta.id);
    assert.equal(opening.at(-1)?.type, "done");
    step("placement opening streamed");

    // Export
    const out = join(dir, app.exportFileName());
    await app.exportTo(out);
    const data = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(data.records.sessions.length, 2);
    assert.equal(data.records.corrections.length, 1);
    assert.equal(data.settings.deviceId, undefined);
    step("export written");

    console.log("✓ selftest passed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
