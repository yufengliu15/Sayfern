import { useRef, useState } from "react";
import { useApp } from "../context";
import { cjkClass, fmtAgo, practisedLabel } from "../lib/format";
import { useDismiss } from "../lib/hooks";
import { navigate, sessionRoute, settingsRoute, type ParsedRoute, type Route } from "../router";
import { Fern, Icon, type IconName } from "./icons";

const NAV: { route: Route; name: ParsedRoute["name"]; label: string; icon: IconName; key: string }[] = [
  { route: "today", name: "today", label: "Today", icon: "today", key: "1" },
  { route: "library", name: "library", label: "Library", icon: "library", key: "2" },
  { route: "grammar", name: "grammar", label: "Grammar", icon: "grammar", key: "3" },
  { route: "progress", name: "progress", label: "Progress", icon: "progress", key: "4" },
];

/** ⌘ on Mac, Ctrl elsewhere (the mock dev server runs in any browser). */
export const MOD = typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl ";

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
        <Fern color="#A9C8B2" />
        <b>Sayfern</b>
      </div>

      <div className="ldd" ref={menuRef}>
        <button
          className="ldd-btn"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Language workspace: ${app.lang.name}`}
          onClick={() => setOpen(!open)}
        >
          <span className={`g ${app.lang.fontClass}`}>{app.lang.glyph}</span>
          <span className="t">
            <b>{app.lang.name}</b>
            <small>{practisedLabel(lastAt(app.language))}</small>
          </span>
          <Icon name="chev" size={16} stroke={2} />
        </button>
        {open && (
          <div className="menu" role="menu" aria-label="Your languages">
            <div className="mh">Your languages</div>
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
                  <b>{l.name}</b>
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
              Add a language
            </button>
          </div>
        )}
      </div>

      <div className="nav">
        {NAV.map((n) => {
          const on = route.name === n.name || (n.name === "library" && route.name === "reader");
          return (
            <button key={n.route} className={on ? "on" : ""} aria-current={on ? "page" : undefined} onClick={() => navigate(n.route)}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
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
          <span>Recent</span>
          <button onClick={() => void app.startSession()} aria-label="New session" title={`New session (${MOD}N)`}>
            <Icon name="plus" size={15} stroke={2} />
          </button>
        </div>
        <div className="recent-list">
          {app.sessions.length === 0 && <div className="recent-empty">No sessions yet</div>}
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
          <button className={route.name === "customize" ? "on" : ""} aria-current={route.name === "customize" ? "page" : undefined} onClick={() => navigate("customize")}>
            <Icon name="customize" />
            <span>Customize</span>
            <span className="soon">SOON</span>
          </button>
          <button className={route.name === "settings" ? "on" : ""} aria-current={route.name === "settings" ? "page" : undefined} onClick={() => navigate("settings")}>
            <Icon name="settings" />
            <span>Settings</span>
          </button>
        </div>
        <div className="hair" />
        {connected.length === 0 ? (
          <button className="status" onClick={() => navigate("settings")}>
            <i className="off" />
            <span>No model connected</span>
          </button>
        ) : (
          connected.slice(0, 2).map((c) => (
            <div className="status" key={c.id} title={c.connectedVia}>
              <i />
              <span>
                {c.name} · {c.connected === "oauth" ? "subscription" : "API key"}
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
        <span>Anki · not connected</span>
      </div>
    );
  }
  const snap = anki.snapshots[language];
  if (anki.connected) {
    return (
      <div className="status" title={anki.version ? `AnkiConnect v${anki.version}` : undefined}>
        <i />
        <span>Anki · {snap ? `synced ${fmtAgo(snap.syncedAt)}` : "connected"}</span>
      </div>
    );
  }
  return (
    <div className="status" title={anki.error}>
      <i className="warn" />
      <span>Anki · {snap ? `offline, using ${fmtAgo(snap.syncedAt)} snapshot` : "offline"}</span>
    </div>
  );
}
