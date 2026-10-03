// In-memory SayfernApi for developing the renderer in a plain browser
// (`npx vite --config vite.mock.config.ts`). Believable Chinese + Japanese data, simulated
// streaming with corrections and tool activity. Never loaded inside Electron.
import type {
  AnkiStatus,
  ChatEvent,
  EndSummary,
  ExtensionInfo,
  GrammarDetail,
  HomeView,
  NewSessionOptions,
  RetryResult,
  SayfernApi,
  SessionView,
} from "../../../shared/api";
import type { DictEntry, DictionaryProgress, DictionaryStatus, LanguageInfo, LookupResult, Token } from "../../../shared/lang";
import type {
  AnkiCard,
  AnkiConfig,
  AnkiOverview,
  AnkiWord,
  ChatMessage,
  Correction,
  GrammarCounts,
  GrammarObservation,
  GrammarPoint,
  GrammarState,
  GrammarSummary,
  Language,
  LearnerProfile,
  LevelEstimate,
  LibraryDoc,
  LibraryHit,
  LibraryParagraph,
  PracticeTarget,
  ProgressStats,
  SavedWord,
  SessionMeta,
  Skill,
  WordUsage,
} from "../../../shared/records";
import type { AuthEventPayload, AuthPromptPayload, ModelInfo, ProviderInfo, Settings } from "../../../shared/types";
import { createBuilderMock } from "./mockBuilder";
import { createDeckMock } from "./mockDecks";
import { createVoiceMock } from "./mockVoice";
import { createQuizMock } from "./mockQuiz";
import { createReviewMock } from "./mockReview";
import { everyLanguage, type MockSessionRec, type MockWorld } from "./mockWorld";
import { LANGUAGE_META, languageInfo } from "../../../shared/languages";
import { matchLocale } from "../../../shared/locales";
import { LANGUAGES } from "../../../shared/records";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const clone = <T>(v: T): T => structuredClone(v);
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

// ---------------------------------------------------------------- dictionaries

type Entry = [reading: string, senses: string, tags?: string];

const ZH_DICT: Record<string, Entry> = {
  欢迎: ["huānyíng", "to welcome; welcome", "v"],
  回来: ["huílai", "to come back; to return", "v"],
  上次: ["shàngcì", "last time", "n"],
  你: ["nǐ", "you", "pron"],
  说: ["shuō", "to say; to speak | to scold", "v"],
  这个: ["zhège", "this; this one", "pron"],
  周末: ["zhōumò", "weekend", "n"],
  想: ["xiǎng", "to want to; would like to | to think | to miss", "v"],
  去: ["qù", "to go; to leave for", "v"],
  爬山: ["pá shān", "to climb a mountain; to go hiking", "v"],
  你们: ["nǐmen", "you (plural)", "pron"],
  最后: ["zuìhòu", "finally; in the end | last", "adv"],
  了: ["le", "(completed action marker) | (change of state)", "particle"],
  吗: ["ma", "(question particle for yes-no questions)", "particle"],
  我们: ["wǒmen", "we; us", "pron"],
  昨天: ["zuótiān", "yesterday", "n"],
  除了: ["chúle", "besides; apart from | except", "prep"],
  还: ["hái", "also; in addition | still; yet", "adv"],
  吃: ["chī", "to eat", "v"],
  很: ["hěn", "very; quite", "adv"],
  有名: ["yǒumíng", "famous; well-known", "adj"],
  的: ["de", "(possessive or attributive particle)", "particle"],
  烤鸭: ["kǎoyā", "roast duck", "n"],
  哇: ["wa", "wow", "interj"],
  对: ["duì", "towards; about | correct; right", "prep"],
  那: ["nà", "that; those", "pron"],
  家: ["jiā", "home; family | (classifier for shops and restaurants)", "n"],
  饭馆: ["fànguǎn", "restaurant", "n"],
  印象: ["yìnxiàng", "impression", "n"],
  怎么样: ["zěnmeyàng", "how; how is it?; what do you think?", "pron"],
  好吃: ["hǎochī", "delicious; tasty", "adj"],
  可是: ["kěshì", "but; however", "conj"],
  排队: ["páiduì", "to queue; to line up", "v"],
  排: ["pái", "to line up | row; line", "v"],
  一: ["yī", "one; a", "num"],
  个: ["gè", "(general classifier)", "classifier"],
  小时: ["xiǎoshí", "hour", "n"],
  推荐: ["tuījiàn", "to recommend; recommendation", "v"],
  朋友: ["péngyou", "friend", "n"],
  会: ["huì", "will; would | can; to know how to", "aux"],
  给: ["gěi", "to give | for; to", "v"],
  真: ["zhēn", "really; truly", "adv"],
  不错: ["búcuò", "not bad; pretty good", "adj"],
  多久: ["duōjiǔ", "how long", "pron"],
  店: ["diàn", "shop; store", "n"],
  下次: ["xiàcì", "next time", "n"],
  什么: ["shénme", "what", "pron"],
  菜: ["cài", "dish; cuisine | vegetable", "n"],
  点: ["diǎn", "to order (food) | o'clock", "v"],
  大学: ["dàxué", "university; college", "n"],
  生活: ["shēnghuó", "life; to live", "n"],
  电影: ["diànyǐng", "film; movie", "n"],
  喜欢: ["xǐhuan", "to like; to be fond of", "v"],
  最: ["zuì", "most; the most", "adv"],
  是: ["shì", "to be", "v"],
  在: ["zài", "at; in | to be (somewhere)", "prep"],
  有: ["yǒu", "to have | there is", "v"],
  我: ["wǒ", "I; me", "pron"],
  和: ["hé", "and; with", "conj"],
  一起: ["yìqǐ", "together", "adv"],
  觉得: ["juéde", "to think; to feel", "v"],
  听起来: ["tīng qilai", "to sound (like)", "v"],
  好玩: ["hǎowán", "fun; amusing", "adj"],
  哪儿: ["nǎr", "where", "pron"],
  可以: ["kěyǐ", "can; may", "aux"],
  几: ["jǐ", "a few; several | how many", "num"],
  地方: ["dìfang", "place", "n"],
  明白: ["míngbai", "to understand; clear", "v"],
  北京: ["Běijīng", "Beijing", "n"],
  那边: ["nàbian", "there; over there", "pron"],
  不一样: ["bù yíyàng", "different; not the same", "adj"],
  先: ["xiān", "first; in advance", "adv"],
  轻松: ["qīngsōng", "relaxed; easy", "adj"],
  聊: ["liáo", "to chat", "v"],
  五: ["wǔ", "five", "num"],
  分钟: ["fēnzhōng", "minute", "n"],
  平时: ["píngshí", "usually; ordinarily", "adv"],
  做: ["zuò", "to do; to make", "v"],
  特别: ["tèbié", "especially; particularly | special", "adv"],
  爱好: ["àihào", "hobby; interest", "n"],
  运动: ["yùndòng", "sports; exercise", "n"],
  吧: ["ba", "(suggestion particle)", "particle"],
  来: ["lái", "to come | (let's)", "v"],
  从: ["cóng", "from", "prep"],
  第: ["dì", "(ordinal prefix)", "prefix"],
  段: ["duàn", "paragraph; section", "n"],
  开始: ["kāishǐ", "to begin; to start", "v"],
  读: ["dú", "to read (aloud); to study", "v"],
  完: ["wán", "to finish", "v"],
  以后: ["yǐhòu", "after; afterwards", "n"],
  告诉: ["gàosu", "to tell", "v"],
  难: ["nán", "difficult; hard", "adj"],
  句: ["jù", "sentence; (classifier for sentences)", "classifier"],
  今天: ["jīntiān", "today", "n"],
  学: ["xué", "to learn; to study", "v"],
  老师: ["lǎoshī", "teacher", "n"],
  同学: ["tóngxué", "classmate", "n"],
  宿舍: ["sùshè", "dormitory", "n"],
  上课: ["shàngkè", "to attend class", "v"],
  忙: ["máng", "busy", "adj"],
  服务员: ["fúwùyuán", "waiter; waitress", "n"],
  菜单: ["càidān", "menu", "n"],
  看: ["kàn", "to look at; to watch | to read", "v"],
  因为: ["yīnwèi", "because", "conj"],
  所以: ["suǒyǐ", "so; therefore", "conj"],
  比: ["bǐ", "than; compared with", "prep"],
  非常: ["fēicháng", "very; extremely", "adv"],
  风景: ["fēngjǐng", "scenery; landscape", "n"],
  以外: ["yǐwài", "apart from; other than", "n"],
  门口: ["ménkǒu", "doorway; entrance", "n"],
  每个: ["měi ge", "each; every", "pron"],
  公园: ["gōngyuán", "park", "n"],
  散步: ["sànbù", "to take a walk", "v"],
  王朋: ["Wáng Péng", "Wang Peng (a name)", "n"],
  李友: ["Lǐ Yǒu", "Li You (a name)", "n"],
  一定: ["yídìng", "surely; must", "adv"],
  大家: ["dàjiā", "everyone", "pron"],
  开心: ["kāixīn", "happy; to have fun", "adj"],
  那天: ["nà tiān", "that day", "n"],
  山上: ["shān shang", "on the mountain", "n"],
  上个: ["shàng ge", "last; previous", "pron"],
  笑着: ["xiàozhe", "smiling; laughing", "v"],
  第十二: ["dì shí'èr", "twelfth", "num"],
  课: ["kè", "lesson; class", "n"],
  越来越: ["yuè lái yuè", "more and more", "adv"],
  虽然: ["suīrán", "although", "conj"],
  但是: ["dànshì", "but; however", "conj"],
  中文: ["Zhōngwén", "Chinese (language)", "n"],
  饺子: ["jiǎozi", "dumpling", "n"],
  音乐: ["yīnyuè", "music", "n"],
  门: ["mén", "door | (classifier for courses)", "n"],
  三: ["sān", "three", "num"],
};

/** Per-character pinyin for characters the demo dictionary has no word for (pinyin-pro does this for real). */
const ZH_CHAR: Record<string, string> = {
  上: "shàng", 山: "shān", 美: "měi", 多: "duō", 人: "rén", 都: "dōu", 饭: "fàn", 里: "lǐ", 事: "shì", 要: "yào", 再: "zài",
  次: "cì", 天: "tiān", 得: "de", 玩: "wán", 笑: "xiào", 着: "zhe", 就: "jiù", 把: "bǎ", 过: "guo", 书: "shū", 画: "huà",
  岁: "suì", 时: "shí", 候: "hou", 本: "běn", 到: "dào", 幅: "fú", 羊: "yáng", 只: "zhī", 请: "qǐng", 他: "tā", 们: "men",
  叫: "jiào", 学: "xué", 生: "shēng", 专: "zhuān", 业: "yè", 计: "jì", 算: "suàn", 机: "jī", 看: "kàn", 做: "zuò",
};

