import he from 'he'

const { decode } = he

// Format attendu par l'API UVSQ : horodatage local sans fuseau, ex. 2026-09-07T09:00:00
const NAIVE_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/

function cleanDescription(description) {
  return decode(description ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Le format brut est "[Lieu]Résumé". On tolère l'absence de crochets
// (au lieu de produire un lieu/résumé tronqué silencieusement).
function splitLocationSummary(description) {
  const openIndex = description.indexOf('[')
  const closeIndex = description.indexOf(']')

  if (openIndex === -1 || closeIndex === -1 || closeIndex < openIndex) {
    return { location: '', summary: description }
  }

  return {
    location: description.slice(0, openIndex).trim(),
    summary: description.slice(closeIndex + 1).trim(),
  }
}

/**
 * Transforme un événement brut de l'API UVSQ en objet exploitable pour l'ICS.
 * Retourne null (avec un avertissement sur stderr) si l'événement est malformé,
 * afin qu'un seul événement invalide n'interrompe pas tout le calendrier.
 */
export function parseEvent(rawEvent) {
  const id = rawEvent?.id
  const start = rawEvent?.start
  const end = rawEvent?.end

  if (!id || !start || !end) {
    console.error(`[parseEvent] événement ignoré (id/start/end manquant) : ${JSON.stringify(rawEvent)}`)
    return null
  }

  if (!NAIVE_DATETIME_RE.test(start) || !NAIVE_DATETIME_RE.test(end)) {
    console.error(`[parseEvent] événement ${id} ignoré (format de date inattendu : start=${start}, end=${end})`)
    return null
  }

  const description = cleanDescription(rawEvent?.description)
  const { location, summary } = splitLocationSummary(description)

  return {
    id: String(id),
    start,
    end,
    summary: summary || 'Cours',
    location,
  }
}
