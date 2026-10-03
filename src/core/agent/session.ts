// Translation (S1-08) and end-of-session summaries.
import type { Api, Model } from "@earendil-works/pi-ai";
import type { EndSummary } from "../../shared/api";
import type { GrammarObservation, WordUsage } from "../../shared/records";
import { explainIn, type TutorDeps } from "./deps";
import { requestOptions } from "./options";
import { stripPasted } from "./text";

export async function translate(deps: TutorDeps, sessionId: string, messageId: string, model: Model<Api>): Promise<string> {
  const messages = await deps.records.getMessages(sessionId);
  const msg = messages.find((m) => m.id === messageId);
  if (!msg) throw new Error(`Message not found: ${messageId}`);
  const target = await explainIn(deps);
  // A translation is cached with the language it was made in; switching the interface language re-translates.
  if (msg.translation && (msg.translationLang ?? "English") === target) return msg.translation;
  if (!msg.text.trim()) return "";
  const reply = await deps.models.completeSimple(
    model,
    {
      systemPrompt: `Translate into natural ${target}. Output only the translation.`,
      messages: [{ role: "user", content: msg.text, timestamp: deps.now() }],
    },
    requestOptions(model, 800),
  );
  if (reply.stopReason === "error" || reply.stopReason === "aborted") {
    throw new Error(reply.errorMessage || "The translation request failed.");
  }
  const translation = reply.content
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("")
    .trim();
  if (translation) await deps.records.updateMessage(sessionId, messageId, { translation, translationLang: target });
  return translation;
}

export async function endSession(deps: TutorDeps, sessionId: string): Promise<EndSummary> {
  const { records } = deps;
  const existing = await records.getSession(sessionId);
  if (!existing) throw new Error(`Session not found: ${sessionId}`);
  const session = existing.endedAt ? existing : await records.updateSession(sessionId, { endedAt: deps.now() });
  const language = session.language;

  const [corrections, observations, targets, messages] = await Promise.all([
    records.listCorrections({ language, sessionId }),
    records.listObservations({ language, sessionId }),
    records.getTargets(sessionId),
    records.getMessages(sessionId),
  ]);

  const byPoint = new Map<string, GrammarObservation[]>();
  for (const o of observations) {
    const list = byPoint.get(o.grammarId);
    if (list) list.push(o);
    else byPoint.set(o.grammarId, [o]);
  }
  const grammar: EndSummary["grammar"] = [];
  for (const [id, obs] of byPoint) {
    const summary = await records.getGrammarSummary(id);
    if (summary) grammar.push({ summary, observations: obs });
  }

  // Words first used in this session: re-segment the learner's messages, then
  // keep usages whose first occurrence is here.
  const pack = deps.lang.pack(language);
  await pack.ready();
  const seen = new Set<string>();
  const newWords: WordUsage[] = [];
  for (const m of messages) {
    if (m.role !== "user") continue;
    for (const w of pack.learnerWords(stripPasted(m.text, m.pastedSpans))) {
      const word = w.trim();
      if (!word || seen.has(word)) continue;
      seen.add(word);
      const u = await records.getWordUsage(language, word);
      if (u && u.firstSessionId === sessionId) newWords.push(u);
    }
  }
  newWords.sort((a, b) => a.firstUsedAt - b.firstUsedAt);

  return { session, corrections, grammar, newWords, targets };
}
