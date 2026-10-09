// Sayfern arm: drives SayfernApp (the same core the desktop app runs) through
// its public SayfernApi methods. Model traffic goes to the recording proxy by
// giving the Anthropic provider the proxy as its base URL. If a future version
// changes these calls, typecheck fails here and nowhere else.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type Api,
  type Model,
  type Provider,
} from "@earendil-works/pi-ai";
import { SayfernApp } from "../../../src/core/app";
import { FileCredentialStore } from "../../../src/core/credential-file-store";
import { createSayfernModels } from "../../../src/core/providers";
import type { ChatEvent } from "../../../src/shared/api";
import type { Language } from "../../../src/shared/records";
import { expandPath, REPO_DIR, type SayfernArmConfig } from "../config";
import type { Scenario, ScenarioSession } from "../scenarios";
import type { TurnOutput } from "../types";
import type { Arm, ArmContext } from "./arm";

/** Routes one provider's requests to `baseUrl` without touching anything else. */
function redirect(p: Provider, baseUrl: string): Provider {
  const move = <M extends Model<Api>>(m: M): M => ({ ...m, baseUrl });
  return {
    ...p,
    baseUrl,
    stream: ((m, c, o) => p.stream(move(m), c, o)) as Provider["stream"],
    streamSimple: ((m, c, o) => p.streamSimple(move(m), c, o)) as Provider["streamSimple"],
  } as Provider;
}

export class SayfernArm implements Arm {
  readonly id: string;
  readonly label: string;
  private app!: SayfernApp;
  private ctx!: ArmContext;
  private language: Language = "zh";
  private sessionId = "";
  private docId = "";
  private events: ChatEvent[] = [];
  private ref = { provider: "anthropic", id: "" };

  constructor(private readonly cfg: SayfernArmConfig) {
    this.id = cfg.id;
    this.label = cfg.label ?? "Sayfern";
  }

  async version(): Promise<string> {
    const pkg = JSON.parse(readFileSync(join(REPO_DIR, "package.json"), "utf8")) as { version: string };
    return `sayfern ${pkg.version}`;
  }

  supports(s: Scenario): string | null {
    return ["zh", "ja"].includes(s.language) ? null : `language ${s.language}`;
  }

  async setup(ctx: ArmContext): Promise<void> {
    this.ctx = ctx;
    this.language = ctx.scenario.language as Language;
    const provider = this.cfg.provider ?? "anthropic";
    const credentials = new FileCredentialStore(expandPath(this.cfg.credentials));
    const models = createSayfernModels(credentials);
    const original = models.getProviders().find((p) => p.id === provider);
    if (!original) throw new Error(`Sayfern has no provider "${provider}"`);
    models.setProvider(redirect(original, ctx.proxyUrl));
    const faux = fauxProvider({ provider: "bench-seed" });
    models.setProvider(faux.provider);

    this.app = new SayfernApp({
      dataDir: join(ctx.runDir, "sayfern-data"),
      models,
      credentials,
      emit: (channel, payload) => {
        if (channel === "chat") this.events.push(payload as ChatEvent);
      },
    });
    await this.app.init();
    this.ref = { provider, id: ctx.model };
    const available = await this.app.listModels();
    if (!available.some((m) => m.provider === provider && m.id === ctx.model)) {
      throw new Error(
        `Sayfern can't use ${provider}/${ctx.model}. Sign in first: npm run smoke -- login ${provider} (credentials: ${this.cfg.credentials}).`,
      );
    }

    const m = ctx.sandbox.manifest;
    await this.app.setSettings({ model: this.ref, language: this.language, languages: [this.language], onboarded: true });
    if (m.profile) await this.app.setProfile({ about: m.profile.about ?? "", goals: m.profile.goals ?? {}, ...(m.profile.name ? { name: m.profile.name } : {}) });
    if (m.selfLevel) await this.app.setSelfLevel(this.language, m.selfLevel);

    // Anki: link the fixture deck and sync it once (a local operation, like the app's background sync).
    await this.app.ankiSetConfig({
      enabled: true,
      url: ctx.ankiUrl,
      decks: [
        {
          language: this.language,
          deck: ctx.sandbox.deck,
          wordField: m.anki.wordField,
          ...(m.anki.readingField ? { readingField: m.anki.readingField } : {}),
          ...(m.anki.meaningField ? { meaningField: m.anki.meaningField } : {}),
        },
      ],
    });
    const status = await this.app.ankiSync(this.language);
    if (!status.snapshots[this.language]) throw new Error(`Sayfern Anki sync failed: ${status.error ?? "no snapshot"}`);

    // Library: import the reader and put the checkpoint where the skill's note says.
    if (ctx.sandbox.reader && m.reader) {
      const [doc] = await this.app.importFiles(this.language, m.reader.kind as never, [ctx.sandbox.reader]);
      this.docId = doc.id;
      if (m.reader.resumeAt) {
        const paras = await this.app.getParagraphs(doc.id, 0, 10_000);
        const hit = paras.find((p) => p.text.includes(m.reader!.resumeAt!));
        if (!hit) throw new Error(`Reader checkpoint text not found: ${m.reader.resumeAt}`);
        await this.app.setCheckpoint(doc.id, hit.index, 0);
      }
    }

    // Prior learning history, equivalent to what the skill's wiki note records.
    // Written through normal tutor turns with a scripted (offline) model.
    const seedRef = { provider: "bench-seed", id: faux.getModel().id };
    for (const seed of m.sayfernSeed ?? []) {
      const view = await this.app.newSession({ language: this.language, kind: "chat" });
      faux.setResponses([
        fauxAssistantMessage([fauxText(seed.reply), fauxToolCall("record_evidence", seed.evidence as never)], { stopReason: "toolUse" }),
      ]);
      await this.app.send(view.meta.id, { text: seed.learner }, seedRef);
      await this.app.whenIdle();
      await this.app.endSession(view.meta.id);
    }
    if ((m.sayfernSeed ?? []).length && (await this.app.listGrammar(this.language)).length === 0) {
      throw new Error("Seeding Sayfern's learning history recorded nothing. The record_evidence arguments in the fixture manifest may need updating.");
    }
    this.events = [];
  }

