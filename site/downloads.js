const matchers = {
  macos: (name) => name.endsWith("_universal.dmg"),
  windows: (name) => name.endsWith("x64-setup.exe"),
  android: (name) => name.endsWith(".apk"),
  linux: (name) => name.endsWith("_amd64.AppImage"),
};

// Highlight the visitor's platform in each download group (macOS stays the default).
function detectPlatform() {
  try {
    const ua = navigator.userAgent || "";
    const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    if (/android/i.test(ua)) return "android";
    if (/iphone|ipad|ipod/i.test(ua)) return null;
    if (/win/i.test(platform) || /windows/i.test(ua)) return "windows";
    if (/mac/i.test(platform) || /mac os x/i.test(ua)) return "macos";
    if (/linux|x11|cros/i.test(platform) || /linux|x11|cros/i.test(ua)) return "linux";
  } catch (error) {
    // Fall back to the default order.
  }
  return null;
}

const detected = detectPlatform();
if (detected) {
  for (const group of document.querySelectorAll("[data-download-group]")) {
    const preferred = group.querySelector(`[data-platform="${detected}"]`);
    if (!preferred) continue;
    for (const button of group.querySelectorAll("[data-platform]")) button.classList.toggle("is-primary", button === preferred);
    group.prepend(preferred);
  }
}

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
      if (!asset) continue;
      for (const link of document.querySelectorAll(`[data-platform="${platform}"]`)) link.href = asset.browser_download_url;
    }
    if (typeof release.tag_name === "string" && /^v\d+\.\d+\.\d+$/.test(release.tag_name)) {
      for (const tag of document.querySelectorAll("[data-release-tag]")) tag.textContent = release.tag_name;
    }
    if (typeof release.html_url === "string" &&
        release.html_url.startsWith("https://github.com/gh-Constant/prior/releases/")) {
      for (const releaseLink of document.querySelectorAll("[data-release-link]")) releaseLink.href = release.html_url;
    }
  })
  .catch(() => {
    // The verified, versioned download links remain usable if GitHub is unavailable.
  });

// Reveal sections once they scroll into view (one-shot, never blocks interaction).
const revealed = document.querySelectorAll(".reveal");
if (revealed.length && "IntersectionObserver" in window) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
  for (const element of revealed) observer.observe(element);
} else {
  for (const element of revealed) element.classList.add("is-visible");
}
