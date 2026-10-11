// Reader (S1-11, S1-12): a paper page of the document with readings, lookups and a
// checkpoint, plus the reading session with the tutor on the right.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Language, LibraryDoc, LibraryParagraph, SourceRef } from "../../../shared/records";
import { api, errorText } from "../api";
import { AnnotatedText } from "../components/AnnotatedText";
import { Composer } from "../components/Composer";
import { Fern, Icon } from "../components/icons";
import { MessageList } from "../components/MessageList";
import { ModelPicker } from "../components/ModelPicker";
import { KIND_NAME, Switch } from "../components/ui";
import { useApp } from "../context";
import { stopStream } from "../lib/chatStream";
import { cjkClass, cls, fontOf, hasReadings, sentenceAt } from "../lib/format";
import { useActivityTracker, useStoredFlag } from "../lib/hooks";
import { useChat } from "../lib/useChat";
import { grammarRoute, readerRoute, sessionRoute, type Navigate } from "../router";
import { t } from "../i18n";

export interface ReaderScreenProps {
  language: Language;
  navigate: Navigate;
  docId: string;
  /** Scroll to this paragraph (0-based) instead of the checkpoint. */
  paragraph?: number;
}

const CHUNK = 40;
const LEAD = 6; // paragraphs loaded above the target so there is context

interface Sel {
  text: string;
  paragraph: number;
  offset: number;
  x: number;
  y: number;
}

