import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loadManualEvents } from '../src/manualEvents.js'

test('formation avec un fichier de correctifs : renvoie les événements manuels', async () => {
  const events = await loadManualEvents('MYIRS1_888')

  assert.ok(Array.isArray(events))
  assert.equal(events.length, 148)

  for (const event of events) {
    assert.match(event.id, /^manual-(aforp|cours|soutenance)-\d{4}-\d{2}-\d{2}-(am|pm)$/)
    assert.match(event.start, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
    assert.match(event.end, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
    assert.ok(event.summary.length > 0)
  }

  const aforpEvents = events.filter((event) => event.summary === 'AFORP')
  assert.equal(aforpEvents.length, 80)
  for (const event of aforpEvents) {
    assert.equal(event.location, 'AFORP - CACHAN\n26-28 Rue Léon Bloy\n92340 Cachan\nFrance')
  }

  const coursEvents = events.filter((event) => event.summary !== 'AFORP' && event.summary !== 'Soutenances M1')
  assert.equal(coursEvents.length, 60)

  const soutenanceEvents = events.filter((event) => event.summary === 'Soutenances M1')
  assert.equal(soutenanceEvents.length, 8)
})

test('formation sans fichier de correctifs : tableau vide', async () => {
  const events = await loadManualEvents('CODE_INCONNU')

  assert.deepEqual(events, [])
})
