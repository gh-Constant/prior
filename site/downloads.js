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
    const tag = document.querySelector("[data-release-tag]");
    if (tag && typeof release.tag_name === "string" && /^v\d+\.\d+\.\d+$/.test(release.tag_name)) {
      tag.textContent = release.tag_name;
    }
    const releaseLink = document.querySelector("[data-release-link]");
    if (releaseLink && typeof release.html_url === "string" &&
        release.html_url.startsWith("https://github.com/gh-Constant/prior/releases/")) {
      releaseLink.href = release.html_url;
    }
  })
  .catch(() => {
    // The verified, versioned download links remain usable if GitHub is unavailable.
  });

// Reveal the product window once it scrolls into view (one-shot, never blocks interaction).
const revealed = document.querySelectorAll(".reveal");
if (revealed.length && "IntersectionObserver" in window) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.15, rootMargin: "0px 0px -10% 0px" });
  for (const element of revealed) observer.observe(element);
} else {
  for (const element of revealed) element.classList.add("is-visible");
}
