// Host for a feature's sandboxed UI (S2-11): <iframe sandbox="allow-scripts"> (no same-origin, no
// navigation of the app, no popups) plus the postMessage bridge behind window.sayfern. Only messages from
// this frame's window are answered; methods are allowlisted and argument size is capped here, and checked
// again in core (featureCall). Owned by the builder feature.
import { useEffect, useRef, useState } from "react";
import type { Language } from "../../../shared/records";
import { FEATURE_LIMITS, FEATURE_RPC_METHODS, type FeatureFrameSource } from "../../../shared/stage2";
import { api, errorText } from "../api";
import { cls } from "../lib/format";
import { t } from "../i18n";

export interface FeatureFrameProps {
  featureId: string;
  version: number;
  entry: string;
  language: Language;
  /** Customize preview: results are stored as preview results. */
  preview?: boolean;
  title: string;
  className?: string;
}

interface Call {
  sayfern: 1;
  id: number;
  method: string;
  args: unknown[];
}

function isCall(d: unknown): d is Call {
  if (!d || typeof d !== "object") return false;
  const m = d as Record<string, unknown>;
  return m.sayfern === 1 && typeof m.id === "number" && Number.isFinite(m.id) && typeof m.method === "string" && Array.isArray(m.args);
}

export function FeatureFrame({ featureId, version, entry, language, preview, title, className }: FeatureFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [src, setSrc] = useState<FeatureFrameSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    setError(null);
    api
      .featureFrame(featureId, version, entry)
      .then((s) => alive && setSrc(s))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [featureId, version, entry]);

  useEffect(() => {
    let inFlight = 0;
    const reply = (msg: Record<string, unknown>) => ref.current?.contentWindow?.postMessage({ sayfern: 1, ...msg }, "*");
    const onMessage = (e: MessageEvent) => {
      const win = ref.current?.contentWindow;
      if (!win || e.source !== win) return;
      if (!isCall(e.data)) return;
      const { id, method, args } = e.data;
      if (!(FEATURE_RPC_METHODS as readonly string[]).includes(method)) return reply({ id, error: t("Unknown method: {name}", { name: method.slice(0, 40) }) });
      if (inFlight >= FEATURE_LIMITS.callsInFlight) return reply({ id, error: t("Too many calls at once.") });
      let size = 0;
      try {
        size = JSON.stringify(args).length;
      } catch {
        return reply({ id, error: t("Arguments must be plain JSON.") });
      }
      if (size > FEATURE_LIMITS.callArgsBytes) return reply({ id, error: t("Arguments are too large.") });
      if (method === "context") return reply({ id, result: { featureId, version, language, preview: !!preview } });
      inFlight++;
      api
        .featureCall({ featureId, version, language, preview: !!preview }, method, args)
        .then(
          (result) => reply({ id, result }),
          (err) => reply({ id, error: errorText(err) || t("Something went wrong.") }),
        )
        .finally(() => inFlight--);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [featureId, version, language, preview]);

  if (error) {
    return (
      <div className={cls("ff ff-msg", className)}>
        <p className="err">{error}</p>
      </div>
    );
  }
  if (!src) return <div className={cls("ff ff-loading", className)} aria-busy="true" />;
  return (
    <iframe
      ref={ref}
      key={`${featureId}:${version}:${entry}:${language}`}
      className={cls("ff", className)}
      title={title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      {...("url" in src ? { src: src.url } : { srcDoc: src.srcdoc })}
    />
  );
}
