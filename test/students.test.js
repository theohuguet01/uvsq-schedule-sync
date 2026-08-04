import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadStudents } from '../src/students.js'

async function withRegistry(t, content) {
  const dir = await mkdtemp(join(tmpdir(), 'uvsq-schedule-sync-students-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'students.json')
  await writeFile(path, content, 'utf8')
  return path
}

const VALID_STUDENT = {
  name: 'theo-huguet',
  token: 'a'.repeat(32),
  formation: 'MYIRS1_888',
}

test('charge un registre valide avec une entrée minimale', async (t) => {
  const path = await withRegistry(t, JSON.stringify([VALID_STUDENT]))

  const students = await loadStudents(path)

  assert.equal(students.length, 1)
  assert.equal(students[0].name, 'theo-huguet')
  assert.equal(students[0].formation, 'MYIRS1_888')
})

test('accepte les surcharges optionnelles calendarName/prodId', async (t) => {
  const path = await withRegistry(t, JSON.stringify([
    { ...VALID_STUDENT, calendarName: 'Mon EDT', prodId: '//test//FR' },
  ]))

  const students = await loadStudents(path)

  assert.equal(students[0].calendarName, 'Mon EDT')
  assert.equal(students[0].prodId, '//test//FR')
})

test('rejette un fichier introuvable', async () => {
  await assert.rejects(() => loadStudents('/chemin/inexistant/students.json'), /Impossible de lire/)
})

test('rejette un JSON malformé', async (t) => {
  const path = await withRegistry(t, '{ not valid json')

  await assert.rejects(() => loadStudents(path), /JSON malformé/)
})

test('rejette une valeur qui n\'est pas un tableau', async (t) => {
  const path = await withRegistry(t, JSON.stringify({ not: 'an array' }))

  await assert.rejects(() => loadStudents(path), /un tableau est attendu/)
})

test('rejette un token qui n\'est pas au format hexadécimal', async (t) => {
  const path = await withRegistry(t, JSON.stringify([{ ...VALID_STUDENT, token: '../../etc/passwd' }]))

  await assert.rejects(() => loadStudents(path), /"token" doit être une chaîne hexadécimale/)
})

test('rejette un token trop court', async (t) => {
  const path = await withRegistry(t, JSON.stringify([{ ...VALID_STUDENT, token: 'abcd' }]))

  await assert.rejects(() => loadStudents(path), /"token" doit être une chaîne hexadécimale/)
})

test('rejette un name invalide (majuscules, espaces...)', async (t) => {
  const path = await withRegistry(t, JSON.stringify([{ ...VALID_STUDENT, name: 'Theo Huguet' }]))

  await assert.rejects(() => loadStudents(path), /"name" doit être un identifiant/)
})

test('rejette une formation manquante', async (t) => {
  const { formation, ...withoutFormation } = VALID_STUDENT
  const path = await withRegistry(t, JSON.stringify([withoutFormation]))

  await assert.rejects(() => loadStudents(path), /"formation" est obligatoire/)
})

test('rejette des tokens dupliqués', async (t) => {
  const path = await withRegistry(t, JSON.stringify([
    VALID_STUDENT,
    { ...VALID_STUDENT, name: 'autre-etudiant' },
  ]))

  await assert.rejects(() => loadStudents(path), /token dupliqué/)
})

test('rejette des noms dupliqués', async (t) => {
  const path = await withRegistry(t, JSON.stringify([
    VALID_STUDENT,
    { ...VALID_STUDENT, token: 'b'.repeat(32) },
  ]))

  await assert.rejects(() => loadStudents(path), /"name" dupliqué/)
})
