// Level guidance for quiz generation (S2-06, S2-09): exam systems, level names, rough vocabulary
// sizes and grammar descriptors, plus the alignment and provenance lines every quiz carries.
//
// No official word lists are bundled. Vocabulary sizes are the publicly stated cumulative totals:
//   - HSK 2.0 (2009-2021 syllabus, Hanban): 150 / 300 / 600 / 1200 / 2500 / 5000 words.
//   - HSK 3.0 ("Chinese Proficiency Grading Standards for International Chinese Language
//     Education", GF 0025-2021): 500 / 1272 / 2245 / 3245 / 4316 / 5456 / 11092 (levels 7-9) words.
//   - JLPT: no official lists since 2010; the figures are the commonly cited estimates
//     (N5 ~800 words / ~100 kanji ... N1 ~10000 words / ~2000 kanji).
//   - TOPIK: no official lists; commonly cited estimates (TOPIK 1 ~800 words ... TOPIK 6 ~8000).
//   - CEFR (A1..C2, used for English, Spanish, French, German, Italian, Portuguese, Russian and
//     Vietnamese): the CEFR sets no word counts; the figures are commonly cited learner estimates.
// Grammar descriptors are short summaries written for this app, not exam content.
// Downloadable lists could follow the dictionary pattern in src/core/lang/dictionary.ts later;
// everything here works without them.
import { fill, type Translator } from "../../shared/i18n";
import { CEFR_LEVELS, LANGUAGE_META, TOPIK_LEVELS } from "../../shared/languages";
import type { GrammarSummary, Language } from "../../shared/records";
import type { ExamSystem, QuizExamInfo, QuizLevel } from "../../shared/stage2";

interface LevelInfo {
  level: string;
  words: number;
  kanji?: number;
  grammar: string;
}

interface ExamDef extends QuizExamInfo {
  language: Language;
  /** How labels read in provenance: "HSK 2.0 levels". */
  version: string;
  info: LevelInfo[];
  /** Item styles the real exam uses, for the model. */
  style: string;
}

const HSK_GRAMMAR = [
  "very short sentences: 是, 有, 吗/呢 questions, 不/没, 很 + adjective, basic measure words",
  "了 for completion, 过, 在 + verb in progress, 比 comparisons, 因为…所以…, 虽然…但是…, 要…了",
  "除了…还…, 把 sentences, result and direction complements, 越来越, 一…就…, 是…的, 如果…就…",
  "即使…也…, 不管…都…, 连…都…, potential complements, 被 sentences, more formal connectors",
  "formal written connectors, set phrases, varied complements and 把/被 forms, longer complex sentences",
  "literary and formal style, chengyu, dense complex sentences",
];

const HSK2: ExamDef = {
  exam: "hsk2",
  name: "HSK 2.0",
  version: "HSK 2.0 levels",
  language: "zh",
  levels: ["HSK 1", "HSK 2", "HSK 3", "HSK 4", "HSK 5", "HSK 6"],
  info: [150, 300, 600, 1200, 2500, 5000].map((words, i) => ({ level: `HSK ${i + 1}`, words, grammar: HSK_GRAMMAR[i] })),
  style:
    "HSK-style items: choose the word that fills the blank (选词填空), pick the sentence that matches, put the parts in order (排列顺序, HSK 4+), short writing from given words (HSK 3+).",
};

const HSK3_WORDS = [500, 1272, 2245, 3245, 4316, 5456, 11092];
const HSK3_CHARS = [300, 600, 900, 1200, 1500, 1800, 3000];
const HSK3: ExamDef = {
  exam: "hsk3",
  name: "HSK 3.0",
  version: "HSK 3.0",
  language: "zh",
  levels: ["HSK 1", "HSK 2", "HSK 3", "HSK 4", "HSK 5", "HSK 6", "HSK 7-9"],
  info: HSK3_WORDS.map((words, i) => ({
    level: i < 6 ? `HSK ${i + 1}` : "HSK 7-9",
    words,
    kanji: HSK3_CHARS[i],
    grammar: i < 6 ? HSK_GRAMMAR[i] : "advanced written and spoken Chinese: formal register, rhetoric, chengyu, academic topics",
  })),
  style:
    "HSK 3.0-style items: fill the blank, choose the matching sentence, sentence ordering, short writing; levels 4+ add more writing and formal register.",
};

