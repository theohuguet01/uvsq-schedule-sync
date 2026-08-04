import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { writeAtomic } from './writeAtomic.js'
import { validateStudent } from './students.js'

export class NameTakenError extends Error {}

// Sérialise les écritures concurrentes sur le registre (inscription comme
// suppression) : deux opérations simultanées ne doivent jamais s'écraser
// l'une l'autre (une lecture-modification-écriture non atomique sans ce
// verrou en mémoire, partagé entre registerStudent et unregisterStudent).
let writeQueue = Promise.resolve()

function withWriteLock(fn) {
  const task = writeQueue.then(fn)
  // Une opération qui échoue ne doit pas bloquer les suivantes : la file
  // doit toujours rester "résolue", jamais "rejetée".
  writeQueue = task.catch(() => {})
  return task
}

async function readRegistry(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []
    }
    throw error
  }
}

function generateToken() {
  return randomBytes(16).toString('hex')
}

// Ajoute un étudiant au registre de façon atomique : vérifie que le nom n'est
// pas déjà pris, génère un token, valide l'entrée finale, puis réécrit le
// fichier en entier (comme students.js, le registre vit hors dépôt git).
// Utilisée par le serveur d'inscription (src/registerHandler.js).
export async function registerStudent(path, { name, formation, calendarName, prodId }) {
  return withWriteLock(async () => {
    const students = await readRegistry(path)

    if (students.some((existing) => existing.name === name)) {
      throw new NameTakenError(`Le nom "${name}" est déjà pris`)
    }

    const student = {
      name,
      token: generateToken(),
      formation,
      ...(calendarName ? { calendarName } : {}),
      ...(prodId ? { prodId } : {}),
    }
    validateStudent(student, students.length)

    students.push(student)
    await writeAtomic(path, JSON.stringify(students, null, 2))

    return student
  })
}

// Retire une entrée du registre par token : le token fait office de preuve de
// possession (c'est un secret que seul l'étudiant qui l'a reçu connaît), donc
// aucune autre vérification d'identité n'est demandée. Renvoie l'entrée
// supprimée, ou null si ce token n'existe pas dans le registre. Utilisée par
// le formulaire de suppression (droit à l'effacement, voir
// public/uvsq/confidentialite.html et src/unregisterHandler.js).
export async function unregisterStudent(path, token) {
  return withWriteLock(async () => {
    const students = await readRegistry(path)
    const index = students.findIndex((existing) => existing.token === token)
    if (index === -1) {
      return null
    }

    const [removed] = students.splice(index, 1)
    await writeAtomic(path, JSON.stringify(students, null, 2))
    return removed
  })
}
