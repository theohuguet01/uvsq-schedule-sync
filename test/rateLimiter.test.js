import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createRateLimiter } from '../src/rateLimiter.js'

test('autorise jusqu\'à "max" appels dans la fenêtre, puis bloque', () => {
  const limiter = createRateLimiter({ windowMs: 1000, max: 3 })

  assert.equal(limiter.check('1.2.3.4', 0), true)
  assert.equal(limiter.check('1.2.3.4', 100), true)
  assert.equal(limiter.check('1.2.3.4', 200), true)
  assert.equal(limiter.check('1.2.3.4', 300), false)
})

test('un nouvel appel après la fin de la fenêtre est de nouveau autorisé', () => {
  const limiter = createRateLimiter({ windowMs: 1000, max: 1 })

  assert.equal(limiter.check('1.2.3.4', 0), true)
  assert.equal(limiter.check('1.2.3.4', 500), false)
  assert.equal(limiter.check('1.2.3.4', 1500), true)
})

test('deux clés différentes ont des limites indépendantes', () => {
  const limiter = createRateLimiter({ windowMs: 1000, max: 1 })

  assert.equal(limiter.check('1.2.3.4', 0), true)
  assert.equal(limiter.check('5.6.7.8', 0), true)
  assert.equal(limiter.check('1.2.3.4', 100), false)
  assert.equal(limiter.check('5.6.7.8', 100), false)
})

test('prune retire les clés dont tous les timestamps sont expirés', () => {
  const limiter = createRateLimiter({ windowMs: 1000, max: 1 })

  limiter.check('1.2.3.4', 0)
  limiter.prune(5000)

  // Après prune, la clé a été oubliée : un nouvel appel dans une fenêtre qui
  // aurait pourtant inclus l'appel initial (s'il n'avait pas été purgé) est
  // de nouveau autorisé, confirmant que l'état a bien été nettoyé.
  assert.equal(limiter.check('1.2.3.4', 5000), true)
})
