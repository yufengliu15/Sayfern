// Mock implementation of the Stage 2 BuilderApi slot for the browser dev server. Owned by the builder feature.
// Builds are scripted (steps streamed over ~4 s); feature files come from examples/extensions/ so the
// preview really runs: featureFrame inlines the page, its CSS, the SDK and its modules (as data: URLs)
// into a srcdoc, since the browser has no sayfern-feature:// protocol.
import type { AnkiCard, Language } from "../../../shared/records";
import type {
  BuilderApi,
  BuilderEvent,
  BuildStep,
  FeatureCallContext,
  FeatureFile,
  FeatureInfo,
  FeatureStatus,
  FeatureSurface,
  FeatureTurn,
  FeatureVersion,
} from "../../../shared/stage2";
import { FEATURE_RPC_METHODS } from "../../../shared/stage2";
import { FEATURE_SDK_CSS, FEATURE_SDK_JS } from "../../../shared/stage2/builder-sdk";
import { MOCK_DAY, MOCK_HOUR, MOCK_MIN, mockClone, mockId, mockWait, type MockWorld } from "./mockWorld";

declare global {
  interface ImportMeta {
    glob<T = unknown>(pattern: string, opts: { query?: string; import?: string; eager: true }): Record<string, T>;
  }
}

const RAW = import.meta.glob<string>("../../../../examples/extensions/**/*.{js,json,html,css}", { query: "?raw", import: "default", eager: true });

function example(name: string): Map<string, string> {
  const prefix = `../../../../examples/extensions/${name}/`;
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(RAW)) if (k.startsWith(prefix)) out.set(k.slice(prefix.length), v);
  return out;
}

const CHENGYU_TEST = `import { chengyuFor } from "./index.js";

test("one idiom a day", () => {
  const a = chengyuFor(new Date(2026, 8, 30, 9));
  const b = chengyuFor(new Date(2026, 8, 30, 21));
  assert.equal(a.idiom, b.idiom);
});

test("idioms have four characters", () => {
  for (let d = 1; d <= 7; d++) assert.equal(chengyuFor(new Date(2026, 9, d)).idiom.length, 4);
});
`;

