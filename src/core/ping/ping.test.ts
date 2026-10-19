import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SettingsStore } from "../app/settings";
import { PING_EVENT, PING_EVERY_MS, pingIfDue } from ".";

function setup(status = 200) {
  const settings = new SettingsStore(join(mkdtempSync(join(tmpdir(), "sayfern-ping-")), "settings.json"));
  const bodies: Record<string, unknown>[] = [];
  const fetch = (async (_url: string | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response("{}", { status });
  }) as typeof globalThis.fetch;
  const clock = { t: Date.UTC(2026, 9, 19) };
  const ping = () => pingIfDue({ settings, fetch, now: () => clock.t, version: "1.2.3", platform: "darwin", key: "phc_test" });
  return { settings, bodies, clock, ping };
}

test("the weekly ping waits for the welcome page, then sends once per 7 days with the same random id", async () => {
  const { settings, bodies, clock, ping } = setup();
  await ping();
  assert.equal(bodies.length, 0);

  await settings.update({ onboarded: true, deviceId: "chatgpt-device" });
  await ping();
  assert.equal(bodies.length, 1);
  const first = bodies[0]!;
  assert.equal(first.event, PING_EVENT);
  assert.equal(first.api_key, "phc_test");
  assert.notEqual(first.distinct_id, "chatgpt-device");
  assert.deepEqual(first.properties, { $process_person_profile: false, app_version: "1.2.3", os: "darwin" });

  clock.t += PING_EVERY_MS - 1;
  await ping();
  assert.equal(bodies.length, 1);

  clock.t += 1;
  await ping();
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1]!.distinct_id, first.distinct_id);
});

test("the weekly ping sends nothing when the learner turned it off", async () => {
  const { settings, bodies, ping } = setup();
  await settings.update({ onboarded: true, sendWeeklyPing: false });
  await ping();
  assert.equal(bodies.length, 0);
});

test("a failed ping does not throw and tries again next time", async () => {
  const { settings, bodies, ping } = setup(503);
  await settings.update({ onboarded: true });
  await ping();
  await ping();
  assert.equal(bodies.length, 2);
  assert.equal((await settings.get()).lastPingAt, undefined);
});
