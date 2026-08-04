import { join } from 'node:path'

import { isValidFormation, isValidName } from './students.js'
import { registerStudent, NameTakenError } from './registry.js'
import { buildStudentConfig } from '../config.js'
import { syncOne } from './sync.js'

function normalizeName(rawName) {
  return String(rawName ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // enlève les accents (é -> e, ...)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function toWebcalUrl(httpsUrl) {
  return httpsUrl.replace(/^https:\/\//, 'webcal://')
}

// Traite une soumission du formulaire d'inscription (public/inscription.html) :
// rate limiting par IP, honeypot anti-bot, validation, ajout au registre,
// sync immédiate du calendrier. Logique pure (pas de req/res HTTP) pour
// rester testable directement ; src/server.js n'est qu'une fine couche HTTP
// au-dessus qui appelle cette fonction.
export async function handleRegister({ ip, body }, { registryPath, outDir, baseCfg, publicBaseUrl, rateLimiter }) {
  if (!rateLimiter.check(ip)) {
    return { status: 429, body: { error: 'Trop de tentatives. Veuillez réessayer dans quelques minutes.' } }
  }

  // Champ caché, invisible pour un humain (voir public/inscription.html) :
  // un bot naïf qui remplit tous les champs du formulaire le remplit aussi.
  // On ne dit pas pourquoi la requête échoue, pour ne pas aider à l'affiner.
  if (body?.website) {
    console.error(`[register] honeypot rempli, requête ignorée (ip=${ip})`)
    return { status: 400, body: { error: 'Requête invalide.' } }
  }

  const name = normalizeName(body?.name)
  if (!isValidName(name)) {
    return { status: 400, body: { error: 'Nom invalide : utilisez des lettres, chiffres et tirets.' } }
  }

  const formation = String(body?.formation ?? '').trim()
  if (!isValidFormation(formation)) {
    return { status: 400, body: { error: 'Code de formation invalide : lettres, chiffres et underscore uniquement.' } }
  }

  let student
  try {
    student = await registerStudent(registryPath, { name, formation })
  } catch (error) {
    if (error instanceof NameTakenError) {
      return { status: 409, body: { error: 'Ce nom est déjà pris, veuillez en choisir un autre.' } }
    }
    throw error
  }

  const studentCfg = buildStudentConfig(baseCfg, student)
  const outPath = join(outDir, student.token, 'edt.ics')
  const statusPath = `${outPath}.status.json`

  let synced = true
  let eventCount = null
  try {
    ;({ eventCount } = await syncOne(studentCfg, outPath, statusPath))
  } catch (error) {
    // L'inscription reste valide même si la sync immédiate échoue (code de
    // formation inconnu de l'API, panne réseau UVSQ...) : le timer périodique
    // réessaiera au prochain passage. On se contente de le signaler dans la
    // réponse plutôt que de faire échouer toute l'inscription.
    console.error(`[register] sync immédiate échouée pour "${name}" : ${error.message}`)
    synced = false
  }

  const httpsUrl = `${publicBaseUrl.replace(/\/$/, '')}/${student.token}/edt.ics`

  return {
    status: 201,
    body: {
      name: student.name,
      synced,
      // Un code de formation inconnu de l'API UVSQ ne provoque pas d'erreur
      // HTTP côté API (elle répond juste avec 0 événement) : sans ce champ,
      // l'étudiant n'aurait aucun moyen de savoir que son calendrier est vide.
      eventCount,
      url: httpsUrl,
      webcalUrl: toWebcalUrl(httpsUrl),
    },
  }
}
