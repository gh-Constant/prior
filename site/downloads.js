const matchers = {
  macos: (name) => name.endsWith("_universal.dmg"),
  windows: (name) => name.endsWith("x64-setup.exe"),
  android: (name) => name.endsWith(".apk"),
  linux: (name) => name.endsWith("_amd64.AppImage"),
};

fetch("https://api.github.com/repos/gh-Constant/prior/releases/latest", {
  headers: { Accept: "application/vnd.github+json" },
})
  .then((response) => {
    if (!response.ok) throw new Error("Release lookup failed");
    return response.json();
  })
  .then((release) => {
    if (!Array.isArray(release.assets)) return;
    for (const [platform, matches] of Object.entries(matchers)) {
      const asset = release.assets.find((candidate) =>
        typeof candidate.name === "string" && matches(candidate.name) &&
        typeof candidate.browser_download_url === "string" &&
        candidate.browser_download_url.startsWith("https://github.com/gh-Constant/prior/releases/download/")
      );
      const link = document.querySelector(`[data-platform="${platform}"]`);
      if (asset && link) link.href = asset.browser_download_url;
    }
  })
  .catch(() => {
    // The verified, versioned download links remain usable if GitHub is unavailable.
  });
