import { useI18n } from "./i18n";

const en = {
  newEvent: "New event", editEvent: "Edit event", newCalendar: "Create a calendar", settings: "Calendar settings", personal: "My calendars", imported: "Imported calendars",
  title: "Title", name: "Name", description: "Description", location: "Location or video link", calendar: "Calendar", color: "Color", defaultColor: "Calendar color",
  start: "Starts", end: "Ends", allDay: "All day", repeat: "Repeat", none: "Does not repeat", daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly",
  every: "Every", days: "Days of the week", ends: "Repetition ends", never: "Never", until: "On a date", after: "After a number of occurrences", count: "Occurrences",
  locked: "Locked", lockHint: "Keep this time fixed for future AI planning. You can still edit it manually.", save: "Save", cancel: "Cancel", delete: "Delete", duplicate: "Duplicate",
  series: "Entire series", occurrence: "Only this occurrence", scope: "Apply to", deleteConfirm: "Confirm deletion", deleteHint: "This removes the selected event or series from Prior.",
  readOnly: "Imported · read only", readOnlyHint: "Colors, locks and hidden events only affect Prior. The original calendar is never changed.",
  hide: "Hide in Prior", filters: "Hide events automatically", filterHint: "Hide titles containing these words (case and accents are ignored). Example: SAE. Applies to future refreshes too.",
  addRule: "Add rule", keyword: "Title contains…", matches: "matching events", restore: "Restore individually hidden events", hidden: "hidden individually", removeCalendar: "Remove calendar", removeHint: "Remove this calendar and its local events from Prior? Imported originals remain unchanged.",
  localHint: "Saved on this device, for this Prior account.", emptyLocal: "Create a personal calendar to add events.", refresh: "Refresh", syncError: "Refresh failed. Previous events are kept.",
  storageError: "Could not save. Check available device storage and try again.", titleRequired: "Enter a title.", calendarName: "Enter a calendar name.", invalidDate: "Choose a valid date between 1900 and 2200.", invalidEnd: "The end must be after the start.", invalidRecurrence: "Check the repetition interval, days and end.",
  ai: "Draft with AI", aiHint: "Describe an event. Your configured agent prepares a draft for you to review before saving.", aiPlaceholder: "Yoga every Tuesday at 10:00 for one hour, until December…", thinking: "Preparing your draft…", aiReady: "Draft ready. Review the details, then save.", aiError: "The agent could not prepare a valid event. Check your AI settings or try again.",
  search: "Search this period", jump: "Go to date", file: "Import an .ics file", fileError: "Could not read this calendar. Check the ICS file (maximum 8 MB).", createAt: "Create an event", details: "Event details", timezone: "Times use this device’s time zone", more: "more · show day", noSources: "No calendars yet", weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};
const fr: typeof en = {
  newEvent: "Nouvel événement", editEvent: "Modifier l’événement", newCalendar: "Créer un calendrier", settings: "Réglages du calendrier", personal: "Mes calendriers", imported: "Calendriers importés",
  title: "Titre", name: "Nom", description: "Description", location: "Lieu ou lien visio", calendar: "Calendrier", color: "Couleur", defaultColor: "Couleur du calendrier",
  start: "Début", end: "Fin", allDay: "Toute la journée", repeat: "Répétition", none: "Ne se répète pas", daily: "Tous les jours", weekly: "Toutes les semaines", monthly: "Tous les mois", yearly: "Tous les ans",
  every: "Intervalle", days: "Jours de la semaine", ends: "Fin de la répétition", never: "Jamais", until: "À une date", after: "Après un nombre d’occurrences", count: "Occurrences",
  locked: "Verrouillé", lockHint: "Conserver cet horaire pour la future planification IA. La modification manuelle reste possible.", save: "Enregistrer", cancel: "Annuler", delete: "Supprimer", duplicate: "Dupliquer",
  series: "Toute la série", occurrence: "Cette occurrence uniquement", scope: "Appliquer à", deleteConfirm: "Confirmer la suppression", deleteHint: "L’événement ou la série sélectionnée sera supprimé de Prior.",
  readOnly: "Importé · lecture seule", readOnlyHint: "Couleurs, verrouillage et masquage s’appliquent uniquement dans Prior. Le calendrier d’origine reste intact.",
  hide: "Masquer dans Prior", filters: "Masquer automatiquement", filterHint: "Masquer les titres contenant ces mots, sans distinction de casse ni d’accents. Exemple : SAE. Ces règles restent actives après actualisation.",
  addRule: "Ajouter une règle", keyword: "Le titre contient…", matches: "événements correspondants", restore: "Réafficher les événements masqués individuellement", hidden: "masqués individuellement", removeCalendar: "Retirer le calendrier", removeHint: "Retirer ce calendrier et ses événements locaux de Prior ? Les originaux importés restent intacts.",
  localHint: "Enregistré sur cet appareil, pour ce compte Prior.", emptyLocal: "Créez un calendrier personnel pour ajouter des événements.", refresh: "Actualiser", syncError: "Échec de l’actualisation. Les événements précédents sont conservés.",
  storageError: "Enregistrement impossible. Vérifiez l’espace disponible sur l’appareil puis réessayez.", titleRequired: "Saisissez un titre.", calendarName: "Saisissez un nom de calendrier.", invalidDate: "Choisissez une date valide entre 1900 et 2200.", invalidEnd: "La fin doit être après le début.", invalidRecurrence: "Vérifiez l’intervalle, les jours et la fin de la répétition.",
  ai: "Préparer avec l’IA", aiHint: "Décrivez un événement. Votre agent configuré prépare un brouillon à vérifier avant enregistrement.", aiPlaceholder: "Yoga tous les mardis à 10 h pendant une heure, jusqu’en décembre…", thinking: "Préparation du brouillon…", aiReady: "Brouillon prêt. Vérifiez les détails, puis enregistrez.", aiError: "L’agent n’a pas pu préparer un événement valide. Vérifiez vos réglages IA ou réessayez.",
  search: "Rechercher dans cette période", jump: "Aller à la date", file: "Importer un fichier .ics", fileError: "Impossible de lire ce calendrier. Vérifiez le fichier ICS (8 Mo maximum).", createAt: "Créer un événement", details: "Détails de l’événement", timezone: "Horaires dans le fuseau de cet appareil", more: "autres · voir la journée", noSources: "Aucun calendrier pour le moment", weekdays: ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"],
};

export function useCalendarLabels() { return useI18n().lang === "fr" ? fr : en; }
