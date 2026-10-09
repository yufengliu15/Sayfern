// Review > Corrections (S2-01..S2-03). Owned by the review feature.
// Corrections across sessions with chip counts (computed in core), filters, "Hide answers and
// retry", and "Select for export" with the Anki export panel beside the list.
import { useEffect, useMemo, useState } from "react";
import type { Correction, Language } from "../../../../shared/records";
import type { ExportAnkiCardsResult, ReviewKindFilter, ReviewList, ReviewStatusFilter } from "../../../../shared/stage2";
import { api, errorText } from "../../api";
import { Icon } from "../../components/icons";
import { Switch } from "../../components/ui";
import { useApp } from "../../context";
import { cls, cjkClass } from "../../lib/format";
import { useStoredFlag } from "../../lib/hooks";
import type { Navigate } from "../../router";
import { AnkiExportPanel } from "./AnkiExportPanel";
import { CorrectionsItem } from "./CorrectionsItem";
import { msg, t } from "../../i18n";

export interface CorrectionsTabProps {
  language: Language;
  navigate: Navigate;
}

const KINDS: { id: ReviewKindFilter; label: string }[] = [
  { id: "all", label: msg("All") },
  { id: "grammar", label: msg("Grammar") },
  { id: "typo", label: msg("Typo") },
  { id: "speaking", label: msg("Speaking") },
];

const STATUSES: { id: ReviewStatusFilter; label: string }[] = [
  { id: "all", label: msg("Any status") },
  { id: "practise", label: msg("To practise") },
  { id: "fixed", label: msg("Fixed on retry") },
  { id: "not_exported", label: msg("Not in Anki yet") },
  { id: "disputed", label: msg("Not a mistake") },
];