const JA_DICT: Record<string, Entry> = {
  こんにちは: ["こんにちは", "hello; good afternoon", "interj"],
  週末: ["しゅうまつ", "weekend", "n"],
  何: ["なに", "what", "pron"],
  する: ["する", "to do", "vs-i"],
  友達: ["ともだち", "friend", "n"],
  一緒に: ["いっしょに", "together", "adv"],
  山: ["やま", "mountain", "n"],
  登る: ["のぼる", "to climb; to go up", "v5r"],
  とても: ["とても", "very", "adv"],
  楽しい: ["たのしい", "fun; enjoyable", "adj-i"],
  です: ["です", "(polite copula) to be", "cop"],
  いい: ["いい", "good; nice", "adj-i"],
  どの: ["どの", "which", "adj-pn"],
  ラーメン: ["ラーメン", "ramen", "n"],
  食べる: ["たべる", "to eat", "v1"],
  美味しい: ["おいしい", "delicious", "adj-i"],
  今日: ["きょう", "today", "n"],
  昨日: ["きのう", "yesterday", "n"],
  映画: ["えいが", "movie; film", "n"],
  見る: ["みる", "to see; to watch", "v1"],
  好き: ["すき", "liked; favourite", "adj-na"],
  予定: ["よてい", "plan; schedule", "n"],
  行列: ["ぎょうれつ", "queue; line (of people)", "n"],
  ある: ["ある", "to exist; to be (of things)", "v5r-i"],
  おすすめ: ["おすすめ", "recommendation", "n"],
  屋: ["や", "shop; store", "suf"],
  来週: ["らいしゅう", "next week", "n"],
  なるほど: ["なるほど", "I see; indeed", "interj"],
  まず: ["まず", "first of all", "adv"],
  五分: ["ごふん", "five minutes", "n"],
  ぐらい: ["ぐらい", "about; approximately", "prt"],
  話す: ["はなす", "to speak; to talk", "v5s"],
  よく: ["よく", "often; well", "adv"],
  行く: ["いく", "to go", "v5k-s"],
  そう: ["そう", "so; like that | seeming", "adv"],
  は: ["は", "(topic marker)", "prt"],
  を: ["を", "(object marker)", "prt"],
  が: ["が", "(subject marker) | but", "prt"],
  に: ["に", "to; at; in", "prt"],
  と: ["と", "and; with", "prt"],
  も: ["も", "also; too", "prt"],
  か: ["か", "(question marker)", "prt"],
  ね: ["ね", "right?; isn't it", "prt"],
  で: ["で", "at; by means of", "prt"],
  の: ["の", "(possessive particle)", "prt"],
  その: ["その", "that", "adj-pn"],
  どう: ["どう", "how", "adv"],
  本: ["ほん", "book", "n"],
  読む: ["よむ", "to read", "v5m"],
  むかしむかし: ["むかしむかし", "once upon a time", "exp"],
  村: ["むら", "village", "n"],
  住む: ["すむ", "to live (somewhere)", "v5m"],
  川: ["かわ", "river", "n"],
  せんたく: ["せんたく", "laundry; washing", "n"],
  しばかり: ["しばかり", "gathering firewood", "n"],
  大きな: ["おおきな", "big; large", "adj-pn"],
  桃: ["もも", "peach", "n"],
  どんぶらこ: ["どんぶらこ", "(sound of something bobbing in water)", "adv"],
  流れる: ["ながれる", "to flow; to float along", "v1"],
  家: ["いえ", "house; home", "n"],
  持つ: ["もつ", "to hold; to carry", "v5t"],
  帰る: ["かえる", "to go home; to return", "v5r"],
  夜: ["よる", "night", "n"],
  二人: ["ふたり", "two people; the two", "n"],
  切る: ["きる", "to cut", "v5r"],
  割れる: ["われる", "to split; to break", "v1"],
  中: ["なか", "inside; middle", "n"],
  元気: ["げんき", "lively; healthy", "adj-na"],
  男の子: ["おとこのこ", "boy", "n"],
  出る: ["でる", "to come out; to leave", "v1"],
  生まれる: ["うまれる", "to be born", "v1"],
  桃太郎: ["ももたろう", "Momotarō (Peach Boy)", "n"],
  名前: ["なまえ", "name", "n"],
  大きい: ["おおきい", "big", "adj-i"],
  強い: ["つよい", "strong", "adj-i"],
  子: ["こ", "child", "n"],
  なる: ["なる", "to become", "v5r"],
  日: ["ひ", "day", "n"],
  悪い: ["わるい", "bad; evil", "adj-i"],
  鬼: ["おに", "ogre; demon", "n"],
  来る: ["くる", "to come", "vk"],
  宝物: ["たからもの", "treasure", "n"],
  取る: ["とる", "to take", "v5r"],
  鬼ヶ島: ["おにがしま", "Onigashima (Ogre Island)", "n"],
  言う: ["いう", "to say", "v5u"],
  日本一: ["にっぽんいち", "the best in Japan", "n"],
  作る: ["つくる", "to make", "v5r"],
  道: ["みち", "road; way", "n"],
  犬: ["いぬ", "dog", "n"],
  会う: ["あう", "to meet", "v5u"],
  一つ: ["ひとつ", "one (thing)", "n"],
  お供: ["おとも", "attendant; going along with someone", "n"],
  次: ["つぎ", "next", "n"],
  猿: ["さる", "monkey", "n"],
  船: ["ふね", "boat; ship", "n"],
  乗る: ["のる", "to ride; to board", "v5r"],
  着く: ["つく", "to arrive", "v5k"],
  空: ["そら", "sky", "n"],
  門: ["もん", "gate", "n"],
  喜ぶ: ["よろこぶ", "to be glad", "v5b"],
  第一話: ["だいいちわ", "episode one", "n"],
  第二話: ["だいにわ", "episode two", "n"],
  第三話: ["だいさんわ", "episode three", "n"],
};

/** Surface readings for inflected forms (kuromoji gives these for real). */
const JA_SURFACE: Record<string, string> = {
  住んでいました: "すんでいました", 行きました: "いきました", 流れてきました: "ながれてきました", 持って: "もって",
  帰りました: "かえりました", 帰ってきました: "かえってきました", 切ろう: "きろう", 割れて: "われて", 出てきました: "でてきました",
  生まれた: "うまれた", 大きくなり: "おおきくなり", 来て: "きて", 取って: "とって", 言いました: "いいました", 作って: "つくって",
  会いました: "あいました", 会い: "あい", 乗って: "のって", 着きました: "つきました", 喜びました: "よろこびました",
  楽しかった: "たのしかった", 食べました: "たべました", 見ました: "みました", 登りました: "のぼりました",
};

/** Inflected surface → dictionary form (what kuromoji would give). */
const JA_FORMS: Record<string, string> = {
  しました: "する",
  しますか: "する",
  します: "する",
  しましょう: "する",
  登りました: "登る",
  登りましたか: "登る",
  楽しかった: "楽しい",
  楽しそう: "楽しい",
  食べました: "食べる",
  食べましたか: "食べる",
  見ました: "見る",
  ありましたか: "ある",
  ありますか: "ある",
  話しましょう: "話す",
  行きました: "行く",
  でした: "です",
  でしたか: "です",
  ですか: "です",
  ですね: "です",
  住んでいました: "住む",
  流れてきました: "流れる",
  持って: "持つ",
  帰りました: "帰る",
  帰ってきました: "帰る",
  切ろう: "切る",
  割れて: "割れる",
  出てきました: "出る",
  生まれた: "生まれる",
  大きくなり: "大きい",
  なりました: "なる",
  来て: "来る",
  取って: "取る",
  言いました: "言う",
  作って: "作る",
  会いました: "会う",
  会い: "会う",
  乗って: "乗る",
  着きました: "着く",
  喜びました: "喜ぶ",
};

const isCjk = (ch: string) => /[぀-ヿ㐀-鿿々ー]/.test(ch);
const isKana = (ch: string) => /[぀-ヿー]/.test(ch);

function segment(language: Language, text: string): Token[] {
  if (language !== "zh" && language !== "ja") {
    const seg = new Intl.Segmenter(LANGUAGE_META[language].bcp47, { granularity: "word" });
    return [...seg.segment(text)].map((s) => ({ text: s.segment, start: s.index, end: s.index + s.segment.length, isWord: !!s.isWordLike }));
  }
  const dict = language === "zh" ? ZH_DICT : JA_DICT;
  const forms: Record<string, string> = language === "ja" ? JA_FORMS : {};
  const known = (s: string) => !!dict[s] || !!forms[s];
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    if (!isCjk(text[i])) {
      let j = i + 1;
      while (j < text.length && !isCjk(text[j])) j++;
      out.push({ text: text.slice(i, j), start: i, end: j, isWord: false });
      i = j;
      continue;
    }
    let len = 0;
    for (let l = Math.min(7, text.length - i); l >= 1; l--) {
      if (known(text.slice(i, i + l))) {
        len = l;
        break;
      }
    }
    if (!len) {
      if (isKana(text[i])) {
        let j = i + 1;
        while (j < text.length && isKana(text[j]) && !known(text.slice(j, j + 2)) && !known(text[j])) j++;
        len = j - i;
      } else len = 1;
    }
    const s = text.slice(i, i + len);
    const lemma = forms[s];
    const e = dict[lemma ?? s];
    const kanaOnly = [...s].every(isKana);
    const reading =
      language === "ja"
        ? kanaOnly
          ? undefined
          : (JA_SURFACE[s] ?? (e && !lemma ? e[0] : undefined))
        : (e?.[0] ?? (len === 1 ? ZH_CHAR[s] : undefined));
    out.push({ text: s, start: i, end: i + len, isWord: true, reading, lemma });
    i += len;
  }
  return out;
}

function toEntry(language: Language, word: string): DictEntry | undefined {
  const dict = language === "zh" ? ZH_DICT : JA_DICT;
  const e = dict[word];
  if (!e) return undefined;
  const [reading, senses, tags] = e;
  return {
    headword: word,
    reading,
    senses: senses.split(" | ").map((s) => ({ glosses: s.split("; "), tags: tags ? [tags] : undefined })),
    source: language === "zh" ? "CC-CEDICT" : "JMdict",
    common: true,
    variants: word === "烤鸭" ? ["烤鴨"] : word === "爬山" ? undefined : undefined,
  };
}

// ---------------------------------------------------------------- static catalogue

const LANGS: LanguageInfo[] = LANGUAGES.map(languageInfo);

