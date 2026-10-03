// Mock implementation of the Stage 2 QuizApi slot for the browser dev server. Owned by the quiz feature.
// Believable generated quizzes for zh and ja in every format, local grading, a simulated 2.5 s
// generation, and a few finished quizzes seeded unless ?fresh=1. Keys stay in this module until a
// question is answered, like the real core.
import type { GrammarObservation, Language } from "../../../shared/records";
import type {
  QuizAnswer,
  QuizApi,
  QuizFocus,
  QuizFormat,
  QuizFormatChoice,
  QuizListItem,
  QuizOptions,
  QuizQuestion,
  QuizSpec,
  QuizSummary,
  QuizView,
} from "../../../shared/stage2";
import { LANGUAGE_META } from "../../../shared/languages";
import { QUIZ_SAMPLES } from "../lib/samples";
import { everyLanguage, MOCK_DAY, MOCK_MIN, mockClone, mockId, mockWait, type MockWorld } from "./mockWorld";

interface BankItem {
  format: QuizFormat;
  prompt: string;
  text?: string;
  context?: string;
  hint?: string;
  choices?: string[];
  tiles?: string[];
  answer: string;
  accepted?: string[];
  explanation: string;
  /** written / scenario: substrings a good answer contains (mock grading). */
  needs?: string[];
  grammarId?: string;
  word?: string;
}

interface MockItem extends BankItem {
  id: string;
  answered?: QuizAnswer;
}

interface MockQuiz {
  id: string;
  language: Language;
  title: string;
  spec: QuizSpec;
  status: QuizView["status"];
  createdAt: number;
  finishedAt?: number;
  error?: string;
  alignment: string;
  provenance: string;
  exam?: QuizView["exam"];
  items: MockItem[];
  retryOf?: string;
  timer?: ReturnType<typeof setTimeout>;
}

/** Languages without a hand-written bank: multiple choice and open answers from the screen's samples (first choice is the key). */
function sampleBank(l: Language): BankItem[] {
  const s = QUIZ_SAMPLES[l];
  const mc = s.multiple_choice;
  return [
    { format: "multiple_choice", prompt: "Choose the word that fits.", text: mc.text, choices: mc.choices, answer: mc.choices?.[0] ?? "", explanation: "Sample item." },
    { format: "written", prompt: "Write your answer.", context: s.written.context, answer: "", explanation: "Sample item.", needs: [] },
    { format: "scenario", prompt: "Reply in the conversation.", context: s.scenario.context, text: s.scenario.text, answer: "", explanation: "Sample item.", needs: [] },
  ];
}

