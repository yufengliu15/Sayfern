// Mock implementation of the Stage 2 DeckApi slot (Anki deck generator) for the browser dev server.
// Owned by the decks feature. Simulated planning (1.5 s), sample cards with ruby, batches of 25
// that "add" cards; ElevenLabs accounts come from mockVoice.ts (any key starting with "sk" works).
import type { Language } from "../../../shared/records";
import {
  DECK_BATCH_SIZE,
  DECK_BEGINNER,
  DECK_SAMPLE_SIZE,
  sharedDecksUrl,
  suggestDeckName,
  type DeckApi,
  type DeckCardView,
  type DeckProjectView,
  type DeckRubySeg,
  type DeckSpec,
  type ElevenLabsStatus,
} from "../../../shared/stage2";
import { LANGUAGE_META } from "../../../shared/languages";
import { everyLanguage, mockClone, mockId, mockWait, type MockWorld } from "./mockWorld";
import { mockAddAccount, mockElevenStatus, mockRemoveAllAccounts, mockSetVoice } from "./mockVoice";

const LEVELS = everyLanguage<string[]>({
  zh: ["HSK 1", "HSK 2", "HSK 3", "HSK 4", "HSK 5", "HSK 6"],
  ja: ["N5", "N4", "N3", "N2", "N1"],
}, (l) => [...LANGUAGE_META[l].levels]);
const CURRENT = everyLanguage<string>({ zh: "HSK 3", ja: "N4" }, (l) => LANGUAGE_META[l].levels[1]);

/** zh: one reading per Han character, in order. */
function zh(text: string, readings: string, target: string): DeckRubySeg[] {
  const rs = readings.split(" ");
  let k = 0;
  const from = text.indexOf(target);
  return [...text].map((ch, i) => {
    const seg: DeckRubySeg = { text: ch };
    if (/[一-鿿]/.test(ch)) seg.rt = rs[k++];
    if (from >= 0 && i >= from && i < from + target.length) seg.target = true;
    return seg;
  });
}

type Bank = Omit<DeckCardView, "status" | "checks"> & { checks?: string[] };

