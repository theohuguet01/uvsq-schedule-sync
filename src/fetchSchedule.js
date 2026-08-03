import { buildRequestBody } from '../config.js'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchOnce(cfg) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), cfg.fetch.timeoutMs)

  try {
    const response = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: buildRequestBody(cfg),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`Réponse HTTP ${response.status} ${response.statusText}`)
    }

    return await response.text()
  } finally {
    clearTimeout(timeout)
  }
}

// Récupère l'emploi du temps brut, avec retries en cas d'échec réseau/HTTP.
export async function fetchSchedule(cfg) {
  let lastError

  for (let attempt = 1; attempt <= cfg.fetch.retries; attempt++) {
    try {
      const text = await fetchOnce(cfg)

      if (!text || !text.trim()) {
        throw new Error('Réponse vide de l\'API')
      }

      let data
      try {
        data = JSON.parse(text)
      } catch {
        throw new Error(`Réponse JSON invalide : ${text.slice(0, 200)}`)
      }

      if (!Array.isArray(data)) {
        throw new Error('La réponse JSON attendue est un tableau d\'événements')
      }

      return data
    } catch (error) {
      lastError = error
      console.error(`[fetchSchedule] tentative ${attempt}/${cfg.fetch.retries} échouée : ${error.message}`)
      if (attempt < cfg.fetch.retries) {
        await sleep(cfg.fetch.retryDelayMs)
      }
    }
  }

  throw new Error(`Échec de récupération de l'emploi du temps après ${cfg.fetch.retries} tentatives : ${lastError.message}`)
}