const JLPT: ExamDef = {
  exam: "jlpt",
  name: "JLPT",
  version: "JLPT",
  language: "ja",
  levels: ["N5", "N4", "N3", "N2", "N1"],
  info: [
    { level: "N5", words: 800, kanji: 100, grammar: "です/ます, particles は が を に で へ と, 〜たい, 〜ている, 〜てから, い/な-adjective past, 〜ましょう" },
    { level: "N4", words: 1500, kanji: 300, grammar: "plain form, potential, volitional, 〜たら/〜ば/〜と, 〜ようと思う, あげる/くれる/もらう, passive basics, 〜そう" },
    { level: "N3", words: 3750, kanji: 650, grammar: "〜ように, 〜ばかり, 〜わけ, 〜らしい, causative and causative-passive, 〜ことにする/なる, 〜うちに" },
    { level: "N2", words: 6000, kanji: 1000, grammar: "〜にもかかわらず, 〜に対して, 〜とともに, 〜ものの, 〜わけにはいかない, formal written connectors" },
    { level: "N1", words: 10000, kanji: 2000, grammar: "literary and formal written grammar, 〜をもって, 〜ならでは, 〜んばかりに, dense editorial prose" },
  ],
  style:
    "JLPT-style items: 文法形式の判断 (choose the form that fits the blank), 文の組み立て (put four parts in order; the starred slot), kanji reading and orthography, word usage, short reading comprehension.",
};

const TOPIK: ExamDef = {
  exam: "topik",
  name: "TOPIK",
  version: "TOPIK",
  language: "ko",
  levels: [...TOPIK_LEVELS],
  info: [
    { level: "TOPIK 1", words: 800, grammar: "해요체 and 합니다체, particles 은/는 이/가 을/를 에 에서, -고 싶다, -아/어요 past and future, 안/못 negation" },
    { level: "TOPIK 2", words: 2000, grammar: "-(으)ㄹ 수 있다, -아/어야 하다, -(으)면, -는데, -기 때문에, -(으)려고, honorific -(으)시-" },
    { level: "TOPIK 3", words: 3000, grammar: "-는 바람에, -다가, -(으)ㄴ/는 편이다, indirect speech -다고 하다, passive and causative basics" },
    { level: "TOPIK 4", words: 4500, grammar: "-더라도, -(으)ㄹ 뿐만 아니라, -는 대로, -던, written style -다/-는다, news and opinion texts" },
    { level: "TOPIK 5", words: 6000, grammar: "formal connectors -(으)ㄴ/는 반면에, -기 마련이다, -(으)ㄹ 따름이다, Sino-Korean vocabulary, argument essays" },
    { level: "TOPIK 6", words: 8000, grammar: "literary and academic style, idioms and proverbs, dense editorial and academic prose" },
  ],
  style:
    "TOPIK-style items: choose the word or ending that fits the blank, choose the sentence with the same meaning, put sentences in order, reading comprehension, short writing (TOPIK II: 200 to 300 characters at 3+).",
};

const CEFR_WORDS = [600, 1200, 2500, 4000, 8000, 12000];

