// Electron main: owns the window, dialogs, Keychain-backed credentials and the
// IPC table. Everything else lives in SayfernApp (src/core/app, plain Node).
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, safeStorage, session, shell, systemPreferences, type MenuItemConstructorOptions, type OpenDialogOptions, type SaveDialogOptions } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SayfernApp, errorText, type CoreApi, type ElectronOnlyMethod } from "../core/app";
import { FileCredentialStore } from "../core/credential-file-store";
import { createSayfernModels } from "../core/providers";
import { installE2EFaux } from "./e2e";
import { API_METHODS, EVENT_CHANNELS, ipcChannel, type SayfernApi } from "../shared/api";
import type { UiLocale } from "../shared/locales";
import { themeInfo } from "../shared/themes";

// ---------- services ----------
// End-to-end checks only: run against a throwaway data folder.
if (process.env.SAYFERN_E2E_DATA) app.setPath("userData", process.env.SAYFERN_E2E_DATA);
const dataDir = app.getPath("userData");
let win: BrowserWindow | null = null;

// Chromium's network stack (system proxy settings, certificates) for main-process HTTP.
const electronFetch = ((input: string | URL | Request, init?: RequestInit) =>
  session.defaultSession.fetch(input instanceof URL ? input.href : input, init)) as typeof fetch;

/** Builds the backend. Called at startup and again after "Erase all data" (fresh caches, fresh credentials). */
function buildApp(): SayfernApp {
  const credentials = new FileCredentialStore(join(dataDir, "credentials.json"), {
    // safeStorage encrypts with a key kept in the macOS Keychain.
    encrypt: (s) => safeStorage.encryptString(s).toString("base64"),
    decrypt: (s) => safeStorage.decryptString(Buffer.from(s, "base64")),
  });
  const models = createSayfernModels(credentials);
  // End-to-end test hook only (never set in normal use): a scripted fake provider.
  if (process.env.SAYFERN_E2E_FAUX === "1") installE2EFaux(models);
  const built: SayfernApp = new SayfernApp({
    dataDir,
    models,
    credentials,
    fetch: electronFetch,
    // Node's fetch for AnkiConnect on 127.0.0.1 (no proxy, no Chromium request policies).
    ankiFetch: globalThis.fetch.bind(globalThis),
    emit: (channel, payload) => {
      // Events from a discarded instance (after an erase) must not reach the new UI.
      if (built === sayfern && win && !win.isDestroyed()) win.webContents.send(EVENT_CHANNELS[channel], payload);
    },
    openExternal: (url) => void shell.openExternal(url),
    // The default interface language follows macOS's preferred languages (System Settings > Language & Region).
    systemLocales: () => app.getPreferredSystemLanguages(),
  });
  if (process.env.SAYFERN_E2E_FAUX === "1") Object.assign(globalThis, { __sayfernE2E: built });
  return built;
}

async function initApp(a: SayfernApp): Promise<void> {
  try {
    await a.init();
  } catch (err) {
    console.error("Sayfern init failed:", errorText(err));
  }
}

let sayfern = buildApp();
/** While an erase runs, every other API call waits for it (and then reaches the new instance). */
let erasing: Promise<void> | null = null;

// ---------- Electron-only API methods ----------
const IMPORT_EXTENSIONS = ["txt", "md", "markdown", "html", "htm", "xhtml", "epub", "pdf"];

const electronOnly: Pick<SayfernApi, ElectronOnlyMethod> = {
  async importDocs(language, kind) {
    const options: OpenDialogOptions = {
      title: "Add to library",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Text, Markdown, HTML, EPUB, PDF", extensions: IMPORT_EXTENSIONS }],
    };
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (r.canceled || r.filePaths.length === 0) return [];
    return sayfern.importFiles(language, kind, r.filePaths);
  },
  async exportData() {
    const options: SaveDialogOptions = {
      title: "Export your data",
      defaultPath: join(app.getPath("downloads"), sayfern.exportFileName()),
      filters: [{ name: "JSON", extensions: ["json"] }],
    };
    const r = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (r.canceled || !r.filePath) return null;
    return sayfern.exportTo(r.filePath);
  },
  eraseAllData(opts) {
    erasing ??= (async () => {
      try {
        await sayfern.eraseData({ keepSignIns: !!opts?.keepSignIns });
      } finally {
        // Rebuild even if deleting failed part-way, so nothing keeps serving stale caches.
        const next = buildApp();
        sayfern = next;
        await initApp(next);
        erasing = null;
      }
    })();
    return erasing;
  },
  async openExternal(url) {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url);
  },
  async requestMicrophone() {
    // macOS asks once; after a "no" the learner has to allow it in System Settings > Privacy & Security.
    if (process.platform !== "darwin") return true;
    if (systemPreferences.getMediaAccessStatus("microphone") === "granted") return true;
    return systemPreferences.askForMediaAccess("microphone");
  },
};

function registerIpc(): void {
  for (const method of API_METHODS) {
    const own = Object.hasOwn(electronOnly, method);
    // Resolved per call: `sayfern` is replaced after an erase.
    const target = (): object => (own ? electronOnly : (sayfern satisfies CoreApi));
    if (typeof (target() as Record<string, unknown>)[method] !== "function") throw new Error(`No handler for ${method}`);
    ipcMain.handle(ipcChannel(method), async (_e, ...args: unknown[]) => {
      try {
        if (erasing && method !== "eraseAllData") await erasing.catch(() => undefined);
        const t = target();
        const result = await ((t as Record<string, unknown>)[method] as (...a: unknown[]) => unknown).apply(t, args);
        if (method === "setSettings") {
          void refreshMenu();
          void refreshTheme();
        }
        return result;
      } catch (err) {
        // Only the message crosses IPC; make sure there is a readable one.
        throw new Error(errorText(err) || "Something went wrong.");
      }
    });
  }
}

