const DEFAULTS = {
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
  fetchTimeoutMs: 15000,
  fetchRetries: 3,
  fetchRetryDelayMs: 2000,
}

function envOr(env, key, fallback) {
  const value = env[key]
  return value !== undefined && value !== '' ? value : fallback
}

// Construit la configuration à partir des variables d'environnement (préfixe
// UVSQ_*), avec repli sur les valeurs par défaut ci-dessus. Permet de changer
// de formation/période sans modifier ce fichier (utile pour un déploiement
// cron ou pour quelqu'un d'autre réutilisant ce projet).
export function loadConfig(env = process.env) {
  return {
    url: envOr(env, 'UVSQ_URL', DEFAULTS.url),
    formation: envOr(env, 'UVSQ_FORMATION', DEFAULTS.formation),
    start: envOr(env, 'UVSQ_START', DEFAULTS.start),
    end: envOr(env, 'UVSQ_END', DEFAULTS.end),
    resType: DEFAULTS.resType,
    calView: DEFAULTS.calView,
    colourScheme: DEFAULTS.colourScheme,
    timezone: envOr(env, 'UVSQ_TIMEZONE', DEFAULTS.timezone),
    prodId: envOr(env, 'UVSQ_PROD_ID', DEFAULTS.prodId),
    calendarName: envOr(env, 'UVSQ_CALENDAR_NAME', DEFAULTS.calendarName),
    fetch: {
      timeoutMs: Number(envOr(env, 'UVSQ_FETCH_TIMEOUT_MS', DEFAULTS.fetchTimeoutMs)),
      retries: Number(envOr(env, 'UVSQ_FETCH_RETRIES', DEFAULTS.fetchRetries)),
      retryDelayMs: Number(envOr(env, 'UVSQ_FETCH_RETRY_DELAY_MS', DEFAULTS.fetchRetryDelayMs)),
    },
  }
}

export const config = loadConfig()

// Fusionne la config globale avec les surcharges d'un étudiant du registre
// (voir src/students.js) : seuls formation/calendarName/prodId sont
// personnalisables par étudiant, le reste (période, fuseau, retries...) est
// partagé par tout le monde.
export function buildStudentConfig(baseCfg, student) {
  return {
    ...baseCfg,
    formation: student.formation,
    calendarName: student.calendarName ?? baseCfg.calendarName,
    prodId: student.prodId ?? baseCfg.prodId,
  }
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
