package httpapi

import (
	"strconv"
	"strings"
)

// Wording of the decision-model Today recommendations, per app language.
// Placeholders: {n}, {title}, {time}, {start}, {end}.
type todayCopy struct {
	overdueOne, overdueMany                   string
	dueToday, dueTomorrow, dueInDays          string
	plannedAt, planned, carriedOver           string
	inProgress, importantUrgent               string
	important, urgent, priority               string
	next, followUp, fallback                  string
	summaryOne, summaryMany, summaryNone, at  string
	tipOverdue, tipFull, tipShort, tipEvening string
	tipBlock, tipInbox, tipOneAtATime         string
}

var todayCopies = map[string]todayCopy{
	"en": {
		overdueOne: "Overdue by a day", overdueMany: "Overdue by {n} days",
		dueToday: "Due today", dueTomorrow: "Due tomorrow", dueInDays: "Due in {n} days",
		plannedAt: "Planned for today at {time}", planned: "Planned for today", carriedOver: "Planned earlier and still open",
		inProgress: "Already in progress", importantUrgent: "Important and urgent",
		important: "Marked important", urgent: "Marked urgent", priority: "Priority P{n}",
		next: "Next on your list", followUp: "Follow-up is due", fallback: "A good next step for today",
		summaryOne:  "One task stands out today: start with “{title}”{time}.",
		summaryMany: "{n} tasks stand out today: start with “{title}”{time}.",
		summaryNone: "Nothing pressing stands out today.", at: " at {time}",
		tipOverdue:    "{n} tasks are overdue: reschedule the ones you won't do today.",
		tipFull:       "Your calendar is full: keep today's focus to one small step.",
		tipShort:      "Less than an hour free today: start with the quickest task.",
		tipEvening:    "Your day is winding down: pick tomorrow's first task now.",
		tipBlock:      "Block {start}–{end} for “{title}” before anything else fills it.",
		tipInbox:      "{n} tasks are still in your inbox: triage them in five minutes.",
		tipOneAtATime: "One task at a time: finish the first before opening the next.",
	},
	"fr": {
		overdueOne: "En retard d'un jour", overdueMany: "En retard de {n} jours",
		dueToday: "Échéance aujourd'hui", dueTomorrow: "Échéance demain", dueInDays: "Échéance dans {n} jours",
		plannedAt: "Prévue aujourd'hui à {time}", planned: "Prévue aujourd'hui", carriedOver: "Prévue plus tôt, toujours ouverte",
		inProgress: "Déjà en cours", importantUrgent: "Importante et urgente",
		important: "Marquée importante", urgent: "Marquée urgente", priority: "Priorité P{n}",
		next: "Prochaine étape de votre liste", followUp: "Relance à faire", fallback: "Une bonne prochaine étape pour aujourd'hui",
		summaryOne:  "Une tâche ressort aujourd'hui : commencez par « {title} »{time}.",
		summaryMany: "{n} tâches ressortent aujourd'hui : commencez par « {title} »{time}.",
		summaryNone: "Rien d'urgent ne ressort aujourd'hui.", at: " à {time}",
		tipOverdue:    "{n} tâches sont en retard : replanifiez celles que vous ne ferez pas aujourd'hui.",
		tipFull:       "Votre agenda est plein : limitez-vous à une petite étape aujourd'hui.",
		tipShort:      "Moins d'une heure de libre aujourd'hui : commencez par la tâche la plus rapide.",
		tipEvening:    "La journée se termine : choisissez dès maintenant la première tâche de demain.",
		tipBlock:      "Bloquez {start}–{end} pour « {title} » avant que ce créneau ne se remplisse.",
		tipInbox:      "{n} tâches attendent dans la boîte de réception : triez-les en cinq minutes.",
		tipOneAtATime: "Une tâche à la fois : terminez la première avant d'ouvrir la suivante.",
	},
	"de": {
		overdueOne: "Seit einem Tag überfällig", overdueMany: "Seit {n} Tagen überfällig",
		dueToday: "Heute fällig", dueTomorrow: "Morgen fällig", dueInDays: "In {n} Tagen fällig",
		plannedAt: "Heute um {time} geplant", planned: "Für heute geplant", carriedOver: "Früher geplant und noch offen",
		inProgress: "Bereits in Arbeit", importantUrgent: "Wichtig und dringend",
		important: "Als wichtig markiert", urgent: "Als dringend markiert", priority: "Priorität P{n}",
		next: "Als Nächstes auf deiner Liste", followUp: "Nachfassen ist fällig", fallback: "Ein guter nächster Schritt für heute",
		summaryOne:  "Heute sticht eine Aufgabe heraus: Beginne mit „{title}“{time}.",
		summaryMany: "Heute stechen {n} Aufgaben heraus: Beginne mit „{title}“{time}.",
		summaryNone: "Heute sticht nichts Dringendes heraus.", at: " um {time}",
		tipOverdue:    "{n} Aufgaben sind überfällig: Plane die, die du heute nicht schaffst, neu ein.",
		tipFull:       "Dein Kalender ist voll: Nimm dir heute nur einen kleinen Schritt vor.",
		tipShort:      "Heute bleibt weniger als eine Stunde frei: Beginne mit der schnellsten Aufgabe.",
		tipEvening:    "Der Tag geht zu Ende: Lege jetzt die erste Aufgabe für morgen fest.",
		tipBlock:      "Blocke {start}–{end} für „{title}“, bevor etwas anderes den Platz einnimmt.",
		tipInbox:      "{n} Aufgaben liegen noch im Eingang: Sortiere sie in fünf Minuten.",
		tipOneAtATime: "Eine Aufgabe nach der anderen: Schließe die erste ab, bevor du die nächste beginnst.",
	},
	"es": {
		overdueOne: "Vencida hace un día", overdueMany: "Vencida hace {n} días",
		dueToday: "Vence hoy", dueTomorrow: "Vence mañana", dueInDays: "Vence en {n} días",
		plannedAt: "Planificada para hoy a las {time}", planned: "Planificada para hoy", carriedOver: "Planificada antes y aún abierta",
		inProgress: "Ya en curso", importantUrgent: "Importante y urgente",
		important: "Marcada como importante", urgent: "Marcada como urgente", priority: "Prioridad P{n}",
		next: "Siguiente en tu lista", followUp: "Toca hacer seguimiento", fallback: "Un buen siguiente paso para hoy",
		summaryOne:  "Hoy destaca una tarea: empieza por «{title}»{time}.",
		summaryMany: "Hoy destacan {n} tareas: empieza por «{title}»{time}.",
		summaryNone: "Hoy no destaca nada urgente.", at: " a las {time}",
		tipOverdue:    "{n} tareas están vencidas: reprograma las que no harás hoy.",
		tipFull:       "Tu calendario está lleno: limita el foco de hoy a un pequeño paso.",
		tipShort:      "Te queda menos de una hora libre hoy: empieza por la tarea más rápida.",
		tipEvening:    "El día termina: elige ya la primera tarea de mañana.",
		tipBlock:      "Reserva {start}–{end} para «{title}» antes de que se llene ese hueco.",
		tipInbox:      "{n} tareas siguen en la bandeja de entrada: clasifícalas en cinco minutos.",
		tipOneAtATime: "Una tarea a la vez: termina la primera antes de abrir la siguiente.",
	},
	"pt": {
		overdueOne: "Atrasada há um dia", overdueMany: "Atrasada há {n} dias",
		dueToday: "Vence hoje", dueTomorrow: "Vence amanhã", dueInDays: "Vence em {n} dias",
		plannedAt: "Planejada para hoje às {time}", planned: "Planejada para hoje", carriedOver: "Planejada antes e ainda aberta",
		inProgress: "Já em andamento", importantUrgent: "Importante e urgente",
		important: "Marcada como importante", urgent: "Marcada como urgente", priority: "Prioridade P{n}",
		next: "Próxima da sua lista", followUp: "Hora de fazer o acompanhamento", fallback: "Um bom próximo passo para hoje",
		summaryOne:  "Hoje uma tarefa se destaca: comece por “{title}”{time}.",
		summaryMany: "Hoje {n} tarefas se destacam: comece por “{title}”{time}.",
		summaryNone: "Nada urgente se destaca hoje.", at: " às {time}",
		tipOverdue:    "{n} tarefas estão atrasadas: reagende as que você não fará hoje.",
		tipFull:       "Sua agenda está cheia: limite o foco de hoje a um pequeno passo.",
		tipShort:      "Menos de uma hora livre hoje: comece pela tarefa mais rápida.",
		tipEvening:    "O dia está acabando: escolha agora a primeira tarefa de amanhã.",
		tipBlock:      "Reserve {start}–{end} para “{title}” antes que outra coisa ocupe esse horário.",
		tipInbox:      "{n} tarefas ainda estão na caixa de entrada: organize-as em cinco minutos.",
		tipOneAtATime: "Uma tarefa de cada vez: termine a primeira antes de abrir a próxima.",
	},
}

