import type { Correction } from "../../shared/records";

/**
 * A correction that shows the learner struggled with the language: a grammar one they did not dispute.
 * Typos and spoken-register slips do not count. Quiz material and tutor pacing both use this.
 */
export function countableCorrection(c: Pick<Correction, "kind" | "status">) {
  return c.kind === "grammar" && c.status !== "disputed";
}