const BANK = everyLanguage<Bank[]>({
  zh: [
    {
      word: "护照",
      reading: "hùzhào",
      wordRuby: zh("护照", "hù zhào", ""),
      definition: "passport",
      sentence: "请给我看一下你的护照。",
      sentenceRuby: zh("请给我看一下你的护照。", "qǐng gěi wǒ kàn yí xià nǐ de hù zhào", "护照"),
      translation: "Please show me your passport.",
    },
    {
      word: "银行",
      reading: "yínháng",
      wordRuby: zh("银行", "yín háng", ""),
      definition: "bank",
      sentence: "我下午要去银行换钱。",
      sentenceRuby: zh("我下午要去银行换钱。", "wǒ xià wǔ yào qù yín háng huàn qián", "银行"),
      translation: "I'm going to the bank this afternoon to change money.",
      checks: ["Reading fixed with CC-CEDICT (model wrote yínxíng)"],
    },
    {
      word: "机场",
      reading: "jīchǎng",
      wordRuby: zh("机场", "jī chǎng", ""),
      definition: "airport",
      sentence: "我们八点到机场。",
      sentenceRuby: zh("我们八点到机场。", "wǒ men bā diǎn dào jī chǎng", "机场"),
      translation: "We get to the airport at eight.",
    },
    {
      word: "行李",
      reading: "xíngli",
      wordRuby: zh("行李", "xíng li", ""),
      definition: "luggage, baggage",
      sentence: "你的行李太重了。",
      sentenceRuby: zh("你的行李太重了。", "nǐ de xíng li tài zhòng le", "行李"),
      translation: "Your luggage is too heavy.",
      notes: "Measure word: 件 or 个.",
    },
    {
      word: "订",
      reading: "dìng",
      wordRuby: zh("订", "dìng", ""),
      definition: "to book, to reserve",
      sentence: "我已经订了两个房间。",
      sentenceRuby: zh("我已经订了两个房间。", "wǒ yǐ jīng dìng le liǎng gè fáng jiān", "订"),
      translation: "I've already booked two rooms.",
    },
    {
      word: "地图",
      reading: "dìtú",
      wordRuby: zh("地图", "dì tú", ""),
      definition: "map",
      sentence: "你有这个城市的地图吗？",
      sentenceRuby: zh("你有这个城市的地图吗？", "nǐ yǒu zhè ge chéng shì de dì tú ma", "地图"),
      translation: "Do you have a map of this city?",
    },
    {
      word: "导游",
      reading: "dǎoyóu",
      wordRuby: zh("导游", "dǎo yóu", ""),
      definition: "tour guide",
      sentence: "导游说明天早上七点出发。",
      sentenceRuby: zh("导游说明天早上七点出发。", "dǎo yóu shuō míng tiān zǎo shang qī diǎn chū fā", "导游"),
      translation: "The guide says we leave at seven tomorrow morning.",
    },
  ],
  ja: [
    {
      word: "切符",
      reading: "きっぷ",
      wordRuby: [{ text: "切符", rt: "きっぷ" }],
      definition: "ticket",
      sentence: "駅で切符を買いました。",
      sentenceRuby: [
        { text: "駅", rt: "えき" },
        { text: "で" },
        { text: "切符", rt: "きっぷ", target: true },
        { text: "を" },
        { text: "買", rt: "か" },
        { text: "いました。" },
      ],
      translation: "I bought a ticket at the station.",
    },
    {
      word: "予約",
      reading: "よやく",
      wordRuby: [{ text: "予約", rt: "よやく" }],
      definition: "reservation, booking",
      sentence: "ホテルを予約しました。",
      sentenceRuby: [{ text: "ホテルを" }, { text: "予約", rt: "よやく", target: true }, { text: "しました。" }],
      translation: "I booked a hotel.",
      notes: "する-verb: 予約する.",
    },
    {
      word: "空港",
      reading: "くうこう",
      wordRuby: [{ text: "空港", rt: "くうこう" }],
      definition: "airport",
      sentence: "空港まで電車で行きます。",
      sentenceRuby: [
        { text: "空港", rt: "くうこう", target: true },
        { text: "まで" },
        { text: "電車", rt: "でんしゃ" },
        { text: "で" },
        { text: "行", rt: "い" },
        { text: "きます。" },
      ],
      translation: "I'll go to the airport by train.",
    },
    {
      word: "荷物",
      reading: "にもつ",
      wordRuby: [{ text: "荷物", rt: "にもつ" }],
      definition: "luggage, package",
      sentence: "荷物はここに置いてください。",
      sentenceRuby: [{ text: "荷物", rt: "にもつ", target: true }, { text: "はここに" }, { text: "置", rt: "お" }, { text: "いてください。" }],
      translation: "Please leave your luggage here.",
    },
    {
      word: "乗る",
      reading: "のる",
      wordRuby: [{ text: "乗", rt: "の" }, { text: "る" }],
      definition: "to ride, to get on",
      sentence: "次のバスに乗りましょう。",
      sentenceRuby: [
        { text: "次", rt: "つぎ" },
        { text: "のバスに" },
        { text: "乗", rt: "の", target: true },
        { text: "りましょう", target: true },
        { text: "。" },
      ],
      translation: "Let's get on the next bus.",
      notes: "Takes に: バスに乗る.",
    },
    {
      word: "地図",
      reading: "ちず",
      wordRuby: [{ text: "地図", rt: "ちず" }],
      definition: "map",
      sentence: "地図を見せてくれませんか。",
      sentenceRuby: [{ text: "地図", rt: "ちず", target: true }, { text: "を" }, { text: "見", rt: "み" }, { text: "せてくれませんか。" }],
      translation: "Could you show me the map?",
    },
  ],
}, () => []);

interface MockProject {
  view: DeckProjectView;
  timer?: ReturnType<typeof setTimeout>;
  cursor: number;
}