// todayCopyFor picks the wording for "fr", "fr-FR", ... (English otherwise).
func todayCopyFor(language string) todayCopy {
	language = strings.ToLower(strings.TrimSpace(language))
	if len(language) > 2 {
		language = language[:2]
	}
	if words, ok := todayCopies[language]; ok {
		return words
	}
	return todayCopies["en"]
}

// reason joins the two most telling facts of a task ("Due today · Marked
// important").
func (c todayCopy) reason(facts []todayFact) string {
	parts := make([]string, 0, 2)
	for _, fact := range facts {
		if len(parts) == 2 {
			break
		}
		if text := c.fact(fact); text != "" {
			parts = append(parts, text)
		}
	}
	if len(parts) == 0 {
		return c.fallback
	}
	return strings.Join(parts, " · ")
}

func (c todayCopy) fact(fact todayFact) string {
	n := strconv.Itoa(fact.n)
	switch fact.kind {
	case "overdue":
		if fact.n == 1 {
			return c.overdueOne
		}
		return fill(c.overdueMany, "n", n)
	case "dueToday":
		return c.dueToday
	case "dueTomorrow":
		return c.dueTomorrow
	case "dueInDays":
		return fill(c.dueInDays, "n", n)
	case "plannedAt":
		return fill(c.plannedAt, "time", fact.clock)
	case "planned":
		return c.planned
	case "carriedOver":
		return c.carriedOver
	case "inProgress":
		return c.inProgress
	case "importantUrgent":
		return c.importantUrgent
	case "important":
		return c.important
	case "urgent":
		return c.urgent
	case "priority":
		return fill(c.priority, "n", n)
	case "next":
		return c.next
	case "followUp":
		return c.followUp
	default:
		return ""
	}
}
