// Sayfern example extension: a daily chengyu (成语) for Chinese sessions.
// Plain ES module, no build step. Copy this folder into Sayfern's extensions
// folder (Settings > Extensions > Open extensions folder), then restart Sayfern.

const CHENGYU = [
  { idiom: "一举两得", pinyin: "yī jǔ liǎng dé", meaning: "kill two birds with one stone", example: "骑自行车上班一举两得，又省钱又锻炼身体。" },
  { idiom: "马马虎虎", pinyin: "mǎ mǎ hū hū", meaning: "so-so; careless", example: "我的中文马马虎虎，还要多练习。" },
  { idiom: "入乡随俗", pinyin: "rù xiāng suí sú", meaning: "when in Rome, do as the Romans do", example: "到了新的城市，我们要入乡随俗。" },
  { idiom: "半途而废", pinyin: "bàn tú ér fèi", meaning: "give up halfway", example: "学语言最怕半途而废。" },
  { idiom: "熟能生巧", pinyin: "shú néng shēng qiǎo", meaning: "practice makes perfect", example: "每天写一点，熟能生巧。" },
  { idiom: "自言自语", pinyin: "zì yán zì yǔ", meaning: "talk to oneself", example: "他一边做饭一边自言自语。" },
  { idiom: "一见如故", pinyin: "yí jiàn rú gù", meaning: "feel like old friends at first meeting", example: "我们第一次见面就一见如故。" },
];

/** Same idiom all day, a different one tomorrow (local date). */
export function chengyuFor(date = new Date()) {
  const day = Math.floor((date.getTime() - date.getTimezoneOffset() * 60000) / 86400000);
  return CHENGYU[((day % CHENGYU.length) + CHENGYU.length) % CHENGYU.length];
}

export function activate(api) {
  api.registerTool({
    name: "chengyu_of_the_day",
    description:
      "Returns today's chengyu (four-character idiom) with pinyin, English meaning and an example sentence. Chinese sessions only.",
    // Plain JSON schema works as well as a TypeBox schema.
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute(_args, ctx) {
      if (ctx.language !== "zh") return "This tool is only for Chinese sessions.";
      const c = chengyuFor();
      return {
        content: `${c.idiom} (${c.pinyin}): ${c.meaning}. Example: ${c.example}`,
        activity: `Chengyu of the day: ${c.idiom}`,
      };
    },
  });

  api.addPromptAddition((language) => {
    if (language !== "zh") return undefined;
    return (
      "Chengyu of the day: occasionally (at most once a session, when it fits naturally) you may " +
      "call chengyu_of_the_day and weave the idiom into the conversation, then invite the learner to try using it. " +
      "Don't force it into unrelated topics."
    );
  });

  api.log("ready");
}
