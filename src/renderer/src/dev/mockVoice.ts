// Mock implementation of the Stage 3 VoiceApi slot for the browser dev server. Any key starting
// with "sk" connects; "sk_empty" is an account with no credits left. Speech is a short tone
// (longer text, longer tone) and "transcribing" returns a canned sentence in the learner's language.
import type { Language } from "../../../shared/records";
import type { ElevenLabsStatus } from "../../../shared/stage2";
import { DEFAULT_VOICE_PREFS, VOICE_RATES, type ElevenLabsAccountView, type VoiceApi, type VoicePrefs, type VoiceStatus } from "../../../shared/stage3";
import { mockClone, mockWait } from "./mockWorld";

const VOICES = [
  { id: "v1", name: "Rachel", category: "premade" },
  { id: "v2", name: "Adam", category: "premade" },
  { id: "c1", name: "My voice", category: "cloned" },
];

const HEARD: Partial<Record<Language, string>> = {
  zh: "我昨天去银行办了一张卡。",
  ja: "昨日、友達と映画を見に行きました。",
  ko: "어제 친구랑 영화를 봤어요.",
  es: "Ayer fui al cine con mis amigos.",
};

let accounts: (ElevenLabsAccountView & { key: string })[] = [];
let prefs: VoicePrefs = { ...DEFAULT_VOICE_PREFS };
let voiceId = "v1";

const usable = () => accounts.filter((a) => a.state === "ok");

function status(): VoiceStatus {
  const s: VoiceStatus = {
    accounts: accounts.map(({ key: _k, ...a }) => a),
    voices: accounts.length ? VOICES : [],
    prefs: { ...prefs },
    speaking: prefs.tts === "elevenlabs" && usable().length ? "elevenlabs" : "edge",
    canTranscribe: usable().length > 0,
  };
  if (accounts.length) {
    const v = VOICES.find((x) => x.id === voiceId)!;
    s.voiceId = v.id;
    s.voiceName = v.name;
    s.creditsLeft = accounts.reduce((n, a) => n + (a.creditsLeft ?? 0), 0);
  }
  return s;
}

/** The decks mock shows the same accounts (the real app shares one pool). */
export function mockElevenStatus(): ElevenLabsStatus {
  if (!accounts.length) return { connected: false, voices: [] };
  const v = VOICES.find((x) => x.id === voiceId)!;
  return {
    connected: true,
    voices: VOICES,
    voiceId: v.id,
    voiceName: v.name,
    creditsLeft: accounts.reduce((n, a) => n + (a.creditsLeft ?? 0), 0),
    creditLimit: accounts.reduce((n, a) => n + (a.creditLimit ?? 0), 0),
    tier: "free",
  };
}

export async function mockAddAccount(key: string, label?: string): Promise<void> {
  await mockWait(400);
  const k = key.trim();
  if (!k.startsWith("sk")) throw new Error("ElevenLabs didn't accept the API key.");
  if (accounts.some((a) => a.key === k)) throw new Error("This ElevenLabs key is already connected.");
  const empty = k === "sk_empty";
  accounts.push({
    id: `acct${Date.now()}`,
    key: k,
    label: label?.trim() || (accounts.length ? `ElevenLabs ${accounts.length + 1}` : "ElevenLabs"),
    addedAt: Date.now(),
    keyHint: `…${k.slice(-4)}`,
    state: empty ? "quota" : "ok",
    ...(empty ? { error: "Your ElevenLabs credits for this month are used up." } : {}),
    tier: "free",
    creditsLeft: empty ? 0 : 8800,
    creditLimit: 10000,
    resetsAt: Date.now() + 12 * 24 * 3600_000,
  });
}

export function mockSetVoice(id: string): void {
  if (!VOICES.some((v) => v.id === id)) throw new Error("That voice isn't in your ElevenLabs account.");
  voiceId = id;
}

export function mockRemoveAllAccounts(): void {
  accounts = [];
}

/** A mono 16-bit WAV: a soft two-note tone, about 60 ms per character (0.4 to 3 s). */
function tone(chars: number): Uint8Array {
  const rate = 16000;
  const secs = Math.min(3, Math.max(0.4, chars * 0.06));
  const n = Math.floor(rate * secs);
  const buf = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => buf.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  buf.setUint32(4, 36 + n * 2, true);
  str(8, "WAVEfmt ");
  buf.setUint32(16, 16, true);
  buf.setUint16(20, 1, true);
  buf.setUint16(22, 1, true);
  buf.setUint32(24, rate, true);
  buf.setUint32(28, rate * 2, true);
  buf.setUint16(32, 2, true);
  buf.setUint16(34, 16, true);
  str(36, "data");
  buf.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const f = i < n / 2 ? 440 : 554;
    const env = Math.min(1, i / 800, (n - i) / 800);
    buf.setInt16(44 + i * 2, Math.sin((2 * Math.PI * f * i) / rate) * 6000 * env, true);
  }
  return new Uint8Array(buf.buffer);
}

export function createVoiceMock(): VoiceApi {
  return {
    async voiceStatus() {
      await mockWait(80);
      return mockClone(status());
    },
    async addElevenLabsAccount(key, label) {
      await mockAddAccount(key, label);
      return mockClone(status());
    },
    async removeElevenLabsAccount(id) {
      accounts = accounts.filter((a) => a.id !== id);
      return mockClone(status());
    },
    async moveElevenLabsAccount(id, by) {
      const i = accounts.findIndex((a) => a.id === id);
      const j = i + by;
      if (i >= 0 && j >= 0 && j < accounts.length) [accounts[i], accounts[j]] = [accounts[j]!, accounts[i]!];
      return mockClone(status());
    },
    async setVoicePrefs(patch) {
      if (patch.voiceId) mockSetVoice(patch.voiceId);
      const { voiceId: _v, ...rest } = patch;
      prefs = { ...prefs, ...rest };
      if (rest.rate !== undefined) prefs.rate = VOICE_RATES.reduce((b, x) => (Math.abs(x - rest.rate!) < Math.abs(b - rest.rate!) ? x : b), 1 as number);
      return mockClone(status());
    },
    async speak(req) {
      await mockWait(350);
      const s = status();
      const fellBack = prefs.tts === "elevenlabs" && accounts.length > 0 && s.speaking === "edge" ? "Your ElevenLabs credits for this month are used up." : undefined;
      return { audio: tone(req.text.length), mime: "audio/wav", by: s.speaking, cached: false, ...(fellBack ? { fellBack } : {}), ...(s.speaking === "elevenlabs" ? { account: usable()[0]!.label } : {}) };
    },
    async transcribe(req) {
      await mockWait(900);
      if (!usable().length) throw new Error("Connect an ElevenLabs account in Settings > Voice to talk instead of typing.");
      return { text: HEARD[req.language] ?? "Yesterday I went to the cinema with my friends.", account: usable()[0]!.label };
    },
    async trackVoiceActivity() {},
  };
}
