// "Make Anki cards" (S2-03): turns the selected corrections into recall cards ("Fill the gap"
// or "Situation → sentence"), previews and edits them one by one, then adds them to a deck.
// Drafts are cached per style and correction, so changing the selection only drafts the new
// ones (situations: one batched model call), and edits survive style switches and failures.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Language } from "../../../../shared/records";
import { clozeFront, type AnkiCardDraft, type AnkiCardStyle, type ExportAnkiCardsResult, type ReviewItem } from "../../../../shared/stage2";
import { api, errorText } from "../../api";
import { Icon } from "../../components/icons";
import { useApp } from "../../context";
import { cjkClass, cls } from "../../lib/format";
import { settingsRoute, type Navigate } from "../../router";
import { msg, t, tc, tn } from "../../i18n";

export interface AnkiExportPanelProps {
  language: Language;
  /** Selected corrections, in list order. */
  items: ReviewItem[];
  navigate: Navigate;
  /** After an export: which corrections made it into Anki (added or already there). */
  onExported(result: ExportAnkiCardsResult): void;
  onClose(): void;
}

const STYLES: { id: AnkiCardStyle; label: string }[] = [
  { id: "cloze", label: msg("Fill the gap") },
  { id: "situation", label: msg("Situation → sentence") },
];

const key = (style: AnkiCardStyle, id: string) => `${style}:${id}`;

/** Why this card can't be added yet (mirrors core's draftProblem). */
function problem(d: AnkiCardDraft): string | null {
  if (!d.back.trim()) return t("The answer side is empty.");
  if (d.style === "cloze") {
    if (!d.gap.trim()) return t("Choose the part to hide.");
    if (!d.back.includes(d.gap)) return t("The hidden part must appear in the sentence.");
  } else if (!d.front.trim()) return t("Write a situation for the front.");
  return null;
}

