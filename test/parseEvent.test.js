import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseEvent } from '../src/parseEvent.js'

const FORMATION = 'MYIRS1_888'
const FIELD_SEP = '\r\n\r\n<br />\r\n\r\n'

// Reconstruit une description brute telle que renvoyée par l'API UVSQ :
// une liste de champs (lieu, cours, formation...) séparés par des <br />
// entourés de sauts de ligne. `field(...)` sert à écrire des <br /> "en ligne"
// (ex. plusieurs salles) sans les confondre avec un vrai séparateur de champ.
function rawDescription(...fields) {
  return FIELD_SEP + fields.join(FIELD_SEP) + FIELD_SEP
}

function field(...lines) {
  return lines.join('<br />')
}

test('événement réel : cours avec code de module, sans code de formation dans le résumé', () => {
  // Cas observé en production : "Fondamentaux des Réseaux [MYIRS114]" - le code
  // de module doit être retiré, et le champ formation "[MYIRS1_888]" écarté.
  const result = parseEvent(
    {
      id: '-1742255826:1073733534:17:5810476:4',
      start: '2026-09-07T13:15:00',
      end: '2026-09-07T17:15:00',
      description: rawDescription(
        'AMPHI GENTIANE',
        'Fondamentaux des R&#233;seaux [MYIRS114]',
        'M1 Saclay Ing&#233;nierie R&#233;seaux et Syst&#232;mes voie Alternance Apprentissage [MYIRS1_888]',
      ),
    },
    FORMATION,
  )

  assert.deepEqual(result, {
    id: '-1742255826:1073733534:17:5810476:4',
    start: '2026-09-07T13:15:00',
    end: '2026-09-07T17:15:00',
    summary: 'Fondamentaux des Réseaux',
    location: 'AMPHI GENTIANE',
  })
})

test('événement réel : cours sans code de module, le résumé arrive après le champ formation', () => {
  // Cas observé en production : le nom du cours ("Principes des transmissions
  // radio.") n'a pas de code et se trouve après le champ formation.
  const result = parseEvent(
    {
      id: '-1742255826:1073733534:17:5810462:4',
      start: '2026-09-07T09:30:00',
      end: '2026-09-07T12:30:00',
      description: rawDescription(
        'AMPHI GENTIANE',
        'M1 Saclay Ing&#233;nierie R&#233;seaux et Syst&#232;mes voie Alternance Apprentissage [MYIRS1_888]',
        'Principes des transmissions radio.',
      ),
    },
    FORMATION,
  )

  assert.equal(result.summary, 'Principes des transmissions radio.')
  assert.equal(result.location, 'AMPHI GENTIANE')
})

test('deux salles listées avec un <br /> "en ligne" : le lieu reste un seul champ', () => {
  // Un <br /> sans saut de ligne autour (à l'intérieur d'un champ) ne doit pas
  // être traité comme un séparateur de champ, sinon la 2e salle serait prise
  // pour le résumé du cours.
  const result = parseEvent(
    {
      id: '1',
      start: '2026-09-10T13:15:00',
      end: '2026-09-10T16:45:00',
      description: rawDescription(
        field('Cartables Num&#233;riques 1', 'Cartables Num&#233;riques 2'),
        'Introduction &#224; la S&#233;curit&#233; [MYIRS115]',
        'M1 Saclay Ing&#233;nierie R&#233;seaux et Syst&#232;mes voie Alternance Apprentissage [MYIRS1_888]',
      ),
    },
    FORMATION,
  )

  assert.equal(result.location, 'Cartables Numériques 1, Cartables Numériques 2')
  assert.equal(result.summary, 'Introduction à la Sécurité')
})

test('aucun champ exploitable après le lieu (retombe sur une valeur par défaut)', () => {
  // Cas observé en production : ni code de module ni titre de cours en dehors
  // du champ formation, qui est écarté - une lacune réelle des données UVSQ.
  const result = parseEvent(
    {
      id: '2',
      start: '2026-09-10T13:15:00',
      end: '2026-09-10T16:45:00',
      description: rawDescription(
        field('Cartables Num&#233;riques 1', 'Cartables Num&#233;riques 2'),
        'M1 Saclay Ing&#233;nierie R&#233;seaux et Syst&#232;mes voie Alternance Apprentissage [MYIRS1_888]',
      ),
    },
    FORMATION,
  )

  assert.equal(result.summary, 'Cours')
  assert.equal(result.location, 'Cartables Numériques 1, Cartables Numériques 2')
})

test('fallback quand la description ne contient aucun séparateur de champ', () => {
  const result = parseEvent(
    {
      id: '3',
      start: '2026-09-07T09:00:00',
      end: '2026-09-07T10:30:00',
      description: 'Réunion sans champ structuré',
    },
    FORMATION,
  )

  assert.equal(result.location, 'Réunion sans champ structuré')
  assert.equal(result.summary, 'Cours')
})

test('ignore un événement sans id/start/end', () => {
  assert.equal(parseEvent({ start: '2026-09-07T09:00:00', end: '2026-09-07T10:00:00' }, FORMATION), null)
  assert.equal(parseEvent({ id: '1', end: '2026-09-07T10:00:00' }, FORMATION), null)
  assert.equal(parseEvent({ id: '1', start: '2026-09-07T09:00:00' }, FORMATION), null)
})

test('ignore un événement avec un format de date inattendu', () => {
  assert.equal(
    parseEvent(
      {
        id: '4',
        start: '2026-09-07T09:00:00Z',
        end: '2026-09-07T10:00:00',
        description: rawDescription('Amphi', 'Cours'),
      },
      FORMATION,
    ),
    null,
  )
})
