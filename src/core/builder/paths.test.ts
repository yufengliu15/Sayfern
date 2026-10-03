import assert from "node:assert/strict";
import { test } from "node:test";
import { mainSideFiles, readManifest } from "./manifest";
import { featureHeaders, featureUrl, importSpecifiers, normalizeFeaturePath, parseFeatureUrl, resolveRelative } from "./paths";

test("normalizeFeaturePath: keeps simple relative paths, strips ./", () => {
  assert.equal(normalizeFeaturePath("ui/index.html"), "ui/index.html");
  assert.equal(normalizeFeaturePath("./ui//main.js"), "ui/main.js");
  assert.equal(normalizeFeaturePath("test.js"), "test.js");
});

test("normalizeFeaturePath: refuses traversal, absolute paths, odd names and types", () => {
  for (const bad of ["../x.js", "ui/../../x.js", "/etc/passwd.txt", "C:/x.js", "ui\\x.js", ".env.js", "ui/.hidden.js", "x.exe", "node_modules", "", "a/b/c/d/e/f.js", "x\0.js", 42]) {
    assert.throws(() => normalizeFeaturePath(bad), Error, String(bad));
  }
});

test("parseFeatureUrl: files, the SDK, and refusals", () => {
  assert.deepEqual(parseFeatureUrl("sayfern-feature://f-1a2b3c4d/v3/ui/index.html"), { kind: "file", id: "f-1a2b3c4d", version: 3, path: "ui/index.html" });
  assert.deepEqual(parseFeatureUrl("sayfern-feature://f-1a2b3c4d/_sdk/sayfern-sdk.js"), { kind: "sdk", id: "f-1a2b3c4d", file: "sayfern-sdk.js" });
  assert.deepEqual(parseFeatureUrl("sayfern-feature://f-1a2b3c4d/_sdk/sayfern.css"), { kind: "sdk", id: "f-1a2b3c4d", file: "sayfern.css" });
  for (const bad of [
    "sayfern-feature://f-1a2b3c4d/v3/%2E%2E/%2E%2E/feature.json",
    "sayfern-feature://f-1a2b3c4d/v3/..%2F..%2Ffeature.json",
    "sayfern-feature://f-1a2b3c4d/v3/ui/x.exe",
    "sayfern-feature://f-1a2b3c4d/latest/ui/index.html",
    "sayfern-feature://f-1a2b3c4d/_sdk/other.js",
    "sayfern-feature://../v1/ui/index.html",
    "https://f-1a2b3c4d/v1/ui/index.html",
    "not a url",
  ]) {
    assert.equal(parseFeatureUrl(bad).kind, "invalid", bad);
  }
  // Plain ".." is resolved by URL parsing before we see it, so it can't climb above the version folder.
  const t = parseFeatureUrl("sayfern-feature://f-1a2b3c4d/v1/ui/../../../feature.json");
  assert.ok(t.kind === "invalid" || (t.kind === "file" && !t.path.includes("..")));
  assert.equal(featureUrl("f-1a2b3c4d", 2, "ui/index.html"), "sayfern-feature://f-1a2b3c4d/v2/ui/index.html");
});

test("featureHeaders: no network, scripts only from the feature itself", () => {
  const csp = featureHeaders("f-1a2b3c4d", "text/html")["Content-Security-Policy"];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /script-src sayfern-feature:\/\/f-1a2b3c4d(;|$)/);
  assert.doesNotMatch(csp, /unsafe-eval|https?:/);
});

test("resolveRelative and importSpecifiers", () => {
  assert.equal(resolveRelative("ui/main.js", "./drill.js"), "ui/drill.js");
  assert.equal(resolveRelative("test.js", "./ui/drill.js"), "ui/drill.js");
  assert.equal(resolveRelative("ui/main.js", "../lib/x.js"), "lib/x.js");
  assert.equal(resolveRelative("ui/main.js", "../../x.js"), null);
  assert.equal(resolveRelative("ui/main.js", "node:fs"), null);
  assert.deepEqual(
    importSpecifiers(`import a from "./a.js";\nimport { b } from './b.js';\nexport * from "./c.js";\nconst d = await import("./d.js");\nimport "./e.js";`).sort(),
    ["./a.js", "./b.js", "./c.js", "./d.js", "./e.js"],
  );
});

const files = (o: Record<string, string>) => new Map(Object.entries(o));
const pkg = (extra: Record<string, unknown>) => JSON.stringify({ name: "X", type: "module", ...extra });

test("readManifest: valid surfaces, defaults, and readable problems", () => {
  const ok = readManifest(
    files({
      "package.json": pkg({ sayfern: { surfaces: [{ kind: "tab", title: "Words", entry: "ui/index.html", languages: ["zh"] }] } }),
      "ui/index.html": "<!doctype html>",
    }),
  );
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.manifest?.surfaces, [{ kind: "tab", title: "Words", entry: "ui/index.html", languages: ["zh"] }]);
  assert.equal(ok.manifest?.main, undefined);

  const bad = readManifest(files({ "package.json": pkg({ sayfern: { surfaces: [{ kind: "widget", title: "x", entry: "ui/index.html" }, { kind: "tab", title: "y", entry: "ui/missing.html" }] } }) }));
  assert.ok(bad.problems.some((p) => p.includes(`"tab" or "activity"`)));
  assert.ok(bad.problems.some((p) => p.includes("doesn't exist")));
  assert.ok(bad.problems.some((p) => p.includes("does nothing")));

  assert.deepEqual(readManifest(files({})).problems, ["package.json is missing."]);
  assert.match(readManifest(files({ "package.json": "{" })).problems[0], /not valid JSON/);
  assert.equal(readManifest(files({ "package.json": pkg({}), "index.js": "export function activate() {}" })).manifest?.main, "index.js");
});

test("mainSideFiles: the main entry and everything it imports", () => {
  const f = files({
    "index.js": `import { x } from "./lib/x.js"; export function activate() {}`,
    "lib/x.js": `export * from "./y.js"; export const x = 1;`,
    "lib/y.js": "export const y = 2;",
    "ui/main.js": `import "./drill.js";`,
    "ui/drill.js": "",
    "test.js": `import "./ui/drill.js";`,
  });
  assert.deepEqual([...mainSideFiles(f, "index.js")].sort(), ["index.js", "lib/x.js", "lib/y.js"]);
  assert.equal(mainSideFiles(f, undefined).size, 0);
});

test("test-page URLs and reserved folder names", () => {
  assert.deepEqual(parseFeatureUrl("sayfern-feature://f-1a2b3c4d/v2/_test/index.html"), { kind: "test", id: "f-1a2b3c4d", version: 2, file: "index.html" });
  assert.equal(parseFeatureUrl("sayfern-feature://f-1a2b3c4d/v2/_test/other.js").kind, "invalid");
  assert.throws(() => normalizeFeaturePath("_test/run.js"), /reserved/);
  assert.throws(() => normalizeFeaturePath("_sdk/sayfern.css"), /reserved/);
});
