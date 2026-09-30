import type { AppDictionary } from "../en/index";

export const palette: AppDictionary["palette"] = {
  label: "Suche und Befehle",
  placeholder: "Aufgaben, Gewohnheiten, Notizen, Projekte suchen oder einen Befehl eingeben…",
  results: "Ergebnisse",
  empty: "Keine Ergebnisse",
  navigate: "zum Navigieren",
  open: "zum Öffnen",
  search: "Suchen",
  groups: {
    recent: "Zuletzt verwendet",
    command: "Befehle",
    task: "Aufgaben",
    habit: "Gewohnheiten",
    note: "Notizen",
    project: "Projekte",
  },
  commands: {
    newTask: "Neue Aufgabe",
    newHabit: "Neue Gewohnheit",
    goTo: "Zu {view} wechseln",
    settings: "Einstellungen: {tab}",
    themeLight: "Helles Design verwenden",
    themeDark: "Dunkles Design verwenden",
    themeSystem: "Systemdesign verwenden",
    gameOn: "Spielerischen Modus aktivieren",
    gameOff: "Zum ruhigen Modus wechseln",
    gameFailed: "Der Modus konnte nicht geändert werden. Versuche es noch einmal.",
    signOut: "Abmelden",
  },
};
