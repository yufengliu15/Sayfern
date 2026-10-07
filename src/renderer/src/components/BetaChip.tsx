import { t } from "../i18n";

/** Marks a language that has no course yet (see isBeta in shared/course). */
export function BetaChip() {
  return (
    <span className="beta-chip" title={t("No course yet. The tutor works, but results may vary.")}>
      {t("Beta")}
    </span>
  );
}
