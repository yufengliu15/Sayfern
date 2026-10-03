// Today: practice activities from features built in Customize (S2-11). Renders nothing when there are none.
// Owned by the builder feature.
import type { Language } from "../../../shared/records";
import { navigate } from "../router";
import { surfaceRoute, useFeatureSurfaces } from "./FeatureNav";
import { Icon } from "./icons";
import { t } from "../i18n";

export function FeatureActivities({ language }: { language: Language }) {
  const activities = useFeatureSurfaces(language).filter((s) => s.surface.kind === "activity");
  if (activities.length === 0) return null;
  return (
    <>
      <div className="eyebrow sub">{t("Your activities")}</div>
      <div className="tiles">
        {activities.map((a) => (
          <button key={`${a.featureId}/${a.index}`} className="tile" onClick={() => navigate(surfaceRoute(a))}>
            <span className="ti">
              <Icon name="puzzle" size={22} />
            </span>
            <span className="tt">{a.surface.title}</span>
            <span className="td">{a.surface.description ?? a.featureName}</span>
          </button>
        ))}
      </div>
    </>
  );
}
