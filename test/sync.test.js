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

test('MYIRS1_888 : planning piloté uniquement par l\'Excel, l\'API UVSQ n\'est pas appelée', async (t) => {
  mockFetch(t, async () => {
    throw new Error('fetch ne doit pas être appelé pour MYIRS1_888 (formation Excel-only)')
  })
  const outPath = await makeOutPath(t)

  const { eventCount } = await syncOne(testConfig(), outPath, null)

  // 148 événements manuels (voir src/manualEvents/MYIRS1_888.json), aucun événement API
  assert.equal(eventCount, 148)

  const ics = await readFile(outPath, 'utf8')
  assert.match(ics, /SUMMARY:AFORP/)
  assert.doesNotMatch(ics, /SUMMARY:Cours test/)
})

test('formation sans correctifs : seuls les événements de l\'API sont présents', async (t) => {
  mockFetch(t, async () => ({ ok: true, text: async () => JSON.stringify([RAW_EVENT]) }))
  const outPath = await makeOutPath(t)

  const { eventCount } = await syncOne(testConfig({ formation: 'CODE_INCONNU' }), outPath, null)

  assert.equal(eventCount, 1)
})
