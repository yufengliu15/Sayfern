// F-04: model menu grouped by provider, with capability hints.
import { useRef, useState } from "react";
import type { ModelInfo, ModelRef } from "../../../shared/types";
import { useApp } from "../context";
import { cls } from "../lib/format";
import { useDismiss } from "../lib/hooks";
import { t } from "../i18n";
import { navigate } from "../router";
import { Icon } from "./icons";

const same = (a?: ModelRef, b?: ModelRef) => !!a && !!b && a.provider === b.provider && a.id === b.id;

function ctx(n: number) {
  if (!n) return "";
  return n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / 1000)}k`;
}

export function ModelPicker({ placement = "up" }: { placement?: "up" | "down" }) {
  const { models, model, modelInfo, setModel, providers } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  if (models.length === 0) {
    return (
      <button className="mp-btn connect" onClick={() => navigate("settings")}>
        <Icon name="key" size={14} />
        {t("Connect a model")}
      </button>
    );
  }

  const groups = new Map<string, ModelInfo[]>();
  for (const m of models) groups.set(m.provider, [...(groups.get(m.provider) ?? []), m]);
  const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="mp" ref={ref}>
      <button
        className="mp-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("Model: {name}", { name: modelInfo?.name ?? t("none") })}
        onClick={() => setOpen(!open)}
      >
        {modelInfo?.reasoning && <Icon name="spark" size={13} />}
        <span>{modelInfo?.name ?? t("Choose a model")}</span>
        <Icon name={placement === "up" ? "chevUp" : "chev"} size={13} stroke={2} />
      </button>
      {open && (
        <div className={cls("mp-menu", placement)} role="menu" aria-label={t("Models")}>
          {[...groups.entries()].map(([prov, list]) => (
            <div key={prov} role="group" aria-label={providerName(prov)}>
              <div className="mh">{providerName(prov)}</div>
              {list.map((m) => {
                const on = same(model, m);
                return (
                  <button
                    key={m.id}
                    role="menuitemradio"
                    aria-checked={on}
                    className={cls("mp-item", on && "on")}
                    onClick={() => {
                      setModel({ provider: m.provider, id: m.id });
                      setOpen(false);
                    }}
                  >
                    <span className="mp-name">{m.name}</span>
                    <span className="mp-caps">
                      {m.reasoning && (
                        <span className="cap" title={t("Thinks before answering")}>
                          <Icon name="spark" size={12} /> {t("Reasoning")}
                        </span>
                      )}
                      {m.input.includes("image") && (
                        <span className="cap" title={t("Can read images")}>
                          <Icon name="image" size={12} /> {t("Images")}
                        </span>
                      )}
                      {m.contextWindow > 0 && <span className="cap mono">{ctx(m.contextWindow)}</span>}
                    </span>
                    {on && (
                      <span className="mp-check">
                        <Icon name="check" size={15} stroke={2.2} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
