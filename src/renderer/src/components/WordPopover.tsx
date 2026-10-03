// S1-07 / S1-09: one word popover for the whole app. AnnotatedText (and any other
// screen) opens it with openWordPopover(); <WordPopoverHost/> renders it once in App.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { DictionaryProgress, DictionaryStatus, LookupResult, Token } from "../../../shared/lang";
import type { Language, SourceRef } from "../../../shared/records";
import { api, errorText } from "../api";
import { useApp } from "../context";
import { clearLookups, lookupCached } from "../lib/cache";
import { cls, fmtShortDate } from "../lib/format";
import { Icon } from "./icons";
import { SpeakButtons } from "./Speak";
import { t, tn } from "../i18n";

export interface WordPopoverRequest {
  /** Unique per rendered token, used to mark the selected word. */
  key: string;
  anchor: HTMLElement;
  token: Token;
  language: Language;
  /** Sentence containing the word, saved with it. */
  sentence: string;
  source?: SourceRef;
  /** Click-opened popovers stay until dismissed; hover-opened ones close when the pointer leaves. */
  pinned: boolean;
}

let current: WordPopoverRequest | null = null;
let closeTimer: number | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openWordPopover(req: WordPopoverRequest): void {
  window.clearTimeout(closeTimer);
  current = req;
  emit();
}

export function closeWordPopover(): void {
  window.clearTimeout(closeTimer);
  if (!current) return;
  const anchor = current.anchor;
  current = null;
  emit();
  if (anchor.isConnected && document.activeElement === document.body) anchor.focus({ preventScroll: true });
}

/** Hover-out: close soon unless the pointer reaches the popover or the popover is pinned. */
export function scheduleCloseWordPopover(key: string): void {
  window.clearTimeout(closeTimer);
  closeTimer = window.setTimeout(() => {
    if (current && current.key === key && !current.pinned) closeWordPopover();
  }, 260);
}

export function cancelCloseWordPopover(): void {
  window.clearTimeout(closeTimer);
}

export function useWordPopover(): WordPopoverRequest | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

const WIDTH = 340;
const GAP = 10;
const MARGIN = 12;

export function WordPopoverHost() {
  const req = useWordPopover();
  if (!req) return null;
  return <WordPopover key={req.key} req={req} />;
}

