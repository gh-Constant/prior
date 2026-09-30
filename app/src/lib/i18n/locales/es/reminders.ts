import type { AppDictionary } from "../en/index";

export const reminders: AppDictionary["reminders"] = {
  picker: {
    label: "Recordatorio",
    none: "Sin recordatorio",
    set: "Recordatorio: {when}",
    custom: "Hora de recordatorio personalizada",
    clear: "Quitar el recordatorio",
  },
  presets: {
    due: "A la hora de vencimiento",
    "10min": "10 min antes",
    "1h": "1 hora antes",
    morning: "Esa misma mañana",
    inOneHour: "Dentro de 1 hora",
    tomorrowMorning: "Mañana por la mañana",
    custom: "Personalizado…",
  },
  notification: {
    taskBody: "Recordatorio de tarea",
    habitBody: "Es la hora de tu hábito",
  },
  channel: "Recordatorios",
  test: {
    title: "Las notificaciones de Prior funcionan",
    body: "Los recordatorios de tareas y hábitos se verán así.",
  },
  settings: {
    title: "Notificaciones",
    enabled: "Recordatorios",
    scopeAndroid: "Los recordatorios de tareas y hábitos saltan aunque Prior esté cerrado.",
    scopeDesktop: "Los recordatorios aparecen mientras Prior está abierto, incluso en segundo plano.",
    scopeWeb: "Los recordatorios aparecen mientras esta pestaña está abierta.",
    denied: "Las notificaciones están bloqueadas. Permítelas para Prior en los ajustes de tu sistema o de tu navegador.",
    unsupported: "Este dispositivo no puede mostrar notificaciones.",
    habits: "Recordatorios de hábitos",
    habitsHint: "A la hora de cada hábito, los días programados en los que aún no lo hayas marcado.",
    quiet: "Horas de silencio",
    quietHint: "Los recordatorios que caen en las horas de silencio esperan a que terminen.",
    quietStart: "Inicio de las horas de silencio",
    quietEnd: "Fin de las horas de silencio",
    test: "Notificación de prueba",
    testHint: "Comprueba que las notificaciones llegan a este dispositivo.",
    testButton: "Enviar una prueba",
    testSent: "Enviada. Debería aparecer en un momento.",
  },
};
