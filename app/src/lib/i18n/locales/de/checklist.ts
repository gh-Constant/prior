import type { AppDictionary } from "../en/index";

export const checklist: AppDictionary["checklist"] = {
  title: "Checkliste",
  progress: "{done} von {total} erledigt",
  change: "Checkliste: {done}/{total}",
  add: "Punkt hinzufügen",
  full: "Die Checkliste ist voll (100 Punkte)",
  itemLabel: "Checklistenpunkt {position}",
  check: "{title} abhaken",
  uncheck: "Haken bei {title} entfernen",
  remove: "{title} entfernen",
  dragHint: "Zum Sortieren ziehen",
  keys: "Eingabe fügt einen Punkt hinzu, Rücktaste in einem leeren Punkt entfernt ihn, Alt+Pfeil hoch oder Alt+Pfeil runter verschiebt ihn.",
  moved: "{title} an Position {position} von {total} verschoben",
};