/** Per-language CEFR grammar descriptors, A1..C2. */
const CEFR_GRAMMAR: Record<"en" | "es" | "fr" | "de" | "it" | "pt" | "ru" | "vi", string[]> = {
  en: [
    "present simple and continuous, be/have, can, there is/are, basic questions and negatives, articles and plurals",
    "past simple (regular and irregular), going to, comparatives and superlatives, countable and uncountable, adverbs of frequency",
    "present perfect vs past simple, first and second conditionals, modal verbs of obligation and advice, relative clauses, passive basics",
    "past perfect, third conditional, reported speech, passive in all tenses, wish/if only, phrasal verbs in context",
    "inversion, cleft sentences, mixed conditionals, advanced modals of deduction, nuanced linking words, formal register",
    "idiomatic and literary usage, subtle register shifts, complex nominal style, rhetorical devices",
  ],
  es: [
    "ser and estar, tener, gender and number agreement, present tense regular verbs, gustar, hay",
    "pretérito indefinido and imperfecto basics, ir a + infinitive, reflexive verbs, direct object pronouns, comparisons",
    "pretérito perfecto vs indefinido, imperfecto vs indefinido, present subjunctive after querer que and ojalá, commands, por and para",
    "subjunctive in relative and adverbial clauses, imperfect subjunctive, conditionals, passive se, reported speech",
    "pluperfect subjunctive, si clauses in the past, nuanced connectors (no obstante, a pesar de que), formal register",
    "literary tenses and style, idioms and set phrases, fine register and regional variation",
  ],
  fr: [
    "être and avoir, articles and gender, present tense -er verbs, ne…pas, questions with est-ce que, il y a",
    "passé composé with avoir and être, futur proche, partitive articles, direct and indirect object pronouns, comparatives",
    "imparfait vs passé composé, futur simple, relative pronouns qui/que/où/dont, y and en, present conditional",
    "subjonctif présent after il faut que and emotions, plus-que-parfait, conditionnel passé, passive voice, reported speech",
    "subjonctif passé, gérondif and participe présent, nuanced connectors (néanmoins, bien que), formal register",
    "passé simple and literary style, idioms, fine register differences, complex argumentation",
  ],
  de: [
    "sein and haben, present tense, word order with the verb second, nominative and accusative articles, negation with nicht and kein",
    "Perfekt with haben and sein, modal verbs, dative with common prepositions, separable verbs, possessive articles",
    "Präteritum of common verbs, subordinate clauses with weil/dass/wenn, two-way prepositions, comparative and superlative, reflexive verbs",
    "Konjunktiv II, passive voice, relative clauses in all cases, genitive, infinitive clauses with zu, n-declension",
    "Konjunktiv I for reported speech, extended participial attributes, nominal style, nuanced connectors",
    "literary and academic style, idioms, fine register and regional variation",
  ],
  it: [
    "essere and avere, articles and gender, present tense regular verbs, c'è and ci sono, piacere",
    "passato prossimo with avere and essere, reflexive verbs, direct object pronouns, prepositions with articles, stare + gerundio",
    "imperfetto vs passato prossimo, futuro semplice, condizionale presente, combined pronouns, ci and ne",
    "congiuntivo presente and passato, trapassato prossimo, passive voice, periodo ipotetico, reported speech",
    "congiuntivo imperfetto and trapassato, hypothetical sentences in the past, nuanced connectors, formal register",
    "passato remoto and literary style, idioms, fine register and regional variation",
  ],
  pt: [
    "ser and estar, ter, articles and gender, present tense regular verbs, contractions (no, na, do, da)",
    "pretérito perfeito, ir + infinitive, possessives, object pronouns in Brazilian usage, comparatives",
    "pretérito imperfeito vs perfeito, futuro do presente, present subjunctive after querer que and talvez, commands",
    "imperfect and future subjunctive, personal infinitive, conditional, passive voice, reported speech",
    "compound subjunctive tenses, nuanced connectors (no entanto, embora), formal register and mesoclisis awareness",
    "literary style, idioms, Brazilian and European differences, fine register",
  ],
  ru: [
    "the alphabet, gender of nouns, nominative and prepositional cases, present tense, это, у меня есть",
    "past tense, accusative and genitive, verbs of motion идти and ехать, possessives, numbers with nouns",
    "verbal aspect, dative and instrumental, all six cases in the singular, prefixed verbs of motion, который clauses",
    "plural case endings, participles and gerunds (recognition), conditional бы, aspect in imperatives, complex sentences",
    "active use of participles and gerunds, nuanced aspect, formal and scientific style, word formation",
    "literary and journalistic style, idioms and proverbs, fine register differences",
  ],
  vi: [
    "là, có, personal pronouns by age and relation, không questions, basic classifiers (con, cái), numbers",
    "time markers đã, đang, sẽ, rồi, chưa, comparisons with hơn and nhất, muốn and thích, location words",
    "bị and được, cho, để, nếu…thì…, vì…nên…, more classifiers, reduplicated words",
    "complex sentences with mặc dù…nhưng…, càng…càng…, formal pronouns and politeness particles, Sino-Vietnamese vocabulary",
    "formal and written connectors, idioms (thành ngữ), news and academic register",
    "literary style, proverbs (tục ngữ), regional differences, fine register",
  ],
};

function cefrExam(exam: ExamSystem, name: string, language: keyof typeof CEFR_GRAMMAR, style: string): ExamDef {
  return {
    exam,
    name,
    version: name,
    language,
    levels: [...CEFR_LEVELS],
    info: CEFR_LEVELS.map((level, i) => ({ level, words: CEFR_WORDS[i], grammar: CEFR_GRAMMAR[language][i] })),
    style,
  };
}

