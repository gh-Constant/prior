import type { AppDictionary } from "../en/index";

export const palette: AppDictionary["palette"] = {
  label: "Recherche et commandes",
  placeholder: "Rechercher des tâches, habitudes, notes, projets, ou saisir une commande…",
  results: "Résultats",
  empty: "Aucun résultat",
  navigate: "pour naviguer",
  open: "pour ouvrir",
  search: "Rechercher",
  groups: {
    recent: "Récents",
    command: "Commandes",
    task: "Tâches",
    habit: "Habitudes",
    note: "Notes",
    project: "Projets",
  },
  commands: {
    newTask: "Nouvelle tâche",
    newHabit: "Nouvelle habitude",
    goTo: "Aller à {view}",
    settings: "Paramètres : {tab}",
    themeLight: "Utiliser le thème clair",
    themeDark: "Utiliser le thème sombre",
    themeSystem: "Utiliser le thème du système",
    gameOn: "Activer le mode ludique",
    gameOff: "Passer en mode Calme",
    gameFailed: "Le mode n’a pas pu être changé. Réessayez.",
    signOut: "Se déconnecter",
  },
};
