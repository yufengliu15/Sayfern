// Customize: Stage 2 placeholder for the feature builder, with installed extensions (read-only).
import { useEffect, useState } from "react";
import type { ExtensionInfo } from "../../../shared/api";
import type { Language } from "../../../shared/records";
import { api } from "../api";
import { Icon } from "../components/icons";
import { cls } from "../lib/format";
import { settingsRoute, type Navigate } from "../router";

export interface CustomizeScreenProps {
  language: Language;
  navigate: Navigate;
}

const IDEAS = ["Quiz me on words from my last session", "Add pitch accent to Japanese readings", "Show HSK levels next to every lookup"];

export function CustomizeScreen({ navigate }: CustomizeScreenProps) {
  const [ext, setExt] = useState<ExtensionInfo[] | null>(null);
  useEffect(() => {
    api
      .listExtensions()
      .then(setExt)
      .catch(() => setExt([]));
  }, []);

  return (
    <main className="main page">
      <div className="page-drag drag" />
      <div className="page-in cust">
        <div className="eyebrow">Customize · coming in Stage 2</div>
        <h1 className="display">Describe a feature. Sayfern builds it.</h1>
        <p className="cust-lead">
          Soon you'll be able to ask for a new drill, lookup or tutor habit in plain words. Sayfern writes it as an extension you can read, switch off
          or share.
        </p>

        <div className="cust-demo card" aria-hidden="true">
          <div className="cust-input">
            <Icon name="customize" size={18} />
            <span>What should Sayfern do for you?</span>
            <span className="st st-intro">Stage 2</span>
          </div>
          <div className="cust-ideas">
            {IDEAS.map((i) => (
              <span key={i} className="chip">
                {i}
              </span>
            ))}
          </div>
        </div>

        <div className="eyebrow sub">Installed extensions</div>
        {ext === null ? null : ext.length === 0 ? (
          <div className="ghost-card">No extensions installed. The extension API is documented in docs/extensions.md.</div>
        ) : (
          <ul className="extlist card cust-ext">
            {ext.map((x) => (
              <li key={x.id} className={cls("ext", !x.enabled && "off")}>
                <span className="ext-i">
                  <Icon name="tool" size={18} />
                </span>
                <div className="ext-t">
                  <div className="ext-n">
                    <b>{x.name}</b>
                    <span className="mono">v{x.version}</span>
                  </div>
                  <p>{x.description}</p>
                  {x.error && (
                    <p className="err">
                      <Icon name="alert" size={14} /> {x.error}
                    </p>
                  )}
                </div>
                <span className={cls("badge", x.error ? "badge-err" : !x.enabled && "badge-off")}>{x.error ? "Error" : x.enabled ? "On" : "Off"}</span>
              </li>
            ))}
          </ul>
        )}
        <button className="linkb cust-manage" onClick={() => navigate(settingsRoute("extensions"))}>
          Manage extensions in Settings
        </button>
      </div>
    </main>
  );
}