const BANK = everyLanguage<BankItem[]>({
  zh: [
    { format: "multiple_choice", prompt: "Choose the word that fits.", text: "除了中文课，我 ___ 有三门课。", choices: ["还", "才", "都", "就"], answer: "还", explanation: "With 除了…还…, 还 adds something extra and comes after the subject. 都 would turn it into except.", grammarId: "zh:chule-hai" },
    { format: "multiple_choice", prompt: "Choose the word that fits.", text: "北京 ___ 上海冷。", choices: ["比", "跟", "和", "对"], answer: "比", explanation: "A 比 B + adjective compares two things. No 很 before the adjective.", grammarId: "zh:bi-comparison" },
    { format: "multiple_choice", prompt: "What does this word mean?", text: "推荐", choices: ["to recommend", "to queue", "impression", "to go hiking"], answer: "to recommend", explanation: "推荐 tuījiàn: to recommend. 我推荐这家饭馆。", word: "推荐" },
    { format: "multiple_choice", prompt: "Choose the word that fits.", text: "我 ___ 到家就睡觉了。", choices: ["一", "刚", "才", "又"], answer: "一", explanation: "一…就… means as soon as. The second action follows right away.", grammarId: "zh:yi-jiu" },
    { format: "multiple_choice", prompt: "Choose the word that fits.", text: "饭馆门口有很多人在 ___。", choices: ["排队", "印象", "烤鸭", "爬山"], answer: "排队", explanation: "排队 páiduì: to queue. 在 + verb says it is happening now.", word: "排队" },
    { format: "multiple_choice", prompt: "Choose the best word.", text: "天气 ___ 冷了。", choices: ["越来越", "越", "来越", "更是"], answer: "越来越", explanation: "越来越 + adjective: more and more. It goes right before the adjective.", grammarId: "zh:yuelaiyue" },
    { format: "cloze", prompt: "Fill the gap.", text: "我___作业做完了。", hint: "moves the object before the verb", answer: "把", explanation: "把 puts the object (作业) before the verb, and the verb needs a result: 做完了.", grammarId: "zh:ba" },
    { format: "cloze", prompt: "Fill the gap.", text: "虽然很累，___很开心。", hint: "but", answer: "但是", accepted: ["可是", "但"], explanation: "虽然 pairs with 但是 (or 可是). Chinese uses both halves.", grammarId: "zh:suiran-danshi" },
    { format: "cloze", prompt: "Fill the gap.", text: "我们昨天去吃了___，很好吃。", hint: "roast duck", answer: "烤鸭", explanation: "烤鸭 kǎoyā: roast duck.", word: "烤鸭" },
    { format: "cloze", prompt: "Fill the gap.", text: "我是坐火车来___。", answer: "的", explanation: "是…的 highlights how a past action happened. 的 closes the pattern.", grammarId: "zh:shi-de" },
    { format: "cloze", prompt: "Fill the gap.", text: "那家饭馆给我的___很好。", hint: "impression", answer: "印象", explanation: "印象 yìnxiàng: impression. 给我的印象 = the impression it gave me.", word: "印象" },
    { format: "ordering", prompt: "Put the words in order.", context: "Besides hiking, we also had roast duck.", tiles: ["烤鸭", "还", "除了", "我们", "吃了", "爬山"], answer: "除了爬山，我们还吃了烤鸭。", explanation: "除了 + A first, then the subject, then 还 + the extra.", grammarId: "zh:chule-hai" },
    { format: "ordering", prompt: "Put the words in order.", context: "My Chinese is getting better and better.", tiles: ["好了", "越来越", "我的", "中文"], answer: "我的中文越来越好了。", explanation: "越来越 sits right before the adjective.", grammarId: "zh:yuelaiyue" },
    { format: "ordering", prompt: "Put the words in order.", context: "I went to sleep as soon as I got home.", tiles: ["就", "到家", "我", "睡觉了", "一"], answer: "我一到家就睡觉了。", explanation: "Subject, 一 + first action, 就 + second action.", grammarId: "zh:yi-jiu" },
    { format: "ordering", prompt: "Put the words in order.", context: "This place is tastier than that one.", tiles: ["那家", "好吃", "这家店", "比"], answer: "这家店比那家好吃。", explanation: "A 比 B + adjective, with the adjective last.", grammarId: "zh:bi-comparison" },
    { format: "written", prompt: "Write one or two sentences.", context: "Say two things you did last weekend, using 除了…还….", answer: "除了爬山，我还看了一个电影。", needs: ["除了", "还"], explanation: "Uses 除了…还… with 还 after the subject.", grammarId: "zh:chule-hai" },
    { format: "written", prompt: "Write one or two sentences.", context: "Recommend a restaurant to a friend using 推荐.", answer: "我推荐你去学校旁边的那家饭馆，烤鸭特别好吃。", needs: ["推荐"], explanation: "推荐 + person + verb phrase.", word: "推荐" },
    { format: "written", prompt: "Write one sentence.", context: "Compare your city with another city using 比.", answer: "北京比我的城市冷，但是更热闹。", needs: ["比"], explanation: "A 比 B + adjective, no 很.", grammarId: "zh:bi-comparison" },
    { format: "scenario", prompt: "Reply in role.", context: "You walk into a busy restaurant. The host greets you. Say how many you are and ask how long the wait is.", text: "您好，几位？现在要排队。", answer: "两位。大概要等多久？", needs: ["位"], explanation: "几位 asks how many people. 要等多久 asks how long.", word: "排队" },
    { format: "scenario", prompt: "Reply in role.", context: "A classmate asks about your weekend. Tell them what you did, plus one more thing.", text: "周末过得怎么样？", answer: "很好！除了爬山，我还跟朋友吃了烤鸭。", needs: ["除了", "还"], explanation: "除了…还… lets you add the second thing naturally.", grammarId: "zh:chule-hai" },
  ],
  ja: [
    { format: "multiple_choice", prompt: "Choose the form that fits.", text: "今、本を ___ います。", choices: ["読んで", "読み", "読む", "読んだ"], answer: "読んで", explanation: "Action in progress: the て-form + いる.", grammarId: "ja:te-iru" },
    { format: "multiple_choice", prompt: "Choose the form that fits.", text: "昨日の映画はとても ___ です。", choices: ["おもしろかった", "おもしろいでした", "おもしろくて", "おもしろかったでした"], answer: "おもしろかった", explanation: "い-adjectives take the past themselves: おもしろい → おもしろかった, then です.", grammarId: "ja:i-adj-past" },
    { format: "multiple_choice", prompt: "What does this word mean?", text: "予定", choices: ["plan", "queue", "delicious", "treasure"], answer: "plan", explanation: "予定 よてい: plan, schedule.", word: "予定" },
    { format: "multiple_choice", prompt: "Choose the form that fits.", text: "富士山に ___ です。", choices: ["登りたい", "登るたい", "登ったい", "登りで"], answer: "登りたい", explanation: "たい attaches to the verb stem: 登ります → 登り + たい.", grammarId: "ja:tai" },
    { format: "cloze", prompt: "Fill the gap.", text: "ご飯を食べて___、出かけます。", hint: "after", answer: "から", explanation: "て-form + から: after doing A, do B.", grammarId: "ja:te-kara" },
    { format: "cloze", prompt: "Fill the gap.", text: "店の前に長い___ができていました。", hint: "queue", answer: "行列", accepted: ["ぎょうれつ"], explanation: "行列 ぎょうれつ: a queue. 行列ができる = a line forms.", word: "行列" },
    { format: "cloze", prompt: "Fill the gap.", text: "毎日日本語を勉強して___。", hint: "polite, ongoing", answer: "います", accepted: ["いる"], explanation: "て-form + います for a habit or ongoing action.", grammarId: "ja:te-iru" },
    { format: "ordering", prompt: "Put the words in order.", context: "I'll go out after eating.", tiles: ["出かけます", "から", "ご飯を", "食べて"], answer: "ご飯を食べてから、出かけます。", explanation: "A-て + から comes first, then the second action.", grammarId: "ja:te-kara" },
    { format: "ordering", prompt: "Put the words in order.", context: "I want to watch more films.", tiles: ["です", "映画を", "見たい", "もっと"], answer: "もっと映画を見たいです。", explanation: "Object + を, verb stem + たい, then です.", grammarId: "ja:tai" },
    { format: "ordering", prompt: "Put the words in order.", context: "I haven't decided my weekend plans yet.", tiles: ["まだ", "いません", "週末の", "決めて", "予定は"], answer: "週末の予定はまだ決めていません。", explanation: "Topic first, まだ before the negative ている form.", word: "予定" },
    { format: "written", prompt: "Write one sentence.", context: "Say what you want to do this weekend, using 〜たい.", answer: "週末は友だちと山に登りたいです。", needs: ["たい"], explanation: "Verb stem + たいです.", grammarId: "ja:tai" },
    { format: "written", prompt: "Write one sentence.", context: "Describe yesterday's weather with an い-adjective in the past.", answer: "昨日はとても寒かったです。", needs: ["かった"], explanation: "い-adjective past: 〜かったです.", grammarId: "ja:i-adj-past" },
    { format: "scenario", prompt: "Reply in role.", context: "You're in line at a ramen shop. The staff asks you a question. Answer and ask how long the wait is.", text: "何名様ですか？", answer: "二人です。どのくらい待ちますか？", needs: ["人"], explanation: "何名様 asks how many people. どのくらい asks how long.", word: "行列" },
    { format: "scenario", prompt: "Reply in role.", context: "A friend asks what you did after class. Say what you did, in order.", text: "授業のあと、何をしたの？", answer: "授業が終わってから、図書館で勉強していました。", needs: ["てから"], explanation: "〜てから orders the two actions.", grammarId: "ja:te-kara" },
  ],
}, (l) => sampleBank(l));

