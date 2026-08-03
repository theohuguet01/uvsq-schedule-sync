import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fetchSchedule } from '../src/fetchSchedule.js'

// Config minimale utilisée par tous les tests : peu de retries et un délai
// quasi nul pour ne pas ralentir la suite.
function testConfig(overrides = {}) {
  return {
    url: 'https://example.invalid/GetCalendarData',
    formation: 'TEST_888',
    start: '2026-09-07',
    end: '2027-08-31',
    resType: 103,
    calView: 'agendaWeek',
    colourScheme: 3,
    fetch: { timeoutMs: 1000, retries: 3, retryDelayMs: 1, ...overrides },
  }
}

function fakeResponse({ ok = true, status = 200, statusText = 'OK', body = '[]' } = {}) {
  return { ok, status, statusText, text: async () => body }
}

// Remplace globalThis.fetch pour la durée du test et le restaure ensuite,
// pour ne pas laisser fuiter le mock vers les autres tests du fichier.
function mockFetch(t, impl) {
  const original = globalThis.fetch
  globalThis.fetch = impl
  t.after(() => {
    globalThis.fetch = original
  })
}

test('retourne le tableau JSON dès le premier succès', async (t) => {
  let callCount = 0
  mockFetch(t, async () => {
    callCount++
    return fakeResponse({ body: '[{"id":"1"}]' })
  })

  const data = await fetchSchedule(testConfig())

  assert.deepEqual(data, [{ id: '1' }])
  assert.equal(callCount, 1)
})

test('réessaie après un échec réseau puis réussit', async (t) => {
  let callCount = 0
  mockFetch(t, async () => {
    callCount++
    if (callCount === 1) {
      throw new Error('network down')
    }
    return fakeResponse({ body: '[{"id":"2"}]' })
  })

  const data = await fetchSchedule(testConfig())

  assert.deepEqual(data, [{ id: '2' }])
  assert.equal(callCount, 2)
})

test('épuise les tentatives sur une erreur HTTP persistante', async (t) => {
  let callCount = 0
  mockFetch(t, async () => {
    callCount++
    return fakeResponse({ ok: false, status: 500, statusText: 'Internal Server Error' })
  })

  await assert.rejects(() => fetchSchedule(testConfig({ retries: 2 })), /Échec de récupération/)
  assert.equal(callCount, 2)
})

test('épuise les tentatives sur une réponse vide', async (t) => {
  mockFetch(t, async () => fakeResponse({ body: '' }))

  await assert.rejects(() => fetchSchedule(testConfig({ retries: 2 })), /Échec de récupération/)
})

test('épuise les tentatives sur un JSON invalide', async (t) => {
  mockFetch(t, async () => fakeResponse({ body: 'ceci n\'est pas du JSON' }))

  await assert.rejects(() => fetchSchedule(testConfig({ retries: 2 })), /Échec de récupération/)
})

test('épuise les tentatives quand la réponse JSON n\'est pas un tableau', async (t) => {
  mockFetch(t, async () => fakeResponse({ body: '{"unexpected":"object"}' }))

  await assert.rejects(() => fetchSchedule(testConfig({ retries: 2 })), /Échec de récupération/)
})
