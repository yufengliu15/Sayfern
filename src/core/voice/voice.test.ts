import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SettingsStore } from "../app/settings";
import { FileCredentialStore } from "../credential-file-store";
import { JsonRecordsStore } from "../records";
import type { Stage2Deps } from "../stage2";
import type { WsFactory, WsLike } from "../decks/tts";
import { DeckService } from "../decks";
import { cleanForSpeech, clip, VoiceService } from "./index";
import { multipart } from "./stt";

type Mode = "ok" | "quota" | "auth" | "noStt" | "rate";

/** One frame of audio per SSML request, then turn.end (same shape as Edge). */
function fakeEdge() {
  const texts: string[] = [];
  const factory: WsFactory = () => {
    const ws: WsLike = {
      binaryType: "blob",
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      send(data) {
        if (!data.includes("Path:ssml")) return;
        const text = /<prosody[^>]*>(.*)<\/prosody>/.exec(data)?.[1] ?? "";
        texts.push(text);
        const head = Buffer.from("Path:audio\r\n");
        const len = Buffer.alloc(2);
        len.writeUInt16BE(head.length);
        const frame = Buffer.concat([len, head, Buffer.from(`EDGE:${text}`)]);
        setTimeout(() => {
          ws.onmessage?.({ data: frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.length) });
          ws.onmessage?.({ data: "Path:turn.end\r\n\r\n{}" });
        }, 1);
      },
      close() {},
    };
    setTimeout(() => ws.onopen?.({}), 1);
    return ws;
  };
  return { factory, texts };
}

function harness() {
  const dir = mkdtempSync(join(tmpdir(), "sayfern-voice-"));
  let clock = new Date(2026, 9, 3, 10, 0).getTime();
  const now = () => clock;
  const records = new JsonRecordsStore({ dataDir: join(dir, "records"), now });
  const credentials = new FileCredentialStore(join(dir, "credentials.json"));
  const settings = new SettingsStore(join(dir, "settings.json"));
  const modes: Record<string, Mode> = { sk_a: "ok", sk_b: "ok", sk_c: "ok" };
  const calls: { url: string; key: string; body?: unknown; contentType?: string }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const key = headers["xi-api-key"] ?? "";
    calls.push({ url: u, key, body: init?.body, contentType: headers["Content-Type"] });
    if (!(key in modes)) return Response.json({ detail: { status: "invalid_api_key", message: "Invalid API key" } }, { status: 401 });
    const mode = modes[key];
    if (u.endsWith("/v1/voices"))
      return Response.json({ voices: [{ voice_id: `cloned-${key}`, name: "Mine", category: "cloned" }, { voice_id: "rachel", name: "Rachel", category: "premade" }] });
    if (u.endsWith("/v1/user/subscription"))
      return Response.json({ tier: "free", character_count: mode === "quota" ? 10000 : 2000, character_limit: 10000, next_character_count_reset_unix: 1790000000 });
    if (u.includes("/v1/text-to-speech/")) {
      if (mode === "quota") return Response.json({ detail: { status: "quota_exceeded", message: "You have 0 credits remaining" } }, { status: 401 });
      if (mode === "rate") return Response.json({ detail: "Too many requests" }, { status: 429 });
      if (mode === "auth") return Response.json({ detail: { status: "invalid_api_key", message: "bad" } }, { status: 401 });
      return new Response(new TextEncoder().encode(`MP3:${key}`));
    }
    if (u.endsWith("/v1/speech-to-text")) {
      if (mode === "noStt") return Response.json({ detail: { status: "missing_permissions", message: "The API key is missing the permission speech_to_text" } }, { status: 401 });
      if (mode === "quota") return Response.json({ detail: { status: "quota_exceeded", message: "quota" } }, { status: 401 });
      return Response.json({ language_code: "zho", language_probability: 0.99, text: " 我想去银行。 " });
    }
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
  let n = 0;
  const deps = {
    dataDir: dir,
    records,
    settings,
    now,
    newId: () => `id${++n}`,
    fetch: fetchImpl,
    credentials,
  } as unknown as Stage2Deps;
  const edge = fakeEdge();
  const voice = new VoiceService(deps, { ws: edge.factory });
  deps.eleven = voice.accounts;
  return { dir, deps, records, credentials, settings, modes, calls, voice, edge, tick: (ms: number) => (clock += ms) };
}

