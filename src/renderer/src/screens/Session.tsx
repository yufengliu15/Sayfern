// The session screen (S1-05..S1-09, S1-24, F-07): conversation, corrections, lookups,
// translation, model choice, streaming and the inspector.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EndSummary } from "../../../shared/api";
import type { Correction, Difficulty, Language, SourceRef } from "../../../shared/records";
import { api, errorText } from "../api";
import { Composer, type ComposerHandle } from "../components/Composer";
import { EndSessionSheet } from "../components/EndSessionSheet";
import { Icon } from "../components/icons";
import { Inspector } from "../components/Inspector";
import { MessageList, type TranslationState } from "../components/MessageList";
import { SessionTools } from "../components/SessionTools";
import { ModelPicker } from "../components/ModelPicker";
import { useApp } from "../context";
import { translateCached } from "../lib/cache";
import { stopStream } from "../lib/chatStream";
import { cls, fmtUsage, KIND_LABEL, fontOf } from "../lib/format";
import { STARTERS } from "../lib/samples";
import { uiLocaleInfo } from "../../../shared/locales";
import { useActivityTracker, useStoredFlag } from "../lib/hooks";
import { useChat } from "../lib/useChat";
import { useAutoSpeak } from "../lib/voice";
import { grammarRoute, readerRoute, sessionRoute, type Navigate } from "../router";
import { langName, t, tj } from "../i18n";

export interface SessionScreenProps {
  id: string;
  language: Language;
  navigate: Navigate;
}