  async open(session: ScenarioSession): Promise<TurnOutput | null> {
    this.events = [];
    const t0 = Date.now();
    let view;
    if (session.mode === "reading") {
      if (!this.docId) throw new Error("reading mode needs a reader in the fixture set");
      view = await this.app.openReading(this.docId);
    } else if (session.mode === "unit") {
      view = await this.app.startUnit(session.unit!, { explain: !!session.explain });
    } else {
      view = await this.app.newSession({ language: this.language, kind: session.mode === "practice" ? "practice" : "chat" });
    }
    this.sessionId = view.meta.id;
    await this.app.whenIdle();
    const mine = this.events.filter((e) => e.sessionId === this.sessionId);
    if (!mine.some((e) => e.type === "done" || e.type === "error")) return null; // no opening turn for this kind
    return this.collect(mine, Date.now() - t0);
  }

  async send(text: string): Promise<TurnOutput> {
    this.events = [];
    const t0 = Date.now();
    await this.app.send(this.sessionId, { text }, this.ref);
    await this.app.whenIdle();
    return this.collect(
      this.events.filter((e) => e.sessionId === this.sessionId),
      Date.now() - t0,
    );
  }

  async end(): Promise<TurnOutput | null> {
    // Ending a session is local in Sayfern (summary computed from records, no model call).
    const t0 = Date.now();
    const summary = await this.app.endSession(this.sessionId);
    return {
      reply: "",
      feedback: summary.corrections.map((c) => `${c.original} → ${c.corrected} (${c.kind}): ${c.explanation}`),
      wallMs: Date.now() - t0,
      extra: { local: true, grammar: summary.grammar.length, newWords: summary.newWords.length },
    };
  }

  async teardown(): Promise<void> {
    await this.app?.whenIdle().catch(() => undefined);
  }

  private collect(mine: ChatEvent[], wallMs: number): TurnOutput {
    const last = [...mine].reverse().find((e) => e.type === "done" || e.type === "error");
    const corrections = mine.flatMap((e) => (e.type === "correction" ? [e.correction] : []));
    const tools = mine.flatMap((e) => (e.type === "tool" ? [e.activity] : []));
    if (!last) return { reply: "", feedback: [], error: "no done/error event", wallMs };
    if (last.type === "error") {
      return { reply: "", feedback: [], error: last.message, wallMs, extra: { tools } };
    }
    const u = last.message.usage;
    return {
      reply: last.message.text,
      feedback: corrections.map((c) => `${c.original} → ${c.corrected} (${c.kind}): ${c.explanation}`),
      ...(last.message.error ? { error: last.message.error } : {}),
      wallMs,
      reported: u ? { input: u.input, output: u.output, costUsd: u.cost } : undefined,
      extra: { tools: tools.map((t) => `${t.ok ? "" : "✗ "}${t.name}: ${t.summary}`) },
    };
  }
}
