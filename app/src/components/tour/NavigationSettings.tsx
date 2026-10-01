import { useI18n } from "../../lib/i18n";
import { REPLAY_TOUR_EVENT, useHiddenViews, writeHiddenViews } from "../../lib/navigation";
import { Icon } from "../Icon";
import { SettingsRow, SettingsSection } from "../SettingsLayout";
import { SPACES } from "./spaces";

/** Settings → General: which spaces show in the navigation, and the product tour again. */
export function NavigationSettings() {
  const { t } = useI18n();
  const hidden = useHiddenViews();
  return (
    <SettingsSection title={t("tour.settings.title")}>
      {SPACES.map((space) => {
        const shown = !hidden.includes(space.view);
        return (
          <SettingsRow key={space.view} label={t(`tour.spaces.${space.view}.name`)} description={t(`tour.spaces.${space.view}.short`)}>
            <button
              type="button"
              role="switch"
              className="settings-switch"
              aria-checked={shown}
              aria-label={t(`tour.spaces.${space.view}.name`)}
              onClick={() => writeHiddenViews(shown ? [...hidden, space.view] : hidden.filter((view) => view !== space.view))}
            />
          </SettingsRow>
        );
      })}
      <SettingsRow label={t("tour.settings.replay")} description={t("tour.settings.replayHint")}>
        <button type="button" className="secondary-button" onClick={() => window.dispatchEvent(new Event(REPLAY_TOUR_EVENT))}><Icon name="compass" />{t("tour.settings.replayButton")}</button>
      </SettingsRow>
    </SettingsSection>
  );
}
