import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AFORP_LOCATION, fetchAforpIcs, parseAforpIcs, toNaiveParis } from '../src/fetchAforpIcs.js'

// Extrait du vrai flux Net-YPareo G2 (récupéré le 01/10/2026), formateurs
// anonymisés : fins de ligne CRLF, VTIMEZONE, jours UVSQ marqués par l'AFORP.
const FEED = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//NetYpareo//NONSGML kigkonsult.se iCalcreator 2.41.90//',
  'X-WR-TIMEZONE:Europe/Paris',
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Paris',
  'BEGIN:STANDARD',
  'DTSTART:19701025T030000',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:6378162663702904@NetYpareo',
  'DESCRIPTION:P42 MASTER IRS-M1 P2028 P40 G1P42 MASTER IRS-M1 P2028 P40 G2',
  'DTSTART;TZID=Europe/Paris:20260929T083000',
  'DTEND;TZID=Europe/Paris:20260929T120000',
  'LOCATION:42 UVSQ 1',
  'SUMMARY:UVSQ - M. 33 UVSQ 1',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:6378162663702950@NetYpareo',
  'DESCRIPTION:P42 MASTER IRS-M1 P2028 P40 G2',
  'DTSTART;TZID=Europe/Paris:20260930T083000',
  'DTEND;TZID=Europe/Paris:20260930T120000',
  'LOCATION:42BE010\\, 42BE011',
  'SUMMARY:Droit informatique et Certifications - M',
  ' . DUPONT',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:6378162663702960@NetYpareo',
  'DTSTART;TZID=Europe/Paris:20261015T130000',
  'DTEND;TZID=Europe/Paris:20261015T163000',
  'LOCATION:',
  'SUMMARY:Savoir être et Méthodologie',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n')

test('cours AFORP : intitulé préfixé, formateur et salle en description, adresse de Cachan', () => {
  const { events } = parseAforpIcs(FEED)

  assert.deepEqual(events[0], {
    id: 'aforp-6378162663702950-NetYpareo',
    start: '2026-09-30T08:30:00',
    end: '2026-09-30T12:00:00',
    summary: 'AFORP - Droit informatique et Certifications',
    location: AFORP_LOCATION,
    description: 'M. DUPONT\nSalle : 42BE010, 42BE011\nVoir emploi du temps sur https://legacy.aforp.fr/Net-YPareo/',
  })
})

test('cours sans formateur ni salle : seul le lien vers Net-YPareo en description', () => {
  const { events } = parseAforpIcs(FEED)

  assert.equal(events[1].summary, 'AFORP - Savoir être et Méthodologie')
  assert.equal(events[1].start, '2026-10-15T13:00:00')
  assert.equal(events[1].description, 'Voir emploi du temps sur https://legacy.aforp.fr/Net-YPareo/')
})

test('les jours UVSQ marqués par l\'AFORP ne sont pas publiés mais comptent comme jours couverts', () => {
  const { events, days } = parseAforpIcs(FEED)

  assert.equal(events.length, 2)
  assert.ok(events.every((event) => !event.summary.includes('UVSQ')))
  assert.deepEqual([...days].sort(), ['2026-09-29', '2026-09-30', '2026-10-15'])
})

test('une réponse qui n\'est pas un calendrier iCal est rejetée', () => {
  assert.throws(() => parseAforpIcs('<html>Erreur</html>'), /BEGIN:VCALENDAR/)
})

test('toNaiveParis : heure locale gardée telle quelle, UTC converti (heure d\'été et d\'hiver), journée entière ignorée', () => {
  assert.equal(toNaiveParis('20260930T083000'), '2026-09-30T08:30:00')
  assert.equal(toNaiveParis('20260930T063000Z'), '2026-09-30T08:30:00')
  assert.equal(toNaiveParis('20261130T073000Z'), '2026-11-30T08:30:00')
  assert.equal(toNaiveParis('20260930'), null)
})

function mockFetch(t, impl) {
  const original = globalThis.fetch
  globalThis.fetch = impl
  t.after(() => {
    globalThis.fetch = original
  })
}

const FETCH_CFG = { timeoutMs: 1000, retries: 2, retryDelayMs: 1 }

test('fetchAforpIcs réessaie après un échec puis renvoie le flux parsé', async (t) => {
  let calls = 0
  mockFetch(t, async () => {
    calls++
    if (calls === 1) {
      return { ok: false, status: 503, statusText: 'Service Unavailable' }
    }
    return { ok: true, text: async () => FEED }
  })

  const { events } = await fetchAforpIcs('https://example.invalid/ical/SECRET-GUID/', FETCH_CFG)

  assert.equal(calls, 2)
  assert.equal(events.length, 2)
})

test('fetchAforpIcs : l\'erreur finale ne contient jamais l\'URL (secrète)', async (t) => {
  mockFetch(t, async () => ({ ok: false, status: 404, statusText: 'Not Found' }))

  await assert.rejects(
    fetchAforpIcs('https://example.invalid/ical/SECRET-GUID/', FETCH_CFG),
    (error) => /HTTP 404/.test(error.message) && !error.message.includes('SECRET-GUID'),
  )
})
