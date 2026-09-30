import type { AppDictionary } from "../en/index";

export const capture: AppDictionary["capture"] = {
  label: "Aufgabe schnell hinzufügen",
  title: "Titel der Aufgabe",
  placeholder: "Was geht dir durch den Kopf?",
  hint: "Eingabe zum Speichern · Esc zum Schließen",
  save: "Aufgabe hinzufügen",
  saved: "Zu deinem Eingang hinzugefügt",
  failed: "Die Aufgabe konnte nicht gespeichert werden. Versuche es erneut.",
  settings: {
    title: "Schnell hinzufügen",
    label: "Globales Tastenkürzel",
    hint: "Öffnet ein kleines Fenster, um aus jeder App eine Aufgabe hinzuzufügen, auch wenn Prior ausgeblendet ist.",
    change: "Ändern",
    recording: "Drücke das neue Tastenkürzel…",
    reset: "Zurücksetzen",
    failed: "Dieses Tastenkürzel konnte nicht registriert werden. Möglicherweise wird es von einer anderen App verwendet.",
    off: "Aus",
  },
};