function WordPopover({ req }: { req: WordPopoverRequest }) {
  const { lang, languages } = useApp();
  const info = languages.find((l) => l.id === req.language) ?? lang;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; arrow: number; above: boolean } | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [reloads, setReloads] = useState(0);
  const word = req.token.lemma ?? req.token.text;

  useEffect(() => {
    let alive = true;
    setError(null);
    lookupCached(req.language, word)
      .then((r) => alive && setResult(r))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [req.language, word, reloads]);

  // Position: below the word, flipped above when there is no room; clamped to the viewport.
  useLayoutEffect(() => {
    const place = () => {
      if (!req.anchor.isConnected) return closeWordPopover();
      const r = req.anchor.getBoundingClientRect();
      const h = ref.current?.offsetHeight ?? 220;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const center = r.left + r.width / 2;
      const left = Math.max(MARGIN, Math.min(center - 44, vw - WIDTH - MARGIN));
      const below = r.bottom + GAP;
      const above = below + h > vh - MARGIN && r.top - GAP - h > MARGIN;
      const top = above ? r.top - GAP - h : Math.min(below, Math.max(MARGIN, vh - MARGIN - h));
      const arrow = Math.max(18, Math.min(center - left - 6, WIDTH - 30));
      setPos((p) => (p && p.left === left && p.top === top && p.arrow === arrow && p.above === above ? p : { left, top, arrow, above }));
    };
    place();
    const ro = new ResizeObserver(place);
    if (ref.current) ro.observe(ref.current);
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [req.anchor]);

  // Escape and outside clicks. Capture phase so an open sheet underneath stays open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      closeWordPopover();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || req.anchor.contains(t)) return;
      closeWordPopover();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [req.anchor]);

  const entry = result?.entries[0];
  const reading = entry?.reading ?? req.token.reading;
  const headword = entry?.headword ?? word;

  const save = async () => {
    if (!req.source) return;
    setSaved("saving");
    try {
      await api.saveWord({
        language: req.language,
        word: headword,
        reading,
        definition: entry?.senses.slice(0, 2).map((s) => s.glosses.join("; ")).join(" / "),
        sentence: req.sentence,
        source: req.source,
      });
      setSaved("saved");
    } catch (e) {
      setSaved("idle");
      setError(errorText(e));
    }
  };

  return (
    <div
      ref={ref}
      className={cls("pop", pos?.above && "above")}
      role="dialog"
      aria-label={`${headword}${reading ? `, ${reading}` : ""}`}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: WIDTH, ["--arrow" as string]: `${pos?.arrow ?? 30}px` }}
      onPointerEnter={cancelCloseWordPopover}
      onPointerLeave={() => scheduleCloseWordPopover(req.key)}
      onPointerDown={() => {
        if (!req.pinned) openWordPopover({ ...req, pinned: true });
      }}
    >
      <div className="pop-head">
        <div className="pop-word">
          <span className={cls("hw", info.fontClass)}>{headword}</span>
          {reading && <span className="pin">{reading}</span>}
        </div>
        <SpeakButtons id={`w:${req.language}:${headword}`} text={headword} language={req.language} kind="word" sessionId={req.source?.kind === "session" ? req.source.sessionId : undefined} />
      </div>

      {req.token.lemma && req.token.lemma !== req.token.text && (
        <div className="pop-note">
          {t("Dictionary form of")} <span className={info.fontClass}>{req.token.text}</span>
        </div>
      )}

      {!result && !error && (
        <div className="pop-skel" aria-label={t("Looking up")}>
          <i style={{ width: "72%" }} />
          <i style={{ width: "48%" }} />
        </div>
      )}

      {result?.needsDictionary && <InstallDictionary language={req.language} hasFallback={result.entries.length > 0} onInstalled={() => setReloads((n) => n + 1)} />}

      {result && !result.needsDictionary && result.entries.length === 0 && (
        <div className="pop-note">
          {result.noDictionary
            ? t("No dictionary for this language in your interface language yet. The tutor can explain it if you ask.")
            : t("Not in the dictionary. The tutor can explain it if you ask.")}
        </div>
      )}

      {result && result.entries.length > 0 && (
        <div className="senses">
          {result.entries.slice(0, 2).map((e, ei) => (
            <div key={ei} className="entry">
              {ei > 0 && (
                <div className="entry-alt">
                  <span className={info.fontClass}>{e.headword}</span> <span className="mono">{e.reading}</span>
                </div>
              )}
              <ol className={e.senses.length > 1 ? "multi" : undefined}>
                {e.senses.slice(0, 3).map((s, si) => (
                  <li key={si}>
                    {s.glosses.join("; ")}
                    {s.tags && s.tags.length > 0 && <span className="tag"> · {s.tags.join(", ")}</span>}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}

      {result?.firstUsedAt && (
        <div className="first">
          <Icon name="check" size={14} stroke={2.2} />
          {firstUsedLine(result.firstUsedAt)}
        </div>
      )}

      {error && <div className="pop-err">{t(error)}</div>}

      {result?.anki && (
        <div className="meta">
          <Icon name="cards" size={14} />
          <span>
            {tn(result.anki.reps, "In your Anki · {count} review", "In your Anki · {count} reviews")}
            {" · "}
            {result.anki.interval > 0 ? tn(result.anki.interval, "every {count} day", "every {count} days") : t("new")}
            {result.anki.lapses > 2 ? ` · ${t("tricky")}` : ""}
          </span>
        </div>
      )}

      <div className="pop-actions">
        <button
          className={cls("btn btn-s", saved === "saved" ? "btn-saved" : "btn-f")}
          onClick={save}
          disabled={!req.source || saved !== "idle"}
          title={req.source ? t("Keep this word with the sentence it came from") : undefined}
        >
          {saved === "saved" ? (
            <>
              <Icon name="check" size={14} stroke={2.4} /> {t("Saved")}
            </>
          ) : saved === "saving" ? (
            t("Saving…")
          ) : (
            t("Save with sentence")
          )}
        </button>
        <button className="btn btn-s" onClick={closeWordPopover}>
          {t("Close")}
        </button>
      </div>
    </div>
  );
}

function firstUsedLine(at: number): string {
  const days = Math.round((startOfToday() - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return t("You used it today for the first time.");
  if (days === 1) return t("You first used it yesterday.");
  if (days < 7) return tn(days, "You first used it {count} day ago.", "You first used it {count} days ago.");
  return t("You first used it on {date}.", { date: fmtShortDate(at) });
}

function startOfToday(): number {
  return new Date().setHours(0, 0, 0, 0);
}

function InstallDictionary({ language, hasFallback, onInstalled }: { language: Language; hasFallback?: boolean; onInstalled(): void }) {
  const [status, setStatus] = useState<DictionaryStatus | null>(null);
  const [progress, setProgress] = useState<DictionaryProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.dictionaryStatus(language).then(setStatus).catch(() => {});
    return api.onDictionaryProgress((p) => {
      if (p.language !== language) return;
      setProgress(p);
      if (p.phase === "error") setError(p.message ?? t("Install failed"));
    });
  }, [language]);

  const install = async () => {
    setError(null);
    setProgress({ language, phase: "download", fraction: 0 });
    try {
      const s = await api.installDictionary(language);
      setStatus(s);
      if (s.installed) {
        clearLookups(language);
        onInstalled();
      } else if (s.error) setError(s.error);
    } catch (e) {
      setError(errorText(e));
      setProgress(null);
    }
  };

  const busy = !!progress && progress.phase !== "done" && progress.phase !== "error";
  const phaseLabel: Record<DictionaryProgress["phase"], string> = {
    download: t("Downloading"),
    parse: t("Reading entries"),
    index: t("Building the index"),
    done: t("Installed"),
    error: t("Failed"),
  };

  return (
    <div className="dict">
      <div className="dict-t">{hasFallback ? t("Meanings in your language need another dictionary") : t("Meanings need a dictionary")}</div>
      <div className="dict-s">
        {status ? t("{name} · {license}. Installed once, works offline.", { name: status.name, license: status.license }) : t("Installed once, works offline.")}
      </div>
      {busy ? (
        <div className="dict-prog" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress?.fraction ?? 0) * 100)}>
          <div className="bar">
            <i style={{ width: `${Math.round((progress?.fraction ?? 0.05) * 100)}%` }} />
          </div>
          <span>
            {phaseLabel[progress!.phase]}
            {progress?.fraction != null ? ` · ${Math.round(progress.fraction * 100)}%` : "…"}
          </span>
        </div>
      ) : (
        <button className="btn btn-s btn-p" onClick={install}>
          <Icon name="download" size={15} stroke={2} />
          {status ? t("Install {name} ({mb} MB)", { name: status.name, mb: status.downloadMb }) : t("Install the dictionary")}
        </button>
      )}
      {error && <div className="pop-err">{t(error)}</div>}
    </div>
  );
}
