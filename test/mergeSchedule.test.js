import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mergeWithExcel, nameSimilarity, normalizeCourseName } from '../src/mergeSchedule.js'

const api = (id, start, end, summary, location = 'AMPHI GENTIANE') => ({ id, start, end, summary, location })
const course = (id, start, end, summary, description) => ({ id: `manual-cours-${id}`, start, end, summary, location: 'AMPHI GENTIANE', description })

test('créneau qui chevauche un cours Excel : horaires/salle de l\'API, prof de l\'Excel', () => {
  const { events, stats } = mergeWithExcel(
    [api('a1', '2026-09-09T13:15:00', '2026-09-09T17:15:00', 'Fondamentaux des Réseaux', 'Serpolet')],
    [course('2026-09-09-pm', '2026-09-09T13:45:00', '2026-09-09T16:45:00', 'Fondamentaux des Réseaux - CM', 'M. GUEROUI')],
  )

  assert.deepEqual(events, [{
    id: 'a1',
    start: '2026-09-09T13:15:00',
    end: '2026-09-09T17:15:00',
    summary: 'Fondamentaux des Réseaux',
    location: 'Serpolet',
    description: 'M. GUEROUI',
  }])
  assert.deepEqual(stats, { byOverlap: 1, byName: 0, unmatched: 0 })
})

test('les cours Excel ne sont jamais publiés tels quels (cours absent de l\'API = déplacé)', () => {
  const { events } = mergeWithExcel(
    [api('a1', '2027-01-11T13:45:00', '2027-01-11T16:45:00', 'Principes des transsmissions radio.')],
    [course('2027-01-04-pm', '2027-01-04T13:45:00', '2027-01-04T16:45:00', 'Principes des transmissions radio (1/5)', 'N. AIT-SAADI')],
  )

  assert.equal(events.length, 1)
  assert.equal(events[0].id, 'a1')
  assert.equal(events[0].start, '2027-01-11T13:45:00')
  // Rattaché par le nom malgré la coquille de l'API
  assert.equal(events[0].description, 'N. AIT-SAADI')
})

test('rattachement par nom : nom Excel plus court contenu dans celui de l\'API', () => {
  const { events, stats } = mergeWithExcel(
    [api('a1', '2027-01-11T09:30:00', '2027-01-11T13:00:00', 'Modélisation des réseaux')],
    [course('2027-01-04-am', '2027-01-04T09:30:00', '2027-01-04T13:00:00', 'Modélisation', 'D. SOHIER')],
  )

  assert.equal(events[0].description, 'D. SOHIER')
  assert.deepEqual(stats, { byOverlap: 0, byName: 1, unmatched: 0 })
})

test('rattachement par nom ambigu (plusieurs profs) : pas de prof', () => {
  const { events, stats } = mergeWithExcel(
    [api('a1', '2026-10-01T09:30:00', '2026-10-01T12:30:00', 'Maths & Langages')],
    [
      course('2026-09-16-am', '2026-09-16T09:30:00', '2026-09-16T12:30:00', 'Maths & Langages', 'S. GOUGEAUD'),
      course('2026-09-16-pm', '2026-09-16T13:15:00', '2026-09-16T16:15:00', 'Maths & Langages', 'S. GOUGEAUD + Vacataire'),
    ],
  )

  assert.equal(events[0].description, undefined)
  assert.deepEqual(stats, { byOverlap: 0, byName: 0, unmatched: 1 })
})

test('intitulé générique "Cours" de l\'API remplacé par celui de l\'Excel', () => {
  const { events } = mergeWithExcel(
    [api('a1', '2026-09-21T09:30:00', '2026-09-21T13:00:00', 'Cours', 'Cartables Numériques 1')],
    [course('2026-09-21-am', '2026-09-21T09:30:00', '2026-09-21T13:00:00', 'Introduction à la sécurité.', 'P. SAS')],
  )

  assert.equal(events[0].summary, 'Introduction à la sécurité.')
  assert.equal(events[0].location, 'Cartables Numériques 1')
  assert.equal(events[0].description, 'P. SAS')
})

test('plusieurs cours chevauchants : celui au plus grand recouvrement est retenu', () => {
  const { events } = mergeWithExcel(
    [api('a1', '2026-09-07T09:00:00', '2026-09-07T12:00:00', 'X')],
    [
      course('a', '2026-09-07T08:00:00', '2026-09-07T09:30:00', 'Y', 'PROF A'),
      course('b', '2026-09-07T09:30:00', '2026-09-07T12:30:00', 'Z', 'PROF B'),
    ],
  )

  assert.equal(events[0].description, 'PROF B')
})

test('événements manuels hors cours (AFORP, soutenances) ajoutés tels quels', () => {
  const aforp = { id: 'manual-aforp-2026-10-05-am', start: '2026-10-05T08:30:00', end: '2026-10-05T12:00:00', summary: 'AFORP', location: 'Cachan' }
  const { events } = mergeWithExcel([], [aforp])

  assert.deepEqual(events, [aforp])
})

test('normalisation et similarité des noms de cours', () => {
  assert.equal(normalizeCourseName('Principes des transmissions radio (3/5)'), 'principes des transmissions radio')
  assert.equal(normalizeCourseName('Fondamentaux des Réseaux - CM'), 'fondamentaux des reseaux')
  assert.ok(nameSimilarity('Introduction à la Sécurité', 'Introduction à la sécurité.') === 1)
  assert.ok(nameSimilarity('Principes des transsmissions radio.', 'Principes des transmissions radio') >= 0.75)
  assert.ok(nameSimilarity('Modélisation des réseaux', 'Fondamentaux des Réseaux') < 0.75)
})
