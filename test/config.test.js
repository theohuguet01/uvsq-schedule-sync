import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildRequestBody, buildStudentConfig, loadConfig } from '../config.js'

test('valeurs par défaut quand aucune variable d\'environnement n\'est définie', () => {
  const cfg = loadConfig({})

  assert.equal(cfg.formation, 'MYIRS1_888')
  assert.equal(cfg.start, '2026-09-07')
  assert.equal(cfg.end, '2027-08-31')
  assert.equal(cfg.timezone, 'Europe/Paris')
  assert.equal(cfg.fetch.retries, 3)
})

test('les variables UVSQ_* surchargent les valeurs par défaut', () => {
  const cfg = loadConfig({
    UVSQ_FORMATION: 'MYAUTRE_777',
    UVSQ_START: '2027-01-01',
    UVSQ_END: '2027-06-30',
    UVSQ_TIMEZONE: 'Europe/London',
    UVSQ_FETCH_RETRIES: '5',
    UVSQ_FETCH_TIMEOUT_MS: '30000',
  })

  assert.equal(cfg.formation, 'MYAUTRE_777')
  assert.equal(cfg.start, '2027-01-01')
  assert.equal(cfg.end, '2027-06-30')
  assert.equal(cfg.timezone, 'Europe/London')
  assert.equal(cfg.fetch.retries, 5)
  assert.equal(cfg.fetch.timeoutMs, 30000)
})

test('une variable vide est traitée comme absente (repli sur le défaut)', () => {
  const cfg = loadConfig({ UVSQ_FORMATION: '' })

  assert.equal(cfg.formation, 'MYIRS1_888')
})

test('buildRequestBody encode correctement les paramètres, y compris federationIds[]', () => {
  const cfg = loadConfig({ UVSQ_FORMATION: 'MYAUTRE_777', UVSQ_START: '2027-01-01', UVSQ_END: '2027-06-30' })

  const body = buildRequestBody(cfg)

  assert.match(body, /start=2027-01-01/)
  assert.match(body, /end=2027-06-30/)
  assert.match(body, /federationIds%5B%5D=MYAUTRE_777/)
})

test('buildStudentConfig surcharge formation/calendarName/prodId, garde le reste de la config globale', () => {
  const baseCfg = loadConfig({})

  const cfg = buildStudentConfig(baseCfg, { formation: 'AUTRE_999', name: 'jane-doe', token: 'a'.repeat(32) })

  assert.equal(cfg.formation, 'AUTRE_999')
  assert.equal(cfg.calendarName, baseCfg.calendarName)
  assert.equal(cfg.prodId, baseCfg.prodId)
  assert.equal(cfg.start, baseCfg.start)
  assert.equal(cfg.timezone, baseCfg.timezone)
})

test('buildStudentConfig applique les surcharges calendarName/prodId de l\'étudiant si présentes', () => {
  const baseCfg = loadConfig({})

  const cfg = buildStudentConfig(baseCfg, {
    formation: 'AUTRE_999',
    name: 'jane-doe',
    token: 'a'.repeat(32),
    calendarName: 'EDT de Jane',
    prodId: '//jane//FR',
  })

  assert.equal(cfg.calendarName, 'EDT de Jane')
  assert.equal(cfg.prodId, '//jane//FR')
})

test('URL des flux AFORP par groupe et groupe mono-utilisateur lus depuis l\'environnement', () => {
  assert.deepEqual(loadConfig({}).aforpIcsUrls, { G1: null, G2: null })
  assert.equal(loadConfig({}).aforpGroup, null)

  const cfg = loadConfig({
    UVSQ_AFORP_ICS_URL_G2: 'https://example.invalid/ical/G2/',
    UVSQ_AFORP_GROUP: 'G2',
  })

  assert.deepEqual(cfg.aforpIcsUrls, { G1: null, G2: 'https://example.invalid/ical/G2/' })
  assert.equal(cfg.aforpGroup, 'G2')
})

test('buildStudentConfig : groupe AFORP de l\'étudiant, jamais celui du mode mono-utilisateur', () => {
  const baseCfg = loadConfig({ UVSQ_AFORP_GROUP: 'G1' })
  const student = { formation: 'MYIRS1_888', name: 'jane-doe', token: 'a'.repeat(32) }

  assert.equal(buildStudentConfig(baseCfg, student).aforpGroup, null)
  assert.equal(buildStudentConfig(baseCfg, { ...student, aforpGroup: 'G2' }).aforpGroup, 'G2')
})

test('buildStudentConfig : uidSalt = token de l\'étudiant (UID propres à chaque calendrier)', () => {
  const cfg = buildStudentConfig(loadConfig({}), { formation: 'MYIRS1_888', name: 'jane-doe', token: 'c'.repeat(32) })

  assert.equal(cfg.uidSalt, 'c'.repeat(32))
  assert.equal(loadConfig({}).uidSalt, undefined)
})