// ---------- branding ----------
// app.name stays "sayfern" (package.json): it names the userData folder and the Keychain item that
// encrypts credentials. Everything the learner sees says "Sayfern". In dev the Dock and menu-bar name
// come from the patched Electron.app (scripts/brand-electron-app.mjs).
const DISPLAY_NAME = "Sayfern";
/** build/icon.png next to the sources; absent in packaged builds (they use the bundle icon). */
const ICON_PNG = join(import.meta.dirname, "../../build/icon.png");

/** The app menu's own items, per interface language. The standard menus (Edit, View, Window) come from Electron. */
const MENU_TEXT: Record<UiLocale, { about: string; hide: string; quit: string }> = {
  en: { about: "About Sayfern", hide: "Hide Sayfern", quit: "Quit Sayfern" },
  "zh-Hans": { about: "关于 Sayfern", hide: "隐藏 Sayfern", quit: "退出 Sayfern" },
  "zh-Hant": { about: "關於 Sayfern", hide: "隱藏 Sayfern", quit: "結束 Sayfern" },
  ja: { about: "Sayfern について", hide: "Sayfern を非表示", quit: "Sayfern を終了" },
  ko: { about: "Sayfern에 관하여", hide: "Sayfern 가리기", quit: "Sayfern 종료" },
  vi: { about: "Giới thiệu về Sayfern", hide: "Ẩn Sayfern", quit: "Thoát Sayfern" },
  ru: { about: "О программе Sayfern", hide: "Скрыть Sayfern", quit: "Завершить Sayfern" },
  fr: { about: "À propos de Sayfern", hide: "Masquer Sayfern", quit: "Quitter Sayfern" },
  it: { about: "Informazioni su Sayfern", hide: "Nascondi Sayfern", quit: "Esci da Sayfern" },
  es: { about: "Acerca de Sayfern", hide: "Ocultar Sayfern", quit: "Salir de Sayfern" },
  de: { about: "Über Sayfern", hide: "Sayfern ausblenden", quit: "Sayfern beenden" },
  "pt-BR": { about: "Sobre o Sayfern", hide: "Ocultar Sayfern", quit: "Encerrar Sayfern" },
  "pt-PT": { about: "Acerca do Sayfern", hide: "Ocultar Sayfern", quit: "Sair do Sayfern" },
};

let menuLocale: UiLocale | null = null;

/** Rebuilds the menu when the interface language changed (startup and after setSettings). */
async function refreshMenu(): Promise<void> {
  const locale = await sayfern.settings.locale().catch((): UiLocale => "en");
  if (locale === menuLocale) return;
  menuLocale = locale;
  setUpBranding(locale);
}

/** Native controls (scrollbars, menus) and the window background follow the colour theme. */
async function refreshTheme(): Promise<void> {
  const info = themeInfo((await sayfern.settings.get().catch(() => undefined))?.theme);
  nativeTheme.themeSource = info.dark ? "dark" : "light";
  win?.setBackgroundColor(info.paper);
}

function setUpBranding(locale: UiLocale = "en"): void {
  const text = MENU_TEXT[locale] ?? MENU_TEXT.en;
  app.setAboutPanelOptions({ applicationName: DISPLAY_NAME, applicationVersion: app.getVersion(), copyright: "MIT License" });
  if (process.platform === "darwin" && !app.isPackaged && existsSync(ICON_PNG)) app.dock?.setIcon(ICON_PNG);
  // Electron's default menu, with the app's own items spelled "Sayfern" instead of app.name.
  // Keeps the standard Edit menu, so copy, paste and undo work in inputs.
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [
          {
            label: DISPLAY_NAME,
            submenu: [
              { role: "about", label: text.about },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide", label: text.hide },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit", label: text.quit },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- window ----------
async function createWindow(): Promise<void> {
  const theme = themeInfo((await sayfern.settings.get().catch(() => undefined))?.theme);
  nativeTheme.themeSource = theme.dark ? "dark" : "light";
  win = new BrowserWindow({
    title: DISPLAY_NAME,
    ...(process.platform === "linux" && existsSync(ICON_PNG) ? { icon: ICON_PNG } : {}),
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 20 },
    backgroundColor: theme.paper,
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // required for an ESM preload; the renderer still has no Node access
    },
  });
  win.once("ready-to-show", () => win?.show());
  win.on("closed", () => {
    win = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  // The UI is one page with hash routes. Anything else (a PDF dropped on the window, a stray link)
  // would replace the app with that file or site: keep the app, open web links in the browser.
  win.webContents.on("will-navigate", (e, url) => {
    const page = (u: string) => u.split("#")[0];
    if (win && page(url) === page(win.webContents.getURL())) return;
    e.preventDefault();
    if (/^https?:/.test(url) && !process.env.ELECTRON_RENDERER_URL?.startsWith(new URL(url).origin)) void shell.openExternal(url);
  });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
}

// ---------- lifecycle ----------
// The menu (setUpBranding) keeps Electron's standard roles, so Edit (copy/paste/undo) works in inputs.
// One instance only: two processes writing the same JSON records would clobber each other.
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  const w = BrowserWindow.getAllWindows()[0];
  if (w) {
    if (w.isMinimized()) w.restore();
    w.focus();
  }
});

app.whenReady().then(async () => {
  setUpBranding();
  await initApp(sayfern);
  await refreshMenu();
  registerIpc();
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
