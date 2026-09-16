import { useEffect, useState, type MouseEvent } from "react";
import { faAndroid, faApple, faLinux, faWindows, type IconDefinition } from "@fortawesome/free-brands-svg-icons";
import { Icon } from "./Icon";
import { openUrl } from "@tauri-apps/plugin-opener";

export const RELEASES_URL = "https://github.com/gh-Constant/prior/releases/latest";
const RELEASE_API_URL = "https://api.github.com/repos/gh-Constant/prior/releases/latest";
const FALLBACK_RELEASE = "https://github.com/gh-Constant/prior/releases/download/v0.1.2";

const platforms: Platform[] = [
  { key: "macos", name: "macOS", detail: "Universal", icon: faApple, matches: (name: string) => name.endsWith("_universal.dmg"), fallback: "Prior_0.1.2_universal.dmg" },
  { key: "windows", name: "Windows", detail: "Installer", icon: faWindows, matches: (name: string) => name.endsWith("x64-setup.exe"), fallback: "Prior_0.1.2_x64-setup.exe" },
  { key: "android", name: "Android", detail: "APK", icon: faAndroid, matches: (name: string) => name.endsWith(".apk"), fallback: "app-universal-release.apk" },
  { key: "linux", name: "Linux", detail: "AppImage", icon: faLinux, matches: (name: string) => name.endsWith("_amd64.AppImage"), fallback: "Prior_0.1.2_amd64.AppImage" },
];

type ReleaseAsset = { readonly name: string; readonly browser_download_url: string };

type Platform = {
  readonly key: string;
  readonly name: string;
  readonly detail: string;
  readonly icon: IconDefinition;
  readonly matches: (name: string) => boolean;
  readonly fallback: string;
};

function PlatformLogo({ icon }: { readonly icon: IconDefinition }) {
  const [width, height, , , pathData] = icon.icon;
  const paths = Array.isArray(pathData) ? pathData : [pathData];
  return <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true" fill="currentColor">{paths.map((path) => <path key={path} d={path} />)}</svg>;
}

function resolveDownloadUrls(assets: ReleaseAsset[]): Record<string, string> {
  return Object.fromEntries(platforms.map((platform) => {
    const asset = assets.find((candidate) => platform.matches(candidate.name));
    return [platform.key, asset?.browser_download_url ?? `${FALLBACK_RELEASE}/${platform.fallback}`];
  }));
}

function openDownload(event: MouseEvent<HTMLAnchorElement>, href: string) {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    event.preventDefault();
    void openUrl(href);
  }
}

export function DownloadPanel() {
  const [downloadUrls, setDownloadUrls] = useState<Record<string, string>>(() => Object.fromEntries(platforms.map((platform) => [platform.key, `${FALLBACK_RELEASE}/${platform.fallback}`])));

  useEffect(() => {
    let active = true;
    void fetch(RELEASE_API_URL, { headers: { Accept: "application/vnd.github+json" } })
      .then((response) => response.ok ? response.json() as Promise<{ assets?: ReleaseAsset[] }> : Promise.reject(new Error("Release lookup failed")))
      .then((release) => {
        if (active) setDownloadUrls(resolveDownloadUrls(release.assets ?? []));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  return (
    <section className="download-panel" aria-labelledby="download-title">
      <div className="download-brand"><img src="/prior-logo.png" alt="Prior" /></div>
      <h3 id="download-title">Prior</h3>
      <div className="download-grid">
        {platforms.map((platform) => (
          <a key={platform.key} className="download-card" href={downloadUrls[platform.key]} target="_blank" rel="noreferrer" onClick={(event) => openDownload(event, downloadUrls[platform.key])}>
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
