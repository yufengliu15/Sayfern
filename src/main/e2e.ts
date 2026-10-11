// Test hook for driving the built app end to end without real credentials.
// Active only when SAYFERN_E2E_FAUX=1: registers pi-ai's faux provider with a
// scripted tutor that replies, records one observation and translates.
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type FauxResponseStep,
  type MutableModels,
} from "@earendil-works/pi-ai";

export function installE2EFaux(models: MutableModels): void {
  const faux = fauxProvider({ tokensPerSecond: 400 });
  models.setProvider(faux.provider);
  const step: FauxResponseStep = (context) => {
    const sys = context.messages.find((m) => m.role === "system");
    const system = typeof sys?.content === "string" ? sys.content : (sys?.content.map((c) => c.text).join("") ?? "");
    if (system.startsWith("Translate")) return fauxAssistantMessage("(translation)");
    if (system.startsWith("You check a language learner's retry")) return fauxAssistantMessage('{"ok": true, "feedback": "Good."}');
    const last = context.messages[context.messages.length - 1];
    const lastText = last?.role === "user" ? (typeof last.content === "string" ? last.content : "") : "";
    if (lastText.startsWith("(The learner opened")) return fauxAssistantMessage("你好！我们开始吧。你今天做了什么？");
    return fauxAssistantMessage([
      fauxText("很好！你说得不错。"),
      fauxToolCall("record_evidence", {
        observations: [
          { grammar_id: "zh:le-completion", pattern: "了", name: "Completed action 了", span: lastText.slice(0, 4), verdict: "correct", assistance: "independent" },
        ],
      }),
    ]);
  };
  faux.setResponses(Array.from({ length: 500 }, () => step));
}
