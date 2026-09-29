// Runs synchronously in <head>, before the first paint, so the page never flashes
// the wrong theme. It is an external file (not inline) to stay within the Tauri CSP
// (default-src 'self'). Keep in sync with resolveTheme() in src/lib/theme.ts.
(function () {
  var theme = "light";
  try {
    var stored = localStorage.getItem("prior.theme");
    if (stored === "dark" || stored === "light") theme = stored;
    else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) theme = "dark";
  } catch (error) {
    try {
      if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) theme = "dark";
    } catch (ignored) {
      // Keep light.
    }
  }
  var root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#191715" : "#fafaf9");
})();