const SECONDS: Record<QuizFormat, number> = { multiple_choice: 30, cloze: 40, ordering: 50, written: 120, scenario: 150 };
const MIXES: Record<QuizFocus, QuizFormat[]> = {
  grammar: ["cloze", "multiple_choice", "ordering", "multiple_choice", "cloze", "ordering", "written"],
  vocabulary: ["multiple_choice", "cloze", "multiple_choice", "cloze", "ordering", "written"],
  scenarios: ["scenario", "multiple_choice", "written", "cloze", "scenario", "multiple_choice"],
  exam: ["multiple_choice", "cloze", "ordering", "multiple_choice", "multiple_choice", "ordering", "cloze", "written"],
  mixed: ["multiple_choice", "cloze", "ordering", "written", "multiple_choice", "scenario", "cloze", "ordering"],
};
const FORMAT_LABEL: Record<QuizFormatChoice, string> = {
  multiple_choice: "multiple choice",
  cloze: "fill the gap",
  ordering: "sentence order",
  written: "written answers",
  scenario: "role-play",
  mixed: "mixed",
};
const EXAMS = {
  zh: [
    { exam: "hsk2" as const, name: "HSK 2.0", levels: ["HSK 1", "HSK 2", "HSK 3", "HSK 4", "HSK 5", "HSK 6"] },
    { exam: "hsk3" as const, name: "HSK 3.0", levels: ["HSK 1", "HSK 2", "HSK 3", "HSK 4", "HSK 5", "HSK 6", "HSK 7-9"] },
  ],
  ja: [{ exam: "jlpt" as const, name: "JLPT", levels: ["N5", "N4", "N3", "N2", "N1"] }],
};
const CURRENT = everyLanguage<string>({ zh: "HSK 3", ja: "N5" }, (l) => LANGUAGE_META[l].levels[1]);

