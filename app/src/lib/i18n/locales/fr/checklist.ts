import type { AppDictionary } from "../en/index";

export const checklist: AppDictionary["checklist"] = {
  title: "Liste de contrôle",
  progress: "{done} sur {total} faits",
  change: "Liste de contrôle : {done}/{total}",
  add: "Ajouter un élément",
  full: "La liste de contrôle est pleine (100 éléments)",
  itemLabel: "Élément {position} de la liste de contrôle",
  check: "Cocher {title}",
  uncheck: "Décocher {title}",
  remove: "Supprimer {title}",
  dragHint: "Faites glisser pour réorganiser",
  keys: "Entrée ajoute un élément, Retour arrière sur un élément vide le supprime, Alt+Haut ou Alt+Bas le déplace.",
  moved: "{title} déplacé en position {position} sur {total}",
};
