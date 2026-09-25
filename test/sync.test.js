import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { syncOne } from '../src/sync.js'

function testConfig(overrides = {}) {
  return {
    url: 'https://example.invalid/GetCalendarData',
    formation: 'MYIRS1_888',
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

async function makeOutPath(t) {
  const dir = await mkdtemp(join(tmpdir(), 'uvsq-schedule-sync-sync-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return join(dir, 'edt.ics')
}

const RAW_EVENT = {
  id: 'evt-1',
  start: '2026-09-07T09:30:00',
  end: '2026-09-07T10:30:00',
  description: '\r\n\r\n<br />\r\n\r\nAmphi\r\n\r\n<br />\r\n\r\nCours test\r\n\r\n<br />\r\n\r\n',
}

test('MYIRS1_888 : horaires/salles de l\'API, prof de l\'Excel, AFORP et soutenances ajoutés', async (t) => {
  mockFetch(t, async () => ({ ok: true, text: async () => JSON.stringify([RAW_EVENT]) }))
  const outPath = await makeOutPath(t)

  const { eventCount } = await syncOne(testConfig(), outPath, null)

  // 1 événement de l'API + 80 AFORP + 8 soutenances (src/manualEvents/MYIRS1_888.json) ;
  // les 60 cours de l'Excel ne servent qu'à enrichir les créneaux de l'API.
  assert.equal(eventCount, 89)

  const ics = await readFile(outPath, 'utf8')
  assert.match(ics, /SUMMARY:Cours test/)
  assert.match(ics, /DTSTART;TZID=Europe\/Paris:20260907T093000/)
  assert.match(ics, /DTEND;TZID=Europe\/Paris:20260907T103000/)
  assert.match(ics, /LOCATION:Amphi/)
  // Chevauche le cours Excel du 07/09 matin (N. AIT-SAADI)
  assert.match(ics, /DESCRIPTION:N\. AIT-SAADI/)
  assert.match(ics, /SUMMARY:AFORP/)
  assert.match(ics, /SUMMARY:Soutenances M1/)
  assert.doesNotMatch(ics, /SUMMARY:Principes des transmissions radio/)
})

test('MYIRS1_888 : API UVSQ en échec, la sync échoue sans toucher au calendrier existant', async (t) => {
  mockFetch(t, async () => {
    throw new Error('panne réseau simulée')
  })
  const outPath = await makeOutPath(t)

  await assert.rejects(syncOne(testConfig(), outPath, null), /panne réseau simulée/)
  await assert.rejects(readFile(outPath, 'utf8'), { code: 'ENOENT' })
})

test('formation sans correctifs : seuls les événements de l\'API sont présents', async (t) => {
  mockFetch(t, async () => ({ ok: true, text: async () => JSON.stringify([RAW_EVENT]) }))
  const outPath = await makeOutPath(t)

  const { eventCount } = await syncOne(testConfig({ formation: 'CODE_INCONNU' }), outPath, null)

  assert.equal(eventCount, 1)
})
