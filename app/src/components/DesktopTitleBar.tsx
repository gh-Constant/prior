import { useCallback } from "react";
import { useI18n } from "../lib/i18n";
import { isDesktop, isMac } from "../lib/platform";

/**
 * Slim window strip for desktop Tauri shells, which run with an overlaid
 * (chromeless) title bar. macOS keeps its floating traffic lights; other
 * desktops get minimal caption buttons incrusted on the right. The strip is
 * the window drag handle (double-click toggles maximize).
 */
export function DesktopTitleBar() {
  const { t } = useI18n();
  if (!isDesktop()) return null;
  const showCaption = !isMac();
  return (
    <div className="window-dragbar" data-tauri-drag-region onDoubleClick={() => void toggleMaximize()}>
      <div className="window-drag-fill" data-tauri-drag-region onDoubleClick={() => void toggleMaximize()} aria-hidden="true" />
      {showCaption && <WindowCaptionButtons t={t} />}
    </div>
  );
}

function WindowCaptionButtons({ t }: { readonly t: (key: string) => string }) {
  const act = useCallback((fn: () => Promise<void>) => {
    void fn().catch(() => undefined);
  }, []);
  return (
    <div className="window-caption">
      <button
        type="button"
        className="window-caption-btn"
        aria-label={t("common.window.minimize")}
        title={t("common.window.minimize")}
        onClick={() => act(async () => { const { getCurrentWindow } = await import("@tauri-apps/api/window"); await getCurrentWindow().minimize(); })}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true"><line x1="2" y1="6" x2="10" y2="6" /></svg>
      </button>
      <button
        type="button"
        className="window-caption-btn"
        aria-label={t("common.window.toggleMaximize")}
        title={t("common.window.toggleMaximize")}
        onClick={() => act(async () => { const { getCurrentWindow } = await import("@tauri-apps/api/window"); await getCurrentWindow().toggleMaximize(); })}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7" rx="1" /></svg>
      </button>
      <button
        type="button"
        className="window-caption-btn close"
        aria-label={t("common.window.close")}
        title={t("common.window.close")}
        onClick={() => act(async () => { const { getCurrentWindow } = await import("@tauri-apps/api/window"); await getCurrentWindow().close(); })}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true"><line x1="3" y1="3" x2="9" y2="9" /><line x1="9" y1="3" x2="3" y2="9" /></svg>
      </button>
    </div>
  );
}

async function toggleMaximize(): Promise<void> {
  if (!isDesktop()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().toggleMaximize();
  } catch {
    // Not a windowed shell: nothing to toggle.
  }
}
