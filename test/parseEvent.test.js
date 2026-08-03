import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseEvent } from '../src/parseEvent.js'

test('parse un événement bien formé avec lieu et résumé', () => {
  // Format observé côté API : "<lieu>[<code interne>]<résumé>" — le contenu
  // entre crochets (code de groupe/couleur) est ignoré, comme dans le script bash d'origine.
  const result = parseEvent({
    id: '42',
    start: '2026-09-07T09:00:00',
    end: '2026-09-07T10:30:00',
    description: 'Bat. A - Salle 101[XYZ]Algorithmique<br />TD groupe 1',
  })

  assert.deepEqual(result, {
    id: '42',
    start: '2026-09-07T09:00:00',
    end: '2026-09-07T10:30:00',
    summary: 'Algorithmique TD groupe 1',
    location: 'Bat. A - Salle 101',
  })
})

test('fallback quand la description ne contient pas de crochets', () => {
  const result = parseEvent({
    id: '43',
    start: '2026-09-07T09:00:00',
    end: '2026-09-07T10:30:00',
    description: 'Réunion sans lieu ni crochets',
  })

  assert.equal(result.location, '')
  assert.equal(result.summary, 'Réunion sans lieu ni crochets')
})

test('décode les entités HTML (accents, esperluette, guillemets)', () => {
  const result = parseEvent({
    id: '44',
    start: '2026-09-07T09:00:00',
    end: '2026-09-07T10:30:00',
    description: 'Amphi[XYZ]Cours d&#233;di&#233; &amp; travaux dirig&#233;s &quot;avanc&#233;s&quot;',
  })

  assert.equal(result.summary, 'Cours dédié & travaux dirigés "avancés"')
})

test('ignore un événement sans id/start/end', () => {
  assert.equal(parseEvent({ start: '2026-09-07T09:00:00', end: '2026-09-07T10:00:00' }), null)
  assert.equal(parseEvent({ id: '1', end: '2026-09-07T10:00:00' }), null)
  assert.equal(parseEvent({ id: '1', start: '2026-09-07T09:00:00' }), null)
})

test('ignore un événement avec un format de date inattendu', () => {
  assert.equal(
    parseEvent({
      id: '45',
      start: '2026-09-07T09:00:00Z',
      end: '2026-09-07T10:00:00',
      description: '[Amphi]Cours',
    }),
    null,
  )
})

test('résumé vide (rien après la fermeture du crochet) retombe sur une valeur par défaut', () => {
  const result = parseEvent({
    id: '46',
    start: '2026-09-07T09:00:00',
    end: '2026-09-07T10:00:00',
    description: 'Amphi[XYZ]',
  })

  assert.equal(result.summary, 'Cours')
  assert.equal(result.location, 'Amphi')
})
