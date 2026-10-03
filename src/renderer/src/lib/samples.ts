// Per-learning-language sample content for the UI: conversation starters, example searches,
// placeholders written in the target language, sample quiz items, feature ideas.
// Text in the learner's interface language is English here, marked with msg() and translated
// with t() where it renders; text in the target language is written in that language.
import type { Language, QuizFormatSample } from "./sampleTypes";
import { msg } from "../i18n";

export type { QuizFormatSample } from "./sampleTypes";

/** Session starters: `t` in the target language, `e` (interface language) says what it's for. */
export const STARTERS: Record<Language, { t: string; e: string }[]> = {
  zh: [
    { t: "我这个周末想……", e: msg("Talk about your weekend plans") },
    { t: "今天我学了……", e: msg("Tell the tutor what you did today") },
    { t: "你推荐什么电影？", e: msg("Ask for a recommendation") },
  ],
  ja: [
    { t: "週末は……", e: msg("Talk about your weekend") },
    { t: "今日は……しました。", e: msg("Tell the tutor about your day") },
    { t: "おすすめの本はありますか？", e: msg("Ask for a recommendation") },
  ],
  ko: [
    { t: "이번 주말에……", e: msg("Talk about your weekend plans") },
    { t: "오늘은……했어요.", e: msg("Tell the tutor about your day") },
    { t: "좋은 영화 추천해 줄 수 있어요?", e: msg("Ask for a recommendation") },
  ],
  en: [
    { t: "This weekend I want to…", e: msg("Talk about your weekend plans") },
    { t: "Today I…", e: msg("Tell the tutor about your day") },
    { t: "Can you recommend a good film?", e: msg("Ask for a recommendation") },
  ],
  es: [
    { t: "Este fin de semana quiero…", e: msg("Talk about your weekend plans") },
    { t: "Hoy he…", e: msg("Tell the tutor about your day") },
    { t: "¿Me recomiendas una película?", e: msg("Ask for a recommendation") },
  ],
  fr: [
    { t: "Ce week-end, je voudrais…", e: msg("Talk about your weekend plans") },
    { t: "Aujourd’hui, j’ai…", e: msg("Tell the tutor about your day") },
    { t: "Tu me conseilles un bon film ?", e: msg("Ask for a recommendation") },
  ],
  de: [
    { t: "Am Wochenende möchte ich…", e: msg("Talk about your weekend plans") },
    { t: "Heute habe ich…", e: msg("Tell the tutor about your day") },
    { t: "Kannst du mir einen Film empfehlen?", e: msg("Ask for a recommendation") },
  ],
  it: [
    { t: "Questo fine settimana vorrei…", e: msg("Talk about your weekend plans") },
    { t: "Oggi ho…", e: msg("Tell the tutor about your day") },
    { t: "Mi consigli un bel film?", e: msg("Ask for a recommendation") },
  ],
  pt: [
    { t: "Neste fim de semana eu quero…", e: msg("Talk about your weekend plans") },
    { t: "Hoje eu…", e: msg("Tell the tutor about your day") },
    { t: "Você me recomenda um filme?", e: msg("Ask for a recommendation") },
  ],
  ru: [
    { t: "В эти выходные я хочу…", e: msg("Talk about your weekend plans") },
    { t: "Сегодня я…", e: msg("Tell the tutor about your day") },
    { t: "Посоветуешь хороший фильм?", e: msg("Ask for a recommendation") },
  ],
  vi: [
    { t: "Cuối tuần này mình muốn…", e: msg("Talk about your weekend plans") },
    { t: "Hôm nay mình đã…", e: msg("Tell the tutor about your day") },
    { t: "Bạn có thể giới thiệu một bộ phim hay không?", e: msg("Ask for a recommendation") },
  ],
};

/** "Write in Spanish…" for written quiz answers, in the target language. */
export const WRITE_PLACEHOLDER: Record<Language, string> = {
  zh: "用中文写…",
  ja: "日本語で書いて…",
  ko: "한국어로 써 보세요…",
  en: "Write in English…",
  es: "Escribe en español…",
  fr: "Écris en français…",
  de: "Schreib auf Deutsch…",
  it: "Scrivi in italiano…",
  pt: "Escreva em português…",
  ru: "Напиши по-русски…",
  vi: "Viết bằng tiếng Việt…",
};

