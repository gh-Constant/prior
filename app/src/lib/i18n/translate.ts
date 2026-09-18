// Tiny key-based translator. Dictionaries are nested objects, keys are
// dot paths ("settings.tabs.general"), values interpolate "{var}".
export type Vars = Record<string, string | number>;

export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

export function lookup(dict: unknown, path: string): string | undefined {
  let current: unknown = dict;
  for (const part of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

export type Translator = {
  t: (key: string, vars?: Vars) => string;
  tp: (base: string, count: number, vars?: Vars) => string;
};

export function createTranslator(lang: string, dict: unknown, fallback: unknown): Translator {
  const t = (key: string, vars?: Vars): string =>
    interpolate(lookup(dict, key) ?? lookup(fallback, key) ?? key, vars);
  // Plural convention: "<base>" for "one", "<base>_plural" otherwise,
  // resolved with Intl.PluralRules so French 0/1 stay singular.
  const tp = (base: string, count: number, vars?: Vars): string => {
    const form = new Intl.PluralRules(lang).select(count);
    return t(form === "one" ? base : `${base}_plural`, { ...vars, count });
  };
  return { t, tp };
}
