import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const MANUAL_EVENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'manualEvents')

// Complète les événements de l'API UVSQ avec des événements saisis à la main,
// pour un code de formation donné (ex. src/manualEvents/MYIRS1_888.json).
// Utile quand une donnée réelle n'est pas exposée par edt.uvsq.fr (ex. les
// journées AFORP de MYIRS1_888, absentes de l'API mais présentes sur le
// planning Excel officiel de la formation) : sans repli silencieux vers un
// tableau vide, un code de formation sans fichier associé ferait échouer
// toute la sync.
export async function loadManualEvents(formation) {
  const path = join(MANUAL_EVENTS_DIR, `${formation}.json`)

  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []
    }
    throw error
  }

  return JSON.parse(raw)
}
