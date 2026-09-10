import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { handleRegister } from '../src/registerHandler.js'
import { createRateLimiter } from '../src/rateLimiter.js'

function testConfig(overrides = {}) {
  return {
    url: 'https://example.invalid/GetCalendarData',
    formation: 'IGNORED',
    start: '2026-09-07',
    end: '2027-08-31',
    resType: 103,
    calView: 'agendaWeek',
    colourScheme: 3,
    timezone: 'Europe/Paris',
    prodId: '//theohuguet//uvsq-schedule-sync-test//FR',
    calendarName: 'Test',
    fetch: { timeoutMs: 1000, retries: 1, retryDelayMs: 1 },
    ...overrides,
  }
}

function mockFetch(t, impl) {
  const original = globalThis.fetch
  globalThis.fetch = impl
  t.after(() => {
    globalThis.fetch = original
  })
}

function alwaysAllow() {
  return { check: () => true }
}

async function makeDirs(t) {
  const dir = await mkdtemp(join(tmpdir(), 'uvsq-schedule-sync-register-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return {
    registryPath: join(dir, 'students.json'),
    outDir: join(dir, 'out'),
  }
}

const RAW_EVENT = {
  id: 'evt-1',
  start: '2026-09-07T09:30:00',
  end: '2026-09-07T10:30:00',
  description: '\r\n\r\n<br />\r\n\r\nAmphi\r\n\r\n<br />\r\n\r\nCours test\r\n\r\n<br />\r\n\r\n',
}

test('inscription réussie : registre + calendrier écrits, URL retournée', async (t) => {
  // Formation sans fichier de correctifs (voir src/manualEvents/) : le test
  // vise le flux générique d'inscription, pas la fusion des événements
  // manuels (couverte par test/sync.test.js), donc eventCount doit rester 1.
  mockFetch(t, async () => ({ ok: true, text: async () => JSON.stringify([RAW_EVENT]) }))
  const { registryPath, outDir } = await makeDirs(t)

  const result = await handleRegister(
    { ip: '1.2.3.4', body: { name: 'Alice Dupont', formation: 'MYAUTRE_777' } },
    { registryPath, outDir, baseCfg: testConfig(), publicBaseUrl: 'https://edt.example.fr', rateLimiter: alwaysAllow() },
  )

  assert.equal(result.status, 201)
  assert.equal(result.body.name, 'alice-dupont')
  assert.equal(result.body.synced, true)
  assert.equal(result.body.eventCount, 1)
  assert.match(result.body.url, /^https:\/\/edt\.example\.fr\/[a-f0-9]{32}\/edt\.ics$/)
  assert.match(result.body.webcalUrl, /^webcal:\/\//)

  const registry = JSON.parse(await readFile(registryPath, 'utf8'))
  assert.equal(registry.length, 1)
  assert.equal(registry[0].formation, 'MYAUTRE_777')

  const ics = await readFile(join(outDir, registry[0].token, 'edt.ics'), 'utf8')
  assert.match(ics, /BEGIN:VEVENT/)
})

test('le nom est normalisé (accents, majuscules, espaces) avant validation', async (t) => {
  mockFetch(t, async () => ({ ok: true, text: async () => JSON.stringify([RAW_EVENT]) }))
  const { registryPath, outDir } = await makeDirs(t)

  const result = await handleRegister(
    { ip: '1.2.3.4', body: { name: 'Théo Huguët', formation: 'MYIRS1_888' } },
    { registryPath, outDir, baseCfg: testConfig(), publicBaseUrl: 'https://edt.example.fr', rateLimiter: alwaysAllow() },
  )

  assert.equal(result.status, 201)
  assert.equal(result.body.name, 'theo-huguet')
})

test('honeypot rempli : rejeté sans toucher au registre', async (t) => {
  const { registryPath, outDir } = await makeDirs(t)

  const result = await handleRegister(
    { ip: '1.2.3.4', body: { name: 'alice', formation: 'MYIRS1_888', website: 'http://spam.example' } },
    { registryPath, outDir, baseCfg: testConfig(), publicBaseUrl: 'https://edt.example.fr', rateLimiter: alwaysAllow() },
  )

  assert.equal(result.status, 400)
  await assert.rejects(() => readFile(registryPath, 'utf8'))
})

test('rate limit dépassé : 429, registre non modifié', async (t) => {
  const { registryPath, outDir } = await makeDirs(t)
  const rateLimiter = createRateLimiter({ windowMs: 60000, max: 0 })

  const result = await handleRegister(
    { ip: '1.2.3.4', body: { name: 'alice', formation: 'MYIRS1_888' } },
    { registryPath, outDir, baseCfg: testConfig(), publicBaseUrl: 'https://edt.example.fr', rateLimiter },
  )

  assert.equal(result.status, 429)
  await assert.rejects(() => readFile(registryPath, 'utf8'))
})

test('nom invalide (uniquement des symboles) : 400', async (t) => {
  const { registryPath, outDir } = await makeDirs(t)

  const result = await handleRegister(
    { ip: '1.2.3.4', body: { name: '!!!', formation: 'MYIRS1_888' } },
    { registryPath, outDir, baseCfg: testConfig(), publicBaseUrl: 'https://edt.example.fr', rateLimiter: alwaysAllow() },
  )

  assert.equal(result.status, 400)
})

test('code de formation invalide : 400', async (t) => {
  const { registryPath, outDir } = await makeDirs(t)

  const result = await handleRegister(
    { ip: '1.2.3.4', body: { name: 'alice', formation: '../../etc/passwd' } },
    { registryPath, outDir, baseCfg: testConfig(), publicBaseUrl: 'https://edt.example.fr', rateLimiter: alwaysAllow() },
  )

  assert.equal(result.status, 400)
})

test('nom déjà pris : 409, registre inchangé', async (t) => {
  mockFetch(t, async () => ({ ok: true, text: async () => JSON.stringify([RAW_EVENT]) }))
  const { registryPath, outDir } = await makeDirs(t)
  const deps = { registryPath, outDir, baseCfg: testConfig(), publicBaseUrl: 'https://edt.example.fr', rateLimiter: alwaysAllow() }

  await handleRegister({ ip: '1.2.3.4', body: { name: 'alice', formation: 'MYIRS1_888' } }, deps)
  const result = await handleRegister({ ip: '5.6.7.8', body: { name: 'alice', formation: 'MYAUTRE_777' } }, deps)

  assert.equal(result.status, 409)
  const registry = JSON.parse(await readFile(registryPath, 'utf8'))
  assert.equal(registry.length, 1)
})

test('la sync immédiate échoue : inscription tout de même valide, synced=false', async (t) => {
  // MYIRS1_888 est piloté uniquement par l'Excel (voir src/sync.js) et n'appelle
  // jamais l'API : ce test simule une panne réseau, donc une autre formation.
  mockFetch(t, async () => {
    throw new Error('panne réseau simulée')
  })
  const { registryPath, outDir } = await makeDirs(t)

  const result = await handleRegister(
    { ip: '1.2.3.4', body: { name: 'alice', formation: 'MYAUTRE_777' } },
    { registryPath, outDir, baseCfg: testConfig(), publicBaseUrl: 'https://edt.example.fr', rateLimiter: alwaysAllow() },
  )

  assert.equal(result.status, 201)
  assert.equal(result.body.synced, false)

  const registry = JSON.parse(await readFile(registryPath, 'utf8'))
  assert.equal(registry.length, 1)
})

test('code de formation inconnu de l\'API (0 événement) : synced=true, eventCount=0', async (t) => {
  // L'API UVSQ ne renvoie pas d'erreur pour un code inexistant, juste un
  // tableau vide - reproduit ici pour vérifier que l'appelant peut le détecter.
  mockFetch(t, async () => ({ ok: true, text: async () => JSON.stringify([]) }))
  const { registryPath, outDir } = await makeDirs(t)

  const result = await handleRegister(
    { ip: '1.2.3.4', body: { name: 'alice', formation: 'CODE_INCONNU' } },
    { registryPath, outDir, baseCfg: testConfig(), publicBaseUrl: 'https://edt.example.fr', rateLimiter: alwaysAllow() },
  )

  assert.equal(result.status, 201)
  assert.equal(result.body.synced, true)
  assert.equal(result.body.eventCount, 0)
})
