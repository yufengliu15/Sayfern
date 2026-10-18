// Electron main: owns the window, dialogs, Keychain-backed credentials and the
// IPC table. Everything else lives in SayfernApp (src/core/app, plain Node).
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, safeStorage, session, shell, systemPreferences, type MenuItemConstructorOptions, type MessageBoxOptions, type OpenDialogOptions, type SaveDialogOptions } from "electron";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SayfernApp, errorText, type CoreApi, type ElectronOnlyMethod } from "../core/app";
import { FileCredentialStore } from "../core/credential-file-store";
import { createSayfernModels } from "../core/providers";
import { checkForUpdate, RELEASES_PAGE } from "../core/updates";
import { installE2EFaux } from "./e2e";
import { API_METHODS, EVENT_CHANNELS, ipcChannel, type SayfernApi } from "../shared/api";
import type { UiLocale } from "../shared/locales";
import { themeInfo } from "../shared/themes";

// ---------- services ----------
// End-to-end checks only: run against a throwaway data folder.
if (process.env.SAYFERN_E2E_DATA) app.setPath("userData", process.env.SAYFERN_E2E_DATA);
const dataDir = app.getPath("userData");
let win: BrowserWindow | null = null;
/** The Flatpak sandbox: Flathub (or the learner's software store) owns updates there. */
const IN_FLATPAK = !!process.env.FLATPAK_ID || existsSync("/.flatpak-info");

// ---------- Linux: X11 fallback ----------
// Electron runs natively on Wayland, where some GPU drivers crash the GPU process. When that happens
// and XWayland is there, Sayfern writes this marker and restarts on X11; every later start uses X11
// too. Delete the marker to try Wayland again. X11 sessions and working Wayland setups never see it.
// The flag must be on the real command line (Chromium picks the platform before main runs), so a
// start with the marker relaunches itself once with it.
const X11_MARKER = join(dataDir, "use-x11");
const OZONE_FLAG = "--ozone-platform=x11";
const onXWayland = process.platform === "linux" && !IN_FLATPAK && !!process.env.WAYLAND_DISPLAY && !!process.env.DISPLAY;
const hasOzoneFlag = process.argv.some((a) => a.startsWith("--ozone-platform"));
/** Driver faults. A killed or out-of-memory GPU process says nothing about Wayland. */
const GPU_FAULTS = new Set(["crashed", "abnormal-exit", "launch-failed"]);

function relaunchOnX11() {
  app.relaunch({ args: [...process.argv.slice(1), OZONE_FLAG] });
  app.exit(0);
}

