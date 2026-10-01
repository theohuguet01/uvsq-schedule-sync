// Fusion API UVSQ (Celcat) + planning Excel (src/manualEvents/<formation>.json)
// pour les formations dont l'Excel sert à enrichir les créneaux de l'API.
//
// Répartition des rôles :
// - horaires et salles : toujours ceux de l'API (edt.uvsq.fr) ;
// - nom du prof (champ description) : repris de l'Excel ;
// - intitulé : celui de l'API, sauf s'il est générique ("Cours"), auquel cas
//   celui de l'Excel est utilisé.
//
// Les cours de l'Excel (id "manual-cours-...") ne servent qu'à l'enrichissement
// et ne sont jamais publiés tels quels : un cours absent de l'API est considéré
// comme déplacé ou annulé. Les autres événements manuels (AFORP, soutenances),
// que l'API n'expose pas, sont ajoutés tels quels.

const COURSE_ID_PREFIX = 'manual-cours-'
const GENERIC_SUMMARY = 'Cours'
// Seuil de similarité (Dice sur bigrammes) pour rattacher un créneau de l'API
// à un cours de l'Excel par son nom quand aucun créneau ne se chevauche.
const NAME_SIMILARITY_THRESHOLD = 0.75

function toMinutes(naive) {
  return Date.parse(`${naive}Z`) / 60000
}

function overlapMinutes(a, b) {
  const start = Math.max(toMinutes(a.start), toMinutes(b.start))
  const end = Math.min(toMinutes(a.end), toMinutes(b.end))
  return Math.max(0, end - start)
}

export function normalizeCourseName(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(\d+\/\d+\)/g, ' ')
    .replace(/\s-\s(cm|td|tp)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function bigrams(text) {
  const compact = text.replace(/\s+/g, '')
  const result = []
  for (let i = 0; i < compact.length - 1; i++) {
    result.push(compact.slice(i, i + 2))
  }
  return result
}

// 1 si l'un des noms normalisés est contenu (mots entiers) dans l'autre, ex.
// "Modélisation" (Excel) et "Modélisation des réseaux" (API) ; sinon Dice sur
// bigrammes, tolérant aux coquilles ("transsmissions").
export function nameSimilarity(a, b) {
  const normalizedA = normalizeCourseName(a)
  const normalizedB = normalizeCourseName(b)
  if (normalizedA && normalizedB && (` ${normalizedA} `.includes(` ${normalizedB} `) || ` ${normalizedB} `.includes(` ${normalizedA} `))) {
    return 1
  }
  const left = bigrams(normalizedA)
  const right = bigrams(normalizedB)
  if (left.length === 0 || right.length === 0) {
    return 0
  }
  const pool = [...right]
  let common = 0
  for (const bigram of left) {
    const index = pool.indexOf(bigram)
    if (index !== -1) {
      common++
      pool.splice(index, 1)
    }
  }
  return (2 * common) / (left.length + right.length)
}

function bestOverlap(apiEvent, courses) {
  let best = null
  let bestMinutes = 0
  for (const course of courses) {
    const minutes = overlapMinutes(apiEvent, course)
    if (minutes > bestMinutes) {
      best = course
      bestMinutes = minutes
    }
  }
  return best
}

// Repli pour un créneau de l'API sans cours de l'Excel au même moment (cours
// déplacé) : le prof est repris d'un cours de même nom, uniquement si ce nom
// correspond à un seul prof dans l'Excel.
function bestByName(apiEvent, courses) {
  if (apiEvent.summary === GENERIC_SUMMARY) {
    return null
  }
  const candidates = courses.filter(
    (course) => course.description && nameSimilarity(apiEvent.summary, course.summary) >= NAME_SIMILARITY_THRESHOLD,
  )
  const teachers = new Set(candidates.map((course) => course.description))
  return teachers.size === 1 ? candidates[0] : null
}

export function mergeWithExcel(apiEvents, manualEvents) {
  const courses = manualEvents.filter((event) => event.id.startsWith(COURSE_ID_PREFIX))
  const extras = manualEvents.filter((event) => !event.id.startsWith(COURSE_ID_PREFIX))

  const stats = { byOverlap: 0, byName: 0, unmatched: 0 }

  const enriched = apiEvents.map((apiEvent) => {
    let course = bestOverlap(apiEvent, courses)
    if (course) {
      stats.byOverlap++
    } else {
      course = bestByName(apiEvent, courses)
      if (course) {
        stats.byName++
      } else {
        stats.unmatched++
        return apiEvent
      }
    }

    const merged = {
      ...apiEvent,
      summary: apiEvent.summary === GENERIC_SUMMARY ? course.summary : apiEvent.summary,
    }
    if (course.description) {
      merged.description = course.description
    }
    return merged
  })

  return { events: [...enriched, ...extras], stats }
}

const AFORP_MANUAL_ID_PREFIX = 'manual-aforp-'

// Remplace les créneaux AFORP saisis à la main (id "manual-aforp-...") par les
// vrais cours du flux Net-YPareo du groupe (voir src/fetchAforpIcs.js), jour
// par jour : un jour présent dans le flux fait foi (même s'il n'y figure que
// comme jour UVSQ), un jour absent du flux (planning AFORP pas encore publié)
// garde ses créneaux manuels.
export function applyAforpFeed(manualEvents, feed) {
  const kept = manualEvents.filter(
    (event) => !(event.id.startsWith(AFORP_MANUAL_ID_PREFIX) && feed.days.has(event.start.slice(0, 10))),
  )
  return {
    events: [...kept, ...feed.events],
    stats: { replaced: manualEvents.length - kept.length, added: feed.events.length },
  }
}
