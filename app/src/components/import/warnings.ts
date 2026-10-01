import type { Vars } from "../../lib/i18n/translate";
import type { ImportWarning } from "../../lib/import/types";

/** The user-language sentence for a warning from the readers, the archive reader or the AI. */
export function warningText(warning: ImportWarning, t: (key: string, vars?: Vars) => string): string {
  return t(`import.warnings.${warning.code}`, { count: warning.count ?? 0, file: warning.file || t("import.pasted") });
}