export function CorrectionsTab({ language, navigate }: CorrectionsTabProps) {
  const app = useApp();
  const L = app.lang.fontClass;
  const [kind, setKind] = useState<ReviewKindFilter>("all");
  const [status, setStatus] = useState<ReviewStatusFilter>("all");
  const [grammarId, setGrammarId] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [list, setList] = useState<ReviewList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hide, setHide] = useStoredFlag("sayfern.review.hideAnswers", false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [reload, setReload] = useState(0);

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let alive = true;
    api
      .listReviewCorrections({ language, kind, status, ...(grammarId ? { grammarId } : {}), ...(search ? { search } : {}) })
      .then((l) => {
        if (!alive) return;
        setList(l);
        setError(null);
      })
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [language, kind, status, grammarId, search, reload]);

  // Selected items stay known to the panel even when a filter hides them.
  const [known, setKnown] = useState<Record<string, ReviewList["items"][number]>>({});
  useEffect(() => {
    if (!list) return;
    setKnown((cur) => {
      const next = { ...cur };
      for (const it of list.items) next[it.correction.id] = it;
      return next;
    });
  }, [list]);
  const selectedItems = useMemo(() => selected.map((id) => known[id]).filter((x) => !!x), [selected, known]);

  const update = (c: Correction) => {
    setList((cur) => (cur ? { ...cur, items: cur.items.map((it) => (it.correction.id === c.id ? { ...it, correction: c } : it)) } : cur));
    if (c.status === "disputed") setSelected((cur) => cur.filter((id) => id !== c.id));
  };

  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const shownSelectable = (list?.items ?? []).filter((it) => it.correction.status !== "disputed").map((it) => it.correction.id);
  const allShownSelected = shownSelectable.length > 0 && shownSelectable.every((id) => selected.includes(id));

  const exported = (r: ExportAnkiCardsResult) => {
    const done = new Set(r.results.filter((x) => x.status !== "failed").map((x) => x.correctionId));
    setSelected((cur) => cur.filter((id) => !done.has(id)));
    setReload((n) => n + 1);
  };

  const clearFilters = () => {
    setKind("all");
    setStatus("all");
    setGrammarId("");
    setQ("");
  };

  if (error && !list) {
    return (
      <p className="err">
        <Icon name="alert" size={15} /> {t(error)}
      </p>
    );
  }

  if (list && list.total === 0) {
    return (
      <div className="rv-empty">
        <span className="ph-i">
          <Icon name="pen" size={24} />
        </span>
        <h2 className="serif">{t("No corrections yet.")}</h2>
        <p className="muted">
          {t("When the tutor corrects something you wrote, it lands here with the fix and why. Come back to retry old sentences or turn them into Anki cards.")}
        </p>
        <button className="btn btn-p" onClick={() => void app.startSession()}>
          {t("Start a conversation")} <Icon name="arrow" size={16} stroke={2} />
        </button>
      </div>
    );
  }

  const counts = list?.counts;
  const filtered = status !== "all" || grammarId || search;

  return (
    <div className={cls("rv", selecting && "rv-selecting")}>
      <div className="rv-bar">
        <div className="rv-chips" role="radiogroup" aria-label={t("Filter by kind")}>
          {KINDS.map((k) => (
            <button key={k.id} role="radio" aria-checked={kind === k.id} className={kind === k.id ? "on" : ""} onClick={() => setKind(k.id)}>
              {t(k.label)}
              <span>{counts ? counts[k.id] : "·"}</span>
            </button>
          ))}
        </div>
        <div className="rv-tools">
          <label className="rv-switch" htmlFor="rv-hide">
            <span>{t("Hide answers and retry")}</span>
            <Switch id="rv-hide" checked={hide} onChange={setHide} label={t("Hide answers and retry")} />
          </label>
          <button className={cls("btn btn-s", selecting && "btn-p")} aria-pressed={selecting} onClick={() => setSelecting(!selecting)}>
            <Icon name="cards" size={15} />
            {selecting ? t("Done selecting") : t("Select for export")}
          </button>
        </div>
      </div>

      <div className="rv-bar rv-bar2">
        <div className="search">
          <Icon name="search" size={16} />
          <label htmlFor="rv-search" className="sr">
            {t("Search corrections")}
          </label>
          <input id="rv-search" className={cls("input", cjkClass(q, L))} type="search" placeholder={t("Search sentences, fixes, notes")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="sr" htmlFor="rv-status">
          {t("Status")}
        </label>
        <select id="rv-status" className="input select sm" value={status} onChange={(e) => setStatus(e.target.value as ReviewStatusFilter)}>
          {STATUSES.map((s) => (
            <option key={s.id} value={s.id}>
              {t(s.label)}
            </option>
          ))}
        </select>
        {(list?.grammarPoints.length ?? 0) > 0 && (
          <>
            <label className="sr" htmlFor="rv-grammar">
              {t("Grammar point")}
            </label>
            <select id="rv-grammar" className="input select sm rv-gsel" value={grammarId} onChange={(e) => setGrammarId(e.target.value)}>
              <option value="">{t("Any grammar point")}</option>
              {list!.grammarPoints.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.pattern} · {g.name} ({g.count})
                </option>
              ))}
            </select>
          </>
        )}
        {selecting && (
          <span className="rv-selall">
            <button className="linkb" onClick={() => setSelected(allShownSelected ? selected.filter((id) => !shownSelectable.includes(id)) : [...new Set([...selected, ...shownSelectable])])}>
              {allShownSelected ? t("Clear shown") : t("Select all shown")}
            </button>
          </span>
        )}
      </div>

      <div className="rv-body">
        <ul className="rv-list" aria-busy={!list}>
          {!list && [0, 1, 2, 3].map((i) => <li key={i} className="rv-item skel" />)}
          {list?.items.map((it) => (
            <CorrectionsItem
              key={it.correction.id}
              item={it}
              fontClass={L}
              hideAnswers={hide}
              selecting={selecting}
              selected={selected.includes(it.correction.id)}
              onToggle={() => toggle(it.correction.id)}
              onUpdate={update}
              model={app.model}
              navigate={navigate}
            />
          ))}
          {list && list.items.length === 0 && (
            <li className="rv-none">
              {filtered || kind !== "all" ? t("Nothing matches these filters.") : t("Nothing matches.")}{" "}
              <button className="linkb" onClick={clearFilters}>
                {t("Clear filters")}
              </button>
            </li>
          )}
        </ul>
        {selecting && (
          <AnkiExportPanel
            language={language}
            items={selectedItems}
            navigate={navigate}
            onExported={exported}
            onClose={() => setSelecting(false)}
          />
        )}
      </div>
    </div>
  );
}
