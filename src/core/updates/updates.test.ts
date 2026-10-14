import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkForUpdate, compareVersions, parseVersion, RELEASES_PAGE, UPDATE_CHECK_FAILED } from "./index";

const answer = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("versions", () => {
  it("parses tags with or without v", () => {
    assert.deepEqual(parseVersion("v0.30.0"), [0, 30, 0]);
    assert.deepEqual(parseVersion("1.2.3-beta.1"), [1, 2, 3]);
    assert.equal(parseVersion("latest"), null);
  });
  it("compares numerically, not as text", () => {
    assert.ok(compareVersions("0.30.0", "0.9.0") > 0);
    assert.ok(compareVersions("0.30.0", "0.30.1") < 0);
    assert.equal(compareVersions("v1.0.0", "1.0.0"), 0);
  });
});

describe("checkForUpdate", () => {
  it("reports a newer release with its page", async () => {
    const r = await checkForUpdate("0.30.0", answer(200, { tag_name: "v0.31.0", html_url: "https://github.com/yufengliu15/Sayfern/releases/tag/v0.31.0" }));
    assert.deepEqual(r, { status: "available", current: "0.30.0", latest: "0.31.0", url: "https://github.com/yufengliu15/Sayfern/releases/tag/v0.31.0" });
  });
  it("is current when the release is the same or older", async () => {
    assert.equal((await checkForUpdate("0.31.0", answer(200, { tag_name: "v0.31.0" }))).status, "current");
    assert.equal((await checkForUpdate("0.32.0", answer(200, { tag_name: "v0.31.0" }))).status, "current");
  });
  it("falls back to the releases page for an unexpected link", async () => {
    const r = await checkForUpdate("0.30.0", answer(200, { tag_name: "v1.0.0", html_url: "https://evil.example/x" }));
    assert.equal(r.status === "available" && r.url, RELEASES_PAGE);
  });
  it("throws one readable error on an error status, a missing tag or no network", async () => {
    const failed = { message: UPDATE_CHECK_FAILED };
    await assert.rejects(checkForUpdate("0.30.0", answer(404, {})), failed);
    await assert.rejects(checkForUpdate("0.30.0", answer(200, {})), failed);
    await assert.rejects(checkForUpdate("0.30.0", (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch), failed);
  });
});