describe("voice: text cleaning", () => {
  it("strips Markdown and bracketed readings for CJK languages", () => {
    const s = cleanForSpeech("**银行**（yínháng, bank）很近。\n- 你去过[这里](https://x.y)吗？", "zh");
    assert.equal(s, "银行很近。\n你去过这里吗？");
    assert.equal(cleanForSpeech("Hola (hello) **amigo**", "es"), "Hola (hello) amigo", "Latin languages keep brackets");
  });
  it("cuts long text at a sentence end", () => {
    const long = "这是一句话。".repeat(400);
    const c = clip(long, 100);
    assert.ok(c.length <= 100 && c.endsWith("。"));
  });
  it("builds multipart bodies by hand", () => {
    const { body, contentType } = multipart({ model_id: "scribe_v2" }, { field: "file", name: "a.webm", mime: "audio/webm", data: new Uint8Array([1, 2]) });
    const text = Buffer.from(body).toString("latin1");
    const boundary = contentType.split("boundary=")[1];
    assert.ok(text.startsWith(`--${boundary}\r\nContent-Disposition: form-data; name="model_id"\r\n\r\nscribe_v2\r\n`));
    assert.ok(text.includes('name="file"; filename="a.webm"\r\nContent-Type: audio/webm\r\n\r\n\u0001\u0002\r\n'));
    assert.ok(text.endsWith(`--${boundary}--\r\n`));
  });
});

