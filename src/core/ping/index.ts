// Weekly ping: tells PostHog that one install of Sayfern was open this week, so the owner can count weekly
// users. At most one event per install per 7 days. It sends a random install id (not the ChatGPT device id),
// the app version and the operating system: nothing about the learner or their learning.
// On by default, off in Settings > Preferences or on the welcome page (Settings.sendWeeklyPing). ADR 41.
// Plain Node (no electron): main passes in its fetch and the version, only in packaged builds.
import { randomUUID } from "node:crypto";
import type { SettingsStore } from "../app/settings";

/** PostHog project key. Public by design (it can only send events), so it is safe in open-source code. Empty = no ping. */
export const POSTHOG_KEY = "phc_rbhDCCfTDHDjs8LZDWLHLzR2U6Yq28iEMSzwb8zZTQSm";
/** Must match the region of the PostHog project: https://us.i.posthog.com or https://eu.i.posthog.com. */
export const POSTHOG_HOST = "https://us.i.posthog.com";
export const PING_EVENT = "weekly_active";
export const PING_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

export interface PingDeps {
  settings: SettingsStore;
  fetch: typeof fetch;
  now: () => number;
  version: string;
  platform: string;
  /** Tests only. Defaults to POSTHOG_KEY. */
  key?: string;
}

/** Sends the ping when it is on, the welcome page is done and the last ping is 7 days old. Never throws. */
export async function pingIfDue(deps: PingDeps): Promise<void> {
  try {
    const key = deps.key ?? POSTHOG_KEY;
    const s = await deps.settings.get();
    if (!key || s.sendWeeklyPing === false || !s.onboarded) return;
    const now = deps.now();
    if (s.lastPingAt && now - s.lastPingAt < PING_EVERY_MS) return;
    const pingId = s.pingId ?? randomUUID();
    const res = await deps.fetch(`${POSTHOG_HOST}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        event: PING_EVENT,
        distinct_id: pingId,
        timestamp: new Date(now).toISOString(),
        // Personless event: PostHog keeps no person profile, and unique users still count by distinct_id.
        properties: { $process_person_profile: false, app_version: deps.version, os: deps.platform },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`PostHog answered ${res.status}`);
    await deps.settings.update({ pingId, lastPingAt: now });
  } catch (err) {
    // Quiet: the next start or the next daily check tries again.
    console.warn("Weekly ping failed:", err);
  }
}
