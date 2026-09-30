import type { AppDictionary } from "../en/index";

export const palette: AppDictionary["palette"] = {
  label: "Búsqueda y comandos",
  placeholder: "Busca tareas, hábitos, notas, proyectos o escribe un comando…",
  results: "Resultados",
  empty: "Sin resultados",
  navigate: "para moverte",
  open: "para abrir",
  search: "Buscar",
  groups: {
    recent: "Recientes",
    command: "Comandos",
    task: "Tareas",
    habit: "Hábitos",
    note: "Notas",
    project: "Proyectos",
  },
  commands: {
    newTask: "Nueva tarea",
    newHabit: "Nuevo hábito",
    goTo: "Ir a {view}",
    settings: "Ajustes: {tab}",
    themeLight: "Usar el tema claro",
    themeDark: "Usar el tema oscuro",
    themeSystem: "Usar el tema del sistema",
    gameOn: "Activar el modo con juego",
    gameOff: "Cambiar al modo Calma",
    gameFailed: "No se pudo cambiar el modo. Inténtalo de nuevo.",
    signOut: "Cerrar sesión",
  },
};
