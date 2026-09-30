import type { AppDictionary } from "../en/index";

export const palette: AppDictionary["palette"] = {
  label: "Pesquisa e comandos",
  placeholder: "Pesquise tarefas, hábitos, notas, projetos ou digite um comando…",
  results: "Resultados",
  empty: "Nenhum resultado",
  navigate: "para navegar",
  open: "para abrir",
  search: "Pesquisar",
  groups: {
    recent: "Recentes",
    command: "Comandos",
    task: "Tarefas",
    habit: "Hábitos",
    note: "Notas",
    project: "Projetos",
  },
  commands: {
    newTask: "Nova tarefa",
    newHabit: "Novo hábito",
    goTo: "Ir para {view}",
    settings: "Configurações: {tab}",
    themeLight: "Usar o tema claro",
    themeDark: "Usar o tema escuro",
    themeSystem: "Usar o tema do sistema",
    gameOn: "Ativar o modo gamificado",
    gameOff: "Mudar para o modo Calmo",
    gameFailed: "Não foi possível mudar o modo. Tente novamente.",
    signOut: "Sair",
  },
};
