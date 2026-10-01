// Library (S1-10): the shelf per language, import, search, rename/delete, saved words.
import { useCallback, useEffect, useRef, useState } from "react";
import type { DocKind, Language, LibraryDoc, LibraryHit, SavedWord } from "../../../shared/records";
import { api, errorText } from "../api";
import { Icon } from "../components/icons";
import { Cover, KIND_HINT, KIND_ICON, KIND_NAME, PopMenu } from "../components/ui";
import { useApp } from "../context";
import { cjkClass, cls, fmtDay, fmtNumber } from "../lib/format";
import { readerRoute, sessionRoute, type Navigate } from "../router";

export interface LibraryScreenProps {
  language: Language;
  navigate: Navigate;
}

const KINDS: DocKind[] = ["textbook", "reader", "personal", "other"];
const FORMATS = ".txt, .md, .html, .epub and PDFs with a text layer";

export function LibraryScreen({ language, navigate }: LibraryScreenProps) {
  const app = useApp();
  const L = app.lang.fontClass;
  const [docs, setDocs] = useState<LibraryDoc[] | null>(null);
  const [words, setWords] = useState<SavedWord[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<LibraryHit[] | null>(null);
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    const [d, w] = await Promise.all([api.listDocs(language), api.listSavedWords(language).catch(() => [] as SavedWord[])]);
    const lastRead = (x: LibraryDoc) => x.checkpoint?.at ?? x.addedAt;
    setDocs([...d].sort((a, b) => lastRead(b) - lastRead(a)));
    setWords([...w].sort((a, b) => b.createdAt - a.createdAt));
  }, [language]);

  useEffect(() => {
    load().catch((e) => setNotice({ text: errorText(e), bad: true }));
  }, [load]);

  // Debounced library search
  useEffect(() => {
    const q = query.trim();
    if (!q) return setHits(null);
    let alive = true;
    const t = window.setTimeout(() => {
      api
        .searchLibrary(language, q)
        .then((h) => alive && setHits(h))
        .catch((e) => alive && setNotice({ text: errorText(e), bad: true }));
    }, 220);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [query, language]);

  const add = async (kind: DocKind) => {
    setImporting(true);
    setNotice(null);
    try {
      const added = await api.importDocs(language, kind);
      if (added.length) {
        await load();
        const warned = added.filter((d) => d.warnings.length).length;
        setNotice({
          text: `Added ${added.length === 1 ? added[0].title : `${added.length} files`}${warned ? `. ${warned} need attention.` : "."}`,
        });
      }
    } catch (e) {
      setNotice({ text: errorText(e), bad: true });
      void load(); // some files may have been added before one failed
    } finally {
      setImporting(false);
    }
  };

  const addMenu = (primary: boolean) => (
    <PopMenu
      label="Add material"
      buttonClass={cls("btn", primary ? "btn-p" : "btn-f")}
      trigger={
        <>
          <Icon name="plus" size={16} stroke={2} />
          {importing ? "Adding…" : "Add material"}
        </>
      }
      header="What are you adding?"
      items={KINDS.map((k) => ({ label: KIND_NAME[k], hint: KIND_HINT[k], icon: KIND_ICON[k], onSelect: () => void add(k) }))}
      footer={<>Works with {FORMATS}.</>}
    />
  );

  const docCount = docs?.length ?? 0;

  return (
    <main className="main page">
      <div className="page-drag drag" />
      <div className="page-in">
        <header className="page-head">
          <div>
            <div className="eyebrow">{app.lang.name} · Library</div>
            <h1 className="display">Your shelf</h1>
            <p className="page-sub">
              {docs === null
                ? " "
                : docCount === 0 && words.length === 0
                  ? "Nothing here yet"
                  : `${docCount} ${docCount === 1 ? "book or note" : "books and notes"} · ${words.length} saved ${words.length === 1 ? "word" : "words"}`}
            </p>
          </div>
          <div className="page-actions">
            <div className="search">
              <Icon name="search" size={16} />
              <label htmlFor="lib-search" className="sr">
                Search your library
              </label>
              <input
                id="lib-search"
                className={cls("input", L)}
                type="search"
                placeholder={language === "zh" ? "Search, e.g. 除了" : "Search, e.g. 桃太郎"}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              />
            </div>
            {addMenu(true)}
          </div>
        </header>

        {notice && (
          <div className={cls("banner", notice.bad && "bad")} role="status">
            <Icon name={notice.bad ? "alert" : "check"} size={15} stroke={notice.bad ? 1.6 : 2.2} />
            <span>{notice.text}</span>
            <button className="iconb sm" aria-label="Dismiss" onClick={() => setNotice(null)}>
              <Icon name="x" size={14} />
            </button>
          </div>
        )}

        {query.trim() ? (
          <SearchResults hits={hits} query={query.trim()} L={L} onOpen={(h) => navigate(readerRoute(h.docId, h.paragraph))} />
        ) : docs === null ? (
          <div className="shelf">
            {[0, 1, 2].map((i) => (
              <div key={i} className="doc skel" />
            ))}
          </div>
        ) : docs.length === 0 ? (
          <div className="lib-empty card">
            <div className="lib-empty-art" aria-hidden="true">
              <Cover kind="reader" title={language === "zh" ? "书" : "本"} />
              <Cover kind="textbook" title={language === "zh" ? "课" : "課"} />
              <Cover kind="personal" title={language === "zh" ? "我" : "私"} />
            </div>
            <div className="lib-empty-t">
              <h2>Bring what you're already reading.</h2>
              <p>
                Add a textbook, a graded reader or a few notes about your life. You can read them here with the tutor, and it quotes them when it
                explains something.
              </p>
              <p className="muted small">Works with {FORMATS}. Scanned PDFs need a text layer.</p>
              <div className="row-gap">{addMenu(false)}</div>
            </div>
          </div>
        ) : (
          <>
            <div className="eyebrow sub">On your shelf</div>
            <div className="shelf">
              {docs.map((d) => (
                <DocCard
                  key={d.id}
                  doc={d}
                  L={L}
                  onOpen={() => navigate(readerRoute(d.id))}
                  onChanged={(next) => setDocs((list) => (list ?? []).map((x) => (x.id === next.id ? next : x)))}
                  onDeleted={() => setDocs((list) => (list ?? []).filter((x) => x.id !== d.id))}
                  onError={(text) => setNotice({ text, bad: true })}
                />
              ))}
            </div>
          </>
        )}

        <section className="saved" aria-labelledby="saved-h">
          <div className="saved-h">
            <h2 id="saved-h" className="eyebrow">
              Saved words
            </h2>
            {words.length > 0 && <span className="muted small">Saved from lookups, with the sentence they came from</span>}
          </div>
          {words.length === 0 ? (
            <div className="ghost-card">Hover any word, in a chat or a book, and choose Save with sentence. It lands here.</div>
          ) : (
            <ul className="wlist">
              {words.map((w) => (
                <li key={w.id} className="wrow">
                  <span className={cls("wrow-w", L)}>{w.word}</span>
                  <span className="wrow-m">
                    <span className="wrow-d">
                      {w.reading && <span className="wrow-r">{w.reading}</span>}
                      {w.definition}
                    </span>
                    <span className={cls("wrow-s", L)}>{w.sentence}</span>
                  </span>
                  <button
                    className="chip chip-s"
                    onClick={() => navigate(w.source.kind === "library" ? readerRoute(w.source.docId, w.source.paragraph) : sessionRoute(w.source.sessionId))}
                  >
                    <Icon name={w.source.kind === "library" ? "library" : "sessions"} size={13} />
                    {w.source.kind === "library" ? `${w.source.title ?? "Library"} · ¶${w.source.paragraph + 1}` : "From a chat"}
                  </button>
                  <span className="wrow-at">{fmtDay(w.createdAt)}</span>
                  <button
                    className="iconb sm"
                    aria-label={`Remove ${w.word} from saved words`}
                    title="Remove"
                    onClick={async () => {
                      setWords((list) => list.filter((x) => x.id !== w.id));
                      await api.deleteSavedWord(w.id).catch((e) => setNotice({ text: errorText(e), bad: true }));
                    }}
                  >
                    <Icon name="x" size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function DocCard({
  doc,
  L,
  onOpen,
  onChanged,
  onDeleted,
  onError,
}: {
  doc: LibraryDoc;
  L: string;
  onOpen(): void;
  onChanged(d: LibraryDoc): void;
  onDeleted(): void;
  onError(t: string): void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [draft, setDraft] = useState(doc.title);
  const input = useRef<HTMLInputElement>(null);
  const cp = doc.checkpoint;
  const pct = doc.paragraphCount ? Math.round(((cp?.paragraph ?? 0) / doc.paragraphCount) * 100) : 0;

  const rename = async () => {
    setRenaming(false);
    const t = draft.trim();
    if (!t || t === doc.title) return setDraft(doc.title);
    onChanged({ ...doc, title: t });
    try {
      onChanged(await api.renameDoc(doc.id, t));
    } catch (e) {
      onChanged(doc);
      onError(errorText(e));
    }
  };

  return (
    <div className={cls("doc", confirm && "confirming")}>
      <button className="doc-open" onClick={onOpen} aria-label={`Open ${doc.title}`} disabled={renaming}>
        <Cover kind={doc.kind} title={doc.title} />
        <span className="doc-t">
          {!renaming && <b className={cjkClass(doc.title, L)}>{doc.title}</b>}
          {renaming && <span className="doc-title-space" />}
          <span className="doc-k">
            {KIND_NAME[doc.kind]} · {doc.format.toUpperCase()}
            {doc.paragraphCount > 0 && ` · ${fmtNumber(doc.paragraphCount)} ¶`}
          </span>
          {doc.warnings.length > 0 ? (
            <span className="warnb" title={doc.warnings.join("\n")}>
              <Icon name="alert" size={13} />
              {doc.warnings.length === 1 ? "Needs attention" : `${doc.warnings.length} warnings`}
            </span>
          ) : cp ? (
            <span className="doc-prog">
              <span className="prog" aria-hidden="true">
                <i style={{ width: `${Math.max(pct, 2)}%` }} />
              </span>
              <span>
                {pct}% · stopped at ¶{cp.paragraph + 1}
              </span>
            </span>
          ) : (
            <span className="doc-prog muted">Not started</span>
          )}
        </span>
      </button>
      {renaming && (
        <form
          className="doc-rename"
          onSubmit={(e) => {
            e.preventDefault();
            void rename();
          }}
        >
          <label className="sr" htmlFor={`rn-${doc.id}`}>
            Title
          </label>
          <input
            id={`rn-${doc.id}`}
            ref={input}
            className={cls("name-input", L)}
            value={draft}
            autoFocus
            maxLength={120}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void rename()}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setDraft(doc.title);
                setRenaming(false);
              }
            }}
          />
        </form>
      )}
      {!renaming && !confirm && (
        <PopMenu
          className="doc-more"
          label={`More actions for ${doc.title}`}
          trigger={<Icon name="more" size={18} stroke={2.6} />}
          items={[
            { label: "Rename", icon: "pen", onSelect: () => setRenaming(true) },
            { label: "Remove from library", icon: "trash", danger: true, onSelect: () => setConfirm(true) },
          ]}
        />
      )}
      {doc.warnings.length > 0 && <p className="doc-warn">{doc.warnings[0]}</p>}
      {confirm && (
        <div className="doc-confirm" role="alertdialog" aria-label={`Remove ${doc.title}?`}>
          <span>Remove it? Your reading position goes too.</span>
          <button className="btn btn-s" autoFocus onClick={() => setConfirm(false)}>
            Keep
          </button>
          <button
            className="btn btn-s btn-danger"
            onClick={async () => {
              try {
                await api.deleteDoc(doc.id);
                onDeleted();
              } catch (e) {
                setConfirm(false);
                onError(errorText(e));
              }
            }}
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

function SearchResults({ hits, query, L, onOpen }: { hits: LibraryHit[] | null; query: string; L: string; onOpen(h: LibraryHit): void }) {
  if (!hits) return <p className="muted small search-status">Searching…</p>;
  if (hits.length === 0)
    return (
      <div className="ghost-card search-status">
        Nothing in your library matches <b className={L}>{query}</b>. Search looks inside every book and note in this language.
      </div>
    );
  return (
    <>
      <div className="eyebrow sub">
        {hits.length} {hits.length === 1 ? "match" : "matches"}
      </div>
      <ul className="hits">
        {hits.map((h) => (
          <li key={`${h.docId}:${h.paragraph}`}>
            <button className="hit" onClick={() => onOpen(h)}>
              <span className="hit-src">
                <b className={cjkClass(h.title, L)}>{h.title}</b>
                <span>
                  {h.heading && <span className={L}>{h.heading} · </span>}¶{h.paragraph + 1}
                </span>
              </span>
              <span className={cls("hit-t", L)}>
                <Highlight text={h.text} q={query} />
              </span>
              <Icon name="chevR" size={16} />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Highlight({ text, q }: { text: string; q: string }) {
  const parts = text.split(q);
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && <mark className="hl">{q}</mark>}
        </span>
      ))}
    </>
  );
}
