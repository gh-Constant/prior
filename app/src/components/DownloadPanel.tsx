import type { MouseEvent } from "react";
import { Icon, type IconName } from "./Icon";
import { openUrl } from "@tauri-apps/plugin-opener";

export const RELEASES_URL = "https://github.com/gh-Constant/prior/releases/latest";

const platforms: Array<{ name: string; detail: string; icon: IconName }> = [
  { name: "macOS", detail: "Universal", icon: "apple" },
  { name: "Windows", detail: "Installer", icon: "windows" },
  { name: "Android", detail: "APK", icon: "android" },
  { name: "Linux", detail: "AppImage", icon: "linux" },
];

export function DownloadPanel() {
  function openRelease(event: MouseEvent<HTMLAnchorElement>) {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      event.preventDefault();
      void openUrl(RELEASES_URL);
    }
  }

  return (
    <section className="download-panel" aria-labelledby="download-title">
      <div className="download-brand"><img src="/prior-logo.png" alt="Prior" /></div>
      <h3 id="download-title">Prior everywhere</h3>
      <p className="download-copy">Choose your platform.</p>
      <div className="download-grid">
        {platforms.map((platform) => (
          <a key={platform.name} className="download-card" href={RELEASES_URL} target="_blank" rel="noreferrer" onClick={openRelease}>
            <span className="download-card-icon"><Icon name={platform.icon} /></span>
            <span className="download-card-copy"><strong>{platform.name}</strong><small>{platform.detail}</small></span>
            <Icon name="download" className="download-card-arrow" />
          </a>
        ))}
      </div>
      <a className="release-link" href={RELEASES_URL} target="_blank" rel="noreferrer" onClick={openRelease}>View all releases <Icon name="arrow" /></a>
    </section>
  );
}
