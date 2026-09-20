import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  detectLanguage,
  getStoredLanguage,
  resolveInitialLanguage,
  setStoredLanguage,
  type Language,
} from "./language";
import { createTranslator, lookup, type Translator, type Vars } from "./translate";
import { dictionaries } from "./locales";

export type I18n = Translator & {
  lang: Language;
  setLang: (lang: Language) => void;
};

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { readonly children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(resolveInitialLanguage);
  useEffect(() => {
    const refresh = () => setLangState(resolveInitialLanguage());
    window.addEventListener("prior-preferences-applied", refresh);
    return () => window.removeEventListener("prior-preferences-applied", refresh);
  }, []);
  const i18n = useMemo<I18n>(() => {
    const dict = dictionaries[lang] ?? dictionaries.en;
    const { t, tp } = createTranslator(lang, dict, dictionaries.en);
    return {
      lang,
      t,
      tp,
      setLang: (next: Language) => {
        setStoredLanguage(next);
        setLangState(next);
      },
    };
  }, [lang]);

  useEffect(() => {
    document.documentElement.lang = lang;
    const dict = dictionaries[lang] ?? dictionaries.en;
    const title =
      lookup(dict, "common.documentTitle") ?? lookup(dictionaries.en, "common.documentTitle");
    if (title) document.title = title;
  }, [lang]);

  return <I18nContext.Provider value={i18n}>{children}</I18nContext.Provider>;
}

// Tolerates a missing provider (tests, isolated renders): falls back to the
// stored/device language with English as safety net. setLang persists so the
// next mounted provider picks it up.
export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  const lang = resolveInitialLanguage();
  const dict = dictionaries[lang] ?? dictionaries.en;
  const { t, tp } = createTranslator(lang, dict, dictionaries.en);
  return {
    lang,
    t,
    tp,
    setLang: (next: Language) => setStoredLanguage(next),
  };
}

// For non-React lib code: translate with the stored/device language.
export function translateStored(key: string, vars?: Vars): string {
  const lang = getStoredLanguage() ?? detectLanguage();
  const { t } = createTranslator(lang, dictionaries[lang] ?? dictionaries.en, dictionaries.en);
  return t(key, vars);
}

export function storedLanguage(): Language {
  return getStoredLanguage() ?? detectLanguage();
}
