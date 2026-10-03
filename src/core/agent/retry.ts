// Correction retries (S1-06, S1-18): a cheap local check first, then a strict-JSON model check.
import { msg } from "../../shared/i18n";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { RetryResult } from "../../shared/api";
import type { Correction } from "../../shared/records";
import { explainIn, type TutorDeps } from "./deps";
import { requestOptions } from "./options";

const LOCAL_OK_FEEDBACK = msg("Nice, that's right now.");
const GENERIC_WRONG_FEEDBACK = msg("Not quite yet. Have another look at the highlighted part.");

/**
 * Local check: the retry contains the corrected text and (once the corrected
 * text is removed) no longer contains the original. Null = undecided.
 */
export function localRetryCheck(correction: Pick<Correction, "original" | "corrected">, retry: string, normalize: (s: string) => string): boolean | null {
  const orig = normalize(correction.original);
  const fixed = normalize(correction.corrected);
  const r = normalize(retry);
  if (!fixed || !r.includes(fixed)) return null;
  if (orig === fixed) return true;
  const rest = r.split(fixed).join("\u0000");
  return orig && rest.includes(orig) ? null : true;
}

/** Parse {"ok": boolean, "feedback": string} from a model reply, defensively. */
export function parseRetryJson(raw: string): { ok: boolean; feedback: string } | null {
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const v = JSON.parse(match[0]) as { ok?: unknown; feedback?: unknown };
      const ok = v.ok === true || v.ok === "true";
      const feedback = typeof v.feedback === "string" ? v.feedback.trim() : "";
      if (typeof v.ok === "boolean" || v.ok === "true" || v.ok === "false") return { ok, feedback };
    } catch {
      // fall through to the loose match
    }
  }
  const loose = cleaned.match(/"?ok"?\s*[:=]\s*(true|false)/i);
  if (loose) return { ok: loose[1].toLowerCase() === "true", feedback: "" };
  return null;
}

export async function checkRetry(deps: TutorDeps, correctionId: string, text: string, model: Model<Api>): Promise<RetryResult> {
  const { records } = deps;
  const correction = await records.getCorrection(correctionId);
  if (!correction) throw new Error(`Correction not found: ${correctionId}`);
  const pack = deps.lang.pack(correction.language);
  const explain = await explainIn(deps);
  await pack.ready();
  const normalize = (s: string) => pack.normalize(s);

  let ok: boolean;
  let feedback: string;
  const local = localRetryCheck(correction, text, normalize);
  if (local === true) {
    ok = true;
    feedback = LOCAL_OK_FEEDBACK;
  } else {
    const messages = await records.getMessages(correction.sessionId);
    const sentence = messages.find((m) => m.id === correction.messageId)?.text ?? correction.original;
    const reply = await deps.models.completeSimple(
      model,
      {
        systemPrompt:
          `You check a language learner's retry after a correction. Judge only whether the retry fixes the problem; other wording changes are fine if correct. Reply with strict JSON only: {"ok": boolean, "feedback": "one short sentence in ${explain}, no answer reveal"}.`,
        messages: [
          {
            role: "user",
            content: [
              `Language: ${pack.info.name}`,
              `Original sentence: ${sentence}`,
              `Problem part: ${correction.original}`,
              `Suggested fix (do not reveal): ${correction.corrected}`,
              `Why: ${correction.explanation}`,
              `Learner's retry: ${text}`,
            ].join("\n"),
            timestamp: deps.now(),
          },
        ],
      },
      requestOptions(model, 200),
    );
    if (reply.stopReason === "error" || reply.stopReason === "aborted") {
      throw new Error(reply.errorMessage || "The model request failed.");
    }
    const raw = reply.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    const parsed = parseRetryJson(raw);
    ok = parsed?.ok ?? false;
    feedback = parsed?.feedback || (ok ? LOCAL_OK_FEEDBACK : GENERIC_WRONG_FEEDBACK);
    const fixed = normalize(correction.corrected);
    if (!ok && fixed && normalize(feedback).includes(fixed)) feedback = GENERIC_WRONG_FEEDBACK;
  }

  const at = deps.now();
  const retries = [...correction.retries, { text, ok, at }];
  const updated = await records.updateCorrection(correction.id, { retries, status: ok ? "retried_ok" : "retried_wrong" });
  if (correction.grammarId) {
    await records.recordObservations(correction.language, [
      {
        grammarId: correction.grammarId,
        sessionId: correction.sessionId,
        messageId: `${correction.messageId}:retry${retries.length}`,
        span: text,
        verdict: ok ? "correct" : "incorrect",
        assistance: "corrected_retry",
        at,
      },
    ]);
  }
  return { ok, feedback, correction: updated };
}
