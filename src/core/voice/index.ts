// Stage 3 voice service (S3-01..S3-04): reads text aloud, transcribes the learner's speech and
// counts voice practice time. Text to speech: ElevenLabs (the learner's accounts, in order) or
// the free Edge voices; speech to text: ElevenLabs Scribe. Clips are cached under records/voice-audio/.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LANGUAGES, type Language } from "../../shared/records";
import { msg } from "../../shared/i18n";
import {
  DEFAULT_VOICE_PREFS,
  SPEAK_MAX_CHARS,
  VOICE_RATES,
  type SpeakRequest,
  type SpeakResult,
  type TranscribeRequest,
  type TranscribeResult,
  type VoiceApi,
  type VoicePrefs,
  type VoiceStatus,
} from "../../shared/stage3";
import type { Stage2Deps } from "../stage2";
import { defaultVoice, EDGE_VOICES, edgeTts, elevenTts, TtsError, type WsFactory } from "../decks/tts";
import { ElevenLabsAccounts } from "./accounts";
import { elevenStt, STT_MAX_BYTES } from "./stt";

export { ElevenLabsAccounts } from "./accounts";

/** Cached clips kept on disk; the oldest go first past this. */
const CACHE_MAX_FILES = 600;
const CACHE_PRUNE_TO = 450;
/** One activity report is capped (renderer sends small increments). */
const MAX_REPORT_MS = 10 * 60_000;

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const CJK: ReadonlySet<Language> = new Set(["zh", "ja", "ko"]);

/**
 * A tutor message as it should be spoken: no Markdown, no links, and in Chinese, Japanese and
 * Korean no romanised readings or glosses in brackets ("银行（yínháng, bank）" → "银行").
 */
