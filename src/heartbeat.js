import { readFile } from 'node:fs/promises'

import { writeAtomic } from './writeAtomic.js'

async function readPreviousStatus(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

// Écrit un fichier de statut à côté du calendrier, pour permettre une
// surveillance externe (le calendrier lui-même ne dit pas si la dernière
// exécution a réussi ni depuis quand il n'a pas été rafraîchi).
export async function writeSuccessStatus(path, { formation, eventCount }) {
  const now = new Date().toISOString()
  const status = {
    ok: true,
    formation,
    eventCount,
    lastAttemptAt: now,
    lastSuccessAt: now,
  }
  await writeAtomic(path, JSON.stringify(status, null, 2))
}

// En cas d'échec, on conserve lastSuccessAt de la précédente exécution
// réussie (si connue) pour que la surveillance externe puisse mesurer
// depuis combien de temps le calendrier n'a plus été rafraîchi avec succès.
export async function writeFailureStatus(path, { formation, error }) {
  const previous = await readPreviousStatus(path)
  const status = {
    ok: false,
    formation,
    error: error.message,
    lastAttemptAt: new Date().toISOString(),
    lastSuccessAt: previous?.lastSuccessAt ?? null,
  }
  await writeAtomic(path, JSON.stringify(status, null, 2))
}
