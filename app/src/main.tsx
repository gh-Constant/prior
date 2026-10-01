import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/dm-sans";
import "./index.css";
import { I18nProvider } from "./lib/i18n";
import { App } from "./App";
import { ForcedUpdateGate } from "./components/ForcedUpdateGate";
import { QuickAddWindow } from "./components/QuickAddWindow";
import { isQuickAddWindow } from "./lib/quickCapture";
import { capturePendingLink } from "./lib/pendingLink";
import { initTheme } from "./lib/theme";
// Phone layout overrides load last so they win over the component styles.
import "./phone.css";

// Theme first: public/theme-init.js already painted the right one; this keeps
// it in sync with system changes, synced preferences and the native window.
initTheme();

const quickAdd = isQuickAddWindow();

// Before anything can navigate away (sign-in), keep shared links safe.
if (!quickAdd) capturePendingLink();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      {quickAdd ? <QuickAddWindow /> : <ForcedUpdateGate><App /></ForcedUpdateGate>}
    </I18nProvider>
  </StrictMode>,
);