/** Example library search per language. */
export const SEARCH_EXAMPLE: Record<Language, string> = {
  zh: "除了",
  ja: "桃太郎",
  ko: "때문에",
  en: "although",
  es: "aunque",
  fr: "pourtant",
  de: "obwohl",
  it: "anche se",
  pt: "embora",
  ru: "потому что",
  vi: "mặc dù",
};

/** Glyphs on the empty library's sample covers: reader, textbook, personal. */
export const COVER_TITLES: Record<Language, [string, string, string]> = {
  zh: ["书", "课", "我"],
  ja: ["本", "課", "私"],
  ko: ["책", "과", "나"],
  en: ["Book", "Lesson", "Me"],
  es: ["Libro", "Lección", "Yo"],
  fr: ["Livre", "Leçon", "Moi"],
  de: ["Buch", "Lektion", "Ich"],
  it: ["Libro", "Lezione", "Io"],
  pt: ["Livro", "Lição", "Eu"],
  ru: ["Книга", "Урок", "Я"],
  vi: ["Sách", "Bài", "Tôi"],
};

/** Ideas for the feature builder (interface language). */
export const BUILDER_IDEAS: Record<Language, string[]> = {
  zh: [
    msg("Add a measure-word drill: show a noun, I pick the right measure word. Use nouns from my Anki."),
    msg("A tab that quizzes me on the words I saved"),
    msg("Tone pair practice with two-syllable words from my Anki"),
  ],
  ja: [
    msg("A counter drill: show a thing, I pick the right counter (本, 枚, 匹). Use nouns from my Anki."),
    msg("A tab that quizzes me on the words I saved"),
    msg("A kana reading race with words from my Anki"),
  ],
  ko: [
    msg("A particle drill: pick 은/는 or 이/가 in sentences with words from my Anki"),
    msg("A tab that quizzes me on the words I saved"),
    msg("A conjugation drill: turn dictionary forms into polite present and past"),
  ],
  en: [
    msg("A phrasal verb drill with verbs from my Anki"),
    msg("A tab that quizzes me on the words I saved"),
    msg("An irregular past tense race"),
  ],
  es: [
    msg("A ser or estar drill with sentences from my Anki"),
    msg("A tab that quizzes me on the words I saved"),
    msg("A conjugation drill: pretérito or imperfecto"),
  ],
  fr: [
    msg("A gender drill: show a noun, I pick le or la. Use nouns from my Anki."),
    msg("A tab that quizzes me on the words I saved"),
    msg("A passé composé drill: être or avoir"),
  ],
  de: [
    msg("An article drill: der, die or das for nouns from my Anki"),
    msg("A tab that quizzes me on the words I saved"),
    msg("A case drill: pick the right ending after a preposition"),
  ],
  it: [
    msg("An article drill: il, lo, la or l' for nouns from my Anki"),
    msg("A tab that quizzes me on the words I saved"),
    msg("A passato prossimo drill: essere or avere"),
  ],
  pt: [
    msg("A ser or estar drill with sentences from my Anki"),
    msg("A tab that quizzes me on the words I saved"),
    msg("A conjugation drill for irregular verbs"),
  ],
  ru: [
    msg("An aspect drill: pick the perfective or imperfective verb"),
    msg("A tab that quizzes me on the words I saved"),
    msg("A case drill with nouns from my Anki"),
  ],
  vi: [
    msg("A tone mark drill with words from my Anki"),
    msg("A tab that quizzes me on the words I saved"),
    msg("A classifier drill: con, cái or chiếc"),
  ],
};

/** Deck generator: placeholder and one-click examples (interface language). */
export const DECK_REQUEST_PLACEHOLDER: Record<Language, string> = {
  zh: msg("e.g. the top 1,500 most common words according to SUBTLEX-CH, or the most common foods, or everyday sayings"),
  ja: msg("e.g. the top 1,500 most common words according to a frequency list, or the most common foods, or everyday sayings"),
  ko: msg("e.g. the top 1,500 most common words according to a frequency list, or the most common foods, or everyday sayings"),
  en: msg("e.g. the top 1,500 most common words according to a frequency list, or the most common foods, or everyday sayings"),
  es: msg("e.g. the top 1,500 most common words according to a frequency list, or the most common foods, or everyday sayings"),
  fr: msg("e.g. the top 1,500 most common words according to a frequency list, or the most common foods, or everyday sayings"),
  de: msg("e.g. the top 1,500 most common words according to a frequency list, or the most common foods, or everyday sayings"),
  it: msg("e.g. the top 1,500 most common words according to a frequency list, or the most common foods, or everyday sayings"),
  pt: msg("e.g. the top 1,500 most common words according to a frequency list, or the most common foods, or everyday sayings"),
  ru: msg("e.g. the top 1,500 most common words according to a frequency list, or the most common foods, or everyday sayings"),
  vi: msg("e.g. the top 1,500 most common words according to a frequency list, or the most common foods, or everyday sayings"),
};

