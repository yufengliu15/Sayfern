// Sidebar entries for enabled custom features that add a tab (S2-11). Owned by the builder feature.
import { useEffect, useState } from "react";
import type { Language } from "../../../shared/records";
import type { FeatureSurfaceRef } from "../../../shared/stage2";
import { api } from "../api";
import { useApp } from "../context";
import { featureRoute, navigate, type ParsedRoute, type Route } from "../router";
import { Icon } from "./icons";

const CHANGED = "sayfern:features-changed";

/** Call after turning a feature on or off, rolling back or deleting: the sidebar and Today refresh. */
export function notifyFeaturesChanged(): void {
  window.dispatchEvent(new Event(CHANGED));
}

/** Route of one surface: feature/<id>/<surface index>. */
export function surfaceRoute(s: Pick<FeatureSurfaceRef, "featureId" | "index">): Route {
  return featureRoute(`${s.featureId}/${s.index}`);
}

/** Enabled tabs and activities for the current workspace, refreshed when features change. */
export function useFeatureSurfaces(language: Language): FeatureSurfaceRef[] {
  const [list, setList] = useState<FeatureSurfaceRef[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .featureSurfaces(language)
        .then((l) => alive && setList(l))
        .catch(() => alive && setList([]));
    void load();
    window.addEventListener(CHANGED, load);
    return () => {
      alive = false;
      window.removeEventListener(CHANGED, load);
    };
  }, [language]);
  return list;
}

export function FeatureNav({ route }: { route: ParsedRoute }) {
  const { language } = useApp();
  const tabs = useFeatureSurfaces(language).filter((s) => s.surface.kind === "tab");
  if (tabs.length === 0) return null;
  return (
    <>
      {tabs.map((t) => {
        const on = route.name === "feature" && route.id === `${t.featureId}/${t.index}`;
        return (
          <button
            key={`${t.featureId}/${t.index}`}
            className={on ? "on fnav" : "fnav"}
            aria-current={on ? "page" : undefined}
            title={`${t.surface.title} · ${t.featureName}`}
            onClick={() => navigate(surfaceRoute(t))}
          >
            <Icon name="puzzle" />
            <span className="clamp">{t.surface.title}</span>
          </button>
        );
      })}
    </>
  );
}
