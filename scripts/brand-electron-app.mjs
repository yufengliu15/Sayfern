// Dev builds run inside node_modules/electron/dist/Electron.app, so macOS shows "Electron" and
// Electron's icon in the Dock, the menu bar and Cmd-Tab. This patches that bundle to say "Sayfern"
// and use build/icon.icns (plus Sayfern's microphone prompt text), then re-signs it ad hoc (editing Info.plist breaks Electron's signature).
// Runs from postinstall and predev, after install-electron. macOS only; idempotent; never fails the
// install. Packaged builds get the name and icon from the packager config instead.
//
// app.name stays "sayfern" (package.json "name"): it names the userData folder and the Keychain
// item that encrypts credentials ("sayfern Safe Storage"). Only the bundle's display name changes.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "Sayfern";
/** macOS shows this when Sayfern first asks for the microphone (Stage 3 voice input). */
const MIC = "Sayfern records your voice when you hold the mic to talk to the tutor. The recording goes to ElevenLabs for transcription and is not kept.";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(root, "node_modules", "electron", "dist", "Electron.app");
const plist = join(bundle, "Contents", "Info.plist");
const icon = join(root, "build", "icon.icns");
const resources = join(bundle, "Contents", "Resources");
/**
 * The Dock, Finder and Cmd-Tab show the bundle's folder name ("Electron") unless the bundle has a
 * localized display name, so every .lproj gets one. macOS uses it only while Info.plist's
 * CFBundleDisplayName matches the folder name, so that one stays "Electron".
 */
const STRINGS = `CFBundleName = "${NAME}";\nCFBundleDisplayName = "${NAME}";\n`;
const lprojs = () => readdirSync(resources).filter((d) => d.endsWith(".lproj")).map((d) => join(resources, d, "InfoPlist.strings"));

const log = (msg) => console.log(`[brand-electron-app] ${msg}`);
const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

function main() {
  if (process.platform !== "darwin") return;
  if (!existsSync(plist)) return log("Electron.app not found yet; skipped (install-electron runs next time).");
  if (!existsSync(icon)) return log("build/icon.icns missing; skipped.");

  const iconFile = run("plutil", ["-extract", "CFBundleIconFile", "raw", plist]); // "electron.icns"
  const bundleIcon = join(bundle, "Contents", "Resources", iconFile.endsWith(".icns") ? iconFile : `${iconFile}.icns`);
  const read = (key) => {
    try {
      return run("plutil", ["-extract", key, "raw", plist]);
    } catch {
      return "";
    }
  };
  const done =
    read("CFBundleName") === NAME &&
    read("CFBundleDisplayName") === "Electron" &&
    read("NSMicrophoneUsageDescription") === MIC &&
    read("LSHasLocalizedDisplayName") === "true" &&
    lprojs().every((f) => existsSync(f) && readFileSync(f, "utf8") === STRINGS) &&
    existsSync(bundleIcon) &&
    sha(bundleIcon) === sha(icon);
  if (done) return;

  run("plutil", ["-replace", "CFBundleName", "-string", NAME, plist]);
  run("plutil", ["-replace", "CFBundleDisplayName", "-string", "Electron", plist]);
  run("plutil", ["-replace", "NSMicrophoneUsageDescription", "-string", MIC, plist]);
  run("plutil", ["-replace", "LSHasLocalizedDisplayName", "-bool", "true", plist]);
  for (const f of lprojs()) writeFileSync(f, STRINGS);
  copyFileSync(icon, bundleIcon);
  try {
    // Ad-hoc signature: valid again after the edit. macOS may ask once more for Keychain access
    // to "sayfern Safe Storage"; choose Always Allow.
    run("codesign", ["--force", "--deep", "--sign", "-", bundle]);
  } catch (err) {
    log(`codesign failed (${String(err.stderr || err.message).trim()}); the app may still launch.`);
  }
  // Nudge Finder and the Dock to drop the cached Electron icon.
  const now = new Date();
  utimesSync(bundle, now, now);
  try {
    run("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", ["-f", bundle]);
  } catch {
    // not critical
  }
  log(`Electron.app now shows as ${NAME} with the Sayfern icon.`);
}

try {
  main();
} catch (err) {
  log(`skipped: ${err instanceof Error ? err.message : String(err)}`);
}
