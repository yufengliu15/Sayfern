import { lastDates, localDate } from "../records/dates";
import { JsonFile } from "../records/io";
import type { UsageSpend } from "../../shared/types";

/** Days kept on disk; the connect screen reads 30. */
const KEEP_DAYS = 60;

/** day ("2026-10-10", local time) → provider id → totals. */
type LogData = Record<string, Record<string, UsageSpend>>;

const empty = (): UsageSpend => ({ requests: 0, tokens: 0, cost: 0 });

function addTo(total: UsageSpend, add: UsageSpend) {
  total.requests += add.requests;
  total.tokens += add.tokens;
  total.cost += add.cost;
}

/** Model calls made with an API key, per local day and provider (records/usage.json). */
export class UsageLog {
  private readonly file: JsonFile<LogData>;

  constructor(
    path: string,
    private readonly now: () => number,
  ) {
    this.file = new JsonFile<LogData>(path, () => ({}));
  }

  add(provider: string, usage: { input: number; output: number; cost: number }) {
    const at = this.now();
    return this.file.update((data) => {
      const day = (data[localDate(at)] ??= {});
      addTo((day[provider] ??= empty()), { requests: 1, tokens: usage.input + usage.output, cost: usage.cost });
      const [oldest] = lastDates(at, KEEP_DAYS);
      for (const key of Object.keys(data)) if (key < oldest) delete data[key];
    });
  }

  async totals(provider: string) {
    const data = await this.file.get();
    const at = this.now();
    const today = { ...empty(), ...data[localDate(at)]?.[provider] };
    const last30Days = empty();
    for (const date of lastDates(at, 30)) {
      const day = data[date]?.[provider];
      if (day) addTo(last30Days, day);
    }
    return { today, last30Days };
  }
}
