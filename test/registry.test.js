import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { registerStudent, unregisterStudent, NameTakenError } from '../src/registry.js'
import { TOKEN_PATTERN } from '../src/students.js'

async function makeRegistryPath(t) {
  const dir = await mkdtemp(join(tmpdir(), 'uvsq-schedule-sync-registry-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return join(dir, 'students.json')
}

test('crée le registre s\'il n\'existe pas encore et y ajoute le premier étudiant', async (t) => {
  const path = await makeRegistryPath(t)

  const student = await registerStudent(path, { name: 'alice', formation: 'MYIRS1_888' })

  assert.equal(student.name, 'alice')
  assert.equal(student.formation, 'MYIRS1_888')
  assert.match(student.token, TOKEN_PATTERN)

  const stored = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(stored.length, 1)
  assert.equal(stored[0].name, 'alice')
})

test('ajoute un second étudiant sans écraser le premier', async (t) => {
  const path = await makeRegistryPath(t)

  await registerStudent(path, { name: 'alice', formation: 'MYIRS1_888' })
  await registerStudent(path, { name: 'bob', formation: 'MYAUTRE_777' })

  const stored = JSON.parse(await readFile(path, 'utf8'))
  assert.deepEqual(stored.map((s) => s.name).sort(), ['alice', 'bob'])
})

test('deux tokens générés sont différents', async (t) => {
  const path = await makeRegistryPath(t)

  const alice = await registerStudent(path, { name: 'alice', formation: 'MYIRS1_888' })
  const bob = await registerStudent(path, { name: 'bob', formation: 'MYAUTRE_777' })

  assert.notEqual(alice.token, bob.token)
})

test('rejette un nom déjà pris', async (t) => {
  const path = await makeRegistryPath(t)

  await registerStudent(path, { name: 'alice', formation: 'MYIRS1_888' })

  await assert.rejects(
    () => registerStudent(path, { name: 'alice', formation: 'MYAUTRE_777' }),
    NameTakenError,
  )

  const stored = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(stored.length, 1)
})

test('rejette un nom au format invalide', async (t) => {
  const path = await makeRegistryPath(t)

  await assert.rejects(() => registerStudent(path, { name: 'Alice Dupont', formation: 'MYIRS1_888' }))
})

test('rejette un code de formation au format invalide', async (t) => {
  const path = await makeRegistryPath(t)

  await assert.rejects(() => registerStudent(path, { name: 'alice', formation: '../../etc/passwd' }))
})

test('une inscription invalide n\'empêche pas la suivante de réussir', async (t) => {
  const path = await makeRegistryPath(t)

  await assert.rejects(() => registerStudent(path, { name: 'Invalide', formation: 'MYIRS1_888' }))

  const student = await registerStudent(path, { name: 'alice', formation: 'MYIRS1_888' })
  assert.equal(student.name, 'alice')

  const stored = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(stored.length, 1)
})

test('deux inscriptions concurrentes sur le même registre sont toutes les deux persistées', async (t) => {
  const path = await makeRegistryPath(t)

  const [alice, bob] = await Promise.all([
    registerStudent(path, { name: 'alice', formation: 'MYIRS1_888' }),
    registerStudent(path, { name: 'bob', formation: 'MYAUTRE_777' }),
  ])

  assert.notEqual(alice.token, bob.token)
  const stored = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(stored.length, 2)
  assert.deepEqual(stored.map((s) => s.name).sort(), ['alice', 'bob'])
})

test('accepte les surcharges calendarName/prodId', async (t) => {
  const path = await makeRegistryPath(t)

  const student = await registerStudent(path, {
    name: 'alice',
    formation: 'MYIRS1_888',
    calendarName: 'EDT Alice',
    prodId: '//alice//FR',
  })

  assert.equal(student.calendarName, 'EDT Alice')
  assert.equal(student.prodId, '//alice//FR')
})

test('unregisterStudent retire l\'entrée correspondant au token et la renvoie', async (t) => {
  const path = await makeRegistryPath(t)
  const alice = await registerStudent(path, { name: 'alice', formation: 'MYIRS1_888' })
  await registerStudent(path, { name: 'bob', formation: 'MYAUTRE_777' })

  const removed = await unregisterStudent(path, alice.token)

  assert.equal(removed.name, 'alice')
  const stored = JSON.parse(await readFile(path, 'utf8'))
  assert.deepEqual(stored.map((s) => s.name), ['bob'])
})

test('unregisterStudent renvoie null pour un token inconnu, registre inchangé', async (t) => {
  const path = await makeRegistryPath(t)
  await registerStudent(path, { name: 'alice', formation: 'MYIRS1_888' })

  const removed = await unregisterStudent(path, 'f'.repeat(32))

  assert.equal(removed, null)
  const stored = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(stored.length, 1)
})

test('unregisterStudent sur un registre inexistant renvoie null sans erreur', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'uvsq-schedule-sync-registry-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'jamais-cree.json')

  const removed = await unregisterStudent(path, 'a'.repeat(32))

  assert.equal(removed, null)
})

test('inscription et suppression concurrentes sur le même registre restent cohérentes', async (t) => {
  const path = await makeRegistryPath(t)
  const alice = await registerStudent(path, { name: 'alice', formation: 'MYIRS1_888' })

  const [bob, removed] = await Promise.all([
    registerStudent(path, { name: 'bob', formation: 'MYAUTRE_777' }),
    unregisterStudent(path, alice.token),
  ])

  assert.equal(removed.name, 'alice')
  assert.equal(bob.name, 'bob')
  const stored = JSON.parse(await readFile(path, 'utf8'))
  assert.deepEqual(stored.map((s) => s.name), ['bob'])
})
