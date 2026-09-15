import { useEffect, useState, type MouseEvent } from "react";
import { faAndroid, faApple, faLinux, faWindows, type IconDefinition } from "@fortawesome/free-brands-svg-icons";
import { Icon } from "./Icon";
import { openUrl } from "@tauri-apps/plugin-opener";

export const RELEASES_URL = "https://github.com/gh-Constant/prior/releases/latest";
const RELEASE_API_URL = "https://api.github.com/repos/gh-Constant/prior/releases/latest";

const platforms = [
  { key: "macos", name: "macOS", detail: "Universal", icon: faApple, matches: (name: string) => name.endsWith("_universal.dmg"), fallback: "Prior_0.1.2_universal.dmg" },
  { key: "windows", name: "Windows", detail: "Installer", icon: faWindows, matches: (name: string) => name.endsWith("x64-setup.exe"), fallback: "Prior_0.1.2_x64-setup.exe" },
  { key: "android", name: "Android", detail: "APK", icon: faAndroid, matches: (name: string) => name.endsWith(".apk"), fallback: "app-universal-release.apk" },
  { key: "linux", name: "Linux", detail: "AppImage", icon: faLinux, matches: (name: string) => name.endsWith("_amd64.AppImage"), fallback: "Prior_0.1.2_amd64.AppImage" },
];

type ReleaseAsset = { name: string; browser_download_url: string };

function PlatformLogo({ icon }: { icon: IconDefinition }) {
  const [width, height, , , pathData] = icon.icon;
  const paths = Array.isArray(pathData) ? pathData : [pathData];
  return <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true" fill="currentColor">{paths.map((path, index) => <path key={index} d={path} />)}</svg>;
}

export function DownloadPanel() {
  const [downloadUrls, setDownloadUrls] = useState<Record<string, string>>(() => Object.fromEntries(platforms.map((platform) => [platform.key, `${RELEASES_URL}/download/${platform.fallback}`])));

  useEffect(() => {
    let active = true;
    void fetch(RELEASE_API_URL, { headers: { Accept: "application/vnd.github+json" } })
      .then((response) => response.ok ? response.json() as Promise<{ assets?: ReleaseAsset[] }> : Promise.reject(new Error("Release lookup failed")))
      .then((release) => {
        const assets = release.assets ?? [];
        const next = Object.fromEntries(platforms.map((platform) => {
          const asset = assets.find((candidate) => platform.matches(candidate.name));
          return [platform.key, asset?.browser_download_url ?? `${RELEASES_URL}/download/${platform.fallback}`];
        }));
        if (active) setDownloadUrls(next);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  function openDownload(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      event.preventDefault();
      void openUrl(href);
    }
  }

  return (
    <section className="download-panel" aria-labelledby="download-title">
      <div className="download-brand"><img src="/prior-logo.png" alt="Prior" /></div>
      <h3 id="download-title">Prior everywhere</h3>
      <p className="download-copy">Choose your platform.</p>
      <div className="download-grid">
        {platforms.map((platform) => (
          <a key={platform.name} className="download-card" href={downloadUrls[platform.key]} target="_blank" rel="noreferrer" onClick={(event) => openDownload(event, downloadUrls[platform.key])}>
            <span className="download-card-icon"><PlatformLogo icon={platform.icon} /></span>
            <span className="download-card-copy"><strong>{platform.name}</strong><small>{platform.detail}</small></span>
            <Icon name="download" className="download-card-arrow" />
          </a>
        ))}
      </div>
      <a className="release-link" href={RELEASES_URL} target="_blank" rel="noreferrer" onClick={(event) => openDownload(event, RELEASES_URL)}>View all releases <Icon name="arrow" /></a>
    </section>
  );
}
