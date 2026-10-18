import { useRef, useState } from "react";
import { useApp } from "../context";
import { cjkClass, fmtAgo, practisedLabel } from "../lib/format";
import { useDismiss } from "../lib/hooks";
import { MOD } from "../lib/platform";
import { langName, msg, t } from "../i18n";
import { navigate, sessionRoute, settingsRoute, type ParsedRoute, type Route } from "../router";
import { Fern, Icon, type IconName } from "./icons";

const NAV: { route: Route; name: ParsedRoute["name"]; label: string; icon: IconName; key: string }[] = [
  { route: "today", name: "today", label: msg("Today"), icon: "today", key: "1" },
  { route: "course", name: "course", label: msg("Course"), icon: "course", key: "2" },
  { route: "library", name: "library", label: msg("Library"), icon: "library", key: "3" },
  { route: "grammar", name: "grammar", label: msg("Grammar"), icon: "grammar", key: "4" },
  { route: "review", name: "review", label: msg("Review"), icon: "review", key: "5" },
  { route: "progress", name: "progress", label: msg("Progress"), icon: "progress", key: "6" },
];

export function Sidebar({ route }: { route: ParsedRoute }) {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menuRef, open, () => setOpen(false));

  const lastAt = (l: string) => app.sessionsByLang[l as keyof typeof app.sessionsByLang]?.[0]?.updatedAt;
  const connected = app.providers.filter((p) => p.connected);
  const currentId = route.name === "session" ? route.id : undefined;

  return (
    <nav className="side" aria-label="Sayfern">
      <div className="side-drag drag" />
      <div className="brand">
        <Fern color="var(--side-accent)" />
        <b>Sayfern</b>
      </div>

      <div className="ldd" ref={menuRef}>
        <button
          className="ldd-btn"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t("Language workspace: {language}", { language: langName(app.language) })}
          onClick={() => setOpen(!open)}
        >
          <span className={`g ${app.lang.fontClass}`}>{app.lang.glyph}</span>
          <span className="t">
            <b>{langName(app.language)}</b>
            <small>{practisedLabel(lastAt(app.language))}</small>
          </span>
          <Icon name="chev" size={16} stroke={2} />
        </button>
        {open && (
          <div className="menu" role="menu" aria-label={t("Your languages")}>
            <div className="mh">{t("Your languages")}</div>
            {app.languages.map((l) => (
              <button
                key={l.id}
                role="menuitemradio"
                aria-checked={l.id === app.language}
                className={`mi${l.id === app.language ? " on" : ""}`}
                onClick={() => {
                  setOpen(false);
                  app.setLanguage(l.id);
                }}
              >
                <span className={`g ${l.fontClass}`}>{l.glyph}</span>
                <span className="t">
                  <b>{langName(l.id)}</b>
                  <small>{practisedLabel(lastAt(l.id))}</small>
                </span>
                {l.id === app.language && (
                  <span className="mck">
                    <Icon name="check" size={16} stroke={2.2} />
                  </span>
                )}
              </button>
            ))}
            <div className="sep" />
            <button
              className="mi add"
              onClick={() => {
                setOpen(false);
                navigate(settingsRoute("languages"));
              }}
            >
              <Icon name="plus" size={16} stroke={2} />
              {t("Add a language")}
            </button>
          </div>
        )}
      </div>

      <div className="nav">
        {NAV.map((n) => {
          const on = route.name === n.name || (n.name === "library" && route.name === "reader") || (n.name === "review" && route.name === "quiz");
          return (
            <button key={n.route} className={on ? "on" : ""} aria-current={on ? "page" : undefined} onClick={() => navigate(n.route)}>
              <Icon name={n.icon} />
              <span>{t(n.label)}</span>
              <span className="k" aria-hidden="true">
                {MOD}
                {n.key}
              </span>
            </button>
          );
        })}
      </div>

      <div className="recent">
        <div className="sect">
          <span>{t("Recent")}</span>
          <button onClick={() => void app.startSession()} aria-label={t("New session")} title={t("New session ({shortcut})", { shortcut: `${MOD}N` })}>
            <Icon name="plus" size={15} stroke={2} />
          </button>
        </div>
        <div className="recent-list">
          {app.sessions.length === 0 && <div className="recent-empty">{t("No sessions yet")}</div>}
          {app.sessions.slice(0, 12).map((s) => (
            <button
              key={s.id}
              className={s.id === currentId ? "cur" : ""}
              aria-current={s.id === currentId ? "page" : undefined}
              onClick={() => navigate(sessionRoute(s.id))}
              title={s.title}
            >
              <i />
              <span className={cjkClass(s.title, app.lang.fontClass)}>{s.title}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="foot">
        <div className="nav">
          <button className={route.name === "settings" ? "on" : ""} aria-current={route.name === "settings" ? "page" : undefined} onClick={() => navigate("settings")}>
            <Icon name="settings" />
            <span>{t("Settings")}</span>
          </button>
        </div>
        <div className="hair" />
        {connected.length === 0 ? (
          <button className="status" onClick={() => navigate("settings")}>
            <i className="off" />
            <span>{t("No model connected")}</span>
          </button>
        ) : (
          connected.slice(0, 2).map((c) => (
            <div className="status" key={c.id} title={c.connectedVia}>
              <i />
              <span>
                {c.name} · {c.connected === "oauth" ? t("subscription") : t("API key")}
              </span>
            </div>
          ))
        )}
        <AnkiStatusRow />
      </div>
    </nav>
  );
}

function AnkiStatusRow() {
  const { anki, language } = useApp();
  if (!anki || !anki.config.enabled) {
    return (
      <div className="status">
        <i className="off" />
        <span>{t("Anki · not connected")}</span>
      </div>
    );
  }
  const snap = anki.snapshots[language];
  if (anki.connected) {
    return (
      <div className="status" title={anki.version ? `AnkiConnect v${anki.version}` : undefined}>
        <i />
        <span>{snap ? t("Anki · synced {ago}", { ago: fmtAgo(snap.syncedAt) }) : t("Anki · connected")}</span>
      </div>
    );
  }
  return (
    <div className="status" title={anki.error}>
      <i className="warn" />
      <span>{snap ? t("Anki · offline, using the snapshot from {ago}", { ago: fmtAgo(snap.syncedAt) }) : t("Anki · offline")}</span>
    </div>
  );
}