const clampQ = (n: number) => Math.max(3, Math.min(30, Math.round(n) || 10));
const plan = (focus: QuizFocus, format: QuizFormatChoice, n: number): QuizFormat[] =>
  Array.from({ length: clampQ(n) }, (_, i) => (format === "mixed" ? MIXES[focus][i % MIXES[focus].length] : format));
const minutesOf = (formats: QuizFormat[]) => Math.max(1, Math.round(formats.reduce((s, f) => s + SECONDS[f], 0) / 60));
function countFor(spec: QuizSpec): number {
  if ("minutes" in spec.length) {
    const budget = spec.length.minutes * 60;
    let used = 0;
    let n = 0;
    for (const f of plan(spec.focus, spec.format, 30)) {
      if (used + SECONDS[f] > budget) break;
      used += SECONDS[f];
      n++;
    }
    return clampQ(n);
  }
  return clampQ(spec.length.questions);
}
const norm = (s: string) => s.normalize("NFKC").replace(/[\s\p{P}]/gu, "").toLowerCase();

function shuffle<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function createQuizMock(world: MockWorld): QuizApi {
  const quizzes = new Map<string, MockQuiz>();

  const resolveLevel = (spec: QuizSpec) => {
    if (spec.level.kind === "exam") {
      const { exam, level } = spec.level;
      const label = exam === "jlpt" ? `JLPT ${level}` : `${level} (${exam === "hsk2" ? "HSK 2.0 levels" : "HSK 3.0"})`;
      const style = exam === "jlpt" ? `JLPT ${level} style` : `${level} style (${exam === "hsk2" ? "HSK 2.0 levels" : "HSK 3.0"})`;
      return { alignment: label, provenance: `Generated in ${style}. Not official exam material.`, exam };
    }
    const cur = CURRENT[spec.language];
    return { alignment: `your level (${cur})`, provenance: `Generated practice at your level (${cur}). Not official exam material.`, exam: undefined };
  };

  const titleOf = (spec: QuizSpec): string => {
    if (spec.level.kind === "exam") return `${spec.level.exam === "jlpt" ? `JLPT ${spec.level.level}` : spec.level.level} style · ${FORMAT_LABEL[spec.format]}`;
    const focus = { grammar: "Grammar", vocabulary: "Vocabulary", scenarios: "Scenarios", exam: "Exam prep", mixed: "Mixed" }[spec.focus];
    const src = spec.sources
      .map((s) => {
        switch (s.kind) {
          case "mistakes":
            return "my mistakes";
          case "anki":
            return s.anki === "struggling" ? "hard Anki words" : s.anki === "all" ? "my Anki words" : "this week's Anki";
          case "grammar":
            return s.grammarIds?.length === 1 ? world.grammar.get(s.grammarIds[0])?.pattern ?? "one grammar point" : s.grammarIds?.length ? `${s.grammarIds.length} grammar points` : "grammar to work on";
          case "document": {
            const t = world.docs.find((d) => d.id === s.docId)?.title ?? "a document";
            return s.chapter ? `${t}, ${s.chapter}` : t;
          }
          case "targets":
            return "my goals";
          case "saved_words":
            return "saved words";
        }
      })
      .join(", ");
    return `${focus} · ${src || "anything at my level"}`;
  };

  /** Bank items for the planned formats, preferring the focus (grammar items for grammar, words for vocabulary). */
  const pick = (language: Language, focus: QuizFocus, formats: QuizFormat[], prefix: string): MockItem[] => {
    const used = new Map<QuizFormat, number>();
    return formats.map((f, i) => {
      let pool = BANK[language].filter((b) => b.format === f);
      if (!pool.length) pool = BANK[language];
      if (focus === "grammar") pool = [...pool.filter((b) => b.grammarId), ...pool.filter((b) => !b.grammarId)];
      if (focus === "vocabulary") pool = [...pool.filter((b) => b.word), ...pool.filter((b) => !b.word)];
      const k = used.get(f) ?? 0;
      used.set(f, k + 1);
      const b = mockClone(pool[k % pool.length]);
      if (b.choices) b.choices = shuffle(b.choices);
      if (b.tiles) b.tiles = shuffle(b.tiles);
      return { ...b, id: `${prefix}-q${i + 1}` };
    });
  };

  const summary = (q: MockQuiz): QuizSummary => {
    const s: QuizSummary = { total: q.items.length, answered: 0, correct: 0, incorrect: 0, uncertain: 0, grammar: [], review: [] };
    const g = new Map<string, QuizSummary["grammar"][number]>();
    for (const it of q.items) {
      if (!it.answered) continue;
      s.answered++;
      s[it.answered.verdict]++;
      if (it.answered.verdict !== "correct") s.review.push(it.id);
      if (it.grammarId) {
        const row = g.get(it.grammarId) ?? { grammarId: it.grammarId, label: world.grammar.get(it.grammarId)?.pattern ?? it.grammarId, correct: 0, incorrect: 0, uncertain: 0 };
        row[it.answered.verdict]++;
        g.set(it.grammarId, row);
      }
    }
    s.grammar = [...g.values()];
    return s;
  };

  const view = (q: MockQuiz): QuizView => {
    const questions: QuizQuestion[] = q.items.map((it, index) => {
      const qq: QuizQuestion = { id: it.id, index, format: it.format, prompt: it.prompt };
      if (it.text) qq.text = it.text;
      if (it.context) qq.context = it.context;
      if (it.hint) qq.hint = it.hint;
      if (it.choices) qq.choices = [...it.choices];
      if (it.tiles) qq.tiles = [...it.tiles];
      if (it.grammarId) {
        qq.grammarId = it.grammarId;
        const p = world.grammar.get(it.grammarId)?.pattern;
        if (p) qq.grammarLabel = p;
      }
      if (it.word) qq.word = it.word;
      if (it.answered) qq.answered = mockClone(it.answered);
      return qq;
    });
    const v: QuizView = {
      id: q.id,
      language: q.language,
      title: q.title,
      spec: mockClone(q.spec),
      status: q.status,
      createdAt: q.createdAt,
      alignment: q.alignment,
      provenance: q.provenance,
      generated: true,
      minutes: minutesOf(q.items.length ? q.items.map((i) => i.format) : plan(q.spec.focus, q.spec.format, countFor(q.spec))),
      questions,
      summary: summary(q),
    };
    if (q.finishedAt) v.finishedAt = q.finishedAt;
    if (q.error) v.error = q.error;
    if (q.exam) v.exam = q.exam;
    if (q.retryOf) v.retryOf = q.retryOf;
    return v;
  };

  const grade = (it: MockItem, response: string, reveal: boolean): QuizAnswer => {
    const base = { response, answer: it.answer, explanation: it.explanation, at: Date.now(), ...(it.accepted ? { accepted: [...it.accepted] } : {}) };
    if (reveal) return { ...base, revealed: true, verdict: "incorrect", feedback: "Here's the answer.", gradedBy: "local" };
    if (!norm(response)) return { ...base, verdict: "incorrect", feedback: "No answer given.", gradedBy: "local" };
    if (it.format === "written" || it.format === "scenario") {
      const hit = (it.needs ?? []).every((n) => response.includes(n));
      if ([...norm(response)].length < 3) return { ...base, verdict: "incorrect", feedback: "Too short to do the task.", better: it.answer, gradedBy: "model" };
      return hit
        ? { ...base, verdict: "correct", feedback: "That works, and the pattern is in the right place.", better: it.answer, gradedBy: "model" }
        : { ...base, verdict: "uncertain", feedback: "Understandable, but it doesn't use what the task asked for.", better: it.answer, gradedBy: "model" };
    }
    const keys = [it.answer, ...(it.accepted ?? [])].map(norm);
    let ok = keys.includes(norm(response));
    if (!ok && it.format === "cloze" && it.text) ok = [it.answer, ...(it.accepted ?? [])].some((a) => norm(it.text!.replace("___", a)) === norm(response));
    return { ...base, verdict: ok ? "correct" : "incorrect", feedback: ok ? "Right." : "Not quite.", gradedBy: "local" };
  };

  const recordEvidence = (q: MockQuiz) => {
    for (const it of q.items) {
      if (!it.grammarId || !it.answered || it.answered.revealed || !it.answered.response) continue;
      const id = `quiz-obs-${it.id}`;
      if (world.observations.some((o) => o.id === id)) continue;
      const span = (it.format === "cloze" || it.format === "multiple_choice") && it.text?.includes("___") ? it.text.replace("___", it.answered.response) : it.answered.response;
      const o: GrammarObservation = {
        id,
        grammarId: it.grammarId,
        language: q.language,
        sessionId: `quiz:${q.id}`,
        messageId: it.id,
        span,
        verdict: it.answered.verdict,
        assistance: "prompted",
        note: `Quiz · ${FORMAT_LABEL[it.format]}`,
        at: it.answered.at,
        origin: "quiz",
        quizId: q.id,
      };
      world.observations.push(o);
    }
  };

  // ---- seeds
  if (!world.fresh) {
    const seed = (language: Language, id: string, spec: QuizSpec, total: number, correct: number, daysAgo: number, evidence: boolean) => {
      const lvl = resolveLevel(spec);
      const items = pick(language, spec.focus, plan(spec.focus, spec.format, total), id);
      const wrong = new Set(Array.from({ length: total - correct }, (_, i) => Math.floor(((i + 0.5) * total) / Math.max(1, total - correct))));
      const at = world.T0 - daysAgo * MOCK_DAY;
      items.forEach((it, i) => {
        const bad = wrong.has(i);
        const response = bad ? (it.choices?.find((c) => c !== it.answer) ?? (it.format === "ordering" ? [...(it.tiles ?? [])].join("") : "也")) : it.format === "ordering" ? it.answer.replace(/[，。、]/g, "") : it.answer;
        it.answered = { ...grade(it, response, false), at: at + i * MOCK_MIN };
        if (bad) it.answered = { ...it.answered, verdict: it.format === "written" || it.format === "scenario" ? "uncertain" : "incorrect", feedback: it.format === "written" || it.format === "scenario" ? it.answered.feedback : "Not quite." };
        else it.answered = { ...it.answered, verdict: "correct", feedback: it.format === "written" || it.format === "scenario" ? "That works." : "Right." };
      });
      const q: MockQuiz = { id, language, title: titleOf(spec), spec, status: "finished", createdAt: at - 12 * MOCK_MIN, finishedAt: at + total * MOCK_MIN, ...lvl, items };
      quizzes.set(id, q);
      if (evidence) recordEvidence(q);
    };
    const base = (language: Language, over: Partial<QuizSpec>): QuizSpec => ({ language, focus: "grammar", sources: [{ kind: "mistakes" }], level: { kind: "current" }, format: "mixed", length: { questions: 10 }, ...over });
    seed("zh", "q-zh-mistakes", base("zh", {}), 10, 9, 1, true);
    seed("zh", "q-zh-anki", base("zh", { focus: "vocabulary", sources: [{ kind: "anki", anki: "recent" }], format: "multiple_choice", length: { questions: 20 } }), 20, 14, 3, false);
    seed("zh", "q-zh-hsk3", base("zh", { focus: "exam", sources: [], level: { kind: "exam", exam: "hsk2", level: "HSK 3" }, length: { questions: 20 } }), 20, 17, 6, false);
    seed("ja", "q-ja-mistakes", base("ja", { length: { questions: 8 } }), 8, 6, 2, true);
  }

  const get = (id: string): MockQuiz => {
    const q = quizzes.get(id);
    if (!q) throw new Error("That quiz no longer exists.");
    return q;
  };

  return {
    quizOptions: async (language): Promise<QuizOptions> => {
      await mockWait(80);
      const corrections = [...world.corrections.values()].filter((c) => c.language === language && c.kind !== "style");
      const pastWrong = [...quizzes.values()].filter((q) => q.language === language).flatMap((q) => q.items.filter((i) => i.answered?.verdict === "incorrect" && !i.answered.revealed));
      const cards = world.ankiOffline || !world.ankiConfig().enabled ? [] : world.ankiCards[language];
      const grammar = [...world.grammar.values()].filter((g) => g.language === language);
      const struggling = cards.filter((c) => c.lapses >= 2).length;
      const recent = cards.filter((c) => c.lastReviewAt && world.T0 - c.lastReviewAt <= 7 * MOCK_DAY).length;
      const toWork = grammar.filter((g) => !["zh:chule-hai", "zh:shi-de", "ja:tai"].includes(g.id)).length;
      return {
        language,
        counts: {
          mistakes: corrections.length + pastWrong.length,
          ankiRecent: recent,
          ankiStruggling: struggling,
          ankiAll: cards.length,
          savedWords: world.savedWords.filter((w) => w.language === language).length,
          grammar: grammar.length,
          grammarToWork: toWork,
          targets: Math.min(5, toWork) + Math.min(6, recent) + 1,
        },
        ankiSyncedAt: cards.length ? world.T0 - 2 * MOCK_MIN : null,
        ankiEnabled: world.ankiConfig().enabled,
        grammar: grammar.map((g) => ({ id: g.id, pattern: g.pattern, name: g.name, level: g.level, state: ["zh:chule-hai", "zh:shi-de", "ja:tai"].includes(g.id) ? "independent" : "with_help" })),
        docs: world.docs.filter((d) => d.language === language && d.paragraphCount > 0 && d.kind !== "personal").map((d) => ({ docId: d.id, title: d.title, kind: d.kind, paragraphs: d.paragraphCount })),
        currentLevel: world.fresh ? null : CURRENT[language],
        goal: language === "zh" ? "Chat comfortably about everyday life" : "Read graded readers without a dictionary",
        exams: mockClone((EXAMS as Partial<Record<Language, (typeof EXAMS)["zh" | "ja"]>>)[language] ?? []),
      };
    },
    quizChapters: async (docId) => {
      await mockWait(60);
      if (docId === "doc-momo")
        return [
          { heading: "第一話　川から来た桃", from: 0, paragraphs: 7 },
          { heading: "第二話　鬼ヶ島へ", from: 7, paragraphs: 8 },
          { heading: "第三話　鬼たいじ", from: 15, paragraphs: 8 },
        ];
      if (docId === "doc-ic2")
        return [
          { heading: "Lesson 11 · 天气", from: 0, paragraphs: 40 },
          { heading: "Lesson 12 · 吃饭", from: 40, paragraphs: 44 },
          { heading: "Lesson 13 · 买东西", from: 84, paragraphs: 39 },
        ];
      if (docId === "doc-genki")
        return [
          { heading: "Lesson 13 · Looking for a part-time job", from: 0, paragraphs: 30 },
          { heading: "Lesson 14 · Valentine's Day", from: 30, paragraphs: 34 },
        ];
      return [];
    },
    estimateQuiz: async (spec) => {
      const n = countFor(spec);
      const lvl = resolveLevel(spec);
      return { questions: n, minutes: minutesOf(plan(spec.focus, spec.format, n)), alignment: lvl.alignment, provenance: lvl.provenance, ...(lvl.exam ? { exam: lvl.exam } : {}) };
    },
    startQuiz: async (spec, _model) => {
      await mockWait(120);
      if (!spec.sources.length && spec.focus !== "exam" && spec.level.kind !== "exam") throw new Error("Pick what to quiz you on first.");
      if (spec.sources.some((s) => s.kind === "saved_words") && !world.savedWords.some((w) => w.language === spec.language)) throw new Error("You haven't saved any words yet.");
      const id = mockId("quiz");
      const lvl = resolveLevel(spec);
      const q: MockQuiz = { id, language: spec.language, title: titleOf(spec), spec: mockClone(spec), status: "generating", createdAt: Date.now(), ...lvl, items: [] };
      quizzes.set(id, q);
      q.timer = setTimeout(() => {
        if (q.status !== "generating") return;
        q.items = pick(spec.language, spec.focus, plan(spec.focus, spec.format, countFor(spec)), id);
        q.status = "ready";
      }, 2500);
      return view(q);
    },
    cancelQuizGeneration: async (id) => {
      const q = quizzes.get(id);
      if (!q) return;
      clearTimeout(q.timer);
      if (q.status === "generating" || q.status === "failed") quizzes.delete(id);
    },
    getQuiz: async (id) => {
      await mockWait(40);
      const q = quizzes.get(id);
      return q ? view(q) : null;
    },
    listQuizzes: async (language): Promise<QuizListItem[]> => {
      await mockWait(60);
      return [...quizzes.values()]
        .filter((q) => q.language === language && q.status !== "failed")
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((q) => {
          const s = summary(q);
          return { id: q.id, language: q.language, title: q.title, status: q.status, createdAt: q.createdAt, ...(q.finishedAt ? { finishedAt: q.finishedAt } : {}), alignment: q.alignment, total: s.total, answered: s.answered, correct: s.correct };
        });
    },
    answerQuestion: async (quizId, questionId, response, _model, opts) => {
      const q = get(quizId);
      const it = q.items.find((i) => i.id === questionId);
      if (!it) throw new Error("That question isn't in this quiz.");
      if (!it.answered) {
        await mockWait(it.format === "written" || it.format === "scenario" ? 1100 : 60);
        it.answered = grade(it, response.trim(), !!opts?.reveal);
      }
      return view(q);
    },
    finishQuiz: async (quizId) => {
      await mockWait(100);
      const q = get(quizId);
      recordEvidence(q);
      if (q.status !== "finished") {
        q.status = "finished";
        q.finishedAt = Date.now();
      }
      return view(q);
    },
    retryMistakes: async (quizId) => {
      await mockWait(100);
      const q = get(quizId);
      const wrong = q.items.filter((i) => i.answered && i.answered.verdict !== "correct");
      if (!wrong.length) throw new Error("No mistakes to retry in this quiz.");
      const id = mockId("quiz");
      const items = wrong.map((w, i) => {
        const c = mockClone(w);
        delete c.answered;
        c.id = `${id}-q${i + 1}`;
        if (c.choices) c.choices = shuffle(c.choices);
        if (c.tiles) c.tiles = shuffle(c.tiles);
        return c;
      });
      const r: MockQuiz = { ...mockClone({ ...q, timer: undefined }), id, title: q.title.startsWith("Retry · ") ? q.title : `Retry · ${q.title}`, status: "ready", createdAt: Date.now(), finishedAt: undefined, items, retryOf: q.id };
      quizzes.set(id, r);
      return view(r);
    },
    deleteQuiz: async (quizId) => {
      const q = quizzes.get(quizId);
      if (q) clearTimeout(q.timer);
      quizzes.delete(quizId);
      for (let i = world.observations.length - 1; i >= 0; i--) if (world.observations[i].sessionId === `quiz:${quizId}`) world.observations.splice(i, 1);
    },
  };
}
