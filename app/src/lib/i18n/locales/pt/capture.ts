import type { AppDictionary } from "../en/index";

export const capture: AppDictionary["capture"] = {
  label: "Adicionar tarefa rápida",
  title: "Título da tarefa",
  placeholder: "No que você está pensando?",
  hint: "Enter para salvar · Esc para fechar",
  save: "Adicionar tarefa",
  saved: "Adicionada à sua caixa de entrada",
  failed: "Não foi possível salvar a tarefa. Tente novamente.",
  settings: {
    title: "Adição rápida",
    label: "Atalho global",
    hint: "Abre uma pequena janela para adicionar uma tarefa de qualquer aplicativo, mesmo quando o Prior está oculto.",
    change: "Alterar",
    recording: "Pressione o novo atalho…",
    reset: "Redefinir",
    failed: "Não foi possível registrar este atalho. Talvez ele esteja sendo usado por outro aplicativo.",
    off: "Desativado",
  },
};