const GENERIC_EXAMPLES = [msg("Top 1,500 most common words by frequency"), msg("The most common foods and dishes"), msg("Common idioms and sayings"), msg("Words for ordering at a restaurant")];

export const DECK_REQUEST_EXAMPLES: Record<Language, string[]> = {
  zh: [msg("Top 1,500 most common words according to SUBTLEX-CH"), msg("The most common foods and dishes"), msg("Common sayings and chengyu"), msg("Words for ordering at a restaurant")],
  ja: [msg("Top 1,500 most common words by frequency"), msg("The most common foods and dishes"), msg("Common sayings (ことわざ)"), msg("Polite phrases for work")],
  ko: [msg("Top 1,500 most common words by frequency"), msg("The most common foods and dishes"), msg("Common sayings (속담)"), msg("Polite phrases for work")],
  en: [msg("Top 1,500 most common words by frequency"), msg("Common phrasal verbs"), msg("Common idioms and sayings"), msg("Words for job interviews")],
  es: GENERIC_EXAMPLES,
  fr: GENERIC_EXAMPLES,
  de: GENERIC_EXAMPLES,
  it: GENERIC_EXAMPLES,
  pt: GENERIC_EXAMPLES,
  ru: GENERIC_EXAMPLES,
  vi: GENERIC_EXAMPLES,
};

/** Goal placeholder in Settings, by level scale. */
export const GOAL_PLACEHOLDER: Record<Language, string> = {
  zh: msg("e.g. Pass HSK 4 by June"),
  ja: msg("e.g. Read a novel without a dictionary"),
  ko: msg("e.g. Pass TOPIK II level 4 by June"),
  en: msg("e.g. Reach B2 by June"),
  es: msg("e.g. Reach B2 by June"),
  fr: msg("e.g. Reach B2 by June"),
  de: msg("e.g. Reach B2 by June"),
  it: msg("e.g. Reach B2 by June"),
  pt: msg("e.g. Reach B2 by June"),
  ru: msg("e.g. Reach B2 by June"),
  vi: msg("e.g. Reach B2 by June"),
};

/**
 * One sample item per quiz format, for the builder's preview: `context` is in the interface
 * language (translated with t()), everything else in the target language.
 */
