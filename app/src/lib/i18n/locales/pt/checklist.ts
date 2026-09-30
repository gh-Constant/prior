import type { AppDictionary } from "../en/index";

export const checklist: AppDictionary["checklist"] = {
  title: "Checklist",
  progress: "{done} de {total} concluídos",
  change: "Checklist: {done}/{total}",
  add: "Adicionar um item",
  full: "O checklist está cheio (100 itens)",
  itemLabel: "Item {position} do checklist",
  check: "Marcar {title}",
  uncheck: "Desmarcar {title}",
  remove: "Remover {title}",
  dragHint: "Arraste para reordenar",
  keys: "Enter adiciona um item, Backspace em um item vazio o remove, Alt+Seta para cima ou Alt+Seta para baixo o move.",
  moved: "{title} movido para a posição {position} de {total}",
};
