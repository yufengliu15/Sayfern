// Review sheet (S2-12, owner decision "Sandboxed UI + review"): every file of one version, read-only.
// Files that run with full access are flagged. For a full-access version that isn't approved yet, the only
// way to turn it on is "I've read this code, turn it on" (approve this exact hash, then enable).
// Owned by the builder feature.
import { useEffect, useRef, useState } from "react";
import type { FeatureFile, FeatureInfo, FeatureVersion } from "../../../shared/stage2";
import { api, errorText } from "../api";
import { cls } from "../lib/format";
import { Icon } from "./icons";
import { t, tn } from "../i18n";

export interface FeatureReviewProps {
  feature: FeatureInfo;
  version: FeatureVersion;
  onClose(): void;
  /** Approve and turn on. Absent: view only. */
  onApprove?(): Promise<void>;
}

function kb(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

export function FeatureReview({ feature, version, onClose, onApprove }: FeatureReviewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [files, setFiles] = useState<FeatureFile[] | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    api
      .featureFiles(feature.id, version.n)
      .then((f) => {
        if (!alive) return;
        setFiles(f);
        const first = f.find((x) => x.fullAccess) ?? f[0];
        if (first) {
          setPath(first.path);
          setSeen(new Set([first.path]));
        }
      })
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [feature.id, version.n]);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const open = (p: string) => {
    setPath(p);
    setSeen((s) => new Set(s).add(p));
  };
  const file = files?.find((f) => f.path === path);
  const full = files?.filter((f) => f.fullAccess) ?? [];
  const unread = full.filter((f) => !seen.has(f.path));
  const approve = async () => {
    if (!onApprove) return;
    setBusy(true);
    setError(null);
    try {
      await onApprove();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <div className="overlay sheet-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet frv" role="dialog" aria-modal="true" aria-labelledby="frv-title" tabIndex={-1} ref={ref}>
        <header className="sheet-h">
          <div>
            <div className="eyebrow">
              {feature.name} · v{version.n} · {tn(version.files.length, "{count} file", "{count} files")}
            </div>
            <h2 id="frv-title">{onApprove ? t("Read the code before turning it on") : t("The code")}</h2>
          </div>
          <button className="iconb" onClick={onClose} aria-label={t("Close")}>
            <Icon name="x" />
          </button>
        </header>
        {version.fullAccess ? (
          <p className="frv-note warn">
            <Icon name="alert" size={16} />
            <span>
              {t(
                "Files marked Full access (every script outside ui/) run inside Sayfern with full access to your Mac account: your files, the network and your learning records. Sayfern runs exactly the files you approve, from a locked copy. Files in ui/ run in a locked-down frame that can only use the Sayfern API.",
              )}
            </span>
          </p>
        ) : (
          <p className="frv-note">
            <Icon name="lock" size={16} />
            <span>{t("Everything here runs in a locked-down frame with no network. It can only read your learning data through the Sayfern API.")}</span>
          </p>
        )}
        <div className="frv-body">
          <ul className="frv-files" aria-label={t("Files")}>
            {files?.map((f) => (
              <li key={f.path}>
                <button className={cls("frv-file", f.path === path && "on")} onClick={() => open(f.path)} aria-current={f.path === path ? "true" : undefined}>
                  <span className="mono clamp">{f.path}</span>
                  {f.fullAccess && <span className="frv-full">{t("Full access")}</span>}
                  <span className="frv-kb mono">{kb(f.bytes)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="frv-code" aria-label={path ?? t("Code")}>
            {file ? (
              <pre className="selectable">
                {file.text.split("\n").map((line, i) => (
                  <div key={i} className="frv-line">
                    <span className="frv-n" aria-hidden="true">
                      {i + 1}
                    </span>
                    <code>{line || " "}</code>
                  </div>
                ))}
              </pre>
            ) : (
              !error && <div className="ff-loading" aria-busy="true" />
            )}
          </div>
        </div>
        <footer className="sheet-f">
          <span className="muted small">
            {error ? (
              <span className="err">{t(error)}</span>
            ) : onApprove && unread.length ? (
              tn(unread.length, "Open the full-access file to continue.", "Open all {count} full-access files to continue.")
            ) : version.approved ? (
              t("You approved this version.")
            ) : (
              t("Approval covers this exact version. Any change needs a new review.")
            )}
          </span>
          <button className="btn" onClick={onClose}>
            {t("Close")}
          </button>
          {onApprove && (
            <button className="btn btn-f" disabled={busy || !files || unread.length > 0} onClick={() => void approve()}>
              <Icon name="check" size={16} stroke={2.2} />
              {t("I've read this code, turn it on")}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
