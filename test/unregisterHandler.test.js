import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'

import { handleUnregister } from '../src/unregisterHandler.js'
import { registerStudent } from '../src/registry.js'
import { createRateLimiter } from '../src/rateLimiter.js'

async function makeDirs(t) {
  const dir = await mkdtemp(join(tmpdir(), 'uvsq-schedule-sync-unregister-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return {
    registryPath: join(dir, 'students.json'),
    outDir: join(dir, 'out'),
  }
}

function alwaysAllow() {
  return { check: () => true }
}

test('suppression réussie : registre et fichiers retirés', async (t) => {
  const { registryPath, outDir } = await makeDirs(t)
  const student = await registerStudent(registryPath, { name: 'alice', formation: 'MYIRS1_888' })

  // Simule les fichiers publiés par une sync précédente.
  const studentDir = join(outDir, student.token)
  await mkdir(studentDir, { recursive: true })
  await writeFile(join(studentDir, 'edt.ics'), 'BEGIN:VCALENDAR\nEND:VCALENDAR\n')
  await writeFile(join(studentDir, 'edt.ics.status.json'), '{}')

  const result = await handleUnregister(
    { ip: '1.2.3.4', body: { token: student.token } },
    { registryPath, outDir, rateLimiter: alwaysAllow() },
  )

  assert.equal(result.status, 200)
  assert.equal(result.body.name, 'alice')

  const registry = JSON.parse(await readFile(registryPath, 'utf8'))
  assert.equal(registry.length, 0)

  await assert.rejects(() => readFile(join(studentDir, 'edt.ics')))
})

test('token inconnu : 404, rien à supprimer', async (t) => {
  const { registryPath, outDir } = await makeDirs(t)
  await registerStudent(registryPath, { name: 'alice', formation: 'MYIRS1_888' })

  const result = await handleUnregister(
    { ip: '1.2.3.4', body: { token: 'f'.repeat(32) } },
    { registryPath, outDir, rateLimiter: alwaysAllow() },
  )

  assert.equal(result.status, 404)
  const registry = JSON.parse(await readFile(registryPath, 'utf8'))
  assert.equal(registry.length, 1)
})

test('token au format invalide : 400', async (t) => {
  const { registryPath, outDir } = await makeDirs(t)

  const result = await handleUnregister(
    { ip: '1.2.3.4', body: { token: '../../etc/passwd' } },
    { registryPath, outDir, rateLimiter: alwaysAllow() },
  )

  assert.equal(result.status, 400)
})

test('token absent du corps : 400', async (t) => {
  const { registryPath, outDir } = await makeDirs(t)

  const result = await handleUnregister(
    { ip: '1.2.3.4', body: {} },
    { registryPath, outDir, rateLimiter: alwaysAllow() },
  )

  assert.equal(result.status, 400)
})

test('rate limit dépassé : 429, registre inchangé', async (t) => {
  const { registryPath, outDir } = await makeDirs(t)
  const student = await registerStudent(registryPath, { name: 'alice', formation: 'MYIRS1_888' })
  const rateLimiter = createRateLimiter({ windowMs: 60000, max: 0 })

  const result = await handleUnregister(
    { ip: '1.2.3.4', body: { token: student.token } },
    { registryPath, outDir, rateLimiter },
  )

  assert.equal(result.status, 429)
  const registry = JSON.parse(await readFile(registryPath, 'utf8'))
  assert.equal(registry.length, 1)
})

test('suppression sans fichiers publiés (jamais synchronisé) : pas d\'erreur', async (t) => {
  const { registryPath, outDir } = await makeDirs(t)
  const student = await registerStudent(registryPath, { name: 'alice', formation: 'MYIRS1_888' })

  const result = await handleUnregister(
    { ip: '1.2.3.4', body: { token: student.token } },
    { registryPath, outDir, rateLimiter: alwaysAllow() },
  )

  assert.equal(result.status, 200)
})
