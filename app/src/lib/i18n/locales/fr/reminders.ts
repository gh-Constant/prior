import type { AppDictionary } from "../en/index";

export const reminders: AppDictionary["reminders"] = {
  picker: {
    label: "Rappel",
    none: "Aucun rappel",
    set: "Rappel : {when}",
    custom: "Heure de rappel personnalisée",
    clear: "Supprimer le rappel",
  },
  presets: {
    due: "À l’échéance",
    "10min": "10 min avant",
    "1h": "1 heure avant",
    morning: "Le matin même",
    inOneHour: "Dans 1 heure",
    tomorrowMorning: "Demain matin",
    custom: "Personnalisé…",
  },
  notification: {
    taskBody: "Rappel de tâche",
    habitBody: "C’est l’heure de votre habitude",
  },
  channel: "Rappels",
  test: {
    title: "Les notifications de Prior fonctionnent",
    body: "Les rappels de tâches et d’habitudes ressembleront à ceci.",
  },
  settings: {
    title: "Notifications",
    enabled: "Rappels",
    scopeAndroid: "Les rappels de tâches et d’habitudes se déclenchent même lorsque Prior est fermé.",
    scopeDesktop: "Les rappels s’affichent tant que Prior est lancé, même en arrière-plan.",
    scopeWeb: "Les rappels s’affichent tant que cet onglet est ouvert.",
    denied: "Les notifications sont bloquées. Autorisez-les pour Prior dans les réglages de votre système ou de votre navigateur.",
    unsupported: "Cet appareil ne peut pas afficher de notifications.",
    habits: "Rappels d’habitudes",
    habitsHint: "À l’heure prévue de chaque habitude, les jours programmés où vous ne l’avez pas encore faite.",
    quiet: "Heures calmes",
    quietHint: "Les rappels qui tombent pendant les heures calmes attendent leur fin.",
    quietStart: "Début des heures calmes",
    quietEnd: "Fin des heures calmes",
    test: "Notification de test",
    testHint: "Vérifie que les notifications arrivent bien sur cet appareil.",
    testButton: "Envoyer un test",
    testSent: "Envoyé. Elle devrait apparaître dans un instant.",
  },
};
