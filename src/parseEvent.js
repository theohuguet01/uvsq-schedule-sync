import he from 'he'

import { config } from '../config.js'

const { decode } = he

// Format attendu par l'API UVSQ : horodatage local sans fuseau, ex. 2026-09-07T09:00:00
const NAIVE_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/

// Un <br /> entouré de sauts de ligne délimite un vrai champ (lieu / cours / formation).
// Un <br /> "en ligne" (ex. plusieurs salles listées à la suite) reste dans le même champ.
const FIELD_SEPARATOR_RE = /\r?\n\r?\n<br\s*\/?>\r?\n\r?\n/gi

function cleanField(field) {
  return decode(field)
    .replace(/<br\s*\/?>/gi, ', ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripTrailingCode(field) {
  return field.replace(/\s*\[[^\]]*\]\s*$/, '').trim()
}

/**
 * La description brute empile plusieurs champs (lieu, cours, formation, groupe...)
 * séparés par des <br /> de paragraphe. Le champ "formation" est identique pour
 * tous les événements d'un même abonnement (il contient le code de la formation,
 * ex. "[MYIRS1_888]") : on l'écarte car il n'apporte aucune information par
 * événement. Le lieu est toujours le premier champ ; le résumé est la
 * concaténation des champs restants (généralement le nom du cours, parfois
 * suivi de son propre code, ex. "Fondamentaux des Réseaux [MYIRS114]").
 */
function splitFields(description, formationCode) {
  const fields = description
    .split(FIELD_SEPARATOR_RE)
    .map(cleanField)
    .filter(Boolean)

  if (fields.length === 0) {
    return { location: '', summary: '' }
  }

  const [location, ...rest] = fields
  const summary = rest
    .filter((field) => !field.includes(`[${formationCode}]`))
    .map(stripTrailingCode)
    .filter(Boolean)
    .join(' ')

  return { location, summary }
}

/**
 * Transforme un événement brut de l'API UVSQ en objet exploitable pour l'ICS.
 * Retourne null (avec un avertissement sur stderr) si l'événement est malformé,
 * afin qu'un seul événement invalide n'interrompe pas tout le calendrier.
 */
export function parseEvent(rawEvent, formationCode = config.formation) {
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

  const { location, summary } = splitFields(rawEvent?.description ?? '', formationCode)

  return {
    id: String(id),
    start,
    end,
    summary: summary || 'Cours',
    location,
  }
}
