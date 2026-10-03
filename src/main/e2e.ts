// Test hook for driving the built app end to end without real credentials.
// Active only when SAYFERN_E2E_FAUX=1: registers pi-ai's faux provider with a
// scripted tutor that replies, records one observation and translates.
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type FauxResponseStep,
  type MutableModels,
} from "@earendil-works/pi-ai";

export function installE2EFaux(models: MutableModels): void {
  const faux = fauxProvider({ tokensPerSecond: 400 });
  models.setProvider(faux.provider);
  const step: FauxResponseStep = (context) => {
    const sys = context.messages.find((m) => m.role === "system");
    const system = typeof sys?.content === "string" ? sys.content : (sys?.content.map((c) => c.text).join("") ?? "");
    if (system.startsWith("Translate")) return fauxAssistantMessage("(translation)");
    if (system.startsWith("You check a language learner's retry")) return fauxAssistantMessage('{"ok": true, "feedback": "Good."}');
    const last = context.messages[context.messages.length - 1];
    const lastText = last?.role === "user" ? (typeof last.content === "string" ? last.content : "") : "";
    if (lastText.startsWith("(The learner opened")) return fauxAssistantMessage("你好！我们开始吧。你今天做了什么？");
    return fauxAssistantMessage([
      fauxText("很好！你说得不错。"),
      fauxToolCall("record_evidence", {
        observations: [
          { grammar_id: "zh:le-completion", pattern: "了", name: "Completed action 了", span: lastText.slice(0, 4), verdict: "correct", assistance: "independent" },
        ],
      }),
    ]);
  };
  faux.setResponses(Array.from({ length: 500 }, () => step));
}

// ---------------------------------------------------------------- feature sandbox check (SAYFERN_E2E_BUILDER=1)
// Runs inside the real Electron main process against a throwaway data folder (SAYFERN_E2E_DATA), prints
// PASS/FAIL lines and exits. Proves: (a) the sandboxed test runner reports counts, (b) test code can't reach
// Node, the web, loopback or a STUN/TURN server, (c) a feature UI loads from sayfern-feature:// in the app
// window and its SDK calls round-trip, with the same network and WebRTC limits, (d) approved full-access code
// loads from its frozen copy. A control window without the lockdown shows the STUN probe itself works.
import { createSocket } from "node:dgram";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { app as electronApp, BrowserWindow, session, type WebFrameMain } from "electron";
import type { SayfernApp } from "../core/app";
import { readDirFiles } from "../core/extensions";

const EXAMPLES = join(import.meta.dirname, "../../examples/extensions");

