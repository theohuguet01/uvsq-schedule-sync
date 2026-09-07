import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loadManualEvents } from '../src/manualEvents.js'

test('formation avec un fichier de correctifs : renvoie les événements manuels', async () => {
  const events = await loadManualEvents('MYIRS1_888')

  assert.ok(Array.isArray(events))
  assert.equal(events.length, 80)

  for (const event of events) {
    assert.match(event.id, /^manual-aforp-\d{4}-\d{2}-\d{2}-(am|pm)$/)
    assert.match(event.start, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
    assert.match(event.end, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
    assert.equal(event.summary, 'AFORP')
    assert.equal(event.location, 'CFA-AFORP (Cachan), 26-28 Rue Léon Bloy, 92340 Cachan, France')
  }
})

test('formation sans fichier de correctifs : tableau vide', async () => {
  const events = await loadManualEvents('CODE_INCONNU')

  assert.deepEqual(events, [])
})
