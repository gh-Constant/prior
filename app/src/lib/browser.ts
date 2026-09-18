import { openUrl } from "@tauri-apps/plugin-opener";
import { isMobileTauri as isMobilePlatform, isTauri } from "./platform";

export { isTauri };
export function isMobileTauri(): boolean {
  return isMobilePlatform();
}

// Opens an external URL. On mobile builds this uses an in-app browser
// (Custom Tabs on Android, Safari View Controller on iOS) so the user never
// leaves Prior — important for OAuth, which Google forbids in raw WebViews
// but allows in Custom Tabs. Everywhere else it opens the system browser.
// Requires the `opener:allow-open-url` scope with `"app": "inAppBrowser"`.
export async function openExternalUrl(url: string): Promise<void> {
  if (isMobileTauri()) await openUrl(url, "inAppBrowser");
  else await openUrl(url);
}