describe("voice: ElevenLabs accounts", () => {
  it("adds several accounts, rejects bad and duplicate keys, keeps the first under the v0.6 credential", async () => {
    const h = harness();
    let st = await h.voice.voiceStatus();
    assert.deepEqual(st.accounts, []);
    assert.equal(st.speaking, "edge");
    assert.equal(st.canTranscribe, false);
    await assert.rejects(h.voice.addElevenLabsAccount("sk_nope"), /didn't accept the API key/);
    st = await h.voice.addElevenLabsAccount(" sk_a ", "Personal");
    st = await h.voice.addElevenLabsAccount("sk_b");
    await assert.rejects(h.voice.addElevenLabsAccount("sk_b"), /already connected/);
    assert.deepEqual(
      st.accounts.map((a) => [a.label, a.keyHint, a.creditsLeft]),
      [
        ["Personal", "…sk_a", 8000],
        ["ElevenLabs 2", "…sk_b", 8000],
      ],
    );
    assert.equal(st.creditsLeft, 16000);
    assert.equal(st.speaking, "elevenlabs");
    assert.equal(st.canTranscribe, true);
    assert.equal(st.voiceId, "rachel", "a premade voice by default");
    assert.deepEqual(await h.credentials.read("elevenlabs"), { type: "api_key", key: "sk_a" });
    const second = (await h.settings.get()).elevenLabsAccounts![1]!;
    assert.deepEqual(await h.credentials.read(second.credential), { type: "api_key", key: "sk_b" });

    st = await h.voice.moveElevenLabsAccount(second.id, -1);
    assert.deepEqual(st.accounts.map((a) => a.label), ["ElevenLabs 2", "Personal"]);
    st = await h.voice.removeElevenLabsAccount(second.id);
    assert.deepEqual(st.accounts.map((a) => a.label), ["Personal"]);
    assert.equal(await h.credentials.read(second.credential), undefined);
  });

  it("turns a v0.6 key into the first account", async () => {
    const h = harness();
    await h.credentials.modify("elevenlabs", async () => ({ type: "api_key", key: "sk_c" }) as never);
    const st = await h.voice.voiceStatus();
    assert.deepEqual(st.accounts.map((a) => [a.label, a.keyHint]), [["ElevenLabs", "…sk_c"]]);
    assert.equal((await h.settings.get()).elevenLabsAccounts?.length, 1);
  });

  it("moves on to the next account when one runs out of credits, and falls back to the free voices at the end", async () => {
    const h = harness();
    await h.voice.addElevenLabsAccount("sk_a");
    await h.voice.addElevenLabsAccount("sk_b");
    h.modes.sk_a = "quota";
    const r1 = await h.voice.speak({ text: "银行", language: "zh", kind: "word" });
    assert.equal(r1.by, "elevenlabs");
    assert.equal(Buffer.from(r1.audio).toString(), "MP3:sk_b");
    const tts = h.calls.filter((c) => c.url.includes("/text-to-speech/"));
    assert.deepEqual(tts.map((c) => c.key), ["sk_a", "sk_b"]);
    assert.equal(JSON.parse(String(tts[1]!.body)).language_code, "zh");

    // sk_a now sits out: the next clip goes straight to sk_b.
    await h.voice.speak({ text: "觉得", language: "zh", kind: "word" });
    assert.deepEqual(h.calls.filter((c) => c.url.includes("/text-to-speech/")).map((c) => c.key), ["sk_a", "sk_b", "sk_b"]);
    const st = await h.voice.voiceStatus();
    assert.equal(st.accounts[0]!.state, "quota");

    // Cached: no request at all.
    const before = h.calls.length;
    const again = await h.voice.speak({ text: "银行", language: "zh", kind: "word" });
    assert.equal(again.cached, true);
    assert.equal(h.calls.length, before);

    h.modes.sk_b = "quota";
    const r3 = await h.voice.speak({ text: "你好！**今天**怎么样？", language: "zh", kind: "message" });
    assert.equal(r3.by, "edge");
    assert.match(r3.fellBack ?? "", /credits for this month are used up/);
    assert.equal(h.edge.texts.at(-1), "你好！今天怎么样？");
  });

  it("uses the free voices when the learner picks them, and sends no language code for whole messages", async () => {
    const h = harness();
    await h.voice.addElevenLabsAccount("sk_a");
    await h.voice.speak({ text: "Hola, ¿qué tal? (How are you?)", language: "es", kind: "message" });
    const body = JSON.parse(String(h.calls.filter((c) => c.url.includes("/text-to-speech/"))[0]!.body));
    assert.equal(body.language_code, undefined);
    assert.equal(body.model_id, "eleven_flash_v2_5");
    const st = await h.voice.setVoicePrefs({ tts: "edge", rate: 0.93, autoSpeak: true });
    assert.deepEqual(st.prefs, { tts: "edge", autoSpeak: true, autoSend: false, rate: 0.9 });
    assert.equal(st.speaking, "edge");
    const r = await h.voice.speak({ text: "Gracias", language: "es", kind: "word" });
    assert.equal(r.by, "edge");
    assert.equal(r.fellBack, undefined);
    await assert.rejects(h.voice.setVoicePrefs({ voiceId: "nobody" }), /isn't in your ElevenLabs account/);
  });

  it("transcribes with Scribe, skipping an account without the speech-to-text permission, and counts voice time", async () => {
    const h = harness();
    await assert.rejects(h.voice.transcribe({ audio: new Uint8Array([1]), mime: "audio/webm", language: "zh" }), /Connect an ElevenLabs account in Settings > Voice/);
    await h.voice.addElevenLabsAccount("sk_a");
    await h.voice.addElevenLabsAccount("sk_b");
    h.modes.sk_a = "noStt";
    const session = await h.records.createSession({ language: "zh", kind: "chat", feedbackMode: "inline" });
    const r = await h.voice.transcribe({ audio: new Uint8Array([9, 9, 9]), mime: "audio/webm;codecs=opus", language: "zh", sessionId: session.id, durationMs: 4000 });
    assert.equal(r.text, "我想去银行。");
    assert.equal(r.heard, "zho");
    assert.equal(r.account, "ElevenLabs 2");
    const stt = h.calls.filter((c) => c.url.endsWith("/speech-to-text"));
    assert.deepEqual(stt.map((c) => c.key), ["sk_a", "sk_b"]);
    const form = Buffer.from(stt[1]!.body as Uint8Array).toString("latin1");
    assert.match(form, /name="model_id"\r\n\r\nscribe_v2\r\n/);
    assert.match(form, /name="language_code"\r\n\r\nzh\r\n/);
    assert.match(form, /filename="speech.webm"\r\nContent-Type: audio\/webm\r\n/);
    assert.match(stt[1]!.contentType ?? "", /^multipart\/form-data; boundary=/);

    // Text to speech still uses sk_a: the missing permission only benches speech to text.
    await h.voice.speak({ text: "银行", language: "zh", kind: "word" });
    assert.equal(h.calls.filter((c) => c.url.includes("/text-to-speech/"))[0]!.key, "sk_a");

    await h.voice.trackVoiceActivity(session.id, 6000);
    const meta = await h.records.getSession(session.id);
    assert.equal(meta?.voiceMs, 10000);
    assert.equal(meta?.activeMs, 0, "voice time stays out of text practice time");
    const progress = await h.records.getProgress("zh", "week");
    assert.equal(progress.voiceMs, 10000);
    assert.equal(progress.sessions, 1);
  });

  it("deck audio shares the account pool", async () => {
    const h = harness();
    const decks = new DeckService(h.deps);
    const status = await decks.connectElevenLabs("sk_a");
    assert.equal(status.connected, true);
    const v = await h.voice.addElevenLabsAccount("sk_b");
    assert.equal(v.accounts.length, 2);
    const both = await decks.elevenLabsStatus();
    assert.equal(both.creditsLeft, 16000);
    await decks.disconnectElevenLabs();
    assert.deepEqual((await h.voice.voiceStatus()).accounts, []);
  });
});