const CAMBRIDGE = cefrExam("cambridge", "Cambridge English (CEFR)", "en", "Cambridge-style items: open and multiple-choice cloze, key word transformation (B1+), word formation, reading for detail, short writing (an email, a story, an essay at B2+).");
const DELE = cefrExam("dele", "DELE", "es", "DELE-style items: choose the option that completes the text, match texts to statements, transformations, reading comprehension, short writing tasks (a message, an opinion text).");
const DELF = cefrExam("delf", "DELF / DALF", "fr", "DELF/DALF-style items: compréhension écrite with questions, choose the right form, rewrite a sentence, short production écrite (a message, an opinion, an argued text at B2+).");
const GOETHE = cefrExam("goethe", "Goethe-Zertifikat", "de", "Goethe-Zertifikat-style items: Lesen (match, true/false, choose), Sprachbausteine (fill the gap), sentence building, Schreiben (an email, a forum post, an argued text at B2+).");
const CILS = cefrExam("cils", "CILS", "it", "CILS-style items: comprehension of short texts, cloze with options, choose the correct form, short writing (a message, a letter, an argued text at B2+).");
const TORFL = cefrExam("torfl", "TORFL (ТРКИ)", "ru", "TORFL-style items (лексика и грамматика): choose the correct case or aspect, complete the sentence, reading comprehension, short writing (a letter, a short essay at B2+). Levels: A1 элементарный, A2 базовый, B1 ТРКИ-1, B2 ТРКИ-2, C1 ТРКИ-3, C2 ТРКИ-4.");
const CEFR_PT = cefrExam("cefr-pt", "CEFR (Portuguese)", "pt", "CEFR-aligned items in Brazilian Portuguese: fill the gap, choose the matching sentence, put the parts in order, short writing (a message, an opinion at B2+).");
const CEFR_VI = cefrExam("cefr-vi", "CEFR (Vietnamese)", "vi", "CEFR-aligned items in Vietnamese (the Vietnamese 6-level framework follows the CEFR): fill the gap, choose the matching sentence, put the parts in order, short writing.");

export const EXAMS: Record<ExamSystem, ExamDef> = {
  hsk2: HSK2,
  hsk3: HSK3,
  jlpt: JLPT,
  topik: TOPIK,
  cambridge: CAMBRIDGE,
  dele: DELE,
  delf: DELF,
  goethe: GOETHE,
  cils: CILS,
  torfl: TORFL,
  "cefr-pt": CEFR_PT,
  "cefr-vi": CEFR_VI,
};

export function examsFor(language: Language): QuizExamInfo[] {
  return Object.values(EXAMS)
    .filter((e) => e.language === language)
    .map(({ exam, name, levels }) => ({ exam, name, levels: [...levels] }));
}

/** "HSK 3 (HSK 2.0 levels)", "HSK 4 (HSK 3.0)", "JLPT N4", "TOPIK 3", "DELE B1". */
export function examLabel(exam: ExamSystem, level: string): string {
  if (exam === "hsk2" || exam === "hsk3") return `${level} (${EXAMS[exam].version})`;
  return examShort(exam, level);
}

/** Short form for titles: "HSK 3", "JLPT N4", "TOPIK 3", "DELE B1". */
export function examShort(exam: ExamSystem, level: string): string {
  if (exam === "jlpt") return `JLPT ${level}`;
  if (exam === "topik" || exam === "hsk2" || exam === "hsk3") return level;
  return `${EXAMS[exam].name} ${level}`;
}

/** "JLPT N4 style", "HSK 3 style (HSK 2.0 levels)", "DELE B1 style" (translated with `tr`). */
export function examStyleLabel(exam: ExamSystem, level: string, tr: Pick<Translator, "t"> = EN): string {
  if (exam === "hsk2" || exam === "hsk3") return tr.t("{level} style ({version})", { level, version: EXAMS[exam].version });
  return tr.t("{exam} style", { exam: examLabel(exam, level) });
}

/** English stand-in when no translator is passed (tests, prompts). */
const EN: Pick<Translator, "t"> = { t: (en, vars) => fill(en, vars) };

