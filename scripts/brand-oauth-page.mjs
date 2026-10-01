// Replaces pi-ai's OAuth callback page ("Authentication successful", Pi logo)
// with a Sayfern-styled page. pi-ai renders this page from its local callback
// server after you approve sign-in in the browser. Runs on postinstall and
// before `npm run dev`; safe to run repeatedly.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "node_modules/@earendil-works/pi-ai/dist/utils/oauth-page.js");
const MARK = "/* sayfern-oauth-page */";

if (!existsSync(target)) {
  console.warn("[brand-oauth-page] pi-ai not installed yet; skipping");
  process.exit(0);
}
if (readFileSync(target, "utf8").startsWith(MARK)) process.exit(0);

const page = String.raw`${MARK}
const FERN = '<svg width="64" height="64" viewBox="0 0 32 32" fill="none" stroke="#2E5B45" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M7 29C11 20 16 12 25 3"/><path d="M10.5 22.5c-3-.6-5.2-2.6-6.2-5.6 M10.5 22.5c3 .2 5.8-.8 8-2.8 M13.6 16.6c-2.2-1-3.8-3-4.2-5.8 M13.6 16.6c2.8 0 5.2-1 7-2.8 M17.4 10.6c-1.2-1.2-1.8-3-1.6-5 M17.4 10.6c2 0 3.8-.8 5.2-2"/></svg>';
function esc(v) {
  return String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function render({ ok, heading, message, details }) {
  const accent = ok ? "#2E5B45" : "#A63D22";
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>' + esc(heading) + ' · Sayfern</title>'
    + '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@400;500&display=swap">'
    + '<style>'
    + '*{box-sizing:border-box}html,body{height:100%;margin:0}'
    + 'body{display:flex;align-items:center;justify-content:center;padding:24px;background:#F4F0E7;color:#1C1E1B;font-family:Geist,ui-sans-serif,-apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased;'
    + 'background-image:radial-gradient(rgba(28,30,27,.035) 1px,transparent 1px);background-size:4px 4px}'
    + '.ghost{position:fixed;right:-40px;bottom:-120px;font-family:"Noto Serif SC","Songti SC",serif;font-size:520px;line-height:1;color:rgba(46,91,69,.06);pointer-events:none}'
    + 'main{position:relative;width:100%;max-width:520px;background:#FBF9F4;border:1px solid #E0D9CA;border-radius:22px;padding:44px 44px 38px;box-shadow:0 30px 60px -40px rgba(28,30,27,.45)}'
    + '.brand{display:flex;align-items:center;gap:10px;margin-bottom:34px}.brand svg{width:30px;height:30px}.brand b{font-family:"Instrument Serif",Georgia,serif;font-weight:400;font-size:28px}'
    + '.mark{width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:' + (ok ? "#E4ECE3" : "#FBEDE6") + ';color:' + accent + ';margin-bottom:18px}'
    + 'h1{font-family:"Instrument Serif",Georgia,serif;font-weight:400;font-size:46px;line-height:1.02;letter-spacing:-.015em;margin:0 0 12px}'
    + 'h1 em{color:' + accent + '}'
    + 'p{margin:0;font-size:15.5px;line-height:1.6;color:#4A4D46}'
    + '.details{margin-top:18px;padding:12px 14px;border-radius:12px;background:#F4F0E7;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;color:#4A4D46;white-space:pre-wrap;word-break:break-word}'
    + '.foot{margin-top:28px;padding-top:18px;border-top:1px solid #EEE8DC;font-size:13px;color:#6B6D64}'
    + '</style></head><body><div class="ghost" aria-hidden="true">' + (ok ? "说" : "停") + '</div><main>'
    + '<div class="brand">' + FERN + '<b>Sayfern</b></div>'
    + '<div class="mark" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'
    + (ok ? '<path d="M5 12.5l4.5 4.5L19 7.5"/>' : '<path d="M6 6l12 12 M18 6 6 18"/>') + '</svg></div>'
    + '<h1>' + (ok ? "You're <em>signed in</em>." : "Sign-in <em>didn't work</em>.") + '</h1>'
    + '<p>' + esc(message) + '</p>'
    + (details ? '<div class="details">' + esc(details) + '</div>' : '')
    + '<div class="foot">' + (ok ? "You can close this tab and go back to Sayfern." : "Close this tab and try again from Sayfern. The app shows what went wrong.") + '</div>'
    + '</main></body></html>';
}
export function oauthSuccessHtml(message) {
  const clean = String(message).replace(/\s*You (may|can) (now )?close this (page|window|tab)\.?/i, "");
  return render({ ok: true, heading: "Signed in", message: clean || "Sayfern is connected." });
}
export function oauthErrorHtml(message, details) {
  return render({ ok: false, heading: "Sign-in failed", message, details });
}
`;

writeFileSync(target, page);
console.log("[brand-oauth-page] Sayfern sign-in page installed");
