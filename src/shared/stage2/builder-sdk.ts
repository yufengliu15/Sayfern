// The Sayfern SDK served to sandboxed feature UIs (sayfern-feature://<id>/_sdk/…) and inlined by the
// browser mock. Plain strings so both TS projects can use them. Reference: docs/feature-sdk.d.ts.
// Owned by the builder feature.

/** Classic script: defines `window.sayfern`, which talks to the host only through postMessage. */
export const FEATURE_SDK_JS = `/* Sayfern feature SDK v1. Talks to Sayfern through postMessage only. */
(function () {
  "use strict";
  var pending = new Map();
  var seq = 0;
  var TIMEOUT_MS = 20000;
  function call(method, args) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      var timer = setTimeout(function () {
        if (pending.delete(id)) reject(new Error("Sayfern did not answer " + method + "."));
      }, TIMEOUT_MS);
      pending.set(id, { resolve: resolve, reject: reject, timer: timer });
      window.parent.postMessage({ sayfern: 1, id: id, method: method, args: args }, "*");
    });
  }
  // Theme: "forest", "ink", or none (Light). The host names the frame "sayfern-theme:<theme>" so the first
  // paint is right, then posts { sayfern: 1, theme } when the app theme changes.
  function setTheme(theme) {
    if (theme === "forest" || theme === "ink") document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }
  if (typeof window.name === "string" && window.name.indexOf("sayfern-theme:") === 0) setTheme(window.name.slice(14));
  window.addEventListener("message", function (e) {
    if (e.source !== window.parent) return;
    var m = e.data;
    if (m && m.sayfern === 1 && typeof m.id !== "number" && "theme" in m) return setTheme(m.theme);
    if (!m || m.sayfern !== 1 || typeof m.id !== "number") return;
    var p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    clearTimeout(p.timer);
    if (typeof m.error === "string") p.reject(new Error(m.error));
    else p.resolve(m.result);
  });
  var api = {
    version: 1,
    context: function () { return call("context", []); },
    anki: { words: function (filter) { return call("anki.words", [filter || {}]); } },
    grammar: { list: function () { return call("grammar.list", []); } },
    words: { saved: function () { return call("words.saved", []); } },
    lookup: function (word) { return call("lookup", [word]); },
    annotate: function (text) { return call("annotate", [text]); },
    storage: {
      get: function (key) { return call("storage.get", [key]); },
      set: function (key, value) { return call("storage.set", [key, value === undefined ? null : value]); }
    },
    results: {
      record: function (result) { return call("results.record", [result]); },
      list: function (limit) { return call("results.list", [limit == null ? 100 : limit]); }
    }
  };
  Object.freeze(api.anki); Object.freeze(api.grammar); Object.freeze(api.words);
  Object.freeze(api.storage); Object.freeze(api.results);
  window.sayfern = Object.freeze(api);
  call("context", []).then(function (c) {
    if (c && c.language) {
      document.documentElement.lang = c.language === "zh" ? "zh-Hans" : c.language;
      document.documentElement.classList.add("sf-" + c.language);
    }
  }, function () {});
})();
`;

