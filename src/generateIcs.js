import ical from 'ical-generator'

// Construit le calendrier iCal à partir des événements déjà nettoyés (parseEvent).
// start/end restent des chaînes "naïves" (sans fuseau) : ical-generator les
// interprète comme heure locale et les étiquette avec le TZID de cfg.timezone,
// ce qui reproduit exactement le comportement de l'ancien script bash.
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
    calendar.createEvent({
      id: event.id,
      start: event.start,
      end: event.end,
      timezone: cfg.timezone,
      summary: event.summary,
      location: event.location,
      description: `Mis à jour le ${updatedAt}`,
    })
  }

  return calendar.toString()
}