export function AnkiExportPanel({ language, items, navigate, onExported, onClose }: AnkiExportPanelProps) {
  const app = useApp();
  const L = app.lang.fontClass;
  const [style, setStyle] = useState<AnkiCardStyle>("cloze");
  const [drafts, setDrafts] = useState<Record<string, AnkiCardDraft>>({});
  const [edits, setEdits] = useState<Record<string, Partial<AnkiCardDraft>>>({});
  const [skipped, setSkipped] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Partial<Record<AnkiCardStyle, string>>>({});
  const [drafting, setDrafting] = useState(false);
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [decks, setDecks] = useState<string[]>([]);
  const defaultDeck = app.anki?.config.exportDecks?.[language] ?? `${app.lang.name}::Sayfern corrections`;
  const [deck, setDeck] = useState(defaultDeck);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<ExportAnkiCardsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requested = useRef(new Set<string>());

  const enabled = app.anki?.config.enabled ?? false;
  const connected = enabled && (app.anki?.connected ?? false);

  // Existing decks for the picker (only when Anki answers).
  useEffect(() => {
    if (!connected) return;
    let alive = true;
    api
      .ankiDecks()
      .then((d) => alive && setDecks(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [connected]);

  // Draft the selected corrections that have no draft in this style yet.
  const ids = items.map((i) => i.correction.id);
  const idsKey = ids.join(",");
  useEffect(() => {
    const missing = ids.filter((id) => !requested.current.has(key(style, id)));
    if (!missing.length) return;
    const timer = setTimeout(
      () => {
        for (const id of missing) requested.current.add(key(style, id));
        setDrafting(true);
        api
          .draftAnkiCards({ language, correctionIds: missing, style }, style === "situation" ? app.model : undefined)
          .then((r) => {
            setDrafts((cur) => {
              const next = { ...cur };
              for (const d of r.cards) next[key(style, d.correctionId)] = d;
              return next;
            });
            if (r.skipped.length) setSkipped((cur) => ({ ...cur, ...Object.fromEntries(r.skipped.map((s) => [s.correctionId, s.reason])) }));
            setNotice((cur) => ({ ...cur, [style]: r.notice ?? cur[style] }));
          })
          .catch((e) => {
            for (const id of missing) requested.current.delete(key(style, id));
            setError(errorText(e));
          })
          .finally(() => setDrafting(false));
      },
      style === "situation" ? 500 : 150,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, style, language, app.model]);

  const cards = useMemo(
    () =>
      ids
        .map((id) => {
          const base = drafts[key(style, id)];
          if (!base) return null;
          const d = { ...base, ...edits[key(style, id)] };
          if (d.style === "cloze") d.front = clozeFront(d.back, d.gap, d.hint);
          return d;
        })
        .filter((d): d is AnkiCardDraft => !!d),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [idsKey, style, drafts, edits],
  );
  const pending = ids.filter((id) => !drafts[key(style, id)] && !skipped[id]).length;
  const skippedHere = ids.filter((id) => skipped[id]).length;
  const i = Math.min(index, Math.max(0, cards.length - 1));
  const card = cards[i];
  const invalid = cards.map(problem).filter(Boolean).length;

  const edit = (patch: Partial<AnkiCardDraft>) => {
    if (!card) return;
    const k = key(style, card.correctionId);
    setEdits((cur) => ({ ...cur, [k]: { ...cur[k], ...patch } }));
  };

  const add = async () => {
    setExporting(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.exportAnkiCards({ language, deck: deck.trim(), cards });
      setResult(r);
      setEditing(false);
      onExported(r);
      void app.refreshAnki();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setExporting(false);
    }
  };

  const deckOptions = [...new Set([defaultDeck, ...decks])].sort((a, b) => a.localeCompare(b));
  const n = cards.length;

  return (
    <aside
      className="ank"
      aria-label={t("Make Anki cards")}
      onKeyDown={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("input, textarea, select")) return;
        if (e.key === "ArrowLeft" && i > 0) setIndex(i - 1);
        if (e.key === "ArrowRight" && i < n - 1) setIndex(i + 1);
      }}
    >
      <div className="ank-h">
        <span className="ank-t">{t("Make Anki cards")}</span>
        <span className="ank-n mono">{t("{n} selected", { n: items.length })}</span>
        <button className="ank-x" onClick={onClose} aria-label={t("Close export")}>
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="seg" role="radiogroup" aria-label={t("Card style")}>
        {STYLES.map((s) => (
          <button key={s.id} role="radio" aria-checked={style === s.id} className={style === s.id ? "on" : ""} onClick={() => setStyle(s.id)}>
            {t(s.label)}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="ank-empty">{t("Tick the corrections you want to practise in Anki. Each one becomes a card with the right answer and its explanation.")}</p>
      ) : !card ? (
        <div className="acard acard-wait" aria-busy="true">
          <span className="ank-spin" />
          {style === "situation" ? t("Writing situations…") : t("Making cards…")}
        </div>
      ) : (
        <>
          {notice[style] && (
            <p className="ank-note">
              <Icon name="hint" size={14} /> {t(notice[style]!)}
            </p>
          )}
          <div className="acard" aria-live="polite">
            {!editing ? (
              <>
                <div className="eyebrow">{t("Front")}</div>
                {card.style === "cloze" ? <ClozeFront card={card} L={L} /> : <div className="acard-sit">{card.front}</div>}
                <div className="acard-rule" />
                <div className="eyebrow">{tc("card side", "Back")}</div>
                <Answer card={card} L={L} />
                {card.explanation && <div className="acard-why">{card.explanation}</div>}
                <div className="acard-src">{card.source}</div>
              </>
            ) : (
              <CardEditor card={card} L={L} onChange={edit} />
            )}
            {problem(card) && (
              <p className="acard-err">
                <Icon name="alert" size={13} /> {problem(card)}
              </p>
            )}
          </div>
          <div className="ank-nav">
            <button className="ank-arrow" onClick={() => setIndex(i - 1)} disabled={i === 0} aria-label={t("Previous card")}>
              <Icon name="back" size={15} />
            </button>
            <span>
              {t("Card {n} of {total}", { n: i + 1, total: n })}
              {pending > 0 && ` ${t("({n} more coming)", { n: pending })}`} ·{" "}
              <button className="ank-edit" onClick={() => setEditing(!editing)} aria-pressed={editing}>
                {editing ? t("done editing") : t("edit before adding")}
              </button>
            </span>
            <button className="ank-arrow" onClick={() => setIndex(i + 1)} disabled={i >= n - 1} aria-label={t("Next card")}>
              <Icon name="arrow" size={15} />
            </button>
          </div>
        </>
      )}
      {skippedHere > 0 && (
        <p className="ank-note">
          {tn(skippedHere, "{count} correction you marked as not a mistake is skipped.", "{count} corrections you marked as not a mistake are skipped.")}
        </p>
      )}

      <div className="field">
        <label htmlFor="ank-deck">{t("Deck")}</label>
        <input
          id="ank-deck"
          className={cls("input", cjkClass(deck, L))}
          list="ank-decks"
          value={deck}
          onChange={(e) => setDeck(e.target.value)}
          placeholder={`${app.lang.name}::Sayfern corrections`}
        />
        <datalist id="ank-decks">
          {deckOptions.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
      </div>

      {!enabled ? (
        <p className="ank-warn">
          {t("Anki isn't connected.")}{" "}
          <button className="ank-link" onClick={() => navigate(settingsRoute("anki"))}>
            {t("Set it up in Settings")}
          </button>
        </p>
      ) : !connected ? (
        <p className="ank-warn">
          {t("Anki isn't answering. Open Anki, then check again.")}{" "}
          <button className="ank-link" onClick={() => void app.refreshAnki()}>
            {t("Check again")}
          </button>
        </p>
      ) : null}

      {result && <ExportSummary result={result} />}
      {error && (
        <p className="ank-error" role="alert">
          <Icon name="alert" size={14} /> {t(error)}
        </p>
      )}

      <button
        className="btn btn-l ank-go"
        onClick={() => void add()}
        disabled={!enabled || exporting || drafting || n === 0 || invalid > 0 || !deck.trim()}
        title={invalid > 0 ? t("Fix the cards marked with a problem first") : undefined}
      >
        <Icon name="cards" size={17} />
        {exporting ? t("Adding…") : n === 0 ? t("Add cards to Anki") : tn(n, "Add {count} card to Anki", "Add {count} cards to Anki")}
      </button>
    </aside>
  );
}

function ClozeFront({ card, L }: { card: AnkiCardDraft; L: string }) {
  const at = card.back.indexOf(card.gap);
  if (at < 0) return <div className={cls("acard-q", L)}>{card.front}</div>;
  return (
    <div className={cls("acard-q", L)}>
      {card.back.slice(0, at)}
      <span className="gap">{card.hint || " "}</span>
      {card.back.slice(at + card.gap.length)}
    </div>
  );
}

function Answer({ card, L }: { card: AnkiCardDraft; L: string }) {
  const at = card.gap ? card.back.indexOf(card.gap) : -1;
  return (
    <div className={cls("acard-a", L)}>
      {at >= 0 ? (
        <>
          {card.back.slice(0, at)}
          <b>{card.gap}</b>
          {card.back.slice(at + card.gap.length)}
        </>
      ) : (
        card.back
      )}
    </div>
  );
}

function CardEditor({ card, L, onChange }: { card: AnkiCardDraft; L: string; onChange(p: Partial<AnkiCardDraft>): void }) {
  const id = (f: string) => `ank-${f}-${card.correctionId}`;
  return (
    <div className="acard-form">
      {card.style === "situation" && (
        <div className="field">
          <label htmlFor={id("front")}>{t("Situation (front)")}</label>
          <textarea id={id("front")} className="input ta" rows={2} value={card.front} onChange={(e) => onChange({ front: e.target.value, fallback: false })} />
        </div>
      )}
      <div className="field">
        <label htmlFor={id("back")}>{t("Sentence (back)")}</label>
        <input id={id("back")} className={cls("input", L)} value={card.back} onChange={(e) => onChange({ back: e.target.value })} />
      </div>
      <div className="acard-row">
        <div className="field">
          <label htmlFor={id("gap")}>{card.style === "cloze" ? t("Hidden part") : t("Highlighted part")}</label>
          <input id={id("gap")} className={cls("input", L)} value={card.gap} onChange={(e) => onChange({ gap: e.target.value })} />
        </div>
        {card.style === "cloze" && (
          <div className="field">
            <label htmlFor={id("hint")}>{t("Hint")}</label>
            <input id={id("hint")} className="input" value={card.hint ?? ""} onChange={(e) => onChange({ hint: e.target.value })} />
          </div>
        )}
      </div>
      <div className="field">
        <label htmlFor={id("why")}>{t("Explanation")}</label>
        <textarea id={id("why")} className="input ta" rows={2} value={card.explanation} onChange={(e) => onChange({ explanation: e.target.value })} />
      </div>
    </div>
  );
}

function ExportSummary({ result }: { result: ExportAnkiCardsResult }) {
  const parts: string[] = [];
  if (result.added) parts.push(tn(result.added, "Added {count} card to {deck}.", "Added {count} cards to {deck}.", { deck: result.deck }));
  if (result.duplicates) parts.push(tn(result.duplicates, "{count} was already there.", "{count} were already there."));
  if (!result.added && !result.duplicates) parts.push(t("No cards were added."));
  const failed = result.results.filter((r) => r.status === "failed");
  return (
    <div className={cls("ank-done", failed.length > 0 && !result.added && "bad")} role="status">
      <Icon name={failed.length && !result.added ? "alert" : "check"} size={15} />
      <div>
        <p>{parts.join(" ")}</p>
        {failed.length > 0 && (
          <p className="ank-fail">
            {tn(failed.length, "{count} card failed", "{count} cards failed")}: {[...new Set(failed.map((f) => t(f.error ?? "Unknown error")))].join(" ")}
          </p>
        )}
      </div>
    </div>
  );
}
