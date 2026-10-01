// Local-date helpers (machine timezone), formatted YYYY-MM-DD.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The `count` local dates ending with the date of `nowMs`, oldest first. DST-safe. */
export function lastDates(nowMs: number, count: number): string[] {
  const now = new Date(nowMs);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    // Noon avoids DST edges shifting the calendar day.
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, 12);
    out.push(localDate(d.getTime()));
  }
  return out;
}