if (onXWayland && !hasOzoneFlag) {
  if (existsSync(X11_MARKER)) relaunchOnX11();
  app.on("child-process-gone", (_e, details) => {
    if (details.type !== "GPU" || !GPU_FAULTS.has(details.reason)) return;
    console.error(`GPU process ${details.reason} (exit ${details.exitCode}) on Wayland: restarting on X11.`);
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(X11_MARKER, `GPU process ${details.reason}, exit code ${details.exitCode}\n`);
    relaunchOnX11();
  });
}

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
  async checkForUpdates() {
    const r = await checkForUpdate(app.getVersion(), electronFetch);
    return { current: r.current, latest: r.latest, available: r.status === "available", url: r.status === "available" ? r.url : RELEASES_PAGE, flatpak: IN_FLATPAK };
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

/** "Check for Updates" text, per interface language. {v} = newest version, {cur} = this build's. */
const UPDATE_TEXT: Record<UiLocale, { check: string; upToDate: string; upToDateDetail: string; available: string; availableDetail: string; flatpakDetail: string; download: string; later: string; failed: string; ok: string }> = {
  en: { check: "Check for Updates…", upToDate: "You're up to date", upToDateDetail: "Sayfern {v} is the newest version.", available: "Sayfern {v} is available", availableDetail: "You have version {cur}.", flatpakDetail: "You have version {cur}. Update it in your software store, or run:", download: "Download", later: "Later", failed: "Couldn't check for updates", ok: "OK" },
  "zh-Hans": { check: "检查更新…", upToDate: "已是最新版本", upToDateDetail: "Sayfern {v} 是最新版本。", available: "Sayfern {v} 现已推出", availableDetail: "你当前的版本是 {cur}。", flatpakDetail: "你当前的版本是 {cur}。请在软件商店中更新，或运行：", download: "下载", later: "稍后", failed: "无法检查更新", ok: "好" },
  "zh-Hant": { check: "檢查更新項目…", upToDate: "已是最新版本", upToDateDetail: "Sayfern {v} 是最新版本。", available: "Sayfern {v} 已推出", availableDetail: "你目前的版本是 {cur}。", flatpakDetail: "你目前的版本是 {cur}。請在軟體商店中更新，或執行：", download: "下載", later: "稍後", failed: "無法檢查更新項目", ok: "好" },
  ja: { check: "アップデートを確認…", upToDate: "最新の状態です", upToDateDetail: "Sayfern {v} は最新バージョンです。", available: "Sayfern {v} が利用可能です", availableDetail: "現在のバージョンは {cur} です。", flatpakDetail: "現在のバージョンは {cur} です。ソフトウェアストアでアップデートするか、次を実行してください：", download: "ダウンロード", later: "後で", failed: "アップデートを確認できませんでした", ok: "OK" },
  ko: { check: "업데이트 확인…", upToDate: "최신 버전입니다", upToDateDetail: "Sayfern {v}이(가) 최신 버전입니다.", available: "Sayfern {v}을(를) 사용할 수 있습니다", availableDetail: "현재 버전은 {cur}입니다.", flatpakDetail: "현재 버전은 {cur}입니다. 소프트웨어 스토어에서 업데이트하거나 다음을 실행하세요:", download: "다운로드", later: "나중에", failed: "업데이트를 확인할 수 없습니다", ok: "확인" },
  vi: { check: "Kiểm tra cập nhật…", upToDate: "Bạn đang dùng bản mới nhất", upToDateDetail: "Sayfern {v} là phiên bản mới nhất.", available: "Đã có Sayfern {v}", availableDetail: "Bạn đang dùng phiên bản {cur}.", flatpakDetail: "Bạn đang dùng phiên bản {cur}. Hãy cập nhật trong kho phần mềm, hoặc chạy:", download: "Tải về", later: "Để sau", failed: "Không thể kiểm tra cập nhật", ok: "OK" },
  ru: { check: "Проверить обновления…", upToDate: "У вас последняя версия", upToDateDetail: "Sayfern {v} — самая новая версия.", available: "Доступна версия Sayfern {v}", availableDetail: "У вас версия {cur}.", flatpakDetail: "У вас версия {cur}. Обновите её в магазине приложений или выполните:", download: "Скачать", later: "Позже", failed: "Не удалось проверить обновления", ok: "ОК" },
  fr: { check: "Rechercher des mises à jour…", upToDate: "Sayfern est à jour", upToDateDetail: "Sayfern {v} est la version la plus récente.", available: "Sayfern {v} est disponible", availableDetail: "Vous avez la version {cur}.", flatpakDetail: "Vous avez la version {cur}. Mettez-la à jour dans votre logithèque, ou lancez :", download: "Télécharger", later: "Plus tard", failed: "Impossible de rechercher des mises à jour", ok: "OK" },
  it: { check: "Controlla aggiornamenti…", upToDate: "Sayfern è aggiornato", upToDateDetail: "Sayfern {v} è la versione più recente.", available: "È disponibile Sayfern {v}", availableDetail: "Hai la versione {cur}.", flatpakDetail: "Hai la versione {cur}. Aggiornala dal tuo store di software, oppure esegui:", download: "Scarica", later: "Più tardi", failed: "Impossibile controllare gli aggiornamenti", ok: "OK" },
  es: { check: "Buscar actualizaciones…", upToDate: "Sayfern está actualizado", upToDateDetail: "Sayfern {v} es la versión más reciente.", available: "Sayfern {v} ya está disponible", availableDetail: "Tienes la versión {cur}.", flatpakDetail: "Tienes la versión {cur}. Actualízala desde tu tienda de software, o ejecuta:", download: "Descargar", later: "Más tarde", failed: "No se pudieron buscar actualizaciones", ok: "Aceptar" },
  de: { check: "Nach Updates suchen …", upToDate: "Sayfern ist auf dem neuesten Stand", upToDateDetail: "Sayfern {v} ist die neueste Version.", available: "Sayfern {v} ist verfügbar", availableDetail: "Du hast Version {cur}.", flatpakDetail: "Du hast Version {cur}. Aktualisiere sie in deiner Softwareverwaltung oder führe aus:", download: "Herunterladen", later: "Später", failed: "Suche nach Updates fehlgeschlagen", ok: "OK" },
  "pt-BR": { check: "Verificar Atualizações…", upToDate: "O Sayfern está atualizado", upToDateDetail: "O Sayfern {v} é a versão mais recente.", available: "O Sayfern {v} está disponível", availableDetail: "Você tem a versão {cur}.", flatpakDetail: "Você tem a versão {cur}. Atualize pela sua loja de software ou execute:", download: "Baixar", later: "Mais tarde", failed: "Não foi possível verificar atualizações", ok: "OK" },
  "pt-PT": { check: "Procurar atualizações…", upToDate: "O Sayfern está atualizado", upToDateDetail: "O Sayfern {v} é a versão mais recente.", available: "O Sayfern {v} está disponível", availableDetail: "Tem a versão {cur}.", flatpakDetail: "Tem a versão {cur}. Atualize na sua loja de software, ou execute:", download: "Transferir", later: "Mais tarde", failed: "Não foi possível procurar atualizações", ok: "OK" },
};

const FLATPAK_UPDATE_COMMAND = "flatpak update ca.sayfern.Sayfern";
let checkingUpdates = false;

/** Menu > Check for Updates: asks GitHub for the newest release and says what to do in a native dialog. */
async function checkUpdatesNow(locale: UiLocale): Promise<void> {
  if (checkingUpdates) return;
  checkingUpdates = true;
  const t = UPDATE_TEXT[locale] ?? UPDATE_TEXT.en;
  const show = (o: MessageBoxOptions) => (win && !win.isDestroyed() ? dialog.showMessageBox(win, o) : dialog.showMessageBox(o));
  try {
    const r = await checkForUpdate(app.getVersion(), electronFetch);
    if (r.status === "current") {
      await show({ type: "info", message: t.upToDate, detail: t.upToDateDetail.replace("{v}", r.current), buttons: [t.ok] });
    } else if (IN_FLATPAK) {
      await show({ type: "info", message: t.available.replace("{v}", r.latest), detail: `${t.flatpakDetail.replace("{cur}", r.current)}\n\n${FLATPAK_UPDATE_COMMAND}`, buttons: [t.ok] });
    } else {
      const { response } = await show({ type: "info", message: t.available.replace("{v}", r.latest), detail: t.availableDetail.replace("{cur}", r.current), buttons: [t.download, t.later], defaultId: 0, cancelId: 1 });
      if (response === 0) await shell.openExternal(r.url);
    }
  } catch {
    // checkForUpdate already logged the cause.
    await show({ type: "warning", message: t.failed, buttons: [t.ok] });
  } finally {
    checkingUpdates = false;
  }
}

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
  const updates = UPDATE_TEXT[locale] ?? UPDATE_TEXT.en;
  // macOS only (the app menu). Windows and Linux hide the menu bar (titleBarStyle), so there the
  // check lives in Settings > Preferences > Updates, which every platform has.
  const checkUpdates: MenuItemConstructorOptions = { label: updates.check, click: () => void checkUpdatesNow(locale) };
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
              checkUpdates,
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