export function ReaderScreen({ docId, paragraph, navigate }: ReaderScreenProps) {
  const app = useApp();
  const [doc, setDoc] = useState<LibraryDoc | null | undefined>(undefined);
  const [paras, setParas] = useState<LibraryParagraph[]>([]);
  const [loading, setLoading] = useState<"before" | "after" | "jump" | null>(null);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [paneError, setPaneError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [savedPhrase, setSavedPhrase] = useState<"idle" | "saving" | "saved">("idle");
  const [flash, setFlash] = useState<number | null>(null);
  const L = (doc?.language ?? app.language) as Language;
  const [ruby, setRuby] = useStoredFlag(`sayfern.ruby.${L}`, true);
  const scroller = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLElement>(null);
  const pendingScroll = useRef<number | null>(null);
  const prependAnchor = useRef<{ height: number; top: number } | null>(null);
  const topSentinel = useRef<HTMLDivElement>(null);
  const bottomSentinel = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);

  const chat = useChat(sessionId);
  const tracked = useActivityTracker(sessionId ?? "", !!sessionId);
  void tracked;

  // ---- load doc + reading session
  useEffect(() => {
    let alive = true;
    api
      .getDoc(docId)
      .then((d) => {
        if (!alive) return;
        setDoc(d);
        // Reading a book switches the workspace to its language (without leaving the reader).
        if (d && d.language !== app.language && app.languages.some((l) => l.id === d.language)) void app.updateSettings({ language: d.language });
      })
      .catch(() => alive && setDoc(null));
    api
      .openReading(docId)
      .then((v) => {
        if (!alive) return;
        setSessionId(v.meta.id);
        void app.refreshSessions();
      })
      .catch((e) => alive && setPaneError(errorText(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const first = paras[0]?.index ?? 0;
  const end = paras.length ? paras[paras.length - 1].index + 1 : 0;

  /** Load a fresh window around `target` and scroll to it. */
  const jumpTo = useCallback(
    async (target: number, highlight = true) => {
      if (!doc) return;
      const t = Math.max(0, Math.min(target, Math.max(0, doc.paragraphCount - 1)));
      if (highlight) setFlash(t);
      if (paras.length && t >= first && t < end) {
        pendingScroll.current = t;
        scrollToPending();
        return;
      }
      setLoading("jump");
      try {
        const from = Math.max(0, t - LEAD);
        const list = await api.getParagraphs(doc.id, from, CHUNK);
        pendingScroll.current = t;
        setParas(list);
      } catch (e) {
        setNotice(errorText(e));
      } finally {
        setLoading(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, paras.length, first, end],
  );

  const scrollToPending = () => {
    const t = pendingScroll.current;
    const el = t != null ? paper.current?.querySelector<HTMLElement>(`[data-p="${t}"]`) : null;
    const sc = scroller.current;
    if (!el || !sc) return;
    pendingScroll.current = null;
    const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
    sc.scrollTop = Math.max(0, top - 140);
  };

  // Initial window: the route's paragraph, else the checkpoint.
  const initial = useRef(false);
  useEffect(() => {
    if (!doc || initial.current) return;
    initial.current = true;
    void jumpTo(paragraph ?? doc.checkpoint?.paragraph ?? 0, paragraph != null);
  }, [doc, paragraph, jumpTo]);

  // Later route changes (e.g. a source chip for another paragraph of this doc)
  useEffect(() => {
    if (initial.current && paragraph != null) void jumpTo(paragraph);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paragraph]);

  useEffect(() => {
    if (flash == null) return;
    const t = window.setTimeout(() => setFlash(null), 1800);
    return () => window.clearTimeout(t);
  }, [flash]);

  // After render: keep position when paragraphs were prepended, or scroll to a jump target.
  useLayoutEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    if (prependAnchor.current) {
      sc.scrollTop = prependAnchor.current.top + (sc.scrollHeight - prependAnchor.current.height);
      prependAnchor.current = null;
    } else if (pendingScroll.current != null) scrollToPending();
  }, [paras]);

  const loadBefore = useCallback(async () => {
    if (!doc || loading || first <= 0) return;
    setLoading("before");
    try {
      const from = Math.max(0, first - CHUNK);
      const list = await api.getParagraphs(doc.id, from, first - from);
      const sc = scroller.current;
      if (sc) prependAnchor.current = { height: sc.scrollHeight, top: sc.scrollTop };
      setParas((cur) => [...list.filter((p) => p.index < (cur[0]?.index ?? Infinity)), ...cur]);
    } finally {
      setLoading(null);
    }
  }, [doc, loading, first]);

  const loadAfter = useCallback(async () => {
    if (!doc || loading || end >= doc.paragraphCount || !paras.length) return;
    setLoading("after");
    try {
      const list = await api.getParagraphs(doc.id, end, CHUNK);
      setParas((cur) => [...cur, ...list.filter((p) => p.index >= (cur[cur.length - 1]?.index ?? -1) + 1)]);
    } finally {
      setLoading(null);
    }
  }, [doc, loading, end, paras.length]);

  // Infinite scroll both ways
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          if (e.target === topSentinel.current) void loadBefore();
          if (e.target === bottomSentinel.current) void loadAfter();
        }
      },
      { root, rootMargin: "700px 0px" },
    );
    if (topSentinel.current) io.observe(topSentinel.current);
    if (bottomSentinel.current) io.observe(bottomSentinel.current);
    return () => io.disconnect();
  }, [loadBefore, loadAfter, paras.length]);

  // ---- checkpoint
  const setCheckpoint = async (p: number) => {
    if (!doc) return;
    const prev = doc;
    setDoc({ ...doc, checkpoint: { paragraph: p, offset: 0, at: Date.now() } });
    try {
      setDoc(await api.setCheckpoint(doc.id, p, 0));
    } catch (e) {
      setDoc(prev);
      setNotice(errorText(e));
    }
  };

  // ---- selection toolbar
  useEffect(() => {
    let t: number | undefined;
    const update = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const s = window.getSelection();
        if (!s || s.isCollapsed || !s.rangeCount) {
          if (!toolbar.current?.contains(document.activeElement)) setSel(null);
          return;
        }
        const range = s.getRangeAt(0);
        const text = s.toString().replace(/\s+/g, " ").trim();
        const host = (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement)?.closest<HTMLElement>("[data-p]");
        if (!text || !host || !paper.current?.contains(host)) return setSel(null);
        const r = range.getBoundingClientRect();
        const p = Number(host.dataset.p);
        const full = host.querySelector(".rd-t")?.textContent ?? "";
        setSavedPhrase("idle");
        setSel({ text: text.slice(0, 400), paragraph: p, offset: Math.max(0, full.indexOf(text)), x: r.left + r.width / 2, y: r.top });
      }, 90);
    };
    document.addEventListener("selectionchange", update);
    return () => {
      document.removeEventListener("selectionchange", update);
      window.clearTimeout(t);
    };
  }, []);

  const clearSel = () => {
    window.getSelection()?.removeAllRanges();
    setSel(null);
  };

  const ask = (kind: "ask" | "translate") => {
    if (!sel) return;
    if (!app.model) return setNotice(t("Connect a model in Settings to ask the tutor."));
    const q = L === "zh" || L === "ja" ? `「${sel.text}」` : `“${sel.text}”`;
    // The learner's own message to the tutor, in the interface language.
    const text =
      kind === "ask"
        ? t("About {quote} in paragraph {n}: what does this mean here, and why is it written this way?", { quote: q, n: sel.paragraph + 1 })
        : t("Could you translate {quote} for me?", { quote: q });
    chat.send({ text, pastedSpans: [sel.text] });
    stickPane.current = true;
    clearSel();
  };

  const savePhrase = async () => {
    if (!sel || !doc) return;
    setSavedPhrase("saving");
    const para = paras.find((p) => p.index === sel.paragraph);
    try {
      await api.saveWord({
        language: doc.language,
        word: sel.text.slice(0, 60),
        sentence: para ? sentenceAt(para.text, sel.offset) || para.text : sel.text,
        source: { kind: "library", docId: doc.id, paragraph: sel.paragraph, title: doc.title, quote: sel.text.slice(0, 120) },
      });
      setSavedPhrase("saved");
      window.setTimeout(clearSel, 900);
    } catch (e) {
      setSavedPhrase("idle");
      setNotice(errorText(e));
    }
  };

  // ---- tutor pane
  const paneScroller = useRef<HTMLDivElement>(null);
  const stickPane = useRef(true);
  useLayoutEffect(() => {
    const el = paneScroller.current;
    if (el && stickPane.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length, chat.stream?.text, chat.stream?.tools.length, chat.corrections.length, chat.view]);

  const openSource = useCallback(
    (s: SourceRef) => {
      if (s.kind === "library" && s.docId === docId) void jumpTo(s.paragraph);
      else navigate(s.kind === "library" ? readerRoute(s.docId, s.paragraph) : sessionRoute(s.sessionId));
    },
    [docId, jumpTo, navigate],
  );

  const source = useMemo(() => (doc ? (p: number): SourceRef => ({ kind: "library", docId: doc.id, paragraph: p, title: doc.title }) : null), [doc]);

  if (doc === null) {
    return (
      <main className="main">
        <header className="hdr drag" />
        <div className="placeholder">
          <div className="eyebrow">{t("Reader")}</div>
          <h1>{t("This book isn't in your library anymore.")}</h1>
          <p className="muted ph-p">{t("It may have been removed.")}</p>
          <button className="btn btn-p" onClick={() => navigate("library")}>
            {t("Back to Library")}
          </button>
        </div>
      </main>
    );
  }

  const cp = doc?.checkpoint?.paragraph;
  const pct = doc && doc.paragraphCount && cp != null ? Math.round((cp / doc.paragraphCount) * 100) : 0;
  const readingName = L === "ja" ? t("Furigana") : t("Pinyin");
  const F = fontOf(L);

  return (
    <>
      <main className="main reader">
        <header className="hdr drag rd-hdr">
          <div className="title">
            <div className="crumb eyebrow">
              <button className="crumb-b" onClick={() => navigate("library")}>
                {t("Library")}
              </button>
              <span aria-hidden="true">/</span>
            </div>
            <div className="title-row">
              <h1 className={cls("name rd-name", cjkClass(doc?.title ?? "", F))}>{doc?.title ?? ""}</h1>
              {doc && <span className="rd-kind">{t(KIND_NAME[doc.kind])}</span>}
            </div>
          </div>
          {hasReadings(L) && (
            <label className="ruby-tg">
              <span>{readingName}</span>
              <Switch checked={ruby} onChange={setRuby} label={L === "ja" ? t("Show furigana above words") : t("Show pinyin above words")} />
            </label>
          )}
          {doc && doc.paragraphCount > 0 && (
            <button
              className="chip chip-toggle cp-chip"
              onClick={() => cp != null && void jumpTo(cp)}
              disabled={cp == null}
              title={cp != null ? t("Go to where you stopped") : t("Click the margin next to a paragraph to mark your place")}
            >
              <Icon name="bookmark" size={15} />
              {cp != null ? (
                <span>{t("¶{n} of {total} · {pct}%", { n: cp + 1, total: doc.paragraphCount, pct })}</span>
              ) : (
                <span>{t("No bookmark yet")}</span>
              )}
            </button>
          )}
        </header>

        {notice && (
          <div className="banner bad floating" role="status">
            <Icon name="alert" size={15} />
            <span>{t(notice)}</span>
            <button className="iconb sm" aria-label={t("Dismiss")} onClick={() => setNotice(null)}>
              <Icon name="x" size={14} />
            </button>
          </div>
        )}

        <div className="rd-scroll" ref={scroller} onScroll={() => sel && setSel(null)}>
          <article className={cls("paper", ruby && "ruby-on")} ref={paper} aria-label={doc?.title}>
            <div ref={topSentinel} className="sentinel" />
            {first > 0 && paras.length > 0 && (
              <div className="rd-more" aria-live="polite">
                {loading === "before" ? t("Loading earlier pages…") : t("¶1 to ¶{n} above", { n: first })}
              </div>
            )}
            {doc && doc.paragraphCount === 0 && (
              <div className="rd-empty">
                <Icon name="alert" size={20} />
                <h2>{t("Nothing to read here yet.")}</h2>
                <p>{doc.warnings[0] ? t(doc.warnings[0]) : t("This file had no text Sayfern could read.")}</p>
              </div>
            )}
            {paras.map((p, i) => {
              const prev = paras[i - 1];
              const showHeading = p.heading && (!prev || prev.heading !== p.heading);
              const read = cp != null && p.index < cp;
              return (
                <Fragment key={p.index}>
                  {showHeading && <h2 className={cls("rd-h", F)}>{p.heading}</h2>}
                  {cp === p.index && p.index > 0 && (
                    <div className="stop" aria-label={t("You stopped here")}>
                      <span>
                        <Icon name="bookmark" size={12} stroke={2} /> {t("You stopped here")}
                      </span>
                    </div>
                  )}
                  <div className={cls("rd-p", read && "read", flash === p.index && "flash", cp === p.index && "cp")} data-p={p.index}>
                    <button
                      className="rd-mark"
                      onClick={() => void setCheckpoint(p.index)}
                      aria-label={t("Pick up from paragraph {n} next time", { n: p.index + 1 })}
                      title={t("Pick up here next time")}
                    >
                      <span className="rd-n">{p.index + 1}</span>
                      <Icon name="bookmark" size={14} />
                    </button>
                    <AnnotatedText language={L} text={p.text} source={source?.(p.index)} ruby={ruby} className="rd-t" />
                  </div>
                </Fragment>
              );
            })}
            <div ref={bottomSentinel} className="sentinel" />
            {doc && paras.length > 0 && end >= doc.paragraphCount && <div className="rd-end">{t("The end · {title}", { title: doc.title })}</div>}
            {doc && paras.length > 0 && end < doc.paragraphCount && <div className="rd-more">{loading === "after" ? t("Loading…") : " "}</div>}
          </article>
        </div>

        {sel && (
          <div
            ref={toolbar}
            className="seltool"
            role="toolbar"
            aria-label={t("Selected text")}
            style={{ left: Math.max(260, Math.min(sel.x, window.innerWidth - 560)), top: Math.max(86, sel.y - 52) }}
            onPointerDown={(e) => e.preventDefault()}
          >
            <button onClick={() => ask("ask")}>
              <Icon name="sessions" size={15} />
              {t("Ask tutor")}
            </button>
            <button onClick={() => ask("translate")}>
              <Icon name="translate" size={15} />
              {t("Translate")}
            </button>
            <button onClick={() => void savePhrase()} disabled={savedPhrase !== "idle"}>
              <Icon name={savedPhrase === "saved" ? "check" : "bookmark"} size={15} stroke={savedPhrase === "saved" ? 2.4 : 1.6} />
              {savedPhrase === "saved" ? t("Saved") : savedPhrase === "saving" ? t("Saving…") : t("Save phrase")}
            </button>
          </div>
        )}
      </main>

      <aside className="rpane" aria-label={t("Reading with your tutor")}>
        <div className="rpane-h">
          <span className="av">
            <Fern size={15} />
          </span>
          <b>{t("Reading with your tutor")}</b>
          {sessionId && (
            <button className="linkb" onClick={() => navigate(sessionRoute(sessionId))}>
              {t("Open as session")}
            </button>
          )}
        </div>
        <div
          className="rpane-convo"
          ref={paneScroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickPane.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          }}
        >
          {paneError ? (
            <p className="err">
              <Icon name="alert" size={15} /> {t(paneError)}
            </p>
          ) : chat.view ? (
            <MessageList
              language={L}
              messages={chat.messages}
              corrections={chat.corrections}
              targets={chat.targets}
              grammarById={chat.grammarById}
              model={app.model}
              streaming={chat.stream ? { text: chat.stream.text, tools: chat.stream.tools, error: chat.stream.error } : null}
              translations={{}}
              onCorrectionUpdate={chat.onCorrectionUpdate}
              onOpenGrammar={(g) => navigate(grammarRoute(g))}
              onOpenSource={openSource}
              onRetry={chat.retry}
              empty={
                <div className="rpane-empty">
                  <p>{t("Ask about anything on the page.")}</p>
                  <p className="muted small">{t("Select a passage to quote it, translate it or save it.")}</p>
                </div>
              }
            />
          ) : (
            <div className="thinking" aria-label={t("Opening the reading session")}>
              <i />
              <i />
              <i />
            </div>
          )}
        </div>
        <div className="rpane-composer">
          <Composer
            key={sessionId ?? "none"}
            language={L}
            busy={chat.busy}
            disabled={!app.model || !sessionId}
            disabledReason={!app.model ? t("Connect a model in Settings to start") : t("Opening…")}
            onSend={(input) => {
              stickPane.current = true;
              chat.send(input);
            }}
            onStop={() => sessionId && stopStream(sessionId)}
            sessionId={sessionId ?? undefined}
            hint={false}
            left={<ModelPicker />}
          />
        </div>
      </aside>
    </>
  );
}
