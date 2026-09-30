import type { AppDictionary } from "../en/index";

export const capture: AppDictionary["capture"] = {
  label: "Ajouter rapidement une tâche",
  title: "Titre de la tâche",
  placeholder: "Qu’avez-vous en tête ?",
  hint: "Entrée pour enregistrer · Échap pour fermer",
  save: "Ajouter la tâche",
  saved: "Ajoutée à votre boîte de réception",
  failed: "La tâche n’a pas pu être enregistrée. Réessayez.",
  settings: {
    title: "Ajout rapide",
    label: "Raccourci global",
    hint: "Ouvre une petite fenêtre pour ajouter une tâche depuis n’importe quelle application, même lorsque Prior est masqué.",
    change: "Modifier",
    recording: "Appuyez sur le nouveau raccourci…",
    reset: "Réinitialiser",
    failed: "Ce raccourci n’a pas pu être enregistré. Il est peut-être utilisé par une autre application.",
    off: "Désactivé",
  },
};