export function SessionScreen({ id, language: appLanguage, navigate }: SessionScreenProps) {
  const app = useApp();
  const chat = useChat(id);
  const { view, setView, stream, corrections, messages, grammarById, targets } = chat;
  const [inspectorOpen, setInspectorOpen] = useStoredFlag("sayfern.inspector", true);
  // Per tutor message: shown or hidden; messages not toggled follow the auto-translate setting.
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [translations, setTranslations] = useState<Record<string, TranslationState>>({});
  const requested = useRef(new Set<string>());
  const [summary, setSummary] = useState<EndSummary | null>(null);
  const [ending, setEnding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const composer = useRef<ComposerHandle>(null);
  const tracked = useActivityTracker(id, !!view);
  useAutoSpeak(id, messages, view?.meta.language ?? appLanguage, !!view);

  useEffect(() => {
    stick.current = true;
  }, [id]);

  // ⌘I toggles the inspector
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        setInspectorOpen(!inspectorOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inspectorOpen, setInspectorOpen]);

  // Translations (S1-08), cached per message
  const autoTranslate = !!app.settings.autoTranslate;
  useEffect(() => {
    if (!view) return;
    const next: Record<string, TranslationState> = {};
    for (const m of view.messages) {
      if (m.role !== "tutor" || !m.text || !(shown[m.id] ?? autoTranslate) || requested.current.has(m.id)) continue;
      requested.current.add(m.id);
      // A cached translation counts only when it is in the current interface language.
      if (m.translation && (m.translationLang ?? "English") === uiLocaleInfo(app.locale).promptName) {
        next[m.id] = { text: m.translation };
      } else if (app.model) {
        next[m.id] = { loading: true };
        translateCached(m.id, app.model)
          .then((text) => setTranslations((s) => ({ ...s, [m.id]: { text } })))
          .catch((e) => {
            requested.current.delete(m.id);
            setTranslations((s) => ({ ...s, [m.id]: { error: t("Couldn't translate: {error}", { error: errorText(e) }) } }));
          });
      } else {
        requested.current.delete(m.id);
        next[m.id] = { error: t("Connect a model to translate.") };
      }
    }
    if (Object.keys(next).length) setTranslations((s) => ({ ...s, ...next }));
  }, [shown, autoTranslate, view, app.model, app.locale]);

  // Stick to the bottom while the learner is at the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, stream?.text, stream?.tools.length, stream?.error, corrections.length, view, translations]);

  const chatCorrectionUpdate = chat.onCorrectionUpdate;
  const onCorrectionUpdate = useCallback((c: Correction) => {
    chatCorrectionUpdate(c);
    setSummary((s) => (s ? { ...s, corrections: s.corrections.map((x) => (x.id === c.id ? c : x)) } : s));
  }, [chatCorrectionUpdate]);

  const openGrammar = useCallback((gid: string) => navigate(grammarRoute(gid)), [navigate]);
  const openSource = useCallback(
    (s: SourceRef) => navigate(s.kind === "library" ? readerRoute(s.docId, s.paragraph) : sessionRoute(s.sessionId)),
    [navigate],
  );

  if (view === undefined) {
    return (
      <div className="main">
        <header className="hdr drag" />
        <div className="convo" />
      </div>
    );
  }

  if (view === null) {
    return (
      <div className="main">
        <header className="hdr drag" />
        <div className="placeholder">
          <div className="eyebrow">{t("Session")}</div>
          <h1>{t("This session isn't here anymore.")}</h1>
          <p className="muted">{t("It may have been deleted.")}</p>
          <button className="btn btn-p" onClick={() => navigate("today")}>
            {t("Back to Today")}
          </button>
        </div>
      </div>
    );
  }

  const meta = view.meta;
  const L = meta.language ?? appLanguage;
  const info = app.languages.find((l) => l.id === L) ?? app.lang;
  const busy = chat.busy;
  const sameLang = app.sessionsByLang[L] ?? [];
  const number = [...sameLang].sort((a, b) => a.createdAt - b.createdAt).findIndex((s) => s.id === meta.id) + 1;
  const focus = meta.focusGrammarId ? grammarById[meta.focusGrammarId] : undefined;
  const send = (input: { text: string; pastedSpans?: string[]; spoken?: boolean }) => {
    stick.current = true;
    chat.send(input);
  };

  const retry = () => {
    stick.current = true;
    chat.retry();
  };

  const setDifficulty = async (difficulty: Difficulty) => {
    if (difficulty === (meta.difficulty ?? 0)) return;
    setView((v) => (v ? { ...v, meta: { ...v.meta, difficulty } } : v));
    try {
      const m = await api.setDifficulty(id, difficulty);
      setView((v) => (v ? { ...v, meta: m } : v));
    } catch (e) {
      setNotice(errorText(e));
    }
  };

  const newTopic = () => {
    stick.current = true;
    if (!chat.newTopic()) setNotice(t("Connect a model in Settings to start"));
  };

  const rename = async (title: string) => {
    const t = title.trim();
    if (!t || t === meta.title) return;
    setView((v) => (v ? { ...v, meta: { ...v.meta, title: t } } : v));
    try {
      const m = await api.renameSession(id, t);
      setView((v) => (v ? { ...v, meta: m } : v));
      void app.refreshSessions();
    } catch (e) {
      setNotice(errorText(e));
    }
  };

  const end = async () => {
    setEnding(true);
    try {
      const s = await api.endSession(id);
      setSummary(s);
      setView((v) => (v ? { ...v, meta: s.session } : v));
      void app.refreshSessions();
    } catch (e) {
      setNotice(errorText(e));
    } finally {
      setEnding(false);
    }
  };

  const eyebrow =
    meta.kind === "reading" && view.doc
      ? t("Reading · {title}", { title: view.doc.title })
      : meta.kind === "practice" && focus
        ? t("Practice · {name}", { name: focus.point.name })
        : `${langName(L)} · ${number > 0 ? t("Session {n}", { n: number }) : t(KIND_LABEL[meta.kind])}${meta.kind !== "chat" && number > 0 ? ` · ${t(KIND_LABEL[meta.kind])}` : ""}`;

  const empty = (
    <div className="empty">
      <div className="eyebrow">{t("{language} · practise by talking", { language: info.nativeName })}</div>
      <h1>{t("What's on your mind today?")}</h1>
      <p className="muted lead">{t("Write a line or two. The tutor answers at your level and remembers what you practise.")}</p>
      <div className="starters">
        {STARTERS[L].map((s) => (
          <button key={s.t} className="starter" onClick={() => composer.current?.setText(s.t.replace(/…+$/, ""))}>
            <span className={cls("s-t", fontOf(L))}>{s.t}</span>
            <span className="s-e">{t(s.e)}</span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <div className="main">
        <header className="hdr drag">
          <div className="title">
            <div className="eyebrow">{eyebrow}</div>
            <div className="title-row">
              <SessionTitle title={meta.title} language={L} onRename={rename} />
              {meta.endedAt && <span className="st st-intro">{t("Ended")}</span>}
            </div>
          </div>

          {meta.usage.input + meta.usage.output > 0 && (
            <span className="chip mono tok" title={t("Tokens and estimated cost for this session at list price")}>
              {fmtUsage(meta.usage)}
            </span>
          )}

          <button className="btn btn-s end-btn" onClick={() => void end()} disabled={ending || messages.length === 0 || busy}>
            <Icon name="flag" size={15} />
            {ending ? t("Wrapping up…") : meta.endedAt ? t("Summary") : t("End session")}
          </button>

          {!inspectorOpen && (
            <button className="iconb" onClick={() => setInspectorOpen(true)} aria-label={t("Show inspector")} title={t("Show inspector ({shortcut})", { shortcut: "⌘I" })}>
              <Icon name="panel" />
            </button>
          )}
        </header>

        {view.doc && meta.kind === "reading" && (
          <div className="reading-bar">
            <Icon name="library" size={15} />
            <span>
              {tj("Reading {title}", { title: <b>{view.doc.title}</b> })}
              {view.doc.checkpoint ? ` · ${t("paragraph {n}", { n: view.doc.checkpoint.paragraph + 1 })}` : ""}
            </span>
            <button className="linkb" onClick={() => navigate(readerRoute(view.doc!.id))}>
              {t("Open reader")}
            </button>
          </div>
        )}

        <div
          className="convo"
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          }}
        >
          <div className="col">
            <MessageList
              language={L}
              messages={messages}
              corrections={corrections}
              targets={targets}
              grammarById={grammarById}
              model={app.model}
              streaming={stream ? { text: stream.text, tools: stream.tools, error: stream.error } : null}
              translations={Object.fromEntries(messages.filter((m) => shown[m.id] ?? autoTranslate).map((m) => [m.id, translations[m.id] ?? {}]))}
              onTranslate={(mid) => setShown((s) => ({ ...s, [mid]: !(s[mid] ?? autoTranslate) }))}
              onCorrectionUpdate={onCorrectionUpdate}
              onOpenGrammar={openGrammar}
              onOpenSource={openSource}
              onRetry={retry}
              empty={empty}
            />
          </div>
        </div>

        <div className="composer-wrap">
          {notice && (
            <div className="notice" role="status">
              <Icon name="alert" size={15} />
              <span>{t(notice)}</span>
              <button className="iconb sm" aria-label={t("Dismiss")} onClick={() => setNotice(null)}>
                <Icon name="x" size={14} />
              </button>
            </div>
          )}
          {!meta.endedAt && meta.kind !== "placement" && (
            <SessionTools
              difficulty={meta.difficulty ?? 0}
              onDifficulty={(d) => void setDifficulty(d)}
              onNewTopic={meta.kind === "chat" || meta.kind === "practice" ? newTopic : undefined}
              busy={busy}
              disabled={!app.model}
            />
          )}
          <Composer
            ref={composer}
            key={id}
            language={L}
            busy={busy}
            disabled={!app.model}
            disabledReason={t("Connect a model in Settings to start")}
            onSend={send}
            sessionId={id}
            onStop={() => stopStream(id)}
            left={<ModelPicker />}
          />
        </div>
      </div>

      {inspectorOpen && (
        <Inspector
          view={view}
          language={L}
          activeMs={chat.loadedActiveMs + tracked}
          onOpenGrammar={openGrammar}
          onOpenSource={openSource}
          onClose={() => setInspectorOpen(false)}
        />
      )}

      {summary && (
        <EndSessionSheet
          summary={summary}
          language={L}
          messages={messages}
          model={app.model}
          onCorrectionUpdate={onCorrectionUpdate}
          onOpenGrammar={openGrammar}
          onClose={() => setSummary(null)}
          onDone={() => navigate("today")}
        />
      )}
    </>
  );
}

function SessionTitle({ title, language, onRename }: { title: string; language: Language; onRename(t: string): void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  if (editing) {
    return (
      <form
        className="title-edit"
        onSubmit={(e) => {
          e.preventDefault();
          setEditing(false);
          onRename(draft);
        }}
      >
        <label htmlFor="session-title" className="sr">
          {t("Session title")}
        </label>
        <input
          id="session-title"
          className={cls("name-input", fontOf(language))}
          value={draft}
          autoFocus
          maxLength={80}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            onRename(draft);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Escape") {
              e.stopPropagation();
              setDraft(title);
              setEditing(false);
            }
          }}
        />
      </form>
    );
  }
  return (
    <h1
      className={cls("name", fontOf(language))}
      title={t("Double-click to rename")}
      tabIndex={0}
      onDoubleClick={() => {
        setDraft(title);
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "F2") {
          setDraft(title);
          setEditing(true);
        }
      }}
    >
      {title}
    </h1>
  );
}
