import { readFile } from 'node:fs/promises'

// Le token sert de nom de dossier dans l'URL publiée (voir README) : format
// hexadécimal strict pour empêcher toute tentative de path traversal via le
// registre (ex. "../../etc/passwd" comme token).
const TOKEN_PATTERN = /^[a-f0-9]{16,64}$/
const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

function validateStudent(student, index) {
  const label = student && typeof student.name === 'string' ? `"${student.name}"` : `#${index}`

  if (!student || typeof student !== 'object') {
    throw new Error(`Étudiant ${label} : entrée invalide (objet attendu)`)
  }
  if (typeof student.name !== 'string' || !NAME_PATTERN.test(student.name)) {
    throw new Error(`Étudiant ${label} : "name" doit être un identifiant en minuscules (lettres, chiffres, tirets)`)
  }
  if (typeof student.token !== 'string' || !TOKEN_PATTERN.test(student.token)) {
    throw new Error(`Étudiant ${label} : "token" doit être une chaîne hexadécimale de 16 à 64 caractères (ex. openssl rand -hex 16)`)
  }
  if (typeof student.formation !== 'string' || student.formation.trim() === '') {
    throw new Error(`Étudiant ${label} : "formation" est obligatoire`)
  }
  if (student.calendarName !== undefined && typeof student.calendarName !== 'string') {
    throw new Error(`Étudiant ${label} : "calendarName" doit être une chaîne`)
  }
  if (student.prodId !== undefined && typeof student.prodId !== 'string') {
    throw new Error(`Étudiant ${label} : "prodId" doit être une chaîne`)
  }
}

// Charge et valide le registre des étudiants (JSON, hors dépôt git puisqu'il
// contient les tokens secrets - voir deploy/students.json.example).
export async function loadStudents(path) {
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    throw new Error(`Impossible de lire le registre des étudiants (${path}) : ${error.message}`)
  }

  let data
  try {
    data = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Registre des étudiants invalide (${path}) : JSON malformé (${error.message})`)
  }

  if (!Array.isArray(data)) {
    throw new Error(`Registre des étudiants invalide (${path}) : un tableau est attendu`)
  }

  data.forEach(validateStudent)

  const tokens = new Set()
  const names = new Set()
  for (const student of data) {
    if (tokens.has(student.token)) {
      throw new Error(`Registre des étudiants invalide : token dupliqué (étudiant "${student.name}")`)
    }
    tokens.add(student.token)

    if (names.has(student.name)) {
      throw new Error(`Registre des étudiants invalide : "name" dupliqué ("${student.name}")`)
    }
    names.add(student.name)
  }

  return data
}
