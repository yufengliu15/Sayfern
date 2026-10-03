// A tab or activity contributed by a feature built in Customize (route feature/<id>/<surface index>).
// Owned by the builder feature: renders the active version's sandboxed UI.
import { useEffect, useState, type ReactNode } from "react";
import type { Language } from "../../../shared/records";
import type { FeatureInfo } from "../../../shared/stage2";
import { api, errorText } from "../api";
import { FeatureFrame } from "../components/FeatureFrame";
import { Icon } from "../components/icons";
import type { Navigate } from "../router";
import { t } from "../i18n";

export interface FeatureScreenProps {
  /** "<featureId>/<surface index>" (or just the feature id: its first surface). */
  id: string;
  language: Language;
  navigate: Navigate;
}

/** Customize opens with this feature selected. */
export const CUSTOMIZE_SELECT_KEY = "sayfern.customize.select";

export function FeatureScreen({ id, language, navigate }: FeatureScreenProps) {
  const [featureId, rawIndex] = id.split("/");
  const index = Number(rawIndex ?? 0) || 0;
  const [feature, setFeature] = useState<FeatureInfo | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getFeature(featureId)
      .then((f) => alive && setFeature(f))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [featureId]);

  const version = feature?.active != null ? feature.versions.find((v) => v.n === feature.active && v.state === "ready") : undefined;
  const surface = version?.surfaces[index] ?? version?.surfaces[0];
  const edit = () => {
    try {
      sessionStorage.setItem(CUSTOMIZE_SELECT_KEY, featureId);
    } catch {
      // storage unavailable: Customize opens on its default
    }
    navigate("customize");
  };

  let body: ReactNode;
  if (error) body = <p className="err">{error}</p>;
  else if (feature === undefined) body = <div className="ff ff-loading" aria-busy="true" />;
  else if (!feature) body = <div className="ghost-card">{t("This feature was deleted.")}</div>;
  else if (!feature.enabled || !version || !surface) body = <div className="ghost-card">{t("This feature is off. Turn it on in Customize.")}</div>;
  else if (surface.languages && !surface.languages.includes(language)) body = <div className="ghost-card">{t("This feature is for another language workspace.")}</div>;
  else body = <FeatureFrame className="fh-frame" featureId={feature.id} version={version.n} entry={surface.entry} language={language} title={surface.title} />;

  return (
    <main className="main page fh">
      <div className="page-drag drag" />
      <div className="fh-in">
        <header className="fh-head">
          <div>
            <div className="eyebrow">
              {t("Your feature")}
              {version ? ` · v${version.n}` : ""}
            </div>
            <h1 className="fh-title serif">{surface?.title ?? feature?.name ?? t("Feature")}</h1>
          </div>
          {feature && (
            <button className="btn btn-s" onClick={edit}>
              <Icon name="customize" size={15} />
              {t("Change in Customize")}
            </button>
          )}
        </header>
        {body}
      </div>
    </main>
  );
}
