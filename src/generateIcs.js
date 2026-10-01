import { createHash } from 'node:crypto'
import ical from 'ical-generator'

// En mode multi-étudiants, les identifiants de l'API (UID Celcat) et des
// événements manuels sont les mêmes dans le calendrier de chaque étudiant
// d'une formation. Or un UID doit être globalement unique (RFC 5545) : un
// client qui voit deux fois le même UID dans un compte (ex. deux calendriers
// abonnés dans le même Google Agenda) peut n'afficher l'événement qu'une fois.
// cfg.uidSalt (le token de l'étudiant, voir buildStudentConfig) rend l'UID
// propre à chaque calendrier, stable d'une sync à l'autre, sans exposer le
// token (seul un hash est publié).
export function buildUid(id, uidSalt) {
  if (!uidSalt) {
    return id
  }
  const hash = createHash('sha256').update(`${uidSalt}:${id}`).digest('hex').slice(0, 32)
  return `${hash}@uvsq-schedule-sync`
}

// Construit le calendrier iCal à partir des événements déjà nettoyés (parseEvent).
// start/end restent des chaînes "naïves" (sans fuseau) : ical-generator les
// interprète comme heure locale et les étiquette avec le TZID de cfg.timezone,
// quel que soit le fuseau horaire du serveur qui exécute le script.
export function generateIcs(events, cfg) {
  const calendar = ical({
    name: cfg.calendarName,
    prodId: cfg.prodId,
    timezone: cfg.timezone,
  })

  const updatedAt = new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: cfg.timezone,
  }).format(new Date())

  for (const event of events) {
    const description = event.description
      ? `${event.description}\n\nMis à jour le ${updatedAt}`
      : `Mis à jour le ${updatedAt}`

    calendar.createEvent({
      id: buildUid(event.id, cfg.uidSalt),
      start: event.start,
      end: event.end,
      timezone: cfg.timezone,
      summary: event.summary,
      location: event.location,
      description,
    })
  }

  return calendar.toString()
}
