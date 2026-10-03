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
  window.addEventListener("message", function (e) {
    if (e.source !== window.parent) return;
    var m = e.data;
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
export const FEATURE_SDK_CSS = `/* Sayfern feature stylesheet v1: tokens and a few components. */
:root {
  --paper: #f4f0e7; --paper-2: #eae4d6; --card: #fbf9f4; --white: #fffefb;
  --ink: #1c1e1b; --ink-2: #3d403a; --ink-3: #4a4d46; --muted: #6b6d64;
  --line: #e0d9ca; --line-2: #dcd4c2; --fern: #2e5b45; --fern-dark: #1f4232; --fern-soft: #e4ece3; --fern-line: #d0ddd2;
  --seal: #a63d22; --seal-bg: #fbf6f1; --seal-line: #eacfc4;
  --sans: "Geist Sans", "Geist", ui-sans-serif, -apple-system, system-ui, sans-serif;
  --serif: "Instrument Serif", "New York", Georgia, serif;
  --mono: "Geist Mono", ui-monospace, Menlo, monospace;
  --zh: "Noto Serif SC", "Songti SC", "STSong", serif;
  --ja: "Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body { font-family: var(--sans); color: var(--ink); background: var(--white); font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
button, input, select, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
:focus-visible { outline: 2px solid rgba(46, 91, 69, 0.55); outline-offset: 2px; }
.zh, .sf-zh .cjk { font-family: var(--zh); }
.ja, .sf-ja .cjk { font-family: var(--ja); }
.serif { font-family: var(--serif); font-weight: 400; }
.mono { font-family: var(--mono); }
.muted { color: var(--muted); }
.eyebrow { font-size: 11.5px; letter-spacing: 0.11em; text-transform: uppercase; color: var(--muted); font-weight: 500; }
.sf-page { min-height: 100vh; display: flex; flex-direction: column; }
.sf-bar { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid #eee8dc; font-size: 13px; color: var(--ink-3); }
.sf-bar b { color: var(--ink); font-weight: 600; }
.sf-body { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; padding: 26px; }
.sf-foot { padding: 12px 18px; border-top: 1px solid #eee8dc; font-size: 12.5px; color: var(--muted); }
.sf-card { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 18px; }
.sf-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 40px; padding: 0 16px; border-radius: 10px; font-size: 14px; font-weight: 500; border: 1px solid #d5cdbb; background: var(--card); color: var(--ink); }
.sf-btn:hover:not(:disabled) { background: #fff; border-color: #c8bfaa; }
.sf-btn:disabled { opacity: 0.5; cursor: default; }
.sf-btn.primary { background: var(--fern); border-color: var(--fern); color: #f7f4ec; }
.sf-btn.primary:hover:not(:disabled) { background: var(--fern-dark); border-color: var(--fern-dark); }
.sf-choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(64px, 1fr)); gap: 10px; width: 100%; }
.sf-choice { height: 64px; border-radius: 14px; border: 1px solid var(--line-2); background: var(--card); font-size: 26px; }
.sf-choice:hover:not(:disabled) { border-color: var(--fern); }
.sf-choice.right { background: var(--fern); border-color: var(--fern); color: #f4f0e7; }
.sf-choice.wrong { background: var(--seal-bg); border-color: var(--seal-line); color: var(--seal); }
.sf-ok { color: var(--fern); }
.sf-bad { color: var(--seal); }
.sf-input { height: 44px; border-radius: 11px; border: 1px solid #d5cdbb; background: #fff; padding: 0 14px; }
.sf-input:focus { outline: 2px solid rgba(46, 91, 69, 0.35); border-color: var(--fern); }
`;
