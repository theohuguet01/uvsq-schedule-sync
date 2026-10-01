// Flux iCal Net-YPareo du CFA-AFORP (un par groupe d'alternants, ex. G1/G2
// de MYIRS1_888). L'URL contient un identifiant qui donne accès au planning
// sans authentification : elle vit dans l'environnement du serveur
// (UVSQ_AFORP_ICS_URL_<groupe>, voir config.js), jamais dans le dépôt ni
// dans les logs.

export const AFORP_LOCATION = 'AFORP - CACHAN\n26-28 Rue Léon Bloy\n92340 Cachan\nFrance'
export const AFORP_PLANNING_LINK = 'Voir emploi du temps sur https://legacy.aforp.fr/Net-YPareo/'

// Net-YPareo marque aussi les jours passés à l'UVSQ ("UVSQ - M. 33 UVSQ 1",
// communs à tous les groupes) : ils doublonneraient les vrais cours de l'API
// UVSQ et ne sont donc jamais publiés.
const UVSQ_SUMMARY_PATTERN = /^UVSQ\b/i
// "Droit informatique et Certifications - M. OUATTARA" : le formateur est
// séparé de l'intitulé, comme le prof des cours UVSQ (champ description).
const TEACHER_SUFFIX_PATTERN = /^(.*\S)\s+-\s+((?:M\.|Mme|MME|Mlle)\s.+)$/

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function unfoldLines(text) {
  return text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
}

function unescapeText(value) {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\([,;\\])/g, '$1')
    .trim()
}

// Convertit une date iCal (20260930T083000, avec TZID=Europe/Paris, ou en UTC
// avec un "Z" final) en chaîne "naïve" à l'heure de Paris, le format attendu
// par generateIcs (voir parseEvent). Renvoie null pour une date sans heure
// (événement "journée entière"), jamais observée dans ce flux.
export function toNaiveParis(value, timezone = 'Europe/Paris') {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value)
  if (!match) {
    return null
  }
  const [, year, month, day, hour, minute, second, utc] = match
  if (!utc) {
    return `${year}-${month}-${day}T${hour}:${minute}:${second}`
  }

  const date = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second))
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date).map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
}

function readEvents(text) {
  const events = []
  let current = null
  for (const line of unfoldLines(text)) {
    if (line === 'BEGIN:VEVENT') {
      current = {}
    } else if (line === 'END:VEVENT') {
      if (current) {
        events.push(current)
      }
      current = null
    } else if (current) {
      const match = /^([A-Z-]+)(?:;[^:]*)?:(.*)$/.exec(line)
      if (match) {
        current[match[1]] = match[2]
      }
    }
  }
  return events
}

// Transforme le flux brut en événements au format de parseEvent. Renvoie :
// - events : les cours AFORP à publier ;
// - days : tous les jours présents dans le flux (UVSQ compris), qui font foi
//   pour remplacer les créneaux AFORP saisis à la main (voir mergeSchedule.js).
export function parseAforpIcs(text) {
  if (typeof text !== 'string' || !text.includes('BEGIN:VCALENDAR')) {
    throw new Error('Réponse iCal invalide (BEGIN:VCALENDAR absent)')
  }

  const events = []
  const days = new Set()

  for (const raw of readEvents(text)) {
    const start = raw.DTSTART && toNaiveParis(raw.DTSTART)
    const end = raw.DTEND && toNaiveParis(raw.DTEND)
    if (!start || !end || !raw.UID) {
      continue
    }
    days.add(start.slice(0, 10))

    const rawSummary = unescapeText(raw.SUMMARY ?? '')
    if (UVSQ_SUMMARY_PATTERN.test(rawSummary)) {
      continue
    }

    const teacherMatch = TEACHER_SUFFIX_PATTERN.exec(rawSummary)
    const course = teacherMatch ? teacherMatch[1] : rawSummary
    const teacher = teacherMatch ? teacherMatch[2] : null
    const room = unescapeText(raw.LOCATION ?? '')

    const description = [
      teacher,
      room ? `Salle : ${room}` : null,
      AFORP_PLANNING_LINK,
    ].filter(Boolean).join('\n')

    events.push({
      id: `aforp-${raw.UID.replace(/[^A-Za-z0-9-]/g, '-')}`,
      start,
      end,
      summary: course ? `AFORP - ${course}` : 'AFORP',
      location: AFORP_LOCATION,
      description,
    })
  }

  return { events, days }
}

async function fetchOnce(url, timeoutMs) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, { signal: controller.signal })

    if (!response.ok) {
      throw new Error(`Réponse HTTP ${response.status} ${response.statusText}`)
    }

    return await response.text()
  } finally {
    clearTimeout(timeout)
  }
}

// Récupère et parse le flux AFORP d'un groupe, avec retries comme
// fetchSchedule. Les messages d'erreur ne contiennent jamais l'URL.
export async function fetchAforpIcs(url, fetchCfg) {
  let lastError

  for (let attempt = 1; attempt <= fetchCfg.retries; attempt++) {
    try {
      return parseAforpIcs(await fetchOnce(url, fetchCfg.timeoutMs))
    } catch (error) {
      lastError = error
      console.error(`[fetchAforpIcs] tentative ${attempt}/${fetchCfg.retries} échouée : ${error.message}`)
      if (attempt < fetchCfg.retries) {
        await sleep(fetchCfg.retryDelayMs)
      }
    }
  }

  throw new Error(`Échec de récupération du flux AFORP après ${fetchCfg.retries} tentatives : ${lastError.message}`)
}
