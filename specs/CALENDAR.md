# Calendrier personnel et imports en lecture seule

## Références et choix produit

Recherche du 20 septembre 2026, à partir de l'aide officielle Google Agenda :

- [Créer un événement](https://support.google.com/calendar/answer/72143?hl=fr) : création depuis un créneau, titre, horaires, calendrier de destination, lieu et description. Prior propose ces champs, les journées entières et les événements sur plusieurs jours.
- [Créer un agenda](https://support.google.com/calendar/answer/37095?hl=fr) : plusieurs calendriers, noms, couleurs et visibilité. Prior distingue les calendriers personnels des calendriers importés.
- [Événements périodiques](https://support.google.com/calendar/answer/37115?hl=fr) : fréquence, date de fin et choix des événements affectés par une modification. Prior propose jour/semaine/mois/an, intervalle, jours de semaine, date de fin ou nombre d'occurrences, modification/suppression d'une occurrence ou de toute la série.
- [Liste des calendriers Google](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list) : lecture des différents calendriers avec le scope `calendar.readonly` déjà utilisé. Aucun appel d'écriture à Google n'est ajouté.

Autres fonctions retenues : vues jour/semaine/mois/liste, accès à une date, recherche dans la période, duplication, couleurs individuelles, import de fichier ICS et abonnement URL. La grille couvre 24 heures et s'ouvre près de 7 h.

Fonctions utiles à prévoir ensuite : rappels avec permissions et notifications natives, export ICS, déplacement/redimensionnement à la souris, modification « cette occurrence et les suivantes », fuseau configurable par événement, recherche globale. Invitations, partage, disponibilité des invités et visioconférence automatique nécessitent un service collaboratif et ne font pas partie de cette version locale.

## Sauvegarde et séparation des données

Les calendriers utilisent le stockage local existant `prior.calendar.v1`, isolé par compte Prior, dans le navigateur et le WebView natif. Ils persistent sur cet appareil ; cette collection n'est pas synchronisée via PostgreSQL. Une erreur de quota est affichée et ne ferme pas le formulaire. Ne pas présenter cette sauvegarde locale comme une sauvegarde cloud.

`local` désigne un calendrier personnel modifiable. Les événements importés sont des copies en lecture seule. Couleurs, verrouillage, masquage individuel et règles de titre sont des préférences Prior conservées séparément, même lorsque les événements sont remplacés par une actualisation.

Les règles utilisent une recherche littérale dans le titre, insensible à la casse et aux accents. Une règle `sae` masque donc `SAE` et `SAÉ`. L'éditeur affiche un aperçu des correspondances en cache. Supprimer une règle réaffiche les événements ; les masquages individuels ont leur propre bouton de restauration. Retirer un calendrier Google de Prior ne le supprime pas chez Google ; une nouvelle connexion permet de le retrouver.

Le verrouillage d'un calendrier s'applique à tous ses événements. Un événement peut aussi être verrouillé individuellement. Cela prépare la future planification automatique et n'interdit pas les modifications manuelles.

## Temps et récurrences

Les événements personnels utilisent des dates/heures civiles du fuseau de l'appareil. Ils gardent leur horaire local lors du changement d'heure. Les jours inexistants sont sautés pour les répétitions mensuelles/annuelles (31 du mois, 29 février). Les fins de journée entière sont inclusives dans le modèle Prior.

Les imports ICS utilisent `ical.js` pour RRULE, RDATE, EXDATE et les exceptions RECURRENCE-ID. DTEND exclusif est converti en date inclusive pour les journées entières ; TZID utilise VTIMEZONE lorsqu'il est présent et la base IANA du runtime sinon. Les flux bruts sont conservés pour recalculer les occurrences lors de la navigation, y compris hors de la première fenêtre d'import. Les limites d'expansion empêchent les flux pathologiques de bloquer indéfiniment l'application ; les données en cache sont conservées en cas d'erreur.

Les imports Google chargent une fenêtre autour de la date sélectionnée, puis une autre lorsque la navigation sort de la période en cache. Les modifications locales et les réponses asynchrones sont isolées par compte.

## Aide IA

Le bouton « Préparer avec l'IA » réutilise le fournisseur, le modèle et l'effort de raisonnement configurés pour l'agent (Codex ou OpenRouter, proxy serveur lorsqu'il est disponible). Il envoie la demande et le contexte de date/fuseau, pas les calendriers importés. Un état de préparation et une annulation sont proposés. La réponse est validée puis remplit le formulaire ; seul « Enregistrer » persiste l'événement. Aucun réordonnancement automatique des tâches n'est introduit.

## Vérifications

Tests de logique et de composants en jsdom : répétitions, exceptions, minuit, journées multiples, changement d'heure, fuseaux ICS, préférences d'import, sauvegarde isolée par compte, formulaires, validation et brouillons IA. Pas de test par computer use ni de connexion réelle aux comptes du développeur.