export function createDeckMock(world: MockWorld): DeckApi {
  const projects = new Map<string, MockProject>();
  const eleven = (): ElevenLabsStatus => mockElevenStatus();

  const cardOf = (language: Language, i: number, status: DeckCardView["status"]): DeckCardView => {
    // Only zh and ja have sample cards: other languages reuse the Chinese ones.
    const bank = BANK[language].length ? BANK[language] : BANK.zh;
    const b = bank[i % bank.length];
    const dict = language === "zh" ? "CC-CEDICT" : language === "ja" ? "JMdict" : "WikDict";
    return { ...mockClone(b), checks: b.checks ?? [`Reading checked in ${dict}`], status };
  };

  const progress = (v: DeckProjectView, added: number) => {
    const remaining = Math.max(0, v.spec.size - added);
    v.progress = { ...v.progress, added, remaining, batchesLeft: Math.ceil(remaining / DECK_BATCH_SIZE) };
  };

  const runBatch = (p: MockProject) => {
    const v = p.view;
    const steps = [
      () => "Checking Anki",
      () => `Batch ${v.batches.length + 1}: writing cards`,
      () => `Batch ${v.batches.length + 1}: recording audio`,
      () => `Batch ${v.batches.length + 1}: adding to Anki`,
    ];
    let s = 0;
    const tick = () => {
      if (v.status !== "generating") return;
      if (s < steps.length) {
        v.activity = steps[s++]();
        v.updatedAt = Date.now();
        p.timer = setTimeout(tick, 700);
        return;
      }
      const n = Math.min(DECK_BATCH_SIZE, v.progress.remaining);
      const cards = Array.from({ length: n }, (_, k) => cardOf(v.language, p.cursor + k, "added"));
      p.cursor += n;
      v.batches.push({ n: v.batches.length + 1, at: Date.now(), added: n, duplicates: 0, failed: 0, skipped: 0 });
      v.recent = [...cards, ...v.recent].slice(0, 50);
      v.progress.planned = Math.max(v.progress.planned, v.progress.added + n + 10);
      progress(v, v.progress.added + n);
      delete v.activity;
      if (v.progress.remaining === 0) {
        v.status = "done";
        v.continuous = false;
      } else if (v.continuous) {
        s = 0;
        p.timer = setTimeout(tick, 500);
        return;
      } else v.status = "ready";
    };
    tick();
  };

  const get = (id: string) => {
    const p = projects.get(id);
    if (!p) throw new Error("That deck project no longer exists.");
    return p;
  };

  return {
    async deckOptions(language) {
      await mockWait();
      const known = new Set(world.ankiCards[language].map((c) => c.word)).size;
      return {
        language,
        levels: [...LEVELS[language]],
        currentLevel: world.fresh ? null : CURRENT[language],
        anki: {
          enabled: world.ankiConfig().enabled,
          connected: world.ankiConfig().enabled && !world.ankiOffline,
          knownWords: world.fresh ? null : known,
          syncedAt: world.fresh ? null : world.T0,
        },
        dictionary: { name: language === "zh" ? "CC-CEDICT" : "JMdict", installed: language === "zh", downloadMb: language === "zh" ? 4 : 18 },
        elevenlabs: mockClone(eleven()),
        defaultDeckName: suggestDeckName(language, world.fresh ? DECK_BEGINNER : CURRENT[language], ""),
        sharedDecksUrl: sharedDecksUrl(language),
      };
    },
    async estimateDeck(spec) {
      const batches = Math.ceil(spec.size / DECK_BATCH_SIZE);
      const audioCharacters = spec.size * (spec.language === "zh" ? 16 : 21);
      return {
        cards: spec.size,
        batches,
        minutes: Math.max(1, Math.round(batches * 1.5)),
        audioCharacters,
        ...(spec.audio === "elevenlabs" && eleven().creditsLeft != null ? { creditsAfter: eleven().creditsLeft! - audioCharacters } : {}),
      };
    },
    async startDeckProject(spec: DeckSpec, model) {
      await mockWait(200);
      if (spec.audio === "elevenlabs" && !eleven().connected) throw new Error("Connect ElevenLabs first, or pick the free voices.");
      const id = mockId("deck");
      const now = Date.now();
      const view: DeckProjectView = {
        id,
        language: spec.language,
        spec: mockClone({ ...spec, deckName: spec.deckName || suggestDeckName(spec.language, spec.level, spec.request) }),
        model: `${model.provider}/${model.id}`,
        modelRef: { ...model },
        status: "planning",
        createdAt: now,
        updatedAt: now,
        activity: "Choosing words (0 so far)",
        samples: [],
        recent: [],
        batches: [],
        progress: { planned: 0, added: 0, duplicates: 0, failed: 0, skipped: 0, remaining: spec.size, batchesLeft: Math.ceil(spec.size / DECK_BATCH_SIZE) },
      };
      const p: MockProject = { view, cursor: 0 };
      projects.set(id, p);
      p.timer = setTimeout(() => {
        view.activity = "Writing sample cards";
        view.progress.planned = Math.min(spec.size, 100);
        view.progress.skipped = spec.skipKnown && !world.fresh ? 3 : 0;
        p.timer = setTimeout(() => {
          view.samples = Array.from({ length: DECK_SAMPLE_SIZE }, (_, i) => cardOf(spec.language, i, "sample"));
          p.cursor = DECK_SAMPLE_SIZE;
          view.status = "preview";
          delete view.activity;
        }, 900);
      }, 700);
      return mockClone(view);
    },
    async redoDeckSamples(id, guidance) {
      const p = get(id);
      p.view.guidance = guidance.trim() || p.view.guidance;
      p.view.status = "planning";
      p.view.activity = "Writing new samples";
      p.timer = setTimeout(() => {
        p.view.samples = Array.from({ length: DECK_SAMPLE_SIZE }, (_, i) => cardOf(p.view.language, i + 1, "sample"));
        p.view.status = "preview";
        delete p.view.activity;
      }, 1200);
      return mockClone(p.view);
    },
    async approveDeckSamples(id) {
      const p = get(id);
      if (p.view.status !== "preview") throw new Error("There are no samples waiting for approval.");
      p.view.status = "ready";
      return mockClone(p.view);
    },
    async runDeckBatch(id, _model, opts) {
      const p = get(id);
      if (p.view.status !== "ready") throw new Error("This deck can't run a batch right now.");
      if (world.ankiOffline) {
        p.view.lastError = "Anki didn't answer in time. On macOS this usually means App Nap paused Anki while it's in the background.";
        return mockClone(p.view);
      }
      delete p.view.lastError;
      p.view.status = "generating";
      p.view.continuous = !!opts?.continuous;
      runBatch(p);
      return mockClone(p.view);
    },
    async stopDeckBatches(id) {
      const p = get(id);
      clearTimeout(p.timer);
      if (p.view.status === "generating") p.view.status = "ready";
      p.view.continuous = false;
      delete p.view.activity;
      return mockClone(p.view);
    },
    async getDeckProject(id) {
      await mockWait(20);
      const p = projects.get(id);
      return p ? mockClone(p.view) : null;
    },
    async listDeckProjects(language) {
      return [...projects.values()]
        .map((p) => p.view)
        .filter((v) => !language || v.language === language)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((v) => ({
          id: v.id,
          language: v.language,
          deckName: v.spec.deckName,
          status: v.status,
          createdAt: v.createdAt,
          updatedAt: v.updatedAt,
          planned: v.progress.planned,
          added: v.progress.added,
          remaining: v.progress.remaining,
        }));
    },
    async deleteDeckProject(id) {
      clearTimeout(projects.get(id)?.timer);
      projects.delete(id);
    },
    async elevenLabsStatus() {
      return mockClone(eleven());
    },
    async connectElevenLabs(key) {
      await mockAddAccount(key);
      return mockClone(eleven());
    },
    async setElevenLabsVoice(voiceId) {
      mockSetVoice(voiceId);
      return mockClone(eleven());
    },
    async disconnectElevenLabs() {
      mockRemoveAllAccounts();
      return mockClone(eleven());
    },
  };
}
