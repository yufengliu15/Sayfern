// Interface language picker (Settings > Preferences and the welcome page). "Match system" follows
// macOS's preferred languages; picking one stores Settings.uiLocale and remounts the UI in it.
import { isUiLocale, UI_LOCALES, uiLocaleInfo } from "../../../shared/locales";
import { useApp } from "../context";
import { t } from "../i18n";
import { Icon } from "./icons";

export function LocalePicker({ id, withLabel = true }: { id: string; withLabel?: boolean }) {
  const app = useApp();
  const chosen = app.settings.uiLocale && isUiLocale(app.settings.uiLocale) ? app.settings.uiLocale : "system";
  const system = uiLocaleInfo(app.systemLocale);
  return (
    <span className="locale-pick">
      {withLabel && (
        <label htmlFor={id}>
          <Icon name="globe" size={15} />
          <span>{t("Interface language")}</span>
        </label>
      )}
      <select
        id={id}
        className="input select"
        value={chosen}
        aria-label={withLabel ? undefined : t("Interface language")}
        onChange={(e) => void app.updateSettings({ uiLocale: e.target.value as typeof chosen })}
      >
        <option value="system">{t("Match system ({language})", { language: system.nativeName })}</option>
        {UI_LOCALES.map((l) => (
          <option key={l.id} value={l.id} lang={l.id}>
            {l.nativeName}
          </option>
        ))}
      </select>
    </span>
  );
}
