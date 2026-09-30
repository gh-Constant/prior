import type { AppDictionary } from "../en/index";

export const capture: AppDictionary["capture"] = {
  label: "Añadir una tarea rápida",
  title: "Título de la tarea",
  placeholder: "¿Qué tienes en mente?",
  hint: "Intro para guardar · Esc para cerrar",
  save: "Añadir tarea",
  saved: "Añadida a tu bandeja de entrada",
  failed: "No se pudo guardar la tarea. Inténtalo de nuevo.",
  settings: {
    title: "Añadido rápido",
    label: "Atajo global",
    hint: "Abre una pequeña ventana para añadir una tarea desde cualquier aplicación, incluso cuando Prior está oculto.",
    change: "Cambiar",
    recording: "Pulsa el nuevo atajo…",
    reset: "Restablecer",
    failed: "No se pudo registrar este atajo. Puede que otra aplicación lo esté usando.",
    off: "Desactivado",
  },
};