async function exampleFiles(name: string): Promise<Map<string, string>> {
  return new Map((await readDirFiles(join(EXAMPLES, name))).map(([p, b]) => [p, b.toString("utf8")]));
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Browser-side probe: fetch to the web and to loopback, and WebRTC to a local STUN and TURN server. */
function probeSource(udpPort: number, tcpPort: number): string {
  return `(async () => {
    const r = {};
    try { await fetch("https://example.com/"); r.web = "open"; } catch (e) { r.web = "blocked"; }
    try { await fetch("http://127.0.0.1:${tcpPort}/"); r.loopback = "open"; } catch (e) { r.loopback = "blocked"; }
    try {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:${udpPort}" }, { urls: "turn:127.0.0.1:${tcpPort}?transport=tcp", username: "u", credential: "p" }] });
      const cands = [];
      pc.onicecandidate = (e) => { if (e.candidate) cands.push(e.candidate.candidate); };
      pc.createDataChannel("x");
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise((ok) => setTimeout(ok, 2500));
      pc.close();
      r.rtc = cands.length + " candidates";
    } catch (e) { r.rtc = "error: " + e.message; }
    return JSON.stringify(r);
  })()`;
}

export async function runBuilderE2E(sayfern: SayfernApp, win: BrowserWindow): Promise<void> {
  const lines: string[] = [];
  let failures = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    lines.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`);
    if (!ok) failures++;
  };
  let udpHits = 0;
  let tcpHits = 0;
  const udp = createSocket("udp4");
  udp.on("message", () => udpHits++);
  await new Promise<void>((ok) => udp.bind(0, "127.0.0.1", ok));
  const tcp = createServer((s) => {
    tcpHits++;
    s.destroy();
  });
  await new Promise<void>((ok) => tcp.listen(0, "127.0.0.1", ok));
  const udpPort = udp.address().port;
  const tcpPort = (tcp.address() as { port: number }).port;
  try {
    // Control: an unlocked window sends STUN to our UDP socket, so a zero below means blocked, not broken.
    const control = new BrowserWindow({ show: false, webPreferences: { session: session.fromPartition("e2e-control"), sandbox: true } });
    await control.loadURL("data:text/html,<p>control</p>");
    const c = JSON.parse(await control.webContents.executeJavaScript(probeSource(udpPort, tcpPort)));
    control.destroy();
    check("control (no lockdown): STUN reaches the local server", udpHits > 0, `${udpHits} UDP packets, ${tcpHits} TCP connections, ${JSON.stringify(c)}`);
    udpHits = 0;
    tcpHits = 0;

    // The app window's session itself, without any page CSP: the dead proxy and WebRTC policy alone.
    const bare = new BrowserWindow({ show: false, webPreferences: { session: session.defaultSession, sandbox: true } });
    bare.webContents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
    await bare.loadURL("data:text/html,<p>bare</p>");
    const b = JSON.parse(await bare.webContents.executeJavaScript(probeSource(udpPort, tcpPort)));
    bare.destroy();
    check("app session without CSP: loopback blocked, no STUN/TURN traffic", b.loopback === "blocked" && udpHits === 0 && tcpHits === 0, `${JSON.stringify(b)} · ${udpHits} UDP, ${tcpHits} TCP`);
    udpHits = 0;
    tcpHits = 0;

    // (a) the example's tests in the sandboxed runner
    const drill = await sayfern.builder.installFeature(await exampleFiles("measure-word-drill"), { language: "zh" });
    const t = await sayfern.builder.testVersion(drill.id, 1);
    check("(a) test page in the hidden sandboxed window reports counts", t.ok && t.passed === 12 && t.total === 12, `${t.passed} of ${t.total}${t.error ? ` · ${t.error}` : ""}`);

    // (b) escape attempts from test code
    const evil = await exampleFiles("measure-word-drill");
    evil.set(
      "test.js",
      `test("escape payload", async () => {
  let r = "nothing";
  try { await import("node:fs"); r = "imported node:fs"; }
  catch (e) { try { r = "process: " + typeof e.constructor.constructor("return process")(); } catch (e2) { r = "blocked " + e2.name; } }
  assert.ok(r.startsWith("blocked"), r);
});
test("require and process are absent", () => { assert.equal(typeof require, "undefined"); assert.equal(typeof process, "undefined"); });
test("fetch to the web fails", async () => { let r = "open"; try { await fetch("https://example.com/"); } catch { r = "blocked"; } assert.equal(r, "blocked"); });
test("probe", async () => { const r = JSON.parse(await ${probeSource(udpPort, tcpPort)}); console.log(JSON.stringify(r)); assert.equal(r.web, "blocked"); assert.equal(r.loopback, "blocked"); });
`,
    );
    const bad = await sayfern.builder.installFeature(evil, { language: "zh" });
    const tb = await sayfern.builder.testVersion(bad.id, 1);
    check("(b) escape, require/process, fetch and loopback all fail inside the test page", tb.ok && tb.passed === 4, `${tb.passed} of ${tb.total} · ${tb.error ?? tb.output.replace(/\n/g, " | ")}`);
    check("(b) no STUN/TURN traffic from the test page", udpHits === 0 && tcpHits === 0, `${udpHits} UDP packets, ${tcpHits} TCP connections`);
    const loop = await sayfern.builder.installFeature(new Map([...evil, ["test.js", `test("forever", () => { for (;;) {} });`]]), { language: "zh" });
    const tl = await sayfern.builder.testVersion(loop.id, 1);
    check("(b) an endless test is stopped by the timeout", !tl.ok && /timed out/.test(tl.error ?? ""), tl.error ?? "");

    // (c) the feature UI in the real app window
    await sayfern.enableFeature(drill.id);
    await sayfern.setSettings({ onboarded: true });
    win.webContents.reload();
    await new Promise<void>((ok) => win.webContents.once("did-finish-load", () => ok()));
    await wait(800);
    await win.webContents.executeJavaScript(`location.hash = "#/feature/${drill.id}%2F0"`);
    let frame: WebFrameMain | undefined;
    for (let i = 0; i < 100 && !frame; i++) {
      await wait(100);
      frame = win.webContents.mainFrame.framesInSubtree.find((f) => f.url.startsWith("sayfern-feature://"));
    }
    check("(c) feature UI iframe loads from sayfern-feature://", !!frame, frame?.url ?? "no frame");
    if (frame) {
      await wait(1000);
      const ui = JSON.parse(
        (await frame.executeJavaScript(`(async () => JSON.stringify({
          origin: window.origin,
          sdk: typeof window.sayfern,
          choices: document.querySelectorAll(".sf-choice").length,
          context: await sayfern.context(),
          set: await sayfern.storage.set("e2e", { ok: 1 }),
          get: await sayfern.storage.get("e2e"),
          saved: (await sayfern.words.saved()).length,
          bad: await sayfern.lookup("").then(() => "accepted", (e) => "rejected: " + e.message),
          probe: JSON.parse(await ${probeSource(udpPort, tcpPort)}),
        }))()`)) as string,
      );
      const stored = join(electronApp.getPath("userData"), "builder", "data", drill.id, "storage.json");
      check("(c) sandboxed frame (opaque origin), drill rendered", ui.origin === "null" && ui.sdk === "object" && ui.choices === 4, JSON.stringify({ origin: ui.origin, choices: ui.choices }));
      check(
        "(c) SDK round trip through the renderer host to core",
        ui.context?.featureId === drill.id && ui.set === true && ui.get?.ok === 1 && existsSync(stored) && readFileSync(stored, "utf8").includes('"e2e"') && /rejected/.test(ui.bad),
        JSON.stringify({ context: ui.context, get: ui.get, saved: ui.saved, bad: ui.bad }),
      );
      check("(c) fetch to the web and loopback fail in the feature frame", ui.probe.web === "blocked" && ui.probe.loopback === "blocked", JSON.stringify(ui.probe));
      check("(c) no STUN/TURN traffic from the feature frame", udpHits === 0 && tcpHits === 0, `${udpHits} UDP packets, ${tcpHits} TCP connections`);
    }

    // (d) approved full-access code loads from its frozen copy
    const chengyu = await exampleFiles("chengyu-of-the-day");
    chengyu.set("test.js", `test("ok", () => assert.ok(true));`);
    const cy = await sayfern.builder.installFeature(chengyu, { language: "zh" });
    const refused = await sayfern.enableFeature(cy.id).then(() => "enabled", (e: Error) => e.message);
    await sayfern.approveFeature(cy.id, 1);
    const on = await sayfern.enableFeature(cy.id);
    const loaded = sayfern.extensions.managedList().find((x) => x.id === cy.id);
    check(
      "(d) review gate: refused before approval, loads the frozen copy after",
      /approve/.test(refused) && on.status === "on" && !!loaded && !loaded.error && loaded.path.includes(`${cy.id}/approved/`) && loaded.contributes.tools.includes("chengyu_of_the_day"),
      `${loaded?.path ?? "not loaded"} ${loaded?.error ?? ""}`,
    );
  } catch (err) {
    check("e2e run", false, err instanceof Error ? (err.stack ?? err.message) : String(err));
  } finally {
    udp.close();
    tcp.close();
    process.stdout.write(`\n${lines.join("\n")}\nE2E ${failures ? `FAILED (${failures})` : "PASSED"}\n`);
    electronApp.exit(failures ? 1 : 0);
  }
}
