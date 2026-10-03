// Review (Stage 2): Corrections and Quizzes tabs for the current language.
import type { Language } from "../../../shared/records";
import { useApp } from "../context";
import { reviewRoute, type Navigate, type ReviewTab } from "../router";
import { CorrectionsTab } from "./review/CorrectionsTab";
import { QuizzesTab } from "./review/QuizzesTab";
import { langName, msg, t } from "../i18n";

export interface ReviewScreenProps {
  tab: ReviewTab;
  language: Language;
  navigate: Navigate;
}

const TABS: { id: ReviewTab; label: string }[] = [
  { id: "corrections", label: msg("Corrections") },
  { id: "quizzes", label: msg("Quizzes") },
];

export function ReviewScreen({ tab, language, navigate }: ReviewScreenProps) {
  const app = useApp();
  return (
    <main className="main page">
      <div className="page-drag drag" />
      <div className="page-in review">
        <header className="page-head">
          <div>
            <div className="eyebrow">{t("{language} · Review", { language: langName(language) })}</div>
            <h1 className="display">{tab === "corrections" ? t("Your corrections") : t("Quizzes")}</h1>
          </div>
          <div className="page-actions">
            <div className="seg" role="tablist" aria-label={t("Review")}>
              {TABS.map((x) => (
                <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? "on" : ""} onClick={() => navigate(reviewRoute(x.id))}>
                  {t(x.label)}
                </button>
              ))}
            </div>
          </div>
        </header>
        {tab === "corrections" ? <CorrectionsTab language={language} navigate={navigate} /> : <QuizzesTab language={language} navigate={navigate} />}
      </div>
    </main>
  );
}
