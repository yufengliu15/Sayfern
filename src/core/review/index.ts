// Corrections review and correction-to-Anki export (S2-01..S2-03). Implements ReviewApi.
// Retry, reveal and dispute reuse the Stage 1 API (checkRetry, revealCorrection, disputeCorrection).
import type { ChatMessage, Correction, GrammarPoint, Language, SessionMeta } from "../../shared/records";
import type {
  AnkiCardDraft,
  DraftAnkiCardsInput,
  DraftAnkiCardsResult,
  ExportAnkiCardsInput,
  ExportAnkiCardsResult,
  ReviewApi,
  ReviewFilter,
  ReviewItem,
  ReviewList,
} from "../../shared/stage2";
import type { ModelRef } from "../../shared/types";
import { AnkiUnreachableError } from "../anki";
import type { AnkiAddResult } from "../contracts";
import { type Stage2Deps, translatorFor, explanationFor } from "../stage2";
import { clozeDraft, draftProblem, noteFor, noteTypeFor, situationDraft } from "./cards";
import { buildItem, reviewList } from "./list";
import { writeSituations } from "./situations";

export { CLOZE_NOTE_TYPE, RECALL_NOTE_TYPE } from "./cards";

/** Most cards one draft or export call handles. */
export const MAX_CARDS = 100;
/** Fixed parts longer than this don't get a dictionary gloss as their cloze hint. */
const GLOSS_MAX_CHARS = 8;

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class ReviewService implements ReviewApi {
  constructor(private readonly deps: Stage2Deps) {}

  // ------------------------------------------------------------ list (S2-01, S2-02)

  async listReviewCorrections(filter: ReviewFilter): Promise<ReviewList> {
    const corrections = await this.deps.records.listCorrections({ language: filter.language });
    return reviewList(await this.items(corrections), filter);
  }

  /** Review items with their session, learner message and grammar point (each read once). */
  private async items(corrections: Correction[]): Promise<ReviewItem[]> {
    const { records } = this.deps;
    const sessions = new Map<string, { meta: SessionMeta | null; messages: ChatMessage[] }>();
    for (const sid of new Set(corrections.map((c) => c.sessionId))) {
      const [meta, messages] = await Promise.all([records.getSession(sid).catch(() => null), records.getMessages(sid).catch(() => [])]);
      sessions.set(sid, { meta, messages });
    }
    const grammar = new Map<string, GrammarPoint | null>();
    for (const gid of new Set(corrections.map((c) => c.grammarId).filter((g): g is string => !!g))) {
      grammar.set(gid, await records.getGrammarPoint(gid).catch(() => null));
    }
    return corrections.map((c) => {
      const s = sessions.get(c.sessionId);
      return buildItem(c, s?.messages, s?.meta, c.grammarId ? grammar.get(c.grammarId) : null);
    });
  }

  // ------------------------------------------------------------ drafts (S2-03)

  async draftAnkiCards(input: DraftAnkiCardsInput, ref?: ModelRef): Promise<DraftAnkiCardsResult> {
    const ids = [...new Set(input.correctionIds)].slice(0, MAX_CARDS);
    const tr = await translatorFor(this.deps);
    const all = await this.deps.records.listCorrections({ language: input.language });
    const byId = new Map(all.map((c) => [c.id, c]));
    const skipped: DraftAnkiCardsResult["skipped"] = [];
    const chosen: Correction[] = [];
    for (const id of ids) {
      const c = byId.get(id);
      if (!c) skipped.push({ correctionId: id, reason: tr.t("This correction no longer exists.") });
      else if (c.status === "disputed") skipped.push({ correctionId: id, reason: tr.t("You marked this one as not a mistake.") });
      else chosen.push(c);
    }
    const items = await this.items(chosen);
    if (!items.length) return { cards: [], skipped };

    if (input.style === "cloze") {
      const cards: AnkiCardDraft[] = [];
      for (const item of items) cards.push(clozeDraft(item, await this.gloss(input.language, item), input.language, tr));
      return { cards, skipped };
    }

    let situations = new Map<string, string>();
    let notice: string | undefined;
    if (!ref) {
      notice = tr.t("Pick a model to write situations. For now the prompts come from the explanations, so edit them before adding.");
    } else {
      try {
        const model = this.deps.resolveModel(ref);
        const explain = { name: await explanationFor(this.deps), locale: tr.locale };
        situations = await writeSituations(this.deps.models, model, input.language, items, this.deps.now, explain);
      } catch (err) {
        notice = tr.t("The model couldn't write situations ({error}). These prompts come from the explanations, so edit them before adding.", { error: errText(err) });
      }
      if (!notice && situations.size < items.length) {
        notice = tr.t("Some prompts come from the explanations because the model's answer was unusable. Edit them before adding.");
      }
    }
    return { cards: items.map((item) => situationDraft(item, input.language, situations.get(item.correction.id), tr)), skipped, ...(notice ? { notice } : {}) };
  }

  /** First dictionary sense of a short fixed part ("爬山" → "to go hiking"), when a dictionary is installed. */
  private async gloss(language: Language, item: ReviewItem): Promise<string | undefined> {
    const word = item.revised.fixed.trim();
    if (!word || [...word].length > GLOSS_MAX_CHARS) return undefined;
    try {
      const r = await this.deps.lang.lookup(language, word);
      const entry = r.entries.find((e) => e.headword === word || e.variants?.includes(word)) ?? (r.entries.length === 1 ? r.entries[0] : undefined);
      const glosses = entry?.senses[0]?.glosses ?? [];
      return glosses.slice(0, 2).join("; ") || undefined;
    } catch {
      return undefined;
    }
  }

  // ------------------------------------------------------------ export (S2-03)

  async exportAnkiCards(input: ExportAnkiCardsInput): Promise<ExportAnkiCardsResult> {
    const { anki, records } = this.deps;
    const deck = input.deck.trim();
    if (!deck) throw new Error("Choose a deck first.");
    const cards = input.cards.slice(0, MAX_CARDS);
    if (!cards.length) throw new Error("Select at least one correction to export.");
    const config = await anki.getConfig();
    if (!config.enabled) throw new Error("Anki is turned off. Turn it on in Settings > Anki, then try again.");

    const results: ExportAnkiCardsResult["results"] = cards.map((c) => ({ correctionId: c.correctionId, status: "failed" as const }));
    const ready: number[] = [];
    cards.forEach((c, i) => {
      const problem = draftProblem(c);
      if (problem) results[i].error = problem;
      else ready.push(i);
    });

    if (ready.length) {
      try {
        await anki.ensureDeck(deck);
        for (const style of new Set(ready.map((i) => cards[i].style))) await anki.ensureNoteType(noteTypeFor(style));
      } catch (err) {
        if (err instanceof AnkiUnreachableError) throw err;
        throw new Error(`Anki couldn't prepare the deck or the Sayfern note types: ${errText(err).replace(/^AnkiConnect error:\s*/, "")}`);
      }
      const added: AnkiAddResult[] = await anki.addNotes(ready.map((i) => noteFor(cards[i], deck)));
      const at = this.deps.now();
      for (const [k, i] of ready.entries()) {
        const r = added[k];
        const out = results[i];
        out.status = r.status;
        if (r.status === "added") out.noteId = r.noteId;
        if (r.status === "failed") out.error = r.error;
        else delete out.error;
        if (r.status === "failed") continue;
        // Mark the correction as exported (a duplicate is in Anki already, so it counts too).
        try {
          const c = await records.getCorrection(cards[i].correctionId);
          if (c) {
            const noteIds = r.status === "added" ? [...new Set([...(c.ankiNoteIds ?? []), r.noteId])] : c.ankiNoteIds;
            await records.updateCorrection(c.id, { exportedAt: at, ...(noteIds ? { ankiNoteIds: noteIds } : {}) });
          }
        } catch {
          // The note is in Anki; a missing correction record only loses the "exported" mark.
        }
      }
    }

    // Remember the deck for next time (re-read: Settings may have changed the config meanwhile).
    try {
      const latest = await anki.getConfig();
      if (latest.exportDecks?.[input.language] !== deck) await anki.setConfig({ ...latest, exportDecks: { ...latest.exportDecks, [input.language]: deck } });
    } catch {
      // Not worth failing the export over.
    }

    const count = (s: string) => results.filter((r) => r.status === s).length;
    return { deck, added: count("added"), duplicates: count("duplicate"), failed: count("failed"), results };
  }
}
