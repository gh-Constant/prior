import type { AppDictionary } from "../en/index";

export const reminders: AppDictionary["reminders"] = {
  picker: {
    label: "Lembrete",
    none: "Sem lembrete",
    set: "Lembrete: {when}",
    custom: "Horário de lembrete personalizado",
    clear: "Remover o lembrete",
  },
  presets: {
    due: "No horário de vencimento",
    "10min": "10 min antes",
    "1h": "1 hora antes",
    morning: "Na manhã do dia",
    inOneHour: "Daqui a 1 hora",
    tomorrowMorning: "Amanhã de manhã",
    custom: "Personalizado…",
  },
  notification: {
    taskBody: "Lembrete de tarefa",
    habitBody: "Hora do seu hábito",
  },
  channel: "Lembretes",
  test: {
    title: "As notificações do Prior estão funcionando",
    body: "Os lembretes de tarefas e hábitos vão aparecer assim.",
  },
  settings: {
    title: "Notificações",
    enabled: "Lembretes",
    scopeAndroid: "Os lembretes de tarefas e hábitos disparam mesmo com o Prior fechado.",
    scopeDesktop: "Os lembretes aparecem enquanto o Prior estiver aberto, mesmo em segundo plano.",
    scopeWeb: "Os lembretes aparecem enquanto esta aba estiver aberta.",
    denied: "As notificações estão bloqueadas. Permita-as para o Prior nas configurações do sistema ou do navegador.",
    unsupported: "Este dispositivo não consegue mostrar notificações.",
    habits: "Lembretes de hábitos",
    habitsHint: "No horário de cada hábito, nos dias programados em que você ainda não o marcou.",
    quiet: "Horário de silêncio",
    quietHint: "Os lembretes que caírem no horário de silêncio esperam até ele terminar.",
    quietStart: "Início do horário de silêncio",
    quietEnd: "Fim do horário de silêncio",
    test: "Notificação de teste",
    testHint: "Verifica se as notificações chegam a este dispositivo.",
    testButton: "Enviar um teste",
    testSent: "Enviada. Ela deve aparecer em instantes.",
  },
};
