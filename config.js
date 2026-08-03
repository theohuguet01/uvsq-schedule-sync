export const config = {
  url: 'https://edt.uvsq.fr/Home/GetCalendarData',
  formation: 'MYIRS1_888',
  start: '2026-09-07',
  end: '2027-08-31',
  resType: 103,
  calView: 'agendaWeek',
  colourScheme: 3,
  timezone: 'Europe/Paris',
  // ical-generator préfixe déjà cette valeur d'un "-" à la génération du fichier.
  prodId: '//EDT M1 IRS Alternance UVSQ Saclay - edit by Théo HUGUET//EN',
  calendarName: 'EDT M1 IRS Alternance UVSQ',
  fetch: {
    timeoutMs: 15000,
    retries: 3,
    retryDelayMs: 2000,
  },
}

export function buildRequestBody(cfg = config) {
  const params = new URLSearchParams()
  params.set('start', cfg.start)
  params.set('end', cfg.end)
  params.set('resType', String(cfg.resType))
  params.set('calView', cfg.calView)
  params.append('federationIds[]', cfg.formation)
  params.set('colourScheme', String(cfg.colourScheme))
  return params.toString()
}
