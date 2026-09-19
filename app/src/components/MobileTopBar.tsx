import { useI18n } from "../lib/i18n";
import { Icon } from "./Icon";

type Props = {
  readonly menuOpen: boolean;
  readonly onMenu: () => void;
};

export function MobileTopBar({ menuOpen, onMenu }: Props) {
  const { t } = useI18n();
  return (
    <div className="mobile-topbar">
      <button
        type="button"
        className="mobile-menu-button"
        aria-label={menuOpen ? t("common.actions.closeMenu") : t("common.actions.openMenu")}
        aria-expanded={menuOpen}
        aria-controls="prior-sidebar"
        onClick={onMenu}
      >
        <Icon name="menu" />
      </button>
    </div>
  );
}
