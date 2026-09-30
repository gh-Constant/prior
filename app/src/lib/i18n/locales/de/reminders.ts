import type { AppDictionary } from "../en/index";

export const reminders: AppDictionary["reminders"] = {
  picker: {
    label: "Erinnerung",
    none: "Keine Erinnerung",
    set: "Erinnerung: {when}",
    custom: "Eigene Erinnerungszeit",
    clear: "Erinnerung entfernen",
  },
  presets: {
    due: "Zum Fälligkeitszeitpunkt",
    "10min": "10 Min. vorher",
    "1h": "1 Stunde vorher",
    morning: "Am Morgen des Tages",
    inOneHour: "In 1 Stunde",
    tomorrowMorning: "Morgen früh",
    custom: "Benutzerdefiniert…",
  },
  notification: {
    taskBody: "Aufgabenerinnerung",
    habitBody: "Zeit für deine Gewohnheit",
  },
  channel: "Erinnerungen",
  test: {
    title: "Prior-Benachrichtigungen funktionieren",
    body: "So sehen Erinnerungen an Aufgaben und Gewohnheiten aus.",
  },
  settings: {
    title: "Benachrichtigungen",
    enabled: "Erinnerungen",
    scopeAndroid: "Erinnerungen an Aufgaben und Gewohnheiten kommen auch, wenn Prior geschlossen ist.",
    scopeDesktop: "Erinnerungen erscheinen, solange Prior läuft, auch im Hintergrund.",
    scopeWeb: "Erinnerungen erscheinen, solange dieser Tab geöffnet ist.",
    denied: "Benachrichtigungen sind blockiert. Erlaube sie für Prior in deinen System- oder Browsereinstellungen.",
    unsupported: "Dieses Gerät kann keine Benachrichtigungen anzeigen.",
    habits: "Erinnerungen an Gewohnheiten",
    habitsHint: "Zur Tageszeit jeder Gewohnheit, an geplanten Tagen, an denen du sie noch nicht abgehakt hast.",
    quiet: "Ruhezeiten",
    quietHint: "Erinnerungen, die in die Ruhezeiten fallen, warten bis zu deren Ende.",
    quietStart: "Beginn der Ruhezeiten",
    quietEnd: "Ende der Ruhezeiten",
    test: "Testbenachrichtigung",
    testHint: "Prüft, ob Benachrichtigungen auf diesem Gerät ankommen.",
    testButton: "Test senden",
    testSent: "Gesendet. Sie sollte gleich erscheinen.",
  },
};
