import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { run } from '../src/index.js'

function testConfig(overrides = {}) {
  return {
    url: 'https://example.invalid/GetCalendarData',
    formation: 'TEST_888',
    start: '2026-09-07',
    end: '2027-08-31',
    resType: 103,
    calView: 'agendaWeek',
    colourScheme: 3,
    timezone: 'Europe/Paris',
    prodId: '//theohuguet//uvsq-schedule-sync-test//FR',
    calendarName: 'Test',
    fetch: { timeoutMs: 1000, retries: 2, retryDelayMs: 1 },
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

async function makeTmpDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'uvsq-schedule-sync-run-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

const RAW_EVENT = {
  id: 'evt-1',
  start: '2026-09-07T09:30:00',
  end: '2026-09-07T10:30:00',
  description: '\r\n\r\n<br />\r\n\r\nAmphi\r\n\r\n<br />\r\n\r\nCours test\r\n\r\n<br />\r\n\r\n',
}

test('exécution réussie : écrit le calendrier et un statut ok=true', async (t) => {
  mockFetch(t, async () => ({ ok: true, text: async () => JSON.stringify([RAW_EVENT]) }))
  const dir = await makeTmpDir(t)
  const outPath = join(dir, 'edt.ics')

  const result = await run(['--out', outPath], testConfig())

  assert.equal(result.eventCount, 1)

  const ics = await readFile(outPath, 'utf8')
  assert.match(ics, /BEGIN:VEVENT/)

  const status = JSON.parse(await readFile(`${outPath}.status.json`, 'utf8'))
  assert.equal(status.ok, true)
  assert.equal(status.eventCount, 1)
  assert.equal(status.formation, 'TEST_888')
  assert.ok(status.lastSuccessAt)
})

test('échec réseau : le calendrier publié n\'est pas touché, le statut passe à ok=false', async (t) => {
  const dir = await makeTmpDir(t)
  const outPath = join(dir, 'edt.ics')

  // Une exécution réussie initiale sert de "calendrier déjà publié".
  mockFetch(t, async () => ({ ok: true, text: async () => JSON.stringify([RAW_EVENT]) }))
  await run(['--out', outPath], testConfig())
  const publishedBefore = await readFile(outPath, 'utf8')
  const successStatus = JSON.parse(await readFile(`${outPath}.status.json`, 'utf8'))

  // Puis une exécution qui échoue systématiquement.
  globalThis.fetch = async () => {
    throw new Error('panne réseau simulée')
  }

  await assert.rejects(() => run(['--out', outPath], testConfig()))

  const publishedAfter = await readFile(outPath, 'utf8')
  assert.equal(publishedAfter, publishedBefore)

  const failureStatus = JSON.parse(await readFile(`${outPath}.status.json`, 'utf8'))
  assert.equal(failureStatus.ok, false)
  assert.match(failureStatus.error, /Échec de récupération/)
  // La date du dernier succès est conservée depuis l'exécution précédente.
  assert.equal(failureStatus.lastSuccessAt, successStatus.lastSuccessAt)
})

test('--status permet de choisir un chemin de statut personnalisé', async (t) => {
  mockFetch(t, async () => ({ ok: true, text: async () => JSON.stringify([RAW_EVENT]) }))
  const dir = await makeTmpDir(t)
  const outPath = join(dir, 'edt.ics')
  const statusPath = join(dir, 'custom-status.json')

  await run(['--out', outPath, '--status', statusPath], testConfig())

  const status = JSON.parse(await readFile(statusPath, 'utf8'))
  assert.equal(status.ok, true)
})

test('UVSQ_OUT_PATH sert de repli quand --out n\'est pas fourni', async (t) => {
  mockFetch(t, async () => ({ ok: true, text: async () => JSON.stringify([RAW_EVENT]) }))
  const dir = await makeTmpDir(t)
  const outPath = join(dir, 'edt-env.ics')

  await run([], testConfig(), { UVSQ_OUT_PATH: outPath })

  const ics = await readFile(outPath, 'utf8')
  assert.match(ics, /BEGIN:VEVENT/)
  const status = JSON.parse(await readFile(`${outPath}.status.json`, 'utf8'))
  assert.equal(status.ok, true)
})

test('--out passé en CLI a priorité sur UVSQ_OUT_PATH', async (t) => {
  mockFetch(t, async () => ({ ok: true, text: async () => JSON.stringify([RAW_EVENT]) }))
  const dir = await makeTmpDir(t)
  const cliPath = join(dir, 'edt-cli.ics')
  const envPath = join(dir, 'edt-env-ignored.ics')

  await run(['--out', cliPath], testConfig(), { UVSQ_OUT_PATH: envPath })

  await readFile(cliPath, 'utf8')
  await assert.rejects(() => readFile(envPath, 'utf8'))
})

test('sans --out ni --status : écrit sur la sortie standard sans tenter d\'écrire de statut', async (t) => {
  mockFetch(t, async () => ({ ok: true, text: async () => JSON.stringify([RAW_EVENT]) }))

  const originalWrite = process.stdout.write
  let written = ''
  process.stdout.write = (chunk) => {
    written += chunk
    return true
  }
  t.after(() => {
    process.stdout.write = originalWrite
  })

  const result = await run([], testConfig())

  assert.equal(result.eventCount, 1)
  assert.match(written, /BEGIN:VCALENDAR/)
})
