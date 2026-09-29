import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/dm-sans";
import "../index.css";
import { I18nProvider } from "../lib/i18n";
import { Lab } from "./Lab";
import { initTheme } from "../lib/theme";

initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <Lab />
    </I18nProvider>
  </StrictMode>,
);
