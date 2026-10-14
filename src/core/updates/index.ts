// "Check for Updates": asks GitHub for the newest Sayfern release and compares it with this build.
// Plain Node (no electron): main passes in its fetch and shows the result in a native dialog.
// Releases come from CI (.github/workflows/release.yml): tag v<version>, one per package.json version.
import { msg } from "../../shared/i18n";

export const RELEASES_REPO = "yufengliu15/Sayfern";
export const RELEASES_PAGE = `https://github.com/${RELEASES_REPO}/releases/latest`;
const LATEST_API = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`;

export type UpdateCheck =
  | { status: "current"; current: string; latest: string }
  | { status: "available"; current: string; latest: string; url: string };

/** "v1.2.3" or "1.2.3-beta" → [1, 2, 3]; null when it is not a version. */
export function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Negative when a is older than b, 0 when equal, positive when a is newer. Unparsable versions count as 0.0.0. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a) ?? [0, 0, 0];
  const pb = parseVersion(b) ?? [0, 0, 0];
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  return 0;
}

/** The one error the learner sees (translated in the catalogs); the cause goes to the console. */
export const UPDATE_CHECK_FAILED = msg("Couldn't check for updates. Check your internet connection and try again.");

/** Throws UPDATE_CHECK_FAILED when GitHub cannot be reached or answers with something unexpected. */
export async function checkForUpdate(current: string, fetchFn: typeof fetch): Promise<UpdateCheck> {
  let tag = "";
  let link: unknown;
  try {
    const res = await fetchFn(LATEST_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `Sayfern/${current}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
    tag = typeof body.tag_name === "string" ? body.tag_name : "";
    link = body.html_url;
    if (!parseVersion(tag)) throw new Error("GitHub sent no release version");
  } catch (err) {
    console.warn("Update check failed:", err);
    throw new Error(UPDATE_CHECK_FAILED);
  }
  const latest = tag.replace(/^v/, "");
  if (compareVersions(latest, current) <= 0) return { status: "current", current, latest };
  const url = typeof link === "string" && link.startsWith("https://github.com/") ? link : RELEASES_PAGE;
  return { status: "available", current, latest, url };
}
