import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildRequestBody, loadConfig } from '../config.js'

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