/** Sayfern look for feature UIs: the app's tokens, a few components. System fonts only (no network). */
export const FEATURE_SDK_CSS = `/* Sayfern feature stylesheet v1: tokens and a few components. The theme is data-theme on <html>:
   absent = Light, "forest" = Forest Night, "ink" = Ink. Use the variables, not literal colours. */
:root {
  color-scheme: light;
  --paper: #f4f0e7;
  --paper-2: #eae4d6;
  --paper-3: #efeadf;
  --card: #fbf9f4;
  --white: #fffefb;
  --ink: #1c1e1b;
  --ink-2: #3d403a;
  --ink-3: #4a4d46;
  --muted: #6b6d64;
  --line: #e0d9ca;
  --line-2: #dcd4c2;
  --line-3: #e6dfd1;
  --fern: #2e5b45;
  --fern-dark: #1f4232;
  --fern-soft: #e4ece3;
  --fern-line: #d0ddd2;
  --fern-mid: #93b39c;
  --forest: #173e35;
  --seal: #a63d22;
  --seal-2: #b8452a;
  --seal-bg: #fbf6f1;
  --seal-line: #eacfc4;
  --on-fern: #ffffff;
  --on-seal: #fbf6f1;
  --seal-dark: #8e3219;
  --line-strong: #cfc7b5;
  --line-hover: #b9b19f;
  --placeholder: #9d9a8e;
  --hover: #f0ebe0;
  --track: #e6e0d2;
  --track-strong: #d6cebc;
  --fern-wash: #f3f6ef;
  --note-bg: #f8f7f1;
  --note-line: #e3ddcd;
  --note-ink: #8a5a3c;
  --note-mark: #c48a6a;
  --warn: #e0b25c;
  --warn-bg: #f2ddc9;
  --warn-ink: #9a6a1c;
  --ok: #7fc29a;
  --pulse: #e0704f;
  --scrim: rgba(23, 30, 26, 0.38);
  --shadow-ink: #1c1e1b;
  --sans: "Geist Sans", "Geist", ui-sans-serif, -apple-system, system-ui, sans-serif;
  --serif: "Instrument Serif", "New York", Georgia, serif;
  --mono: "Geist Mono", ui-monospace, Menlo, monospace;
  --zh: "Noto Serif SC", "Songti SC", "STSong", serif;
  --ja: "Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", serif;
}

:root[data-theme="forest"] {
  color-scheme: dark;
  --paper: #10231d;
  --paper-2: #0c1d18;
  --paper-3: #0e201b;
  --card: #16302a;
  --white: #1b3a31;
  --ink: #ece6d8;
  --ink-2: #d2ccbd;
  --ink-3: #bdb8aa;
  --muted: #9aa89b;
  --line: #2a463c;
  --line-2: #2f4d42;
  --line-3: #223c33;
  --fern: #9cc2a7;
  --fern-dark: #c4dccb;
  --fern-soft: #1b3a31;
  --fern-line: #2c4f43;
  --fern-mid: #6f9a7f;
  --forest: #0a1a15;
  --seal: #e5876a;
  --seal-2: #ec9a80;
  --seal-bg: #2a1d17;
  --seal-line: #5b3426;
  --on-fern: #0f231d;
  --on-seal: #1f110c;
  --seal-dark: #f0a890;
  --line-strong: #3d5e51;
  --line-hover: #55786a;
  --placeholder: #7f8e82;
  --hover: #1d3a31;
  --track: #223c33;
  --track-strong: #2f4d42;
  --fern-wash: #132a23;
  --note-bg: #152a23;
  --note-line: #2f4a40;
  --note-ink: #d9a88a;
  --note-mark: #b07a5e;
  --warn: #e0b25c;
  --warn-bg: #33261a;
  --warn-ink: #e6b64a;
  --ok: #7fc29a;
  --pulse: #e0704f;
  --scrim: rgba(0, 0, 0, 0.55);
  --shadow-ink: #000000;
}

:root[data-theme="ink"] {
  color-scheme: dark;
  --paper: #111111;
  --paper-2: #0b0b0b;
  --paper-3: #0e0e0e;
  --card: #171717;
  --white: #1f1f1f;
  --ink: #f5f5f5;
  --ink-2: #d4d4d4;
  --ink-3: #bdbdbd;
  --muted: #a3a3a3;
  --line: #2b2b2b;
  --line-2: #333333;
  --line-3: #202020;
  --fern: #f5f5f5;
  --fern-dark: #ffffff;
  --fern-soft: #262626;
  --fern-line: #363636;
  --fern-mid: #8a8a8a;
  --forest: #0a0a0a;
  --seal: #ff7a66;
  --seal-2: #ff8f7d;
  --seal-bg: #24130f;
  --seal-line: #5a2a22;
  --on-fern: #0a0a0a;
  --on-seal: #140806;
  --seal-dark: #ff9a88;
  --line-strong: #404040;
  --line-hover: #5a5a5a;
  --placeholder: #7a7a7a;
  --hover: #242424;
  --track: #262626;
  --track-strong: #333333;
  --fern-wash: #161616;
  --note-bg: #191919;
  --note-line: #2e2e2e;
  --note-ink: #d4b49c;
  --note-mark: #a08070;
  --warn: #e0b25c;
  --warn-bg: #2a2110;
  --warn-ink: #e6b64a;
  --ok: #7fc29a;
  --pulse: #ff7a66;
  --scrim: rgba(0, 0, 0, 0.6);
  --shadow-ink: #000000;
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body { font-family: var(--sans); color: var(--ink); background: var(--white); font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
button, input, select, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
:focus-visible { outline: 2px solid color-mix(in srgb, var(--fern) 55%, transparent); outline-offset: 2px; }
.zh, .sf-zh .cjk { font-family: var(--zh); }
.ja, .sf-ja .cjk { font-family: var(--ja); }
.serif { font-family: var(--serif); font-weight: 400; }
.mono { font-family: var(--mono); }
.muted { color: var(--muted); }
.eyebrow { font-size: 11.5px; letter-spacing: 0.11em; text-transform: uppercase; color: var(--muted); font-weight: 500; }
.sf-page { min-height: 100vh; display: flex; flex-direction: column; }
.sf-bar { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--line-3); font-size: 13px; color: var(--ink-3); }
.sf-bar b { color: var(--ink); font-weight: 600; }
.sf-body { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; padding: 26px; }
.sf-foot { padding: 12px 18px; border-top: 1px solid var(--line-3); font-size: 12.5px; color: var(--muted); }
.sf-card { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 18px; }
.sf-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 40px; padding: 0 16px; border-radius: 10px; font-size: 14px; font-weight: 500; border: 1px solid var(--line-2); background: var(--card); color: var(--ink); }
.sf-btn:hover:not(:disabled) { background: var(--white); border-color: var(--line-strong); }
.sf-btn:disabled { opacity: 0.5; cursor: default; }
.sf-btn.primary { background: var(--fern); border-color: var(--fern); color: var(--on-fern); }
.sf-btn.primary:hover:not(:disabled) { background: var(--fern-dark); border-color: var(--fern-dark); }
.sf-choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(64px, 1fr)); gap: 10px; width: 100%; }
.sf-choice { height: 64px; border-radius: 14px; border: 1px solid var(--line-2); background: var(--card); font-size: 26px; }
.sf-choice:hover:not(:disabled) { border-color: var(--fern); }
.sf-choice.right { background: var(--fern); border-color: var(--fern); color: var(--on-fern); }
.sf-choice.wrong { background: var(--seal-bg); border-color: var(--seal-line); color: var(--seal); }
.sf-ok { color: var(--fern); }
.sf-bad { color: var(--seal); }
.sf-input { height: 44px; border-radius: 11px; border: 1px solid var(--line-2); background: var(--white); padding: 0 14px; }
.sf-input::placeholder { color: var(--placeholder); }
.sf-input:focus { outline: 2px solid color-mix(in srgb, var(--fern) 35%, transparent); border-color: var(--fern); }
`;