export function cleanForSpeech(text: string, language: Language): string {
  let s = String(text ?? "");
  s = s.replace(/```[\s\S]*?```/g, " ");
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/https?:\/\/\S+/g, " ");
  s = s.replace(/^\s{0,3}(#{1,6}|>+)\s*/gm, "");
  s = s.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, "");
  s = s.replace(/\|/g, " ");
  s = s.replace(/(\*\*|__|\*|`|~~)/g, "");
  if (CJK.has(language)) s = s.replace(/[(（]\s*[\p{Script=Latin}\p{M}\d\s,.;:'’‘"“”\-–/!?，、。=]+\s*[)）]/gu, "");
  s = s.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{2,}/g, "\n");
  return s.trim();
}

/** Cuts long text at the last sentence end before `max` characters. */
export function clip(text: string, max = SPEAK_MAX_CHARS): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const cut = Math.max(...["。", "！", "？", ". ", "! ", "? ", "\n"].map((p) => head.lastIndexOf(p)));
  return (cut > max * 0.5 ? head.slice(0, cut + 1) : head).trim();
}

function nearestRate(r: unknown): number {
  const n = typeof r === "number" && Number.isFinite(r) ? r : 1;
  return VOICE_RATES.reduce((best, x) => (Math.abs(x - n) < Math.abs(best - n) ? x : best), 1 as number);
}

export class VoiceService implements VoiceApi {
  readonly accounts: ElevenLabsAccounts;
  private readonly dir: string;
  private readonly ws?: WsFactory;
  private writes = 0;

  constructor(
    private readonly deps: Stage2Deps,
    opts: { ws?: WsFactory } = {},
  ) {
    this.accounts = deps.eleven ?? new ElevenLabsAccounts({ credentials: deps.credentials, settings: deps.settings, fetch: () => this.fetch, now: deps.now, newId: deps.newId });
    this.dir = join(deps.records.dataDir, "voice-audio");
    this.ws = opts.ws;
  }

  private get fetch(): typeof fetch {
    return this.deps.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async prefs(): Promise<VoicePrefs> {
    const v = (await this.deps.settings.get()).voice ?? {};
    return {
      tts: v.tts === "edge" ? "edge" : "elevenlabs",
      autoSpeak: typeof v.autoSpeak === "boolean" ? v.autoSpeak : DEFAULT_VOICE_PREFS.autoSpeak,
      autoSend: typeof v.autoSend === "boolean" ? v.autoSend : DEFAULT_VOICE_PREFS.autoSend,
      rate: nearestRate(v.rate ?? DEFAULT_VOICE_PREFS.rate),
    };
  }

  // ------------------------------------------------------------ status and accounts

  async voiceStatus(): Promise<VoiceStatus> {
    const [prefs, accounts, settings] = await Promise.all([this.prefs(), this.accounts.views(), this.deps.settings.get()]);
    const status: VoiceStatus = { accounts, voices: [], prefs, speaking: "edge", canTranscribe: false };
    if (!accounts.length) return status;
    const { voices } = await this.accounts.allVoices();
    status.voices = voices;
    const chosen = voices.find((v) => v.id === settings.elevenLabsVoice?.id) ?? (settings.elevenLabsVoice ? undefined : defaultVoice(voices));
    if (chosen) {
      status.voiceId = chosen.id;
      status.voiceName = chosen.name;
    } else if (settings.elevenLabsVoice) {
      status.voiceId = settings.elevenLabsVoice.id;
      status.voiceName = settings.elevenLabsVoice.name;
    }
    const working = accounts.filter((a) => a.state === "ok");
    if (prefs.tts === "elevenlabs" && working.length) status.speaking = "elevenlabs";
    status.canTranscribe = working.length > 0 && (await this.accounts.canDo("stt"));
    const known = accounts.filter((a) => a.creditsLeft != null);
    if (known.length) status.creditsLeft = known.reduce((n, a) => n + (a.creditsLeft ?? 0), 0);
    return status;
  }

  async addElevenLabsAccount(apiKey: string, label?: string): Promise<VoiceStatus> {
    const added = await this.accounts.add(apiKey, label);
    this.accounts.clearBench();
    const settings = await this.deps.settings.get();
    if (!settings.elevenLabsVoice) {
      const voice = defaultVoice(await this.accounts.voicesOf(added).catch(() => []));
      if (voice) await this.deps.settings.update({ elevenLabsVoice: { id: voice.id, name: voice.name } });
    }
    return this.voiceStatus();
  }

  async removeElevenLabsAccount(accountId: string): Promise<VoiceStatus> {
    await this.accounts.remove(String(accountId));
    return this.voiceStatus();
  }

  async moveElevenLabsAccount(accountId: string, by: -1 | 1): Promise<VoiceStatus> {
    await this.accounts.move(String(accountId), by < 0 ? -1 : 1);
    return this.voiceStatus();
  }

  async setVoicePrefs(patch: Partial<VoicePrefs> & { voiceId?: string }): Promise<VoiceStatus> {
    const p = patch && typeof patch === "object" ? patch : {};
    const next: Partial<VoicePrefs> = { ...(await this.deps.settings.get()).voice };
    if (p.tts === "edge" || p.tts === "elevenlabs") next.tts = p.tts;
    if (typeof p.autoSpeak === "boolean") next.autoSpeak = p.autoSpeak;
    if (typeof p.autoSend === "boolean") next.autoSend = p.autoSend;
    if (p.rate !== undefined) next.rate = nearestRate(p.rate);
    const update: Parameters<Stage2Deps["settings"]["update"]>[0] = { voice: next };
    if (typeof p.voiceId === "string") {
      const v = (await this.accounts.allVoices()).voices.find((x) => x.id === p.voiceId);
      if (!v) throw new Error("That voice isn't in your ElevenLabs account.");
      update.elevenLabsVoice = { id: v.id, name: v.name };
    }
    await this.deps.settings.update(update);
    return this.voiceStatus();
  }

  // ------------------------------------------------------------ speaking

  private async cached(key: string): Promise<Buffer | null> {
    try {
      const buf = await readFile(join(this.dir, `${key}.mp3`));
      return buf.length ? buf : null;
    } catch {
      return null;
    }
  }

  private async keep(key: string, audio: Buffer): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const file = join(this.dir, `${key}.mp3`);
    await writeFile(`${file}.tmp`, audio);
    await rename(`${file}.tmp`, file);
    if (++this.writes % 25 === 0) void this.prune().catch(() => undefined);
  }

  /** Keeps the cache bounded: deletes the least recently written clips. */
  async prune(): Promise<number> {
    const names = (await readdir(this.dir).catch(() => [] as string[])).filter((n) => n.endsWith(".mp3"));
    if (names.length <= CACHE_MAX_FILES) return 0;
    const dated = await Promise.all(names.map(async (n) => ({ n, t: (await stat(join(this.dir, n)).catch(() => null))?.mtimeMs ?? 0 })));
    dated.sort((a, b) => a.t - b.t);
    const drop = dated.slice(0, dated.length - CACHE_PRUNE_TO);
    await Promise.all(drop.map((d) => unlink(join(this.dir, d.n)).catch(() => undefined)));
    return drop.length;
  }

  async speak(req: SpeakRequest): Promise<SpeakResult> {
    const language = req?.language;
    if (!(LANGUAGES as readonly string[]).includes(language)) throw new Error("Unknown language.");
    const kind = req.kind === "word" || req.kind === "sentence" ? req.kind : "message";
    const raw = typeof req.text === "string" ? req.text : "";
    const text = clip(kind === "message" ? cleanForSpeech(raw, language) : raw.replace(/\s+/g, " ").trim());
    if (!text) throw new Error("There's nothing to read aloud here.");

    const prefs = await this.prefs();
    let fellBack: string | undefined;
    if (prefs.tts === "elevenlabs" && (await this.accounts.count()) > 0) {
      const wanted = (await this.deps.settings.get()).elevenLabsVoice?.id;
      // Whole messages often mix the target language with explanations: let the model detect it.
      const code = kind === "message" ? undefined : language;
      const key = sha(`elevenlabs|${wanted ?? "default"}|${code ?? "auto"}|${text}`);
      const hit = await this.cached(key);
      if (hit) return { audio: hit, mime: "audio/mpeg", by: "elevenlabs", cached: true };
      try {
        const { value, account } = await this.accounts.run("tts", async (a) => {
          const voiceId = await this.accounts.voiceFor(a, wanted);
          if (!voiceId) throw new TtsError(msg("This ElevenLabs account has no voices Sayfern can use."), "other");
          return elevenTts(this.fetch, a.key, { text, voiceId, ...(code ? { language: code } : {}) });
        });
        await this.keep(key, value);
        return { audio: value, mime: "audio/mpeg", by: "elevenlabs", account: account.label, cached: false };
      } catch (err) {
        fellBack = errText(err);
      }
    }
    const voice = EDGE_VOICES[language][kind === "word" ? "word" : "sentence"];
    const key = sha(`edge|${voice}|${text}`);
    const hit = await this.cached(key);
    const out = (audio: Buffer, cached: boolean): SpeakResult => ({ audio, mime: "audio/mpeg", by: "edge", cached, ...(fellBack ? { fellBack } : {}) });
    if (hit) return out(hit, true);
    const audio = await edgeTts(text, voice, { ws: this.ws, fetch: this.fetch });
    await this.keep(key, audio);
    return out(audio, false);
  }

  // ------------------------------------------------------------ listening

  async transcribe(req: TranscribeRequest): Promise<TranscribeResult> {
    const language = req?.language;
    if (!(LANGUAGES as readonly string[]).includes(language)) throw new Error("Unknown language.");
    const audio = req.audio instanceof Uint8Array ? req.audio : null;
    if (!audio?.byteLength) throw new Error("The recording is empty. Check that Sayfern can use the microphone.");
    if (audio.byteLength > STT_MAX_BYTES) throw new Error("That recording is too long. Keep voice messages under two minutes.");
    if ((await this.accounts.count()) === 0) throw new Error("Connect an ElevenLabs account in Settings > Voice to talk instead of typing.");
    const mime = typeof req.mime === "string" && /^audio\//.test(req.mime) ? req.mime : "audio/webm";
    const { value, account } = await this.accounts.run("stt", (a) => elevenStt(this.fetch, a.key, { audio, mime, language }));
    if (req.sessionId && typeof req.durationMs === "number") await this.trackVoiceActivity(req.sessionId, req.durationMs).catch(() => undefined);
    if (!value.text) throw new Error("Sayfern didn't hear any speech. Try again a little closer to the microphone.");
    const result: TranscribeResult = { text: value.text, account: account.label };
    if (value.heard) result.heard = value.heard;
    return result;
  }

  async trackVoiceActivity(sessionId: string, ms: number): Promise<void> {
    if (typeof sessionId !== "string" || !Number.isFinite(ms) || ms <= 0) return;
    await this.deps.records.addVoiceTime(sessionId, Math.min(ms, MAX_REPORT_MS));
  }
}
