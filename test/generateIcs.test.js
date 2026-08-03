import assert from 'node:assert/strict'
import { test } from 'node:test'

import { generateIcs } from '../src/generateIcs.js'

function testCfg(overrides = {}) {
  return {
    calendarName: 'EDT Test',
    prodId: '//theohuguet//uvsq-schedule-sync//FR',
    timezone: 'Europe/Paris',
    ...overrides,
  }
}

test('calendrier vide : enveloppe VCALENDAR valide sans VEVENT', () => {
  const ics = generateIcs([], testCfg())

  assert.match(ics, /BEGIN:VCALENDAR/)
  assert.match(ics, /END:VCALENDAR/)
  assert.match(ics, /PRODID:-\/\/theohuguet\/\/uvsq-schedule-sync\/\/FR/)
  assert.doesNotMatch(ics, /BEGIN:VEVENT/)
})

test('un événement produit un seul VEVENT avec les bons champs', () => {
  const ics = generateIcs(
    [
      {
        id: 'abc-123',
        start: '2026-09-07T09:30:00',
        end: '2026-09-07T10:30:00',
        summary: 'Fondamentaux des Réseaux',
        location: 'AMPHI GENTIANE',
      },
    ],
    testCfg(),
  )

  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1)
  assert.match(ics, /UID:abc-123/)
  assert.match(ics, /DTSTART;TZID=Europe\/Paris:20260907T093000/)
  assert.match(ics, /DTEND;TZID=Europe\/Paris:20260907T103000/)
  assert.match(ics, /SUMMARY:Fondamentaux des Réseaux/)
  assert.match(ics, /LOCATION:AMPHI GENTIANE/)
})

test('plusieurs événements produisent autant de VEVENT', () => {
  const events = [
    { id: '1', start: '2026-09-07T09:30:00', end: '2026-09-07T10:30:00', summary: 'A', location: 'X' },
    { id: '2', start: '2026-09-08T09:30:00', end: '2026-09-08T10:30:00', summary: 'B', location: 'Y' },
    { id: '3', start: '2026-09-09T09:30:00', end: '2026-09-09T10:30:00', summary: 'C', location: 'Z' },
  ]

  const ics = generateIcs(events, testCfg())

  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 3)
  assert.equal((ics.match(/END:VEVENT/g) || []).length, 3)
})

test('échappe les caractères spéciaux iCal dans le résumé et le lieu (RFC 5545)', () => {
  const ics = generateIcs(
    [
      {
        id: '1',
        start: '2026-09-07T09:30:00',
        end: '2026-09-07T10:30:00',
        summary: 'Cours, TD; Groupe \\A',
        location: 'Salle A, B',
      },
    ],
    testCfg(),
  )

  assert.match(ics, /SUMMARY:Cours\\, TD\\; Groupe \\\\A/)
  assert.match(ics, /LOCATION:Salle A\\, B/)
})
