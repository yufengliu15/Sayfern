import type { AssistantMessage, MutableModels } from "@earendil-works/pi-ai";
import { LOCAL_ENGINES } from "../local/engines";
import type { UsageLog } from "./log";

/**
 * Wraps `models` so every reply made with an API key lands in the usage log:
 * chat, quizzes, decks and card drafts all call streamSimple or completeSimple.
 * Subscription sign-ins are skipped (the provider reports their limits) and so are local servers.
 */
export function meterModels(models: MutableModels, log: UsageLog): MutableModels {
  const record = async (m: AssistantMessage) => {
    if (m.provider in LOCAL_ENGINES) return;
    if ((await models.checkAuth(m.provider))?.type !== "api_key") return;
    const u = m.usage;
    await log.add(m.provider, { input: u.input + u.cacheRead + u.cacheWrite, output: u.output, cost: u.cost.total });
  };
  const settle = (reply: Promise<AssistantMessage>) => void reply.then(record).catch((err) => console.error("Usage log failed:", err));

  const streamSimple: MutableModels["streamSimple"] = (...args) => {
    const stream = models.streamSimple(...args);
    settle(stream.result());
    return stream;
  };
  // models.completeSimple calls models.streamSimple, not the wrapper above, so a reply counts once.
  const completeSimple: MutableModels["completeSimple"] = async (...args) => {
    const reply = await models.completeSimple(...args);
    settle(Promise.resolve(reply));
    return reply;
  };

  return new Proxy(models, {
    get(target, prop) {
      if (prop === "streamSimple") return streamSimple;
      if (prop === "completeSimple") return completeSimple;
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
