// Electron side of the feature sandbox (S2-11, S2-12). Core resolves sayfern-feature:// URLs
// (BuilderService.serveAsset); this file decides where that code may run and what it can reach:
//
// - Feature UIs: <iframe sandbox="allow-scripts"> in the main window (default session). That session gets a
//   dead proxy, so nothing but sayfern-feature://, file:// and data: loads; WebRTC may only use the (dead)
//   proxy, so no STUN/TURN traffic; subframes get no permissions. Main's own HTTP goes through a separate
//   session (netSession), so model sign-ins and downloads are unaffected.
// - Feature tests: a hidden, sandboxed, preload-less BrowserWindow on its own in-memory session with the same
//   lockdown, loading the version's test page; results are read back with executeJavaScript.
import { BrowserWindow, session, type Session } from "electron";
import { FEATURE_SCHEME } from "../shared/stage2";
import type { AssetResponse, FeatureTestRunner } from "../core/builder";
import { parseTestOutput } from "../core/builder";

/** Nothing listens here: every proxied request fails. */
const DEAD_PROXY = "http://127.0.0.1:9";
export const FEATURE_TEST_PARTITION = "sayfern-feature-tests";
const NET_PARTITION = "sayfern-net";

export type ServeAsset = (url: string, opts: { tests?: boolean }) => Promise<AssetResponse>;

function handleWith(serve: ServeAsset, tests: boolean) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
    const r = await serve(req.url, { tests });
    return new Response(r.body ?? null, { status: r.status, headers: r.headers });
  };
}

/**
 * Routes all of a session's network traffic to a dead proxy. `loopback`: also send localhost through it
 * (Chromium bypasses the proxy for loopback by default). The dev server needs loopback, so dev keeps it.
 */
export async function blockNetwork(ses: Session, loopback: boolean): Promise<void> {
  await ses.setProxy({ proxyRules: DEAD_PROXY, proxyBypassRules: loopback ? "<-loopback>" : "" });
  await ses.closeAllConnections();
}

/** Main window session: the app page keeps its (few) permissions; feature frames get none. */
export async function lockDownAppSession(serve: ServeAsset, opts: { dev: boolean }): Promise<void> {
  const ses = session.defaultSession;
  ses.protocol.handle(FEATURE_SCHEME, handleWith(serve, false));
  await blockNetwork(ses, !opts.dev);
  const fromFeature = (url: string | undefined, mainFrame: boolean | undefined) => !mainFrame || !url || url.startsWith(`${FEATURE_SCHEME}:`);
  ses.setPermissionRequestHandler((_wc, _permission, callback, details) => callback(!fromFeature(details.requestingUrl, details.isMainFrame)));
  ses.setPermissionCheckHandler((_wc, _permission, _origin, details) => !fromFeature(details.requestingUrl, details.isMainFrame));
  ses.setDevicePermissionHandler(() => false);
}

/** Session for main-process HTTP (dictionary downloads and other electronFetch calls). */
export function netSession(): Session {
  return session.fromPartition(NET_PARTITION);
}

/** Locks down a feature's webContents: no WebRTC traffic outside the (dead) proxy, no popups. */
export function lockDownContents(wc: Electron.WebContents): void {
  wc.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
}

let testSession: Promise<Session> | null = null;

function featureTestSession(serve: ServeAsset): Promise<Session> {
  testSession ??= (async () => {
    const ses = session.fromPartition(FEATURE_TEST_PARTITION);
    ses.protocol.handle(FEATURE_SCHEME, handleWith(serve, true));
    await blockNetwork(ses, true);
    ses.setPermissionRequestHandler((_wc, _p, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.setDevicePermissionHandler(() => false);
    return ses;
  })();
  return testSession;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The app's feature test runner: the version's test page in a hidden sandboxed window on the locked-down
 * test session. `serve` is resolved per request (main replaces SayfernApp after an erase).
 */
export function createElectronTestRunner(serve: ServeAsset): FeatureTestRunner {
  return async ({ url, timeoutMs }) => {
    const started = Date.now();
    const elapsed = () => Date.now() - started;
    const ses = await featureTestSession(serve);
    const win = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false, backgroundThrottling: false },
    });
    lockDownContents(win.webContents);
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), timeoutMs)));
    try {
      const run = (async () => {
        await win.loadURL(url);
        for (;;) {
          const r: unknown = await win.webContents.executeJavaScript("window.__sayfernResult ?? null", false);
          if (typeof r === "string") return r;
          await sleep(40);
        }
      })();
      run.catch(() => undefined);
      const raw = await Promise.race([run, timeout]);
      if (raw == null) return { passed: 0, failed: 0, total: 0, ok: false, output: "", error: `Tests timed out after ${Math.max(1, Math.round(timeoutMs / 1000))} s.`, durationMs: elapsed() };
      return parseTestOutput(raw, elapsed());
    } catch (err) {
      return { passed: 0, failed: 0, total: 0, ok: false, output: "", error: `Tests couldn't run: ${err instanceof Error ? err.message : String(err)}`, durationMs: elapsed() };
    } finally {
      clearTimeout(timer);
      if (!win.isDestroyed()) {
        win.webContents.forcefullyCrashRenderer();
        win.destroy();
      }
    }
  };
}
