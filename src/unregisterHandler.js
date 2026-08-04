import { rm } from 'node:fs/promises'
import { join } from 'node:path'

import { TOKEN_PATTERN } from './students.js'
import { unregisterStudent } from './registry.js'

// Traite une demande de suppression (droit à l'effacement, voir
// public/uvsq/confidentialite.html) : le token de l'étudiant sert de preuve
// de possession, aucune autre authentification n'est nécessaire puisque c'est
// un secret que lui seul détient (il apparaît dans son lien de calendrier).
// Retire l'entrée du registre ET les fichiers publiés (edt.ics, statut) -
// une suppression du seul registre laisserait le calendrier accessible.
export async function handleUnregister({ ip, body }, { registryPath, outDir, rateLimiter }) {
  if (!rateLimiter.check(ip)) {
    return { status: 429, body: { error: 'Trop de tentatives. Veuillez réessayer dans quelques minutes.' } }
  }

  const token = String(body?.token ?? '').trim()
  if (!TOKEN_PATTERN.test(token)) {
    return { status: 400, body: { error: 'Lien ou jeton invalide.' } }
  }

  const removed = await unregisterStudent(registryPath, token)
  if (!removed) {
    return { status: 404, body: { error: 'Aucune inscription trouvée pour ce lien.' } }
  }

  await rm(join(outDir, token), { recursive: true, force: true })

  return { status: 200, body: { name: removed.name } }
}