export function isValidExamLevel(language: Language, level: QuizLevel): boolean {
  if (level.kind === "current") return true;
  const def = EXAMS[level.exam];
  return !!def && def.language === language && def.levels.includes(level.level);
}

export interface ResolvedLevel {
  /** "HSK 3 (HSK 2.0 levels)" or "your level (HSK 3)". */
  alignment: string;
  provenance: string;
  exam?: ExamSystem;
  /** Level on the language's own scale, when known ("HSK 3", "N4"). */
  level: string | null;
  /** Lines for the model. */
  guidance: string;
}

/** Turns a QuizLevel into labels and model guidance. `current` = the learner's current estimate. Labels use `tr`. */
export function resolveLevel(language: Language, level: QuizLevel, current: string | null, tr: Pick<Translator, "t"> = EN): ResolvedLevel {
  if (level.kind === "exam" && isValidExamLevel(language, level)) {
    const def = EXAMS[level.exam];
    const info = def.info.find((i) => i.level === level.level)!;
    const label = examLabel(level.exam, level.level);
    const style = examStyleLabel(level.exam, level.level, tr);
    return {
      alignment: label,
      provenance: tr.t("Generated in {style}. Not official exam material.", { style }),
      exam: level.exam,
      level: level.level,
      guidance: [
        `Target: ${label}. Learners at this level know about ${info.words} words${info.kanji ? ` and ${info.kanji} ${language === "ja" ? "kanji" : "characters"}` : ""} in total (rough estimate).`,
        `Typical grammar: ${info.grammar}.`,
        def.style,
        "Write original items in that style. Never copy or claim to reproduce official exam questions.",
      ].join("\n"),
    };
  }
  const known = current ?? null;
  const info = known ? levelInfo(language, known) : null;
  return {
    alignment: known ? tr.t("your level ({level})", { level: known }) : tr.t("your level"),
    provenance: known
      ? tr.t("Generated practice at your level ({level}). Not official exam material.", { level: known })
      : tr.t("Generated practice at your level. Not official exam material."),
    level: known,
    guidance: known
      ? [`Target: the learner's current level, ${known}.`, info ? `Typical grammar around this level: ${info.grammar}.` : "", "Keep vocabulary at or just below this level, except the words being practised."]
          .filter(Boolean)
          .join("\n")
      : "The learner's level is unknown: keep sentences short and vocabulary common, except the words being practised.",
  };
}

/** Level descriptor for a level name on the language's own scale (HSK 2.0 names for zh, plus "HSK 7-9"). */
export function levelInfo(language: Language, level: string): LevelInfo | null {
  const defs = language === "zh" ? [HSK2, HSK3] : Object.values(EXAMS).filter((e) => e.language === language);
  for (const d of defs) {
    const hit = d.info.find((i) => i.level === level);
    if (hit) return hit;
  }
  return null;
}

/** Index on the language's scale (0 = easiest), or -1. Used to pick catalogue grammar at or below a level. */
export function levelRank(language: Language, level: string | undefined | null): number {
  if (!level) return -1;
  const scale = language === "zh" ? HSK3.levels : [...(LANGUAGE_META[language]?.levels ?? [])];
  const exact = scale.indexOf(level.trim());
  if (exact >= 0) return exact;
  const system = LANGUAGE_META[language]?.levelSystem;
  if (system === "hsk" || system === "topik") {
    const m = level.match(/(\d)/);
    if (m) return Math.min(scale.length - 1, Number(m[1]) - 1);
  }
  if (system === "jlpt") {
    const n = level.match(/N\s*([1-5])/i);
    if (n) return 5 - Number(n[1]);
  }
  if (system === "cefr") {
    const c = level.toUpperCase().match(/\b([ABC])\s*([12])\b/);
    if (c) return (c[1].charCodeAt(0) - 65) * 2 + Number(c[2]) - 1;
  }
  return -1;
}

/** The learner's grammar points tagged at or below `level` (catalogue for the model). */
export function catalogueAtLevel(language: Language, grammar: GrammarSummary[], level: string | null, limit = 12): GrammarSummary[] {
  const max = levelRank(language, level);
  return grammar
    .filter((g) => {
      if (max < 0) return true;
      const r = levelRank(language, g.point.level);
      return r < 0 || r <= max;
    })
    .slice(0, limit);
}