export const QUIZ_SAMPLES: Record<Language, QuizFormatSample> = {
  zh: {
    multiple_choice: { text: "除了中文课，我 ___ 有三门课。", choices: ["还", "才", "都", "就"] },
    cloze: { text: "虽然很累，___很开心。" },
    ordering: { context: msg("Besides hiking, we also had roast duck."), tiles: ["烤鸭", "还", "除了", "我们", "吃了", "爬山"] },
    written: { context: msg("Say two things you did last weekend, using 除了…还….") },
    scenario: { context: msg("A busy restaurant. The host greets you."), text: "您好，几位？现在要排队。" },
  },
  ja: {
    multiple_choice: { text: "今、本を ___ います。", choices: ["読んで", "読み", "読む", "読んだ"] },
    cloze: { text: "ご飯を食べて___、出かけます。" },
    ordering: { context: msg("I want to watch more films."), tiles: ["です", "映画を", "見たい", "もっと"] },
    written: { context: msg("Say what you want to do this weekend, using 〜たい.") },
    scenario: { context: msg("In line at a ramen shop. The staff asks you something."), text: "何名様ですか？" },
  },
  ko: {
    multiple_choice: { text: "저는 커피 ___ 좋아해요.", choices: ["를", "가", "에", "의"] },
    cloze: { text: "비가 와서 집에 ___ 있었어요." },
    ordering: { context: msg("I went to the park with a friend yesterday."), tiles: ["어제", "친구하고", "공원에", "갔어요"] },
    written: { context: msg("Say what you want to do this weekend, using -고 싶다.") },
    scenario: { context: msg("At a café. The barista greets you."), text: "어서 오세요. 뭐 드릴까요?" },
  },
  en: {
    multiple_choice: { text: "I have lived here ___ 2019.", choices: ["since", "for", "from", "during"] },
    cloze: { text: "If I ___ more time, I would travel more." },
    ordering: { context: msg("Have you ever been to London?"), tiles: ["been", "Have", "London?", "ever", "to", "you"] },
    written: { context: msg("Say what you did last weekend, using the past simple.") },
    scenario: { context: msg("At a hotel desk. The receptionist greets you."), text: "Good evening! Do you have a reservation?" },
  },
  es: {
    multiple_choice: { text: "Ayer ___ al cine con mis amigos.", choices: ["fui", "iba", "voy", "iré"] },
    cloze: { text: "Espero que ___ un buen fin de semana." },
    ordering: { context: msg("I would like a coffee with milk, please."), tiles: ["un", "Quisiera", "café", "con", "leche"] },
    written: { context: msg("Say what you did last weekend, using the pretérito.") },
    scenario: { context: msg("A busy restaurant. The waiter greets you."), text: "¡Buenas noches! ¿Mesa para cuántos?" },
  },
  fr: {
    multiple_choice: { text: "Hier, nous ___ allés au cinéma.", choices: ["sommes", "avons", "étions", "serons"] },
    cloze: { text: "Il faut que tu ___ tes devoirs." },
    ordering: { context: msg("I would like a coffee, please."), tiles: ["un", "Je", "café,", "voudrais", "s’il vous plaît"] },
    written: { context: msg("Say what you did last weekend, using the passé composé.") },
    scenario: { context: msg("At a bakery. The baker greets you."), text: "Bonjour ! Qu’est-ce que je vous sers ?" },
  },
  de: {
    multiple_choice: { text: "Ich gebe ___ Freund ein Buch.", choices: ["meinem", "meinen", "mein", "meiner"] },
    cloze: { text: "Gestern ___ ich ins Kino gegangen." },
    ordering: { context: msg("Tomorrow I'm going to the cinema with my sister."), tiles: ["gehe", "Morgen", "ich", "mit meiner Schwester", "ins Kino"] },
    written: { context: msg("Say what you did last weekend, using the Perfekt.") },
    scenario: { context: msg("At a café in Berlin. The waiter greets you."), text: "Hallo! Was darf’s sein?" },
  },
  it: {
    multiple_choice: { text: "Ieri ___ andata al mare.", choices: ["sono", "ho", "ero", "sarò"] },
    cloze: { text: "Penso che lui ___ ragione." },
    ordering: { context: msg("I would like a coffee, please."), tiles: ["un", "Vorrei", "caffè,", "per favore"] },
    written: { context: msg("Say what you did last weekend, using the passato prossimo.") },
    scenario: { context: msg("At a trattoria. The waiter greets you."), text: "Buonasera! Avete prenotato?" },
  },
  pt: {
    multiple_choice: { text: "Ontem eu ___ ao cinema.", choices: ["fui", "ia", "vou", "irei"] },
    cloze: { text: "Espero que você ___ um bom fim de semana." },
    ordering: { context: msg("I would like a coffee, please."), tiles: ["um", "Eu", "café,", "queria", "por favor"] },
    written: { context: msg("Say what you did last weekend, using the pretérito perfeito.") },
    scenario: { context: msg("At a café. The waiter greets you."), text: "Oi! O que você vai querer?" },
  },
  ru: {
    multiple_choice: { text: "Я каждый день ___ на работу.", choices: ["хожу", "иду", "пойду", "шёл"] },
    cloze: { text: "Вчера я ___ интересную книгу." },
    ordering: { context: msg("Tomorrow we are going to Moscow."), tiles: ["в", "Завтра", "едем", "мы", "Москву"] },
    written: { context: msg("Say what you did last weekend, using the past tense.") },
    scenario: { context: msg("At a café. The waiter greets you."), text: "Здравствуйте! Что будете заказывать?" },
  },
  vi: {
    multiple_choice: { text: "Hôm qua tôi ___ đi chợ.", choices: ["đã", "sẽ", "đang", "chưa"] },
    cloze: { text: "Tôi ___ thích ăn phở lắm." },
    ordering: { context: msg("I am learning Vietnamese."), tiles: ["đang", "Tôi", "học", "tiếng Việt"] },
    written: { context: msg("Say what you did last weekend, using đã.") },
    scenario: { context: msg("At a phở shop. The owner greets you."), text: "Chào em! Em ăn gì?" },
  },
};