const SAVED_FILES = new Map<string, string>([
  [
    "package.json",
    JSON.stringify(
      {
        name: "Saved words flashcards",
        version: "1.1.0",
        description: "Flip through the words you saved from lookups.",
        type: "module",
        sayfern: { surfaces: [{ kind: "tab", title: "Saved words", entry: "ui/index.html" }] },
      },
      null,
      2,
    ),
  ],
  [
    "ui/index.html",
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="/_sdk/sayfern.css" />
    <link rel="stylesheet" href="./style.css" />
    <script src="/_sdk/sayfern-sdk.js"></script>
    <script type="module" src="./main.js"></script>
  </head>
  <body>
    <div class="sf-page">
      <div class="sf-bar"><b>Saved words</b><span id="count"></span></div>
      <main class="sf-body" id="body"><p class="muted">Loading…</p></main>
      <div class="sf-foot">Click the card to flip it. Your saved words stay in Sayfern.</div>
    </div>
  </body>
</html>
`,
  ],
  ["ui/style.css", `.card { width: min(420px, 100%); min-height: 220px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; cursor: pointer; text-align: center; }\n.word { font-size: 56px; }\n.sentence { font-size: 15px; color: var(--ink-3); }\n.row { display: flex; gap: 10px; }\n`],
  [
    "ui/cards.js",
    `export function deck(words) {\n  return (words || []).filter((w) => w && w.word).map((w) => ({ front: w.word, reading: w.reading || "", back: w.definition || "", sentence: w.sentence || "" }));\n}\n\nexport function step(index, delta, size) {\n  return size ? (index + delta + size) % size : 0;\n}\n`,
  ],
  [
    "ui/main.js",
    `import { deck, step } from "./cards.js";

const $ = (id) => document.getElementById(id);
let cards = [];
let i = 0;
let flipped = false;

function render() {
  if (!cards.length) {
    $("body").innerHTML = '<p class="muted">No saved words yet. Hover a word in a session and save it.</p>';
    return;
  }
  const c = cards[i];
  $("count").textContent = (i + 1) + " of " + cards.length;
  const card = document.createElement("div");
  card.className = "sf-card card";
  card.tabIndex = 0;
  const word = document.createElement("div");
  word.className = "word cjk";
  word.textContent = c.front;
  card.append(word);
  if (flipped) {
    const r = document.createElement("div"); r.className = "muted"; r.textContent = c.reading + "  " + c.back;
    const s = document.createElement("div"); s.className = "sentence cjk"; s.textContent = c.sentence;
    card.append(r, s);
  }
  card.onclick = () => { flipped = !flipped; render(); };
  const row = document.createElement("div");
  row.className = "row";
  for (const [label, d] of [["Previous", -1], ["Next", 1]]) {
    const b = document.createElement("button");
    b.className = "sf-btn" + (d > 0 ? " primary" : "");
    b.textContent = label;
    b.onclick = () => { i = step(i, d, cards.length); flipped = false; render(); };
    row.append(b);
  }
  $("body").replaceChildren(card, row);
}

sayfern.words.saved().then((w) => { cards = deck(w); render(); }, () => { cards = []; render(); });
`,
  ],
  [
    "test.js",
    `import { deck, step } from "./ui/cards.js";\n\ntest("builds cards from saved words", async () => {\n  const d = deck(await sayfern.words.saved());\n  assert.ok(d.length >= 1);\n  assert.ok(d[0].front);\n});\n\ntest("wraps around", () => {\n  assert.equal(step(0, -1, 3), 2);\n  assert.equal(step(2, 1, 3), 0);\n});\n\ntest("empty deck", () => assert.deepEqual(deck(undefined), []));\n`,
  ],
]);

// ---------------------------------------------------------------- tiny helpers (mirror core/builder/paths.ts)

function resolveRel(from: string, spec: string): string | null {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return null;
  const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")).split("/") : [];
  for (const s of spec.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") {
      if (!dir.length) return null;
      dir.pop();
    } else dir.push(s);
  }
  return dir.join("/");
}

function b64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Inlines a page for an iframe srcdoc: SDK + CSS as tags, module scripts as data: URLs (imports rewritten). */
export function inlineFeaturePage(files: Map<string, string>, entry: string): string {
  const cache = new Map<string, string>();
  const moduleUrl = (path: string, stack: string[] = []): string => {
    const hit = cache.get(path);
    if (hit) return hit;
    if (stack.includes(path)) throw new Error(`Import cycle at ${path}`);
    const src = files.get(path) ?? `throw new Error("Missing module ${path}")`;
    const rewritten = src.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(["'])(\.{1,2}\/[^"'\n]+)\2/g, (m, pre: string, q: string, spec: string) => {
      const target = resolveRel(path, spec);
      return target ? `${pre}${q}${moduleUrl(target, [...stack, path])}${q}` : m;
    });
    const url = `data:text/javascript;base64,${b64(rewritten)}`;
    cache.set(path, url);
    return url;
  };
  let html = files.get(entry) ?? "<p>Missing page</p>";
  html = html.replace(/<link\s+[^>]*href=["']([^"']+)["'][^>]*>/g, (tag, href: string) => {
    if (!/rel=["']stylesheet["']/.test(tag)) return tag;
    if (href === "/_sdk/sayfern.css") return `<style>${FEATURE_SDK_CSS}</style>`;
    const p = resolveRel(entry, href.startsWith(".") ? href : `./${href}`);
    return p && files.has(p) ? `<style>${files.get(p)}</style>` : "";
  });
  html = html.replace(/<script\s+([^>]*)src=["']([^"']+)["']([^>]*)><\/script>/g, (_tag, a: string, src: string, b: string) => {
    if (src === "/_sdk/sayfern-sdk.js") return `<script>${FEATURE_SDK_JS}</script>`;
    const p = resolveRel(entry, src.startsWith(".") ? src : `./${src}`);
    if (!p || !files.has(p)) return "";
    return `<script ${a}src="${moduleUrl(p)}"${b}></script>`;
  });
  return html;
}

// ---------------------------------------------------------------- mock state

interface MockFeature {
  info: FeatureInfo;
  files: Map<number, Map<string, string>>;
  data: Record<string, unknown>;
  results: Record<string, unknown>[];
}

function surfacesOf(files: Map<string, string>): { surfaces: FeatureSurface[]; fullAccess: boolean; name: string; description: string } {
  try {
    const pkg = JSON.parse(files.get("package.json") ?? "{}") as { name?: string; description?: string; main?: string; sayfern?: { surfaces?: FeatureSurface[] } };
    return { surfaces: pkg.sayfern?.surfaces ?? [], fullAccess: typeof pkg.main === "string" || files.has("index.js"), name: pkg.name ?? "Feature", description: pkg.description ?? "" };
  } catch {
    return { surfaces: [], fullAccess: false, name: "Feature", description: "" };
  }
}

function fakeHash(files: Map<string, string>): string {
  let h = 2166136261;
  for (const [p, t] of [...files.entries()].sort()) for (const ch of p + "\0" + t) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0").repeat(8);
}

function versionOf(n: number, files: Map<string, string>, extra: Partial<FeatureVersion> & { prompt: string; createdAt: number }): FeatureVersion {
  const m = surfacesOf(files);
  const tests = (files.get("test.js")?.match(/^test\(/gm) ?? []).length;
  return {
    n,
    state: "ready",
    files: [...files.entries()].map(([path, t]) => ({ path, bytes: new TextEncoder().encode(t).length })).sort((a, b) => a.path.localeCompare(b.path)),
    hash: fakeHash(files),
    tests: { passed: tests, failed: 0, total: tests, ok: true, output: "", durationMs: 40 },
    surfaces: m.surfaces,
    fullAccess: m.fullAccess,
    approved: false,
    ...extra,
  };
}

const done = (id: string, kind: BuildStep["kind"], title: string, detail?: string): BuildStep => ({ id, kind, status: "done", title, detail });

function statusOf(f: FeatureInfo): FeatureStatus {
  if (f.buildId) return "building";
  const draft = f.draft == null ? undefined : f.versions.find((v) => v.n === f.draft);
  if (draft) return draft.state !== "ready" ? "failed" : draft.fullAccess && !draft.approved ? "review" : "preview";
  if (f.active != null) return f.enabled ? "on" : "off";
  return "failed";
}

const MEASURE_NOUNS: [string, string, string][] = [
  ["书", "shū", "book"],
  ["桌子", "zhuōzi", "table"],
  ["狗", "gǒu", "dog"],
  ["衣服", "yīfu", "clothes"],
  ["鱼", "yú", "fish"],
  ["自行车", "zìxíngchē", "bicycle"],
];

export function createBuilderMock(world: MockWorld): BuilderApi {
  const subs = new Set<(e: BuilderEvent) => void>();
  const emit = (e: BuilderEvent) => {
    for (const cb of subs) cb(mockClone(e));
  };
  const features = new Map<string, MockFeature>();
  const timers = new Map<string, ReturnType<typeof setTimeout>[]>();
  const now = () => Date.now();

  if (!world.fresh) {
    // Nouns for the measure-word drill, in the learner's Anki.
    const zh = world.ankiCards.zh;
    MEASURE_NOUNS.forEach(([word, reading, meaning], i) => {
      if (zh.some((c) => c.word === word)) return;
      const card: AnkiCard = { cardId: 900 + i, noteId: 990 + i, deck: "Chinese::HSK3", word, reading, meaning, interval: 6 + i, ease: 2400, lapses: i % 3, reps: 5 + i, lastReviewAt: world.T0 - (i + 1) * MOCK_DAY, lastEase: 3 };
      zh.push(card);
    });

    const T = world.T0;
    const drill = example("measure-word-drill");
    const mwSteps: BuildStep[] = [
      done("read", "read", "Read the docs and two examples", "measure-word-drill · chengyu-of-the-day"),
      done("write", "write", "Wrote the activity", "features/f-mw0d3a1c · 6 files"),
      done("test", "test", "Tests passed", "12 of 12"),
      done("preview", "preview", "Preview ready", "Reloads instantly. No rebuild needed."),
    ];
    const mwTurn: FeatureTurn = {
      id: "t-mw-1",
      buildId: "b-mw-1",
      prompt: "Add a measure-word drill: show a noun, I pick the right measure word. Use nouns from my Anki.",
      at: T - 6 * MOCK_MIN,
      version: 1,
      model: "anthropic/claude-sonnet-5-5",
      steps: mwSteps,
      text: "I'll read the guide and the two examples first.\n\nA drill tab and a Today activity: each round takes ten nouns from your Anki, hardest first, and asks for the measure word. Results are kept with the feature.",
      status: "done",
      usage: { input: 41_200, output: 6_900, cost: 0.23 },
    };
    features.set("f-mw0d3a1c", {
      info: {
        id: "f-mw0d3a1c",
        name: "Measure-word drill",
        description: "Shows a noun from your Anki deck; you pick the right measure word.",
        language: "zh",
        createdAt: T - 6 * MOCK_MIN,
        updatedAt: T - 4 * MOCK_MIN,
        status: "preview",
        versions: [versionOf(1, drill, { prompt: mwTurn.prompt, createdAt: T - 6 * MOCK_MIN, summary: "A drill tab and a Today activity." })],
        enabled: false,
        draft: 1,
        turns: [mwTurn],
      },
      files: new Map([[1, drill]]),
      data: {},
      results: [],
    });

    const saved1 = new Map(SAVED_FILES);
    saved1.set("ui/style.css", ".card { width: 100%; min-height: 200px; cursor: pointer; text-align: center; }\n.word { font-size: 44px; }\n.row { display: flex; gap: 10px; }\n");
    features.set("f-sv71be02", {
      info: {
        id: "f-sv71be02",
        name: "Saved words flashcards",
        description: "Flip through the words you saved from lookups.",
        language: "zh",
        createdAt: T - 3 * MOCK_DAY,
        updatedAt: T - 2 * MOCK_DAY,
        status: "on",
        versions: [
          versionOf(2, SAVED_FILES, { prompt: "Make the characters bigger and show the sentence on the back", createdAt: T - 2 * MOCK_DAY, basedOn: 1, summary: "Bigger characters; the back shows the saved sentence." }),
          versionOf(1, saved1, { prompt: "A flashcard tab for the words I saved", createdAt: T - 3 * MOCK_DAY, summary: "A Saved words tab with flip cards." }),
        ],
        active: 2,
        enabled: true,
        turns: [
          { id: "t-sv-1", buildId: "b-sv-1", prompt: "A flashcard tab for the words I saved", at: T - 3 * MOCK_DAY, version: 1, model: "openai/gpt-5.5", steps: [done("read", "read", "Read the docs and one example", "measure-word-drill"), done("write", "write", "Wrote the tab", "features/f-sv71be02 · 6 files"), done("test", "test", "Tests passed", "3 of 3"), done("preview", "preview", "Preview ready")], text: "A Saved words tab with flip cards.", status: "done" },
          { id: "t-sv-2", buildId: "b-sv-2", prompt: "Make the characters bigger and show the sentence on the back", at: T - 2 * MOCK_DAY, version: 2, model: "openai/gpt-5.5", steps: [done("read", "read", "Read the docs"), done("write", "write", "Wrote the tab", "features/f-sv71be02 · 6 files"), done("test", "test", "Tests passed", "3 of 3"), done("preview", "preview", "Preview ready")], text: "Bigger characters; the back shows the saved sentence.", status: "done" },
        ],
      },
      files: new Map([
        [1, saved1],
        [2, new Map(SAVED_FILES)],
      ]),
      data: {},
      results: [],
    });

    const chengyu = example("chengyu-of-the-day");
    chengyu.set("test.js", CHENGYU_TEST);
    features.set("f-cy5e90a7", {
      info: {
        id: "f-cy5e90a7",
        name: "Chengyu of the day",
        description: "Gives the Chinese tutor one four-character idiom a day.",
        language: "zh",
        createdAt: T - 5 * MOCK_HOUR,
        updatedAt: T - 5 * MOCK_HOUR,
        status: "review",
        versions: [versionOf(1, chengyu, { prompt: "Have the tutor teach me one chengyu a day", createdAt: T - 5 * MOCK_HOUR, summary: "A tutor tool. It runs with full access, so read it before turning it on." })],
        enabled: false,
        draft: 1,
        turns: [
          {
            id: "t-cy-1",
            buildId: "b-cy-1",
            prompt: "Have the tutor teach me one chengyu a day",
            at: T - 5 * MOCK_HOUR,
            version: 1,
            model: "anthropic/claude-sonnet-5-5",
            steps: [
              done("read", "read", "Read the docs and one example", "chengyu-of-the-day"),
              done("write", "write", "Wrote the tutor add-on", "features/f-cy5e90a7 · 3 files"),
              done("test", "test", "Tests passed", "2 of 2"),
              done("preview", "preview", "Preview ready", "Reloads instantly. No rebuild needed."),
              { id: "review", kind: "review", status: "running", title: "Needs your review", detail: "Part of it runs with full access to your Mac account. Read the code before turning it on." },
            ],
            text: "This one changes the tutor, so it needs a small tool that runs inside Sayfern. The tutor can call chengyu_of_the_day and weave the idiom into the chat, at most once a session.",
            status: "done",
          },
        ],
      },
      files: new Map([[1, chengyu]]),
      data: {},
      results: [],
    });
  }

  const get = (id: string): MockFeature => {
    const f = features.get(id);
    if (!f) throw new Error("That feature doesn't exist anymore.");
    return f;
  };
  const view = (f: MockFeature): FeatureInfo => {
    f.info.status = statusOf(f.info);
    return mockClone(f.info);
  };
  const version = (f: MockFeature, n: number): FeatureVersion => {
    const v = f.info.versions.find((x) => x.n === n);
    if (!v) throw new Error(`Version ${n} doesn't exist.`);
    return v;
  };

  const activate = async (f: MockFeature, n: number, enabled: boolean): Promise<FeatureInfo> => {
    await mockWait(120);
    const v = version(f, n);
    if (v.state !== "ready") throw new Error(`Version ${n} didn't finish building, so it can't be used.`);
    if (enabled && v.fullAccess && !v.approved) throw new Error("Part of this version runs with full access to your Mac account. Read and approve its code first.");
    f.info.active = n;
    f.info.enabled = enabled;
    if (f.info.draft != null && f.info.draft <= n) delete f.info.draft;
    f.info.updatedAt = now();
    return view(f);
  };

  /** Scripted build: steps over ~4 s, files from the measure-word example (or the previous version). */
  const runScript = (f: MockFeature, buildId: string, n: number, base: Map<string, string> | undefined, prompt: string) => {
    const id = f.info.id;
    const turn = f.info.turns.find((t) => t.buildId === buildId)!;
    const files = base ? new Map(base) : example("measure-word-drill");
    const isNew = !base;
    if (!isNew && /bigger|larger|size/i.test(prompt)) files.set("ui/style.css", (files.get("ui/style.css") ?? "").replace("font-size: 64px", "font-size: 80px"));
    const fileCount = files.size;
    const list: [number, () => void][] = [];
    const at = (ms: number, fn: () => void) => list.push([ms, fn]);
    const step = (s: BuildStep) => {
      const i = turn.steps.findIndex((x) => x.id === s.id);
      if (i >= 0) turn.steps[i] = s;
      else turn.steps.push(s);
      emit({ type: "step", buildId, featureId: id, step: s });
    };
    const text = (delta: string) => {
      turn.text += delta;
      emit({ type: "text", buildId, featureId: id, delta });
    };
    const intro = isNew ? "I'll read the guide and the two examples first." : "I'll read the current files, then make the change.";
    at(200, () => step({ id: "read", kind: "read", status: "running", title: "Reading the docs and examples" }));
    intro.split(" ").forEach((w, i) => at(250 + i * 45, () => text((i ? " " : "") + w)));
    at(1200, () => step(done("read", "read", isNew ? "Read the docs and two examples" : "Read the docs", isNew ? "measure-word-drill · chengyu-of-the-day" : undefined)));
    for (let k = 1; k <= fileCount; k++) {
      at(1300 + k * 260, () => step({ id: "write", kind: "write", status: "running", title: "Writing the feature", detail: `features/${id} · ${k} file${k === 1 ? "" : "s"}` }));
    }
    const tWrite = 1400 + fileCount * 260;
    at(tWrite, () => step(done("write", "write", "Wrote the activity", `features/${id} · ${fileCount} files`)));
    at(tWrite + 100, () => step({ id: "test", kind: "test", status: "running", title: "Running tests" }));
    const tests = (files.get("test.js")?.match(/^test\(/gm) ?? []).length;
    at(tWrite + 900, () => step(done("test", "test", "Tests passed", `${tests} of ${tests}`)));
    const summary = isNew
      ? "A drill tab and a Today activity: each round takes ten nouns from your Anki, hardest first, and asks for the measure word."
      : "Done. The change is in a new version; the one you had stays as it was.";
    at(tWrite + 1100, () => text(`\n\n${summary}`));
    at(tWrite + 1300, () => {
      step(done("preview", "preview", "Preview ready", "Reloads instantly. No rebuild needed."));
      const m = surfacesOf(files);
      const v = version(f, n);
      Object.assign(v, versionOf(n, files, { prompt, createdAt: v.createdAt, basedOn: v.basedOn, summary }));
      f.files.set(n, files);
      if (isNew) {
        f.info.name = /measure/i.test(prompt) ? "Measure-word drill" : f.info.name;
        f.info.description = m.description;
      }
      turn.status = "done";
      turn.usage = { input: 38_000, output: 6_100, cost: 0.21 };
      delete f.info.buildId;
      f.info.updatedAt = now();
      timers.delete(buildId);
      emit({ type: "done", buildId, featureId: id, feature: view(f) });
    });
    timers.set(
      buildId,
      list.map(([ms, fn]) => setTimeout(fn, ms)),
    );
  };

  const api: BuilderApi = {
    onBuilderEvent: (cb) => {
      subs.add(cb);
      return () => void subs.delete(cb);
    },

    listFeatures: async () => {
      await mockWait(40);
      return [...features.values()].map(view).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    getFeature: async (id) => (features.has(id) ? view(features.get(id)!) : null),

    buildFeature: async (req, model) => {
      await mockWait(80);
      const prompt = req.prompt.trim();
      if (!prompt) throw new Error("Describe the feature you want.");
      if (!model) throw new Error("Connect a model in Settings first.");
      const buildId = mockId("build");
      const t = now();
      let f: MockFeature;
      let base: Map<string, string> | undefined;
      if (req.featureId) {
        f = get(req.featureId);
        if (f.info.buildId) throw new Error("This feature is already being built.");
        const last = f.info.versions.find((v) => v.state !== "building");
        base = last ? f.files.get(last.n) : undefined;
      } else {
        const id = `f-${Math.random().toString(16).slice(2, 10)}`;
        const first = prompt.split(/[.!?。！？\n:]/)[0].trim();
        f = {
          info: { id, name: first.length > 40 ? `${first.slice(0, 38)}…` : first, description: "", language: req.language, createdAt: t, updatedAt: t, status: "building", versions: [], enabled: false, turns: [] },
          files: new Map(),
          data: {},
          results: [],
        };
        features.set(id, f);
      }
      const n = Math.max(0, ...f.info.versions.map((v) => v.n)) + 1;
      const baseVersion = f.info.versions.find((v) => v.state !== "building");
      f.info.versions.unshift({ n, createdAt: t, prompt, basedOn: base ? baseVersion?.n : undefined, state: "building", files: [], surfaces: [], fullAccess: false, approved: false });
      f.info.draft = n;
      f.info.buildId = buildId;
      f.info.updatedAt = t;
      f.info.turns.push({ id: mockId("turn"), buildId, prompt, at: t, version: n, model: `${model.provider}/${model.id}`, steps: [], text: "", status: "building" });
      emit({ type: "started", buildId, featureId: f.info.id, feature: view(f) });
      runScript(f, buildId, n, base, prompt);
      return { buildId, featureId: f.info.id };
    },

    abortBuild: async (buildId) => {
      const list = timers.get(buildId);
      if (!list) return;
      list.forEach(clearTimeout);
      timers.delete(buildId);
      const f = [...features.values()].find((x) => x.info.buildId === buildId);
      if (!f) return;
      const turn = f.info.turns.find((t) => t.buildId === buildId);
      if (turn) {
        turn.status = "stopped";
        turn.error = "Stopped";
      }
      const v = f.info.draft != null ? f.info.versions.find((x) => x.n === f.info.draft) : undefined;
      if (v) {
        v.state = "stopped";
        v.error = "Stopped";
      }
      delete f.info.buildId;
      emit({ type: "error", buildId, featureId: f.info.id, message: "Stopped", feature: view(f) });
    },

    featureFiles: async (id, n): Promise<FeatureFile[]> => {
      await mockWait(60);
      const f = get(id);
      const v = version(f, n);
      const files = f.files.get(n) ?? new Map<string, string>();
      const order = (p: string, full: boolean) => (p === "package.json" ? 0 : full ? 1 : p === "test.js" ? 3 : 2);
      return [...files.entries()]
        .map(([path, text]) => ({ path, text, bytes: new TextEncoder().encode(text).length, fullAccess: v.fullAccess && /\.m?js$/.test(path) && !path.startsWith("ui/") && path !== "test.js" }))
        .sort((a, b) => order(a.path, a.fullAccess) - order(b.path, b.fullAccess) || a.path.localeCompare(b.path));
    },

    approveFeature: async (id, n) => {
      await mockWait(80);
      const f = get(id);
      const v = version(f, n);
      if (v.state !== "ready") throw new Error("Only a finished version can be approved.");
      v.approved = true;
      return view(f);
    },
    enableFeature: async (id, n) => {
      const f = get(id);
      const target = n ?? f.info.draft ?? f.info.active ?? f.info.versions.find((v) => v.state === "ready")?.n;
      if (target == null) throw new Error("This feature has no finished version yet.");
      return activate(f, target, true);
    },
    disableFeature: async (id) => {
      await mockWait(80);
      const f = get(id);
      f.info.enabled = false;
      f.info.updatedAt = now();
      return view(f);
    },
    rollbackFeature: async (id, n) => {
      const f = get(id);
      return activate(f, n, f.info.enabled);
    },
    discardDraft: async (id) => {
      await mockWait(80);
      const f = get(id);
      if (f.info.buildId) throw new Error("Stop the build before discarding it.");
      const n = f.info.draft;
      if (n == null) return view(f);
      f.info.versions = f.info.versions.filter((v) => v.n !== n);
      f.files.delete(n);
      delete f.info.draft;
      if (!f.info.versions.length) {
        features.delete(id);
        return null;
      }
      return view(f);
    },
    deleteFeature: async (id) => {
      await mockWait(80);
      const f = features.get(id);
      if (f?.info.buildId) await api.abortBuild(f.info.buildId);
      features.delete(id);
    },

    featureSurfaces: async (language) => {
      const out = [];
      for (const f of features.values()) {
        if (!f.info.enabled || f.info.active == null) continue;
        const v = f.info.versions.find((x) => x.n === f.info.active && x.state === "ready");
        if (!v) continue;
        for (const [index, surface] of v.surfaces.entries()) {
          if (surface.languages && !surface.languages.includes(language)) continue;
          out.push({ featureId: f.info.id, featureName: f.info.name, version: v.n, index, surface: mockClone(surface) });
        }
      }
      return out.sort((a, b) => a.surface.title.localeCompare(b.surface.title));
    },

    featureFrame: async (id, n, entry) => {
      const f = get(id);
      version(f, n);
      const files = f.files.get(n);
      if (!files?.has(entry)) throw new Error(`No page ${entry} in this version.`);
      return { srcdoc: inlineFeaturePage(files, entry) };
    },

    featureCall: async (ctx: FeatureCallContext, method, args) => {
      await mockWait(30);
      const f = get(ctx.featureId);
      version(f, ctx.version);
      if (!(FEATURE_RPC_METHODS as readonly string[]).includes(method)) throw new Error(`Unknown method: ${method}`);
      if (!Array.isArray(args)) throw new Error("Arguments must be a list.");
      const language: Language = ctx.language;
      switch (method) {
        case "context":
          return { featureId: f.info.id, version: ctx.version, language, preview: !!ctx.preview };
        case "anki.words": {
          const filter = (args[0] ?? {}) as { status?: string; limit?: number };
          const limit = filter.limit ?? 50;
          if (typeof limit !== "number" || limit < 1 || limit > 200) throw new Error("filter.limit must be a whole number from 1 to 200.");
          const words = world.ankiCards[language].map((c) => ({
            word: c.word,
            reading: c.reading,
            meaning: c.meaning,
            status: c.interval >= 21 ? "known" : c.reps ? "learning" : "new",
            mature: c.interval >= 21,
            lapses: c.lapses,
            struggle: Math.min(1, c.lapses / 4 + (c.ease < 2300 ? 0.2 : 0)),
          }));
          const list = filter.status === "struggling" ? words.filter((w) => w.struggle >= 0.3).sort((a, b) => b.struggle - a.struggle) : filter.status && filter.status !== "all" ? words.filter((w) => w.status === filter.status) : words;
          return { total: list.length, items: list.slice(0, limit), syncedAt: world.T0 - 2 * MOCK_MIN };
        }
        case "grammar.list":
          return [...world.grammar.values()]
            .filter((g) => g.language === language)
            .map((g) => ({ id: g.id, pattern: g.pattern, name: g.name, reading: g.reading, level: g.level, explanation: g.explanation, examples: g.examples.slice(0, 3), state: "with_help", rate: null }));
        case "words.saved":
          return world.savedWords.filter((w) => w.language === language).map((w) => ({ word: w.word, reading: w.reading, definition: w.definition, sentence: w.sentence, savedAt: w.createdAt }));
        case "lookup": {
          const word = String(args[0] ?? "");
          const card = world.ankiCards[language].find((c) => c.word === word);
          return { query: word, needsDictionary: false, entries: card ? [{ headword: card.word, reading: card.reading ?? "", senses: [{ glosses: [card.meaning ?? ""] }] }] : [] };
        }
        case "annotate":
          return world.segment(language, String(args[0] ?? "")).map((t) => ({ text: t.text, start: t.start, end: t.end, isWord: t.isWord, reading: t.reading, lemma: t.lemma }));
        case "storage.get":
          return f.data[String(args[0])] ?? null;
        case "storage.set":
          if (args[1] === null || args[1] === undefined) delete f.data[String(args[0])];
          else f.data[String(args[0])] = mockClone(args[1]);
          return true;
        case "results.record": {
          const r = args[0] as { item?: unknown };
          if (!r || typeof r.item !== "string") throw new Error("result.item is required.");
          f.results.push({ ...mockClone(r), at: now(), version: ctx.version, language, preview: !!ctx.preview });
          return true;
        }
        case "results.list":
          return f.results.filter((r) => r.language === language).slice(-(Number(args[0]) || 100)).reverse();
      }
      return null;
    },
  };
  return api;
}
