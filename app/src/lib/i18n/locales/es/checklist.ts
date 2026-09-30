import type { AppDictionary } from "../en/index";

export const checklist: AppDictionary["checklist"] = {
  title: "Lista de comprobación",
  progress: "{done} de {total} hechos",
  change: "Lista de comprobación: {done}/{total}",
  add: "Añadir un elemento",
  full: "La lista de comprobación está llena (100 elementos)",
  itemLabel: "Elemento {position} de la lista de comprobación",
  check: "Marcar {title}",
  uncheck: "Desmarcar {title}",
  remove: "Quitar {title}",
  dragHint: "Arrastra para reordenar",
  keys: "Intro añade un elemento, Retroceso en un elemento vacío lo quita, Alt+Arriba o Alt+Abajo lo mueve.",
  moved: "{title} movido a la posición {position} de {total}",
};