const MODELS: ModelInfo[] = [
  { provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", reasoning: true, input: ["text", "image"], contextWindow: 200_000 },
  { provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5", reasoning: false, input: ["text", "image"], contextWindow: 200_000 },
  { provider: "anthropic", id: "claude-opus-4-1", name: "Claude Opus 4.1", reasoning: true, input: ["text", "image"], contextWindow: 200_000 },
  { provider: "openai", id: "gpt-5", name: "GPT-5", reasoning: true, input: ["text", "image"], contextWindow: 400_000 },
  { provider: "openai", id: "gpt-5-mini", name: "GPT-5 mini", reasoning: true, input: ["text", "image"], contextWindow: 400_000 },
  { provider: "deepseek", id: "deepseek-chat", name: "DeepSeek V3", reasoning: false, input: ["text"], contextWindow: 128_000 },
];

interface Reply {
  t: string;
  tr: string;
}

/** One canned reply for the languages the mock has no rich data for. */
const MORE_REPLIES: Partial<Record<Language, Reply[]>> = {
  ko: [{ t: "좋네요! 주말에 또 뭐 했어요?", tr: "Nice! What else did you do on the weekend?" }],
  en: [{ t: "That sounds great! What else did you do over the weekend?", tr: "That sounds great! What else did you do over the weekend?" }],
  es: [{ t: "¡Qué bien! ¿Qué más hiciste el fin de semana?", tr: "Great! What else did you do on the weekend?" }],
  fr: [{ t: "Super ! Qu'est-ce que tu as fait d'autre ce week-end ?", tr: "Great! What else did you do this weekend?" }],
  de: [{ t: "Toll! Was hast du am Wochenende sonst noch gemacht?", tr: "Great! What else did you do on the weekend?" }],
  it: [{ t: "Che bello! Cos'altro hai fatto nel fine settimana?", tr: "How nice! What else did you do on the weekend?" }],
  pt: [{ t: "Que legal! O que mais você fez no fim de semana?", tr: "How cool! What else did you do on the weekend?" }],
  ru: [{ t: "Здорово! А что ещё ты делал на выходных?", tr: "Great! What else did you do on the weekend?" }],
  vi: [{ t: "Hay quá! Cuối tuần bạn còn làm gì nữa?", tr: "Great! What else did you do on the weekend?" }],
};

/** A few reading paragraphs for the same languages. */
const MORE_PARAS: Partial<Record<Language, string[]>> = {
  ko: ["가을이 되면 많은 사람들이 산에 올라갑니다.", "산 위에서 보는 경치는 정말 아름답습니다."],
  en: ["In autumn, lots of people go hiking in the hills.", "The view from the top is beautiful."],
  es: ["En otoño, mucha gente sube a la montaña.", "La vista desde arriba es preciosa."],
  fr: ["En automne, beaucoup de gens montent à la montagne.", "La vue d'en haut est magnifique."],
  de: ["Im Herbst wandern viele Leute auf die Berge.", "Die Aussicht von oben ist wunderschön."],
  it: ["In autunno, molte persone vanno in montagna.", "La vista dall'alto è bellissima."],
  pt: ["No outono, muitas pessoas sobem a montanha.", "A vista lá de cima é linda."],
  ru: ["Осенью многие люди ходят в горы.", "Вид сверху очень красивый."],
  vi: ["Vào mùa thu, nhiều người đi leo núi.", "Phong cảnh trên đỉnh núi rất đẹp."],
};

const REPLIES = everyLanguage<Reply[]>({
  zh: [
    { t: "真不错！你们排队排了多久？那家店你会推荐给朋友吗？", tr: "Nice! How long did you queue? Would you recommend that place to friends?" },
    { t: "听起来很好玩。除了烤鸭，你们还点了什么菜？", tr: "Sounds like fun. Besides roast duck, what else did you order?" },
    { t: "下次你想去哪儿爬山？我可以推荐几个地方。", tr: "Where do you want to go hiking next time? I can recommend a few places." },
    { t: "我明白了。你觉得北京的饭馆和你家那边的有什么不一样？", tr: "I see. How are Beijing restaurants different from the ones where you live?" },
  ],
  ja: [
    { t: "いいですね！その山はどうでしたか？行列はありましたか？", tr: "Nice! How was the mountain? Was there a queue?" },
    { t: "楽しそうですね。おすすめのラーメン屋はありますか？", tr: "Sounds fun. Is there a ramen shop you'd recommend?" },
    { t: "なるほど。来週の予定は何ですか？", tr: "I see. What are your plans for next week?" },
  ],
}, (l) => MORE_REPLIES[l] ?? []);

const TRANSLATIONS: Record<string, string> = {
  "欢迎回来！上次你说这个周末想去爬山。你们最后去了吗？": "Welcome back! Last time you said you wanted to go hiking this weekend. Did you end up going?",
  "哇，烤鸭！你对那家饭馆的印象怎么样？": "Wow, roast duck! What did you think of the restaurant?",
  "我们先轻松地聊五分钟。你平时周末喜欢做什么？": "Let's have a relaxed five-minute chat first. What do you usually like to do on weekends?",
  "我们来聊聊你的爱好吧。除了看电影，你平时还喜欢做什么？": "Let's talk about your hobbies. Besides watching movies, what else do you like to do?",
  "我们从第4段开始读吧。读完以后，告诉我你觉得最难的一句。": "Let's start reading from paragraph 4. When you're done, tell me which sentence felt hardest.",
  "こんにちは！週末は何をしましたか？": "Hello! What did you do on the weekend?",
  "いいですね！どの山に登りましたか？ラーメンも食べましたか？": "Nice! Which mountain did you climb? Did you have ramen too?",
  "まず五分ぐらい話しましょう。週末はよく何をしますか？": "Let's talk for about five minutes first. What do you often do on weekends?",
  "你最喜欢的电影是什么？": "What's your favourite movie?",
  "你在大学的生活怎么样？忙吗？": "How is your life at university? Busy?",
  "欢迎！你想点什么菜？": "Welcome! What would you like to order?",
  "好きな映画は何ですか？": "What's your favourite movie?",
  ...Object.fromEntries(Object.values(REPLIES).flat().map((r) => [r.t, r.tr])),
};

// ---------------------------------------------------------------- mutable world

type SessionRec = MockSessionRec;

export function createMockApi(): SayfernApi {
  const T0 = Date.now();

  const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
  /** ?onboarding=1: first run (nothing connected, onboarding not done). */
  const firstRun = params.get("onboarding") === "1";
  /** ?fresh=1: a brand-new learner with no records (empty states). */
  const fresh = firstRun || params.get("fresh") === "1";
  /** ?anki=offline: AnkiConnect unreachable. */
  const ankiOffline = params.get("anki") === "offline";

  let settings: Settings = {
    language: "zh",
    model: { provider: "anthropic", id: "claude-sonnet-4-5" },
    deviceId: "mock-device",
    languages: ["zh", "ja"],
    feedbackMode: "inline",
    autoTranslate: false,
    onboarded: !firstRun,
  };

  const providers: ProviderInfo[] = [
    { id: "anthropic", name: "Anthropic", note: "Claude. Sign in with Pro/Max or use an API key.", canApiKey: true, oauthLabel: "Sign in with Claude Pro/Max", oauthIsSubscription: true, connected: "oauth", connectedVia: "Claude Max" },
    { id: "openai", name: "OpenAI", note: "GPT. Sign in with ChatGPT or use an API key.", canApiKey: true, oauthLabel: "Sign in with ChatGPT", oauthIsSubscription: true, connected: "api_key" },
    { id: "deepseek", name: "DeepSeek", note: "DeepSeek API key.", canApiKey: true, oauthIsSubscription: false, connected: null },
  ];

  let profile: LearnerProfile = {
    about: "Computer science student. Likes hiking, cooking and films.",
    goals: { zh: "Chat comfortably about everyday life", ja: "Read graded readers without a dictionary" },
    name: "Sam",
  };

  const levels: LevelEstimate[] = [
    { language: "zh", skill: "writing", level: "HSK 2", confidence: "low", evidence: "Set by you.", examples: [], at: T0 - 60 * DAY, by: "self" },
    { language: "zh", skill: "reading", level: "HSK 4", confidence: "medium", evidence: "Reads textbook dialogues comfortably and asks about idioms, not basics.", examples: [], at: T0 - 20 * DAY, by: "placement" },
    { language: "zh", skill: "recognition", level: "HSK 4", confidence: "medium", evidence: "Recognises most HSK 4 words in lookups without opening the dictionary.", examples: [], at: T0 - 20 * DAY, by: "placement" },
    { language: "zh", skill: "writing", level: "HSK 3", confidence: "high", evidence: "Uses 除了…还… and 是…的 on their own; 了 placement still slips with 去 + activity.", examples: [], at: T0 - 3 * DAY, by: "observed" },
  ];

  // ---- grammar (counts are derived from observations, like the real RecordsStore)
  const grammar = new Map<string, GrammarPoint>();
  const baseState = new Map<string, GrammarState>();
  type Hist = [daysAgo: number, span: string, verdict: GrammarObservation["verdict"], assistance: GrammarObservation["assistance"], sessionId: string, note?: string];
  const histories: [string, Hist[]][] = [];
  const addPoint = (p: Omit<GrammarPoint, "createdAt" | "updatedAt" | "sources"> & { sources?: GrammarPoint["sources"] }, state: GrammarState, ago: number, hist: Hist[] = []) => {
    grammar.set(p.id, { sources: [], ...p, createdAt: T0 - ago, updatedAt: T0 - DAY });
    baseState.set(p.id, state);
    histories.push([p.id, hist]);
  };
  const IC2 = { kind: "library" as const, docId: "doc-ic2", paragraph: 1, title: "Integrated Chinese 2", quote: "Lesson 12 · 除了…以外，还…" };
  addPoint(
    {
      id: "zh:chule-hai", language: "zh", pattern: "除了…还…", name: "besides A, also B", reading: "chúle… hái…", level: "HSK 3",
      explanation: "Adds B on top of A. 除了 introduces what you already mentioned; 还 comes after the subject and introduces the extra. Swap 还 for 都 and it means except A.",
      examples: [
        { text: "除了爬山，我们还吃了烤鸭。", translation: "Besides hiking, we also had roast duck." },
        { text: "除了中文，她还会说日语。", translation: "Besides Chinese, she also speaks Japanese." },
      ],
      sources: [IC2], introducedAt: T0 - 18 * DAY,
    },
    "independent", 18 * DAY,
    [
      [5, "除了饺子，我们还……", "uncertain", "independent", "s-zh-food", "Unfinished sentence"],
      [8, "除了中文课，我还有三门课。", "correct", "corrected_retry", "s-zh-uni"],
      [8, "除了中文课，还我有三门课。", "incorrect", "independent", "s-zh-uni", "还 goes after the subject"],
      [10, "除了看书，我还喜欢听音乐。", "correct", "prompted", "s-zh-film"],
      [12, "除了电影，我还喜欢运动。", "correct", "independent", "s-zh-film"],
      [14, "除了北京，我还想去上海。", "correct", "independent", "s-zh-film"],
      [15, "除了吃饭，还做什么", "unassessed", "prompted", "s-zh-food"],
      [16, "除了上课，我还很忙。", "correct", "independent", "s-zh-uni"],
      [17, "除了老师，同学们还……", "unassessed", "prompted", "s-zh-uni"],
    ],
  );
  addPoint(
    { id: "zh:le-completion", language: "zh", pattern: "了", name: "completed action", reading: "le", level: "HSK 2", explanation: "Marks that an action is complete. With 去 plus an activity, 了 goes after the whole phrase.", examples: [{ text: "我们去爬山了。", translation: "We went hiking." }, { text: "我吃了两个饺子。", translation: "I ate two dumplings." }], introducedAt: T0 - 40 * DAY },
    "with_help", 40 * DAY,
    [
      [5, "我今天上了三个课。", "correct", "independent", "s-zh-uni"],
      [8, "我们点了烤鸭。", "correct", "prompted", "s-zh-food"],
      [10, "我看了那个电影两次。", "correct", "independent", "s-zh-film"],
      [11, "我去了看电影。", "incorrect", "independent", "s-zh-film"],
    ],
  );
  addPoint(
    { id: "zh:yinwei-suoyi", language: "zh", pattern: "因为…所以…", name: "because… so…", reading: "yīnwèi… suǒyǐ…", level: "HSK 2", explanation: "Links a cause and its result. In speech you can drop either half.", examples: [{ text: "因为下雨，所以我们没去。", translation: "Because it rained, we didn't go." }], introducedAt: T0 - 5 * DAY },
    "introduced", 5 * DAY,
    [[5, "因为很忙，所以我没去。", "correct", "prompted", "s-zh-uni"]],
  );
  addPoint(
    { id: "zh:bi-comparison", language: "zh", pattern: "A 比 B + adj", name: "comparisons with 比", reading: "bǐ", level: "HSK 2", explanation: "Compares two things. The adjective comes last, with no 很 in front of it.", examples: [{ text: "北京比上海冷。", translation: "Beijing is colder than Shanghai." }] },
    "with_help", 12 * DAY,
    [
      [3, "这家店比那家好吃。", "correct", "prompted", "s-zh-food"],
      [8, "北京比上海很冷。", "incorrect", "independent", "s-zh-food"],
      [12, "我比我哥哥高。", "correct", "independent", "s-zh-film"],
    ],
  );
  addPoint(
    { id: "zh:yuelaiyue", language: "zh", pattern: "越来越", name: "more and more", reading: "yuè lái yuè", level: "HSK 3", explanation: "Shows a change that keeps growing. Put it right before the adjective or verb.", examples: [{ text: "天气越来越冷了。", translation: "The weather is getting colder and colder." }], introducedAt: T0 - 9 * DAY },
    "with_help", 9 * DAY,
    [[4, "我的中文越来越好了。", "correct", "prompted", "s-zh-uni"], [9, "越来越我喜欢。", "incorrect", "independent", "s-zh-film"]],
  );
  addPoint(
    { id: "zh:ba", language: "zh", pattern: "把", name: "disposal construction", reading: "bǎ", level: "HSK 3", explanation: "Moves the object before the verb to say what happens to it. The verb needs something after it, like 了 or a result.", examples: [{ text: "我把作业做完了。", translation: "I finished my homework." }], introducedAt: T0 - 3 * DAY },
    "introduced", 3 * DAY,
  );
  addPoint(
    { id: "zh:suiran-danshi", language: "zh", pattern: "虽然…但是…", name: "although…, but…", reading: "suīrán… dànshì…", level: "HSK 2", explanation: "Concedes one thing and contrasts it with another. Unlike English, Chinese uses both words.", examples: [{ text: "虽然很累，但是很开心。", translation: "Although tired, we were happy." }], introducedAt: T0 - 20 * DAY },
    "with_help", 20 * DAY,
    [[6, "虽然排队很久，但是很好吃。", "correct", "prompted", "s-zh-food"]],
  );
  addPoint(
    { id: "zh:yi-jiu", language: "zh", pattern: "一…就…", name: "as soon as…", reading: "yī… jiù…", level: "HSK 3", explanation: "The second action happens right after the first.", examples: [{ text: "我一到家就睡觉了。", translation: "I went to sleep as soon as I got home." }], introducedAt: T0 - 2 * DAY },
    "introduced", 2 * DAY,
  );
  addPoint(
    { id: "zh:shi-de", language: "zh", pattern: "是…的", name: "focus on details", reading: "shì… de", level: "HSK 2", explanation: "Highlights when, where or how a past action happened.", examples: [{ text: "我是坐火车来的。", translation: "I came by train." }] },
    "independent", 50 * DAY,
    [[7, "我是去年开始学的。", "correct", "independent", "s-zh-uni"], [13, "这个电影是朋友推荐的。", "correct", "independent", "s-zh-film"], [20, "我是在北京吃的。", "correct", "independent", "s-zh-food"]],
  );
  addPoint(
    { id: "ja:te-iru", language: "ja", pattern: "〜ている", name: "ongoing action or state", reading: "ている", level: "N5", explanation: "Describes an action in progress or a resulting state. With と, it sets the scene for something unexpected: せんたくをしていると…", examples: [{ text: "今、本を読んでいます。", translation: "I'm reading a book now." }], sources: [{ kind: "library", docId: "doc-momo", paragraph: 2, title: "ももたろう", quote: "おばあさんが川でせんたくをしていると" }] },
    "with_help", 15 * DAY,
    [[2, "今、ももたろうを読んでいます。", "correct", "prompted", "s-ja-weekend"], [6, "毎日日本語を勉強している。", "correct", "independent", "s-ja-film"], [9, "映画を見ていました。", "uncertain", "independent", "s-ja-film"]],
  );
  addPoint(
    { id: "ja:i-adj-past", language: "ja", pattern: "〜かった", name: "past tense of い-adjectives", reading: "かった", level: "N5", explanation: "い-adjectives conjugate themselves: 楽しい becomes 楽しかった. Add です for politeness.", examples: [{ text: "とても楽しかったです。", translation: "It was a lot of fun." }] },
    "with_help", 9 * DAY,
    [[6, "映画はおもしろかったです。", "correct", "prompted", "s-ja-film"]],
  );
  addPoint(
    { id: "ja:tai", language: "ja", pattern: "〜たい", name: "want to", reading: "たい", level: "N5", explanation: "Attach to the verb stem to say what you want to do.", examples: [{ text: "山に登りたいです。", translation: "I want to climb a mountain." }] },
    "independent", 20 * DAY,
    [[2, "富士山に登りたいです。", "correct", "independent", "s-ja-weekend"], [6, "もっと映画を見たい。", "correct", "independent", "s-ja-film"]],
  );
  addPoint(
    { id: "ja:te-kara", language: "ja", pattern: "〜てから", name: "after doing", reading: "てから", level: "N5", explanation: "Joins two actions in order: do A, then B.", examples: [{ text: "ご飯を食べてから、出かけます。", translation: "I'll go out after eating." }], introducedAt: T0 - 4 * DAY },
    "introduced", 4 * DAY,
  );

  const observations: GrammarObservation[] = [];
  const corrections = new Map<string, Correction>();
  const usage = new Map<string, WordUsage>(); // key lang:word
  const savedWords: SavedWord[] = [
    { id: "w-1", language: "zh", word: "风景", reading: "fēngjǐng", definition: "scenery; landscape", sentence: "山上的风景特别美。", source: { kind: "library", docId: "doc-ic2", paragraph: 0, title: "Integrated Chinese 2" }, createdAt: T0 - DAY },
    { id: "w-2", language: "zh", word: "印象", reading: "yìnxiàng", definition: "impression", sentence: "哇，烤鸭！你对那家饭馆的印象怎么样？", source: { kind: "session", sessionId: "s-zh-weekend", messageId: "m-zh1-3" }, createdAt: T0 - 2 * HOUR },
    { id: "w-3", language: "zh", word: "排队", reading: "páiduì", definition: "to queue; to line up", sentence: "饭馆门口有很多人排队，我们排了一个小时。", source: { kind: "library", docId: "doc-ic2", paragraph: 2, title: "Integrated Chinese 2" }, createdAt: T0 - 3 * DAY },
    { id: "w-4", language: "ja", word: "どんぶらこ", definition: "(sound of something bobbing in water)", sentence: "大きな桃が、どんぶらこ、どんぶらこと流れてきました。", source: { kind: "library", docId: "doc-momo", paragraph: 2, title: "ももたろう" }, createdAt: T0 - 2 * DAY },
    { id: "w-5", language: "ja", word: "宝物", reading: "たからもの", definition: "treasure", sentence: "みんなの宝物を取っていきました。", source: { kind: "library", docId: "doc-momo", paragraph: 8, title: "ももたろう" }, createdAt: T0 - 2 * DAY },
  ];

  // ---- anki
  const ankiCards = everyLanguage<AnkiCard[]>({
    zh: [
      { cardId: 1, noteId: 11, deck: "Chinese::HSK3", word: "爬山", reading: "pá shān", meaning: "to go hiking", interval: 5, ease: 2500, lapses: 0, reps: 4, lastReviewAt: T0 - 5 * DAY, lastEase: 3 },
      { cardId: 2, noteId: 12, deck: "Chinese::HSK3", word: "烤鸭", reading: "kǎoyā", meaning: "roast duck", interval: 3, ease: 2300, lapses: 1, reps: 12, lastReviewAt: T0 - DAY, lastEase: 3 },
      { cardId: 3, noteId: 13, deck: "Chinese::HSK3", word: "印象", reading: "yìnxiàng", meaning: "impression", interval: 2, ease: 2100, lapses: 3, reps: 9, lastReviewAt: T0 - DAY, lastEase: 1 },
      { cardId: 4, noteId: 14, deck: "Chinese::HSK4", word: "推荐", reading: "tuījiàn", meaning: "to recommend", interval: 1, ease: 2500, lapses: 0, reps: 2, lastReviewAt: T0 - DAY, lastEase: 3 },
      { cardId: 5, noteId: 15, deck: "Chinese::HSK3", word: "排队", reading: "páiduì", meaning: "to queue", interval: 4, ease: 2200, lapses: 2, reps: 7, lastReviewAt: T0 - 2 * DAY, lastEase: 2 },
    ],
    ja: [
      { cardId: 21, noteId: 31, deck: "Japanese::Core", word: "行列", reading: "ぎょうれつ", meaning: "queue", interval: 3, ease: 2400, lapses: 1, reps: 6 },
      { cardId: 22, noteId: 32, deck: "Japanese::Core", word: "美味しい", reading: "おいしい", meaning: "delicious", interval: 12, ease: 2600, lapses: 0, reps: 8 },
      { cardId: 23, noteId: 33, deck: "Japanese::Core", word: "予定", reading: "よてい", meaning: "plan", interval: 2, ease: 2200, lapses: 2, reps: 5 },
    ],
  }, () => []);
  let ankiConfig: AnkiConfig = {
    enabled: true,
    url: "http://127.0.0.1:8765",
    decks: [
      { language: "zh", deck: "Chinese::HSK3", wordField: "Hanzi", readingField: "Pinyin", meaningField: "English" },
      { language: "ja", deck: "Japanese::Core", wordField: "Expression", readingField: "Reading", meaningField: "Meaning" },
    ],
  };
  const ANKI_FIELDS: Record<string, string[]> = {
    "Chinese::HSK3": ["Hanzi", "Pinyin", "English", "Audio"],
    "Chinese::HSK4": ["Hanzi", "Pinyin", "English", "Audio"],
    "Japanese::Core": ["Expression", "Reading", "Meaning", "Sentence"],
    Default: ["Front", "Back"],
  };
  const ankiSyncedAt = everyLanguage<number>({ zh: T0 - 2 * MIN, ja: T0 - 3 * HOUR }, () => T0 - HOUR);
  const freshTargets = (l: Language): PracticeTarget[] =>
    ankiCards[l].map((c) => ({ word: c.word, reading: c.reading, meaning: c.meaning, reason: c.lapses > 1 ? "difficult" : "recent", cardId: c.cardId, status: "pending" }));

  // ---- dictionaries
  const dictInstalled = everyLanguage<boolean>({ zh: true, ja: false }, () => false);
  const dictProgressSubs = new Set<(p: DictionaryProgress) => void>();
  const dictStatus = (l: Language): DictionaryStatus =>
    l !== "zh" && l !== "ja"
      ? { language: l, name: `WikDict ${LANGUAGE_META[l].name}`, license: "CC BY-SA 3.0", installed: dictInstalled[l], entries: dictInstalled[l] ? 48_000 : undefined, version: "2026-09-01", downloadMb: 12 }
      : l === "zh"
      ? { language: "zh", name: "CC-CEDICT", license: "CC BY-SA 4.0", installed: dictInstalled.zh, entries: dictInstalled.zh ? 124_312 : undefined, version: "2026-09-01", downloadMb: 9 }
      : { language: "ja", name: "JMdict", license: "CC BY-SA 4.0", installed: dictInstalled.ja, entries: dictInstalled.ja ? 213_004 : undefined, version: "2026-09-15", downloadMb: 22 };

  // ---- library
  const docs: LibraryDoc[] = [
    { id: "doc-ic2", language: "zh", title: "Integrated Chinese 2", kind: "textbook", format: "pdf", addedAt: T0 - 60 * DAY, paragraphCount: 480, charCount: 96_000, checkpoint: { paragraph: 3, offset: 0, at: T0 - DAY }, warnings: [] },
    { id: "doc-xwz", language: "zh", title: "小王子", kind: "reader", format: "epub", addedAt: T0 - 20 * DAY, paragraphCount: 910, charCount: 38_000, checkpoint: { paragraph: 212, offset: 0, at: T0 - 6 * DAY }, warnings: [] },
    { id: "doc-zh-me", language: "zh", title: "关于我", kind: "personal", format: "md", addedAt: T0 - 58 * DAY, paragraphCount: 6, charCount: 240, warnings: [] },
    { id: "doc-scan", language: "zh", title: "HSK 4 workbook (scan)", kind: "other", format: "pdf", addedAt: T0 - 2 * DAY, paragraphCount: 0, charCount: 0, warnings: ["No text layer found: scanned PDFs need OCR, which isn't supported yet."] },
    { id: "doc-momo", language: "ja", title: "ももたろう", kind: "reader", format: "epub", addedAt: T0 - 9 * DAY, paragraphCount: 23, charCount: 1_150, checkpoint: { paragraph: 7, offset: 0, at: T0 - 2 * DAY }, warnings: [] },
    { id: "doc-genki", language: "ja", title: "Genki II notes", kind: "textbook", format: "md", addedAt: T0 - 40 * DAY, paragraphCount: 220, charCount: 31_000, checkpoint: { paragraph: 17, offset: 0, at: T0 - 3 * DAY }, warnings: [] },
    { id: "doc-ja-me", language: "ja", title: "About me", kind: "personal", format: "txt", addedAt: T0 - 30 * DAY, paragraphCount: 4, charCount: 180, warnings: [] },
    { id: "doc-nhk", language: "ja", title: "NHK Easy: 秋の山", kind: "other", format: "html", addedAt: T0 - 4 * DAY, paragraphCount: 12, charCount: 1_900, warnings: [] },
  ];
  // [heading, text] rows. A heading row starts a section.
  const MOMO: [string | null, string][] = [
    ["第一話　川から来た桃", "むかしむかし、ある村に、おじいさんとおばあさんが住んでいました。"],
    [null, "おじいさんは山へしばかりに、おばあさんは川へせんたくに行きました。"],
    [null, "おばあさんが川でせんたくをしていると、大きな桃が、どんぶらこ、どんぶらこと流れてきました。"],
    [null, "「まあ、なんて大きな桃でしょう。」おばあさんは桃を家に持って帰りました。"],
    [null, "夜になって、おじいさんが山から帰ってきました。"],
    [null, "二人が桃を切ろうとすると、桃がぱかっと割れて、中から元気な男の子が出てきました。"],
    [null, "「桃から生まれたから、桃太郎という名前にしよう。」"],
    ["第二話　鬼ヶ島へ", "桃太郎はすくすくと大きくなり、とても強い子になりました。"],
    [null, "ある日、村に悪い鬼が来て、みんなの宝物を取っていきました。"],
    [null, "「ぼくが鬼ヶ島へ行って、鬼をたいじしてきます。」と桃太郎は言いました。"],
    [null, "おばあさんは、日本一のきびだんごを作ってくれました。"],
    [null, "道で、犬に会いました。「桃太郎さん、どこへ行くのですか。」"],
    [null, "「鬼ヶ島へ、鬼たいじに行くんだ。」"],
    [null, "「おこしにつけたきびだんご、一つわたしにください。お供します。」"],
    [null, "次に猿に会い、それからきじにも会いました。"],
    ["第三話　鬼たいじ", "みんなで船に乗って、鬼ヶ島に着きました。"],
    [null, "きじは空から、猿はかべをのぼって、犬は門をかみました。"],
    [null, "鬼たちはびっくりして、「ごめんなさい。もう悪いことはしません。」と言いました。"],
    [null, "桃太郎たちは宝物を持って、村に帰りました。"],
    [null, "おじいさんとおばあさんは、とても喜びました。"],
    [null, "それから、みんなは村でしあわせに暮らしました。"],
    [null, "めでたし、めでたし。"],
    [null, "おわり"],
  ];
  const IC2_TEXT: [string | null, string][] = [
    [null, "上个周末，我和朋友一起去爬山了。山上的风景特别美。"],
    [null, "除了爬山以外，我们还去了一家很有名的饭馆吃烤鸭。"],
    [null, "饭馆门口有很多人排队，我们排了一个小时。"],
    [null, "服务员给我们推荐了几个菜，每个菜都很好吃。"],
    [null, "吃完饭以后，我们在公园里散步，聊了很多大学生活的事。"],
    [null, "王朋说：“下次我们去北京，一定要再吃一次烤鸭。”"],
    [null, "李友笑着说：“你除了吃，还想做什么？”"],
    [null, "大家都笑了。那天我们玩得非常开心。"],
  ];
  const TEXTS: Record<string, [string | null, string][]> = {
    "doc-momo": MOMO,
    "doc-ic2": IC2_TEXT,
    "doc-xwz": [
      [null, "六岁的时候，我在一本书上看到了一幅很美的画。"],
      [null, "大人们总是需要解释，小孩子总是给他们解释，真累。"],
      [null, "“请你……给我画一只羊吧！”"],
      [null, "我吃了一惊，站了起来，用力揉了揉眼睛。"],
    ],
    "doc-zh-me": [
      [null, "我叫Sam，是计算机专业的学生。"],
      [null, "我喜欢爬山、做饭和看电影。"],
      [null, "明年夏天我想去北京学中文。"],
    ],
    "doc-ja-me": [[null, "私はコンピューターサイエンスの学生です。"], [null, "山に登るのが好きです。"]],
  };
  const PARAS = everyLanguage<string[]>({
    zh: IC2_TEXT.map((r) => r[1]),
    ja: [
      "秋になると、たくさんの人が山に登ります。",
      "山の上から見る景色はとてもきれいです。",
      "有名なラーメン屋の前には、長い行列ができていました。",
      "週末の予定を友達と話しました。",
    ],
  }, (l) => MORE_PARAS[l] ?? []);
  const paragraphOf = (doc: LibraryDoc, index: number): LibraryParagraph => {
    const rows = TEXTS[doc.id] ?? PARAS[doc.language].map((t): [string | null, string] => [null, t]);
    const exact = doc.paragraphCount <= rows.length;
    const row = rows[index % rows.length];
    let heading: string | undefined;
    if (exact) {
      for (let i = index; i >= 0; i--) if (rows[i][0]) { heading = rows[i][0]!; break; }
    } else heading = doc.language === "zh" ? `第${12 + Math.floor(index / 40)}课` : `Lesson ${12 + Math.floor(index / 40)}`;
    return { docId: doc.id, index, text: row[1], heading };
  };
  let importCount = 0;

  // ---- sessions
  const sessions = new Map<string, SessionRec>();
  const mkMeta = (p: Partial<SessionMeta> & Pick<SessionMeta, "id" | "language" | "title">): SessionMeta => ({
    kind: "chat",
    createdAt: T0,
    updatedAt: T0,
    feedbackMode: settings.feedbackMode ?? "inline",
    activeMs: 0,
    usage: { input: 0, output: 0, cost: 0 },
    ...p,
  });
  const tutorMsg = (sessionId: string, id: string, text: string, at: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
    id,
    sessionId,
    role: "tutor",
    text,
    at,
    model: "anthropic/claude-sonnet-4-5",
    usage: { input: 1100 + (text.length % 7) * 60, output: text.length * 4, cost: 0.004 + text.length * 0.00004 },
    ...extra,
  });
  const userMsg = (sessionId: string, id: string, text: string, at: number): ChatMessage => ({ id, sessionId, role: "user", text, at });

  // The wireframe conversation: 周末计划
  {
    const id = "s-zh-weekend";
    const at = T0 - 2 * HOUR;
    const messages: ChatMessage[] = [
      tutorMsg(id, "m-zh1-1", "欢迎回来！上次你说这个周末想去爬山。你们最后去了吗？", at - 6 * MIN, {
        toolActivity: [{ name: "anki_lookup", summary: "Picked 5 Anki words to weave in", ok: true }],
        usage: { input: 1240, output: 96, cost: 0.0052 },
      }),
      userMsg(id, "m-zh1-2", "我们昨天去了爬山！除了爬山，我们还吃了很有名的烤鸭。", at - 4 * MIN),
      tutorMsg(id, "m-zh1-3", "哇，烤鸭！你对那家饭馆的印象怎么样？", at - 3 * MIN, {
        toolActivity: [
          { name: "record_evidence", summary: "Logged 2 observations", ok: true },
          { name: "record_evidence", summary: "Logged 1 correction", ok: true },
          { name: "search_library", summary: "Searched library: 除了", ok: true },
        ],
        sources: [{ kind: "library", docId: "doc-ic2", paragraph: 11, title: "Integrated Chinese 2", quote: "L12 · 除了…以外，还…" }],
        usage: { input: 1410, output: 374, cost: 0.0161 },
      }),
    ];
    sessions.set(id, {
      meta: mkMeta({ id, language: "zh", title: "周末计划", createdAt: T0 - 3 * DAY, updatedAt: at - 3 * MIN, activeMs: 18 * MIN, usage: { input: 2650, output: 470, cost: 0.0213 } }),
      messages,
      targets: freshTargets("zh").map((t) => ({ ...t, status: t.word === "爬山" || t.word === "烤鸭" ? "used" : t.word === "印象" ? "asked" : "pending" })),
      grammarIds: ["zh:chule-hai", "zh:le-completion"],
      replyIdx: 0,
    });
    corrections.set("c-zh1-1", {
      id: "c-zh1-1",
      language: "zh",
      sessionId: id,
      messageId: "m-zh1-2",
      original: "去了爬山",
      corrected: "去爬山了",
      explanation: "With 去 plus an activity, 了 closes the whole phrase: 去爬山了.",
      kind: "grammar",
      grammarId: "zh:le-completion",
      createdAt: at - 3 * MIN,
      status: "open",
      retries: [],
    });
    observations.push(
      { id: "o-zh1-1", grammarId: "zh:chule-hai", language: "zh", sessionId: id, messageId: "m-zh1-2", span: "除了爬山，我们还吃了很有名的烤鸭", verdict: "correct", assistance: "independent", at: at - 4 * MIN },
      { id: "o-zh1-2", grammarId: "zh:le-completion", language: "zh", sessionId: id, messageId: "m-zh1-2", span: "去了爬山", verdict: "incorrect", assistance: "independent", at: at - 4 * MIN },
    );
    for (const [w, sentence] of [["爬山", "我们昨天去了爬山！"], ["烤鸭", "除了爬山，我们还吃了很有名的烤鸭。"]])
      usage.set(`zh:${w}`, { word: w, language: "zh", count: 1, firstUsedAt: at - 4 * MIN, firstSessionId: id, firstMessageId: "m-zh1-2", firstSentence: sentence });
  }

  const simple = (id: string, language: Language, title: string, daysAgo: number, lines: [string, string], extra: Partial<SessionMeta> = {}) => {
    const at = T0 - daysAgo * DAY;
    sessions.set(id, {
      meta: mkMeta({ id, language, title, createdAt: at - 30 * MIN, updatedAt: at, endedAt: at, activeMs: (12 + daysAgo) * MIN, usage: { input: 5200, output: 900, cost: 0.031 }, ...extra }),
      messages: [tutorMsg(id, `${id}-1`, lines[0], at - 20 * MIN), userMsg(id, `${id}-2`, lines[1], at - 18 * MIN)],
      targets: [],
      grammarIds: [],
      replyIdx: 1,
    });
  };
  simple("s-zh-uni", "zh", "我的大学生活", 5, ["你在大学的生活怎么样？忙吗？", "很忙！我每天都上课，可是周末有时间和同学一起玩。"]);
  simple("s-zh-food", "zh", "在饭馆点菜", 8, ["欢迎！你想点什么菜？", "我想看看菜单。你们有什么特别好吃的菜？"]);
  simple("s-zh-film", "zh", "最喜欢的电影", 10, ["你最喜欢的电影是什么？", "我最喜欢的电影是《千与千寻》，因为很有意思。"]);

  {
    const id = "s-ja-weekend";
    const at = T0 - 2 * DAY;
    sessions.set(id, {
      meta: mkMeta({ id, language: "ja", title: "週末の予定", createdAt: at - 40 * MIN, updatedAt: at, activeMs: 11 * MIN, usage: { input: 3100, output: 520, cost: 0.019 } }),
      messages: [
        tutorMsg(id, "m-ja1-1", "こんにちは！週末は何をしましたか？", at - 12 * MIN),
        userMsg(id, "m-ja1-2", "友達と一緒に山に登りました。とても楽しいでした。", at - 10 * MIN),
        tutorMsg(id, "m-ja1-3", "いいですね！どの山に登りましたか？ラーメンも食べましたか？", at - 9 * MIN, {
          toolActivity: [{ name: "record_evidence", summary: "Logged 1 correction", ok: true }],
        }),
      ],
      targets: freshTargets("ja"),
      grammarIds: ["ja:i-adj-past"],
      replyIdx: 0,
    });
    corrections.set("c-ja1-1", {
      id: "c-ja1-1",
      language: "ja",
      sessionId: id,
      messageId: "m-ja1-2",
      original: "楽しいでした",
      corrected: "楽しかったです",
      explanation: "い-adjectives carry their own past tense: 楽しかった, then です for politeness.",
      kind: "grammar",
      grammarId: "ja:i-adj-past",
      createdAt: at - 9 * MIN,
      status: "open",
      retries: [],
    });
    observations.push({ id: "o-ja1-1", grammarId: "ja:i-adj-past", language: "ja", sessionId: id, messageId: "m-ja1-2", span: "楽しいでした", verdict: "incorrect", assistance: "independent", at: at - 10 * MIN });
  }
  simple("s-ja-film", "ja", "好きな映画", 6, ["好きな映画は何ですか？", "私はジブリの映画が好きです。"]);
  {
    const id = "s-ja-momo";
    const at = T0 - 2 * DAY + 3 * HOUR;
    sessions.set(id, {
      meta: mkMeta({ id, language: "ja", title: "ももたろうを読む", kind: "reading", docId: "doc-momo", createdAt: at - 30 * MIN, updatedAt: at, activeMs: 16 * MIN, usage: { input: 4100, output: 610, cost: 0.024 } }),
      messages: [
        tutorMsg(id, "m-momo-1", "「せんたくをしていると」の「と」は、ここでどんな意味だと思いますか？", at - 14 * MIN, {
          sources: [{ kind: "library", docId: "doc-momo", paragraph: 2, title: "ももたろう", quote: "おばあさんが川でせんたくをしていると" }],
        }),
        userMsg(id, "m-momo-2", "「しているとき」みたいな意味ですか？", at - 12 * MIN),
        tutorMsg(id, "m-momo-3", "近いです！「していると」は「しているとき」に似ていますが、次に何かびっくりすることが起きます。桃が流れてきましたね。", at - 11 * MIN, {
          toolActivity: [{ name: "search_library", summary: "Searched library: 〜と", ok: true }, { name: "record_evidence", summary: "Logged 1 observation", ok: true }],
          sources: [{ kind: "library", docId: "doc-genki", paragraph: 17, title: "Genki II notes", quote: "〜と (when…, and then)" }],
        }),
      ],
      targets: [],
      grammarIds: ["ja:te-iru"],
      replyIdx: 1,
    });
  }

  // Materialize the authored grammar histories (spread over the day so the timeline has times).
  histories.forEach(([gid, hist], gi) => {
    const lang = grammar.get(gid)!.language;
    hist.forEach(([daysAgo, span, verdict, assistance, sessionId, note], i) => {
      observations.push({ id: `o-${gi}-${i}`, grammarId: gid, language: lang, sessionId, messageId: `${sessionId}-2`, span, verdict, assistance, note, at: T0 - daysAgo * DAY - (i + 1) * 37 * MIN });
    });
  });
  {
    const o = observations.find((x) => x.span === "这个电影是朋友推荐的。");
    if (o) o.disputed = { note: "This sounds natural to me. My teacher uses it the same way.", at: T0 - 12 * DAY, originalVerdict: "incorrect" };
  }
  corrections.set("c-zh-uni-1", {
    id: "c-zh-uni-1", language: "zh", sessionId: "s-zh-uni", messageId: "s-zh-uni-2", original: "还我有", corrected: "我还有",
    explanation: "还 goes after the subject: 我还有.", kind: "grammar", grammarId: "zh:chule-hai", createdAt: T0 - 8 * DAY, status: "retried_ok",
    retries: [{ text: "除了中文课，我还有三门课。", ok: true, at: T0 - 8 * DAY + MIN }],
  });
  corrections.set("c-zh-film-1", {
    id: "c-zh-film-1", language: "zh", sessionId: "s-zh-film", messageId: "s-zh-film-2", original: "去了看电影", corrected: "去看电影了",
    explanation: "With 去 plus an activity, 了 closes the whole phrase.", kind: "grammar", grammarId: "zh:le-completion", createdAt: T0 - 11 * DAY, status: "revealed", retries: [],
  });

  // Older first-used words so lookups show history; a few stay unused so new ones light up.
  const NEVER_USED = new Set(["排队", "推荐", "印象", "小时", "特别", "多久", "不一样", "轻松", "服务员", "菜单", "听起来", "好玩", "行列", "予定", "美味しい"]);
  const oldWords: [Language, string][] = [
    ...Object.keys(ZH_DICT).map((w): [Language, string] => ["zh", w]),
    ...Object.keys(JA_DICT).map((w): [Language, string] => ["ja", w]),
  ];
  oldWords.forEach(([l, w], i) => {
    if (NEVER_USED.has(w) || usage.has(`${l}:${w}`)) return;
    const sid = l === "zh" ? "s-zh-film" : "s-ja-film";
    const pool = [...Object.values(TEXTS).flat().map((r) => r[1]), ...PARAS[l]].filter((t) => /[぀-ヿ]/.test(t) === (l === "ja"));
    const firstSentence = pool.find((t) => t.includes(w)) ?? "";
    usage.set(`${l}:${w}`, { word: w, language: l, count: 3 + (i % 9), firstUsedAt: T0 - (8 + (i % 50)) * DAY, firstSessionId: sid, firstMessageId: `${sid}-2`, firstSentence });
  });
  // This week's first uses, with the learner's own sentences.
  const RECENT: [Language, string, number, string][] = [
    ["zh", "风景", 1, "山上的风景特别美，我拍了很多照片。"],
    ["zh", "散步", 2, "吃完饭以后，我们去公园散步了。"],
    ["zh", "公园", 2, "吃完饭以后，我们去公园散步了。"],
    ["zh", "开心", 3, "那天我玩得非常开心。"],
    ["zh", "一定", 4, "下次我一定要再去那家店。"],
    ["zh", "大家", 6, "大家都喜欢吃烤鸭。"],
    ["ja", "宝物", 2, "桃太郎は宝物を持って村に帰りました。"],
    ["ja", "強い", 2, "桃太郎はとても強いです。"],
    ["ja", "元気", 5, "おばあさんはいつも元気です。"],
  ];
  RECENT.forEach(([l, w, d, sentence], i) =>
    usage.set(`${l}:${w}`, { word: w, language: l, count: 1 + (i % 3), firstUsedAt: T0 - d * DAY + i * MIN, firstSessionId: l === "zh" ? "s-zh-uni" : "s-ja-momo", firstMessageId: "x", firstSentence: sentence }),
  );

  // ---- helpers
  const summarize = (gid: string): GrammarSummary => {
    const point = grammar.get(gid)!;
    const counts: GrammarCounts = { correct: 0, incorrect: 0, uncertain: 0, unassessed: 0 };
    let lastUsedAt: number | undefined;
    // Stage 2: quiz evidence is counted apart (see summarizeGrammar in core/records/grammar.ts).
    const quiz: GrammarCounts = { correct: 0, incorrect: 0, uncertain: 0, unassessed: 0 };
    let quizAt = 0;
    for (const o of observations) {
      if (o.grammarId !== gid) continue;
      if (o.origin === "quiz") {
        quiz[o.verdict]++;
        quizAt = Math.max(quizAt, o.at);
        continue;
      }
      counts[o.verdict]++;
      lastUsedAt = Math.max(lastUsedAt ?? 0, o.at);
    }
    const assessed = counts.correct + counts.incorrect;
    const qa = quiz.correct + quiz.incorrect;
    return {
      point: clone(point),
      state: baseState.get(gid)!,
      counts,
      rate: assessed ? counts.correct / assessed : null,
      lastUsedAt,
      ...(quizAt ? { quiz: { counts: quiz, rate: qa ? quiz.correct / qa : null, lastAt: quizAt } } : {}),
    };
  };

  const view = (id: string): SessionView => {
    const s = sessions.get(id)!;
    const gids = new Set(s.grammarIds);
    if (s.meta.focusGrammarId) gids.add(s.meta.focusGrammarId);
    return clone({
      meta: s.meta,
      messages: s.messages,
      corrections: [...corrections.values()].filter((c) => c.sessionId === id),
      targets: s.targets,
      grammarInPlay: [...gids].filter((g) => grammar.has(g)).map(summarize),
      doc: s.meta.docId ? docs.find((d) => d.id === s.meta.docId) : undefined,
    });
  };

  const listFor = (l: Language) => [...sessions.values()].filter((s) => s.meta.language === l).map((s) => clone(s.meta)).sort((a, b) => b.updatedAt - a.updatedAt);

  const createSession = (opts: NewSessionOptions, title: string, opener?: string): SessionView => {
    const id = uid("s");
    const now = Date.now();
    const rec: SessionRec = {
      meta: mkMeta({ id, language: opts.language, title, kind: opts.kind ?? "chat", createdAt: now, updatedAt: now, focusGrammarId: opts.focusGrammarId, docId: opts.docId, feedbackMode: settings.feedbackMode ?? "inline" }),
      messages: [],
      targets: ankiConfig.enabled ? freshTargets(opts.language) : [],
      grammarIds: opts.focusGrammarId ? [opts.focusGrammarId] : [],
      replyIdx: 0,
    };
    if (opener) rec.messages.push(tutorMsg(id, uid("m"), opener, now, { usage: { input: 980, output: opener.length * 4, cost: 0.004 } }));
    sessions.set(id, rec);
    return view(id);
  };

  // ---- chat simulation
  const chatSubs = new Set<(e: ChatEvent) => void>();
  const emit = (e: ChatEvent) => chatSubs.forEach((cb) => cb(clone(e)));
  const running = new Map<string, { timers: number[]; sessionId: string; text: string; finished: boolean }>();

  const CORRECTION_RULES = everyLanguage<{ re: RegExp; make(m: RegExpMatchArray): Omit<Correction, "id" | "language" | "sessionId" | "messageId" | "createdAt" | "status" | "retries"> }[]>({
    zh: [
      {
        re: /去了([一-鿿]{2})/,
        make: (m) => ({ original: m[0], corrected: `去${m[1]}了`, explanation: `With 去 plus an activity, 了 closes the whole phrase: 去${m[1]}了.`, kind: "grammar", grammarId: "zh:le-completion" }),
      },
      {
        re: /很好吃/,
        make: () => ({ original: "很好吃", corrected: "特别好吃", explanation: "很好吃 is correct. 特别好吃 sounds livelier when you're telling a story.", kind: "style" }),
      },
      {
        re: /比([一-鿿]{1,3})很([一-鿿])/,
        make: (m) => ({ original: m[0], corrected: `比${m[1]}${m[2]}`, explanation: "Comparisons with 比 don't take 很 before the adjective.", kind: "grammar", grammarId: "zh:bi-comparison" }),
      },
    ],
    ja: [
      {
        re: /([一-鿿]+)いでした/,
        make: (m) => ({ original: m[0], corrected: `${m[1]}かったです`, explanation: `い-adjectives carry their own past tense: ${m[1]}かった, then です.`, kind: "grammar", grammarId: "ja:i-adj-past" }),
      },
    ],
  }, () => []);

  const send: SayfernApi["send"] = async (sessionId, input, model) => {
    await wait(40);
    const s = sessions.get(sessionId);
    if (!s) throw new Error("Session not found");
    const requestId = uid("r");
    const lang = s.meta.language;
    const now = Date.now();
    const user = userMsg(sessionId, uid("m"), input.text, now);
    if (input.pastedSpans?.length) user.pastedSpans = input.pastedSpans;
    if (input.spoken) user.spoken = true;
    s.messages.push(user);
    if (s.meta.title === "New session") s.meta.title = input.text.split(/[，。！？,.!?\n]/)[0].slice(0, 10) || "New session";
    s.meta.updatedAt = now;

    // Words used for the first time (S1-22)
    for (const t of segment(lang, input.text)) {
      if (!t.isWord) continue;
      const w = t.lemma ?? t.text;
      const k = `${lang}:${w}`;
      if (!(lang === "zh" ? ZH_DICT : JA_DICT)[w]) continue;
      const u = usage.get(k);
      if (u) u.count++;
      else usage.set(k, { word: w, language: lang, count: 1, firstUsedAt: now, firstSessionId: sessionId, firstMessageId: user.id, firstSentence: input.text });
    }

    const reply = REPLIES[lang][s.replyIdx++ % REPLIES[lang].length];
    const job = { timers: [] as number[], sessionId, text: "", finished: false };
    running.set(requestId, job);
    let t = 120;
    const at = (ms: number, fn: () => void) => job.timers.push(window.setTimeout(fn, (t += ms)));

    at(0, () => emit({ requestId, sessionId, type: "user_saved", message: user }));
    const failing = /error|错误|エラー/i.test(input.text);
    const chars = [...reply.t];
    t += 650; // "thinking"
    for (let i = 0; i < chars.length; ) {
      const n = 1 + Math.floor(Math.random() * 2);
      const piece = chars.slice(i, i + n).join("");
      i += n;
      at(45 + Math.random() * 45, () => {
        job.text += piece;
        emit({ requestId, sessionId, type: "delta", text: piece });
      });
      if (failing && i > 8) {
        at(200, () => {
          job.finished = true;
          running.delete(requestId);
          emit({ requestId, sessionId, type: "error", message: "The provider is overloaded (529). Try again in a moment.", aborted: false });
        });
        return { requestId };
      }
    }

    // Evidence: corrections and observations (S1-26)
    const found: Correction[] = [];
    for (const rule of CORRECTION_RULES[lang]) {
      const m = input.text.match(rule.re);
      if (!m) continue;
      found.push({ ...rule.make(m), id: uid("c"), language: lang, sessionId, messageId: user.id, createdAt: Date.now(), status: "open", retries: [] });
    }
    const obs: GrammarObservation[] = [];
    if (lang === "zh" && /除了.*还/.test(input.text))
      obs.push({ id: uid("o"), grammarId: "zh:chule-hai", language: lang, sessionId, messageId: user.id, span: input.text.slice(input.text.indexOf("除了")), verdict: "correct", assistance: "independent", at: now });
    for (const c of found)
      if (c.grammarId) obs.push({ id: uid("o"), grammarId: c.grammarId, language: lang, sessionId, messageId: user.id, span: c.original, verdict: "incorrect", assistance: "independent", at: now });
    const tools = [
      { name: "record_evidence", summary: `Logged ${Math.max(obs.length, 1)} observation${obs.length === 1 || obs.length === 0 ? "" : "s"}`, ok: true },
      ...(found.length ? [{ name: "record_evidence", summary: `Logged ${found.length} correction${found.length === 1 ? "" : "s"}`, ok: true }] : []),
    ];
    at(260, () => emit({ requestId, sessionId, type: "tool", activity: tools[0] }));
    for (const c of found)
      at(220, () => {
        corrections.set(c.id, c);
        emit({ requestId, sessionId, type: "correction", correction: c });
      });
    if (tools[1]) at(120, () => emit({ requestId, sessionId, type: "tool", activity: tools[1] }));

    at(380, () => {
      job.finished = true;
      running.delete(requestId);
      observations.push(...obs);
      for (const o of obs) if (!s.grammarIds.includes(o.grammarId)) s.grammarIds.push(o.grammarId);
      for (const tg of s.targets) {
        if (input.text.includes(tg.word)) tg.status = "used";
        else if (reply.t.includes(tg.word) && tg.status === "pending") tg.status = "asked";
      }
      const msg = tutorMsg(sessionId, uid("m"), reply.t, Date.now(), {
        model: `${model.provider}/${model.id}`,
        toolActivity: tools,
        usage: { input: 1200 + s.messages.length * 140, output: reply.t.length * 5 + 120, cost: 0.006 + s.messages.length * 0.0007 },
      });
      s.messages.push(msg);
      s.meta.usage.input += msg.usage!.input;
      s.meta.usage.output += msg.usage!.output;
      s.meta.usage.cost += msg.usage!.cost;
      s.meta.updatedAt = Date.now();
      emit({ requestId, sessionId, type: "done", message: msg, view: view(sessionId) });
    });
    return { requestId };
  };

  const NEW_TOPICS = everyLanguage<string[]>({
    zh: ["换个话题吧！最近你看了什么好看的电影吗？", "我们聊点别的。你周末一般喜欢去哪儿玩？", "说到吃的，你最喜欢做什么菜？"],
    ja: ["話題を変えましょう！最近、何かいい映画を見ましたか？", "別の話をしましょう。週末はどこへ行くのが好きですか？"],
  }, () => ["Let's talk about something new. What did you do last weekend?"]);

  const newTopic: SayfernApi["newTopic"] = async (sessionId, model) => {
    await wait(40);
    const s = sessions.get(sessionId);
    if (!s) throw new Error("Session not found");
    const requestId = uid("r");
    const list = NEW_TOPICS[s.meta.language];
    const reply = list[s.replyIdx++ % list.length];
    const job = { timers: [] as number[], sessionId, text: "", finished: false };
    running.set(requestId, job);
    let t = 120;
    const at = (ms: number, fn: () => void) => job.timers.push(window.setTimeout(fn, (t += ms)));
    at(0, () => emit({ requestId, sessionId, type: "delta", text: "" }));
    t += 500;
    for (const ch of [...reply]) {
      at(40 + Math.random() * 30, () => {
        job.text += ch;
        emit({ requestId, sessionId, type: "delta", text: ch });
      });
    }
    at(200, () => {
      job.finished = true;
      running.delete(requestId);
      const msg = tutorMsg(sessionId, uid("m"), reply, Date.now(), {
        model: `${model.provider}/${model.id}`,
        usage: { input: 1100 + s.messages.length * 140, output: reply.length * 5, cost: 0.005 },
      });
      s.messages.push(msg);
      s.meta.updatedAt = Date.now();
      emit({ requestId, sessionId, type: "done", message: msg, view: view(sessionId) });
    });
    return { requestId };
  };

  const abort: SayfernApi["abort"] = async (requestId) => {
    const job = running.get(requestId);
    if (!job || job.finished) return;
    job.timers.forEach((t) => clearTimeout(t));
    running.delete(requestId);
    const s = sessions.get(job.sessionId)!;
    s.messages.push(tutorMsg(job.sessionId, uid("m"), job.text, Date.now(), { error: "Stopped", usage: { input: 1100, output: job.text.length * 4, cost: 0.003 } }));
    emit({ requestId, sessionId: job.sessionId, type: "error", message: "Stopped", aborted: true, view: view(job.sessionId) });
  };

  // ---- home & progress
  const dailyMinutes = [22, 35, 0, 18, 41, 12, 6];
  const daily = (days: number, lang: Language) =>
    Array.from({ length: days }, (_, i) => {
      const d = new Date(T0 - (days - 1 - i) * DAY);
      const mins = days === 7 ? dailyMinutes[i] : Math.max(0, Math.round(20 + 18 * Math.sin(i * 1.3) + (i % 5 === 0 ? -30 : 0)));
      return { date: d.toLocaleDateString("en-CA"), activeMs: (lang === "ja" ? Math.round(mins * 0.4) : mins) * MIN };
    });

  const getHome: SayfernApi["getHome"] = async (language) => {
    await wait(120);
    const list = listFor(language);
    const resumeMeta = list.find((m) => !m.endedAt);
    const resumeRec = resumeMeta && sessions.get(resumeMeta.id);
    const lastTutor = resumeRec && [...resumeRec.messages].reverse().find((m) => m.role === "tutor");
    const doc = docs.find((d) => d.language === language && d.checkpoint);
    const week = fresh ? daily(7, language).map((d) => ({ ...d, activeMs: 0 })) : daily(7, language);
    const cur: Partial<Record<Skill, LevelEstimate>> = {};
    for (const l of levels.filter((x) => x.language === language)) cur[l.skill] = clone(l);
    const home: HomeView = {
      language,
      resume: resumeMeta ? { session: resumeMeta, lastTutorLine: lastTutor?.text } : undefined,
      followUps: (language === "zh" ? ["zh:chule-hai", "zh:bi-comparison"] : ["ja:te-iru"]).filter((g) => grammar.has(g)).map(summarize),
      reading: doc ? { doc: clone(doc), paragraph: doc.checkpoint!.paragraph, preview: paragraphOf(doc, doc.checkpoint!.paragraph).text } : undefined,
      targets: ankiConfig.enabled ? freshTargets(language) : [],
      week: {
        activeMs: week.reduce((a, d) => a + d.activeMs, 0),
        wordsWritten: fresh ? 0 : language === "zh" ? 1286 : 342,
        distinctWords: fresh ? 0 : language === "zh" ? 402 : 131,
        firstUsed: fresh ? 0 : language === "zh" ? 23 : 9,
        daily: week,
      },
      recent: list.slice(0, 5),
      levels: cur,
      needsPlacement: !levels.some((l) => l.language === language),
    };
    return home;
  };

  const getProgress: SayfernApi["getProgress"] = async (language, range) => {
    await wait();
    const days = range === "week" ? 7 : range === "month" ? 30 : 90;
    const since = range === "all" ? 0 : T0 - days * DAY;
    const d = fresh ? daily(days, language).map((x) => ({ ...x, activeMs: 0 })) : daily(days, language);
    const first = [...usage.values()].filter((u) => u.language === language && u.firstUsedAt >= since).sort((a, b) => b.firstUsedAt - a.firstUsedAt);
    const states = { introduced: 0, with_help: 0, independent: 0 };
    for (const g of grammar.values()) if (g.language === language) states[baseState.get(g.id)!]++;
    const k = range === "week" ? 1 : range === "month" ? 3 : 6;
    const corr = [...corrections.values()].filter((c) => c.language === language);
    const scale = fresh ? 0 : 1;
    const stats: ProgressStats = {
      language,
      range,
      activeMs: d.reduce((a, x) => a + x.activeMs, 0),
      voiceMs: fresh ? 0 : k * 11 * 60_000,
      sessions: scale * listFor(language).length * k,
      wordsWritten: scale * Math.round((language === "zh" ? 1286 : 342) * (days / 7)),
      distinctWords: scale * (language === "zh" ? 180 + days * 8 : 60 + days * 3),
      firstUsed: first,
      daily: d,
      grammar: states,
      corrections: {
        total: corr.length + scale * (language === "zh" ? 5 : 2) * k,
        byKind: {
          grammar: corr.filter((c) => c.kind === "grammar").length + scale * (language === "zh" ? 3 : 1) * k,
          vocabulary: scale * (language === "zh" ? 1 : 1) * k,
          phrasing: scale * k,
          style: corr.filter((c) => c.kind === "style").length + (language === "zh" ? scale * k : 0),
        },
      },
      anki: ankiConfig.enabled && !fresh ? { matureCount: language === "zh" ? 412 : 96, usedInWriting: language === "zh" ? 158 : 22, reviewedToday: 38, syncedAt: ankiSyncedAt[language] } : undefined,
    };
    stats.corrections.total = Object.values(stats.corrections.byKind).reduce((a, b) => a + b, 0);
    return stats;
  };

  const ankiStatus = (): AnkiStatus => ({
    config: clone(ankiConfig),
    connected: ankiConfig.enabled && !ankiOffline,
    version: 6,
    error: ankiConfig.enabled && ankiOffline ? "Anki didn't answer in time. On macOS this usually means App Nap paused Anki while it's in the background." : undefined,
    reason: ankiConfig.enabled && ankiOffline ? "timeout" : undefined,
    detail: ankiConfig.enabled && ankiOffline ? "The operation was aborted due to timeout" : undefined,
    url: "http://127.0.0.1:8765",
    snapshots: {
      zh: { syncedAt: ankiSyncedAt.zh, matureCount: 412, reviewedToday: 38, cards: 1260 },
      ja: { syncedAt: ankiSyncedAt.ja, matureCount: 96, reviewedToday: 12, cards: 430 },
    },
  });

  const mockWord = (word: string, reading: string, meaning: string, extra: Partial<AnkiWord> = {}): AnkiWord => ({
    word, reading, meaning, status: "known", mature: false, cards: 2, cardIds: [], decks: [], lapses: 0, recentReviews: 0, recentFails: 0, struggle: 0, reasons: [], ...extra,
  });
  const emptyOverview = (language: Language): Omit<AnkiOverview, "syncedAt"> => ({
    language,
    counts: { known: 0, learning: 0, new: 0, suspended: 0 },
    mature: 0,
    young: 0,
    newRemaining: 0,
    struggling: 0,
    reviewedToday: 0,
    topStruggling: [],
    nextNew: [],
  });
  const ankiOverviews = everyLanguage<Omit<AnkiOverview, "syncedAt">>({
    zh: {
      language: "zh",
      counts: { known: 1204, learning: 36, new: 812, suspended: 5 },
      mature: 412,
      young: 792,
      newRemaining: 812,
      struggling: 23,
      reviewedToday: 38,
      topStruggling: [
        mockWord("印象", "yìnxiàng", "impression", { lapses: 8, struggle: 0.71, reasons: ["8 lapses", "failed 4 of last 9", "ease 150%"] }),
        mockWord("排队", "páiduì", "to queue", { lapses: 5, struggle: 0.58, reasons: ["failed 3 of last 6", "5 lapses"] }),
        mockWord("推荐", "tuījiàn", "to recommend", { status: "learning", lapses: 2, struggle: 0.47, reasons: ["relearning now", "failed 2 of last 4"] }),
        mockWord("既然", "jìrán", "since; now that", { lapses: 9, struggle: 0.45, reasons: ["leech", "9 lapses"] }),
        mockWord("烤鸭", "kǎoyā", "roast duck", { lapses: 3, struggle: 0.38, reasons: ["ease 170%", "3 lapses"] }),
      ],
      nextNew: [
        mockWord("博物馆", "bówùguǎn", "museum", { status: "new", newPosition: 1 }),
        mockWord("预订", "yùdìng", "to book", { status: "new", newPosition: 2 }),
        mockWord("出发", "chūfā", "to set off", { status: "new", newPosition: 3 }),
      ],
    },
    ja: {
      language: "ja",
      counts: { known: 318, learning: 22, new: 1540, suspended: 0 },
      mature: 96,
      young: 222,
      newRemaining: 1540,
      struggling: 7,
      reviewedToday: 12,
      topStruggling: [
        mockWord("予定", "よてい", "plan", { lapses: 4, struggle: 0.52, reasons: ["4 lapses", "failed 3 of last 7"] }),
        mockWord("行列", "ぎょうれつ", "queue", { lapses: 2, struggle: 0.41, reasons: ["relearning now", "ease 180%"] }),
      ],
      nextNew: [mockWord("景色", "けしき", "scenery", { status: "new", newPosition: 1 })],
    },
  }, (l) => emptyOverview(l));

  const EXT_DIR = "~/Library/Application Support/Sayfern/extensions";
  let extensions: ExtensionInfo[] = [
    { id: "hsk-tagger", name: "HSK level tags", description: "Adds an HSK level to Chinese lookups and lets the tutor check word levels.", version: "0.2.0", enabled: true, path: `${EXT_DIR}/hsk-tagger`, contributes: { tools: ["hsk_level"], languages: [] } },
    { id: "pitch-accent", name: "Pitch accent notes", description: "Adds Tokyo pitch accent to Japanese readings.", version: "0.1.3", enabled: false, path: `${EXT_DIR}/pitch-accent`, contributes: { tools: ["pitch_accent"], languages: [] } },
    { id: "cantonese", name: "Cantonese (粵語)", description: "Language pack with Jyutping readings.", version: "0.0.4", enabled: true, path: `${EXT_DIR}/cantonese`, error: "index.js failed to load: Cannot find module './jyutping.json'", contributes: { tools: [], languages: ["yue"] } },
  ];

  if (fresh) {
    docs.splice(0);
    grammar.clear();
    observations.splice(0);
    corrections.clear();
    usage.clear();
    savedWords.splice(0);
    sessions.clear();
    levels.splice(0);
  }
  if (firstRun) for (const p of providers) p.connected = null;

  const authSubs = new Set<(e: AuthEventPayload) => void>();
  const promptSubs = new Set<(p: AuthPromptPayload) => void>();

  // Shared with the Stage 2 mock slots.
  const world: MockWorld = {
    T0,
    fresh,
    ankiOffline,
    sessions,
    corrections,
    grammar,
    observations,
    savedWords,
    docs,
    ankiCards,
    ankiConfig: () => ankiConfig,
    settings: () => settings,
    extensions: () => extensions,
    setExtensions: (next) => {
      extensions = next;
    },
    segment,
  };

  const api: SayfernApi = {
    ...createReviewMock(world),
    ...createQuizMock(world),
    ...createBuilderMock(world),
    ...createDeckMock(world),
    ...createVoiceMock(),

    // settings, providers, auth
    getSettings: async () => clone(settings),
    systemLocale: async () => matchLocale(navigator.languages),
    setSettings: async (patch) => {
      settings = { ...settings, ...patch };
      return clone(settings);
    },
    listProviders: async () => clone(providers),
    listModels: async () => clone(MODELS.filter((m) => providers.find((p) => p.id === m.provider)?.connected)),
    setApiKey: async (providerId, key) => {
      await wait(300);
      if (key.length < 8) throw new Error("That key looks too short.");
      const p = providers.find((x) => x.id === providerId);
      if (p) p.connected = "api_key";
    },
    login: async (providerId) => {
      authSubs.forEach((cb) => cb({ type: "progress", message: "Waiting for the browser…" }));
      await wait(900);
      const p = providers.find((x) => x.id === providerId);
      if (p) p.connected = "oauth";
    },
    cancelLogin: async () => {},
    logout: async (providerId) => {
      const p = providers.find((x) => x.id === providerId);
      if (p) p.connected = null;
    },
    answerAuthPrompt: async () => {},
    onAuthEvent: (cb) => {
      authSubs.add(cb);
      return () => authSubs.delete(cb);
    },
    onAuthPrompt: (cb) => {
      promptSubs.add(cb);
      return () => promptSubs.delete(cb);
    },

    // languages & home
    listLanguages: async () => clone(LANGS),
    getHome,

    // sessions
    listSessions: async (language) => listFor(language),
    getSession: async (id) => {
      await wait(80);
      return sessions.has(id) ? view(id) : null;
    },
    newSession: async (opts) => {
      await wait(120);
      if (opts.kind === "practice" && opts.focusGrammarId) return api.practiseGrammar(opts.focusGrammarId);
      if (opts.kind === "reading" && opts.docId) return api.openReading(opts.docId);
      if (opts.kind === "placement") return api.startPlacement(opts.language);
      return createSession(opts, "New session");
    },
    renameSession: async (id, title) => {
      const s = sessions.get(id)!;
      s.meta.title = title;
      return clone(s.meta);
    },
    deleteSession: async (id) => {
      sessions.delete(id);
    },
    setFeedbackMode: async (id, mode) => {
      const s = sessions.get(id)!;
      s.meta.feedbackMode = mode;
      return clone(s.meta);
    },
    setDifficulty: async (id, difficulty) => {
      const s = sessions.get(id)!;
      s.meta.difficulty = difficulty;
      return clone(s.meta);
    },
    newTopic,
    send,
    abort,
    onChatEvent: (cb) => {
      chatSubs.add(cb);
      return () => chatSubs.delete(cb);
    },
    translate: async (messageId) => {
      await wait(500 + Math.random() * 400);
      for (const s of sessions.values()) {
        const m = s.messages.find((x) => x.id === messageId);
        if (m) {
          m.translation = TRANSLATIONS[m.text] ?? "(The demo data has no translation for this line.)";
          return m.translation;
        }
      }
      throw new Error("Message not found");
    },
    endSession: async (id): Promise<EndSummary> => {
      await wait(500);
      const s = sessions.get(id)!;
      s.meta.endedAt = s.meta.endedAt ?? Date.now();
      const obs = observations.filter((o) => o.sessionId === id);
      const gids = [...new Set([...s.grammarIds, ...obs.map((o) => o.grammarId)])];
      return clone({
        session: s.meta,
        corrections: [...corrections.values()].filter((c) => c.sessionId === id),
        grammar: gids.map((g) => ({ summary: summarize(g), observations: obs.filter((o) => o.grammarId === g) })),
        newWords: [...usage.values()].filter((u) => u.firstSessionId === id),
        targets: s.targets,
      });
    },
    trackActivity: async (sessionId, ms) => {
      const s = sessions.get(sessionId);
      if (s) s.meta.activeMs += ms;
    },

    // corrections
    checkRetry: async (correctionId, text): Promise<RetryResult> => {
      await wait(700);
      const c = corrections.get(correctionId)!;
      const ok = text.includes(c.corrected);
      c.retries.push({ text, ok, at: Date.now() });
      c.status = ok ? "retried_ok" : "retried_wrong";
      const feedback = ok
        ? "That's it. Logged as fixed on retry."
        : c.language === "zh"
          ? "Close. Look at where 了 sits: it should close the whole phrase."
          : "Close. The adjective itself changes in the past tense.";
      return { ok, feedback, correction: clone(c) };
    },
    revealCorrection: async (id) => {
      await wait(150);
      const c = corrections.get(id)!;
      if (c.status !== "retried_ok") c.status = "revealed";
      return clone(c);
    },
    disputeCorrection: async (id, note) => {
      await wait(200);
      const c = corrections.get(id)!;
      c.status = "disputed";
      c.disputeNote = note || undefined;
      return clone(c);
    },

    // lookup & vocabulary
    annotate: async (language, text) => {
      await wait(30 + Math.random() * 60);
      return segment(language, text);
    },
    lookup: async (language, word): Promise<LookupResult> => {
      await wait(90);
      const card = ankiCards[language].find((c) => c.word === word);
      const u = usage.get(`${language}:${word}`);
      const base = { query: word, anki: card ? clone(card) : undefined, firstUsedAt: u?.firstUsedAt };
      if (!dictInstalled[language]) return { ...base, entries: [], needsDictionary: true };
      const e = toEntry(language, word);
      return { ...base, entries: e ? [e] : [] };
    },
    dictionaryStatus: async (language) => dictStatus(language),
    installDictionary: async (language) => {
      const send = (p: DictionaryProgress) => dictProgressSubs.forEach((cb) => cb(p));
      for (let i = 0; i <= 10; i++) {
        send({ language, phase: "download", fraction: i / 10 });
        await wait(140);
      }
      send({ language, phase: "parse", fraction: 0.5 });
      await wait(400);
      send({ language, phase: "index", fraction: 0.9 });
      await wait(400);
      dictInstalled[language] = true;
      send({ language, phase: "done", fraction: 1 });
      return dictStatus(language);
    },
    onDictionaryProgress: (cb) => {
      dictProgressSubs.add(cb);
      return () => dictProgressSubs.delete(cb);
    },
    saveWord: async (input) => {
      await wait(200);
      const w: SavedWord = { id: uid("w"), createdAt: Date.now(), ...input };
      savedWords.push(w);
      return clone(w);
    },
    listSavedWords: async (language) => clone(savedWords.filter((w) => w.language === language)),
    deleteSavedWord: async (id) => {
      const i = savedWords.findIndex((w) => w.id === id);
      if (i >= 0) savedWords.splice(i, 1);
    },

    // grammar
    listGrammar: async (language) => [...grammar.values()].filter((g) => g.language === language).map((g) => summarize(g.id)),
    getGrammar: async (id): Promise<GrammarDetail | null> => {
      if (!grammar.has(id)) return null;
      const obs = observations.filter((o) => o.grammarId === id).sort((a, b) => b.at - a.at);
      const sids = new Set(obs.map((o) => o.sessionId));
      return clone({
        summary: summarize(id),
        observations: obs,
        corrections: [...corrections.values()].filter((c) => c.grammarId === id),
        sessions: [...sids].map((s) => sessions.get(s)?.meta).filter((m): m is SessionMeta => !!m),
      });
    },
    disputeObservation: async (observationId, verdict, note) => {
      const o = observations.find((x) => x.id === observationId);
      if (!o) return null;
      o.disputed = { note, at: Date.now(), originalVerdict: o.verdict };
      o.verdict = verdict;
      return api.getGrammar(o.grammarId);
    },
    practiseGrammar: async (grammarId, opts) => {
      await wait(150);
      const g = grammar.get(grammarId)!;
      const opener = opts?.explain
        ? g.language === "zh"
          ? `我们再看一下「${g.pattern}」：${g.name}。比如：除了打篮球，我还喜欢游泳。你呢？除了学中文，你还学什么？`
          : `もう一度「${g.pattern}」を見ましょう：${g.name}。例えば、雨が降っても、散歩に行きます。あなたはどうですか？`
        : g.language === "zh"
          ? "我们来聊聊你的爱好吧。除了看电影，你平时还喜欢做什么？"
          : "まず五分ぐらい話しましょう。週末はよく何をしますか？";
      return createSession({ language: g.language, kind: "practice", focusGrammarId: grammarId }, `练习 ${g.pattern}`, opener);
    },

    // library
    listDocs: async (language) => clone(docs.filter((d) => d.language === language)),
    importDocs: async (language, kind) => {
      await wait(500);
      importCount++;
      const d: LibraryDoc = {
        id: uid("doc"), language, kind, format: "md", addedAt: Date.now(), paragraphCount: 3, charCount: 120, warnings: [],
        title: kind === "personal" ? (language === "zh" ? "我的日记" : "日記") : `Imported notes ${importCount}`,
      };
      TEXTS[d.id] = PARAS[language].slice(0, 3).map((t): [string | null, string] => [null, t]);
      docs.push(d);
      return [clone(d)];
    },
    getDoc: async (docId) => clone(docs.find((d) => d.id === docId) ?? null),
    getParagraphs: async (docId, from, count): Promise<LibraryParagraph[]> => {
      await wait(90);
      const d = docs.find((x) => x.id === docId);
      if (!d) return [];
      const start = Math.max(0, from);
      return Array.from({ length: Math.max(0, Math.min(count, d.paragraphCount - start)) }, (_, i) => paragraphOf(d, start + i));
    },
    setCheckpoint: async (docId, paragraph, offset) => {
      const d = docs.find((x) => x.id === docId)!;
      d.checkpoint = { paragraph, offset, at: Date.now() };
      return clone(d);
    },
    renameDoc: async (docId, title) => {
      const d = docs.find((x) => x.id === docId)!;
      d.title = title;
      return clone(d);
    },
    deleteDoc: async (docId) => {
      const i = docs.findIndex((d) => d.id === docId);
      if (i >= 0) docs.splice(i, 1);
    },
    searchLibrary: async (language, query) => {
      await wait(120);
      const q = query.trim();
      if (!q) return [];
      const hits: LibraryHit[] = [];
      for (const d of docs.filter((x) => x.language === language)) {
        const n = Math.min(d.paragraphCount, (TEXTS[d.id] ?? PARAS[d.language]).length);
        for (let i = 0; i < n; i++) {
          const p = paragraphOf(d, i);
          if (p.text.includes(q)) hits.push({ docId: d.id, title: d.title, paragraph: i, heading: p.heading, text: p.text, score: q.length / p.text.length });
        }
      }
      return hits.sort((a, b) => b.score - a.score).slice(0, 20);
    },
    openReading: async (docId) => {
      await wait(150);
      const existing = [...sessions.values()].find((s) => s.meta.docId === docId && s.meta.kind === "reading");
      if (existing) return view(existing.meta.id);
      const d = docs.find((x) => x.id === docId)!;
      const p = d.checkpoint?.paragraph ?? 0;
      const opener =
        d.language === "zh"
          ? `我们从第${p + 1}段开始读吧。读完以后，告诉我你觉得最难的一句。`
          : "ゆっくり読みましょう。わからないところがあったら、聞いてください。";
      return createSession({ language: d.language, kind: "reading", docId }, d.title, opener);
    },

    // progress
    getProgress,

    // anki
    ankiStatus: async () => ankiStatus(),
    ankiSetConfig: async (config) => {
      ankiConfig = clone(config);
      return ankiStatus();
    },
    ankiDecks: async () => ["Chinese::HSK3", "Chinese::HSK4", "Japanese::Core", "Default"],
    ankiFields: async (deck) => ANKI_FIELDS[deck] ?? ["Front", "Back"],
    ankiSync: async (language) => {
      await wait(600);
      if (ankiOffline) throw new Error("Couldn't reach AnkiConnect. Open Anki and try again.");
      ankiSyncedAt[language] = Date.now();
      return ankiStatus();
    },
    ankiOverview: async (language) => (ankiConfig.enabled ? { ...clone(ankiOverviews[language]), syncedAt: ankiSyncedAt[language] } : null),

    // profile & level
    getProfile: async () => clone(profile),
    setProfile: async (patch) => {
      profile = { ...profile, ...patch };
      return clone(profile);
    },
    getLevels: async (language) => {
      const cur: Partial<Record<Skill, LevelEstimate>> = {};
      for (const l of levels.filter((x) => x.language === language)) cur[l.skill] = clone(l);
      return { current: cur, history: clone(levels.filter((l) => l.language === language)) };
    },
    setSelfLevel: async (language, level) => {
      for (const skill of ["reading", "recognition", "writing"] as Skill[])
        levels.push({ language, skill, level, confidence: "low", evidence: "Set by you.", examples: [], at: Date.now(), by: "self" });
    },
    startPlacement: async (language) => {
      await wait(150);
      const opener = language === "zh" ? "我们先轻松地聊五分钟。你平时周末喜欢做什么？" : "まず五分ぐらい話しましょう。週末はよく何をしますか？";
      return createSession({ language, kind: "placement" }, language === "zh" ? "水平测试" : "レベルチェック", opener);
    },

    // data & extensions
    exportData: async () => {
      await wait(400);
      return { path: "~/Downloads/sayfern-export-2026-09-30.json" };
    },
    // The UI reloads after an erase; the next load builds a fresh mock (first run, or signed in and fresh).
    eraseAllData: async ({ keepSignIns }) => {
      await wait(500);
      const next = new URLSearchParams(location.search);
      next.delete("onboarding");
      next.delete("fresh");
      next.set(keepSignIns ? "fresh" : "onboarding", "1");
      history.replaceState(null, "", `${location.pathname}?${next}${location.hash}`);
    },
    listExtensions: async () => clone(extensions),
    setExtensionEnabled: async (id, enabled) => {
      extensions = extensions.map((e) => (e.id === id ? { ...e, enabled } : e));
      return clone(extensions);
    },
    openExtensionsFolder: async () => {},
    openExternal: async (url) => {
      window.open(url, "_blank", "noopener");
    },
    requestMicrophone: async () => true,
  };
  return api;
}
