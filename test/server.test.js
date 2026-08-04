import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'

import { createServer } from '../src/server.js'
import { createRateLimiter } from '../src/rateLimiter.js'
import { registerStudent } from '../src/registry.js'

function testConfig(overrides = {}) {
  return {
    url: 'https://example.invalid/GetCalendarData',
    formation: 'IGNORED',
    start: '2026-09-07',
    end: '2027-08-31',
    resType: 103,
    calView: 'agendaWeek',
    colourScheme: 3,
    timezone: 'Europe/Paris',
    prodId: '//theohuguet//uvsq-schedule-sync-test//FR',
    calendarName: 'Test',
    fetch: { timeoutMs: 1000, retries: 1, retryDelayMs: 1 },
    ...overrides,
  }
}

function mockFetch(t, impl) {
  const original = globalThis.fetch
  globalThis.fetch = impl
  t.after(() => {
    globalThis.fetch = original
  })
}

async function makeDirs(t) {
  const dir = await mkdtemp(join(tmpdir(), 'uvsq-schedule-sync-server-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return {
    registryPath: join(dir, 'students.json'),
    outDir: join(dir, 'out'),
  }
}

async function withServer(t, deps) {
  const server = createServer(deps)
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  t.after(() => new Promise((resolvePromise) => server.close(resolvePromise)))
  return server
}

// Requête HTTP brute (node:http, pas fetch) : le fetch global est mocké dans
// ces tests pour intercepter l'appel sortant vers l'API UVSQ déclenché par la
// sync immédiate - on ne veut pas qu'il intercepte aussi les requêtes que ce
// test envoie lui-même au serveur local.
function request(server, { method = 'POST', path = '/api/register', body, raw } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const { port } = server.address()
    const payload = raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: payload !== undefined
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        let received = ''
        res.on('data', (chunk) => {
          received += chunk
        })
        res.on('end', () => {
          resolvePromise({ status: res.statusCode, body: received ? JSON.parse(received) : null })
        })
      },
    )
    req.on('error', rejectPromise)
    if (payload !== undefined) {
      req.write(payload)
    }
    req.end()
  })
}

const RAW_EVENT = {
  id: 'evt-1',
  start: '2026-09-07T09:30:00',
  end: '2026-09-07T10:30:00',
  description: '\r\n\r\n<br />\r\n\r\nAmphi\r\n\r\n<br />\r\n\r\nCours test\r\n\r\n<br />\r\n\r\n',
}

function baseDeps({ registryPath, outDir }) {
  return {
    registryPath,
    outDir,
    baseCfg: testConfig(),
    publicBaseUrl: 'https://edt.example.fr',
    rateLimiter: createRateLimiter({ windowMs: 60000, max: 10 }),
  }
}

test('POST /api/register : inscription réussie renvoie 201 avec l\'URL', async (t) => {
  mockFetch(t, async () => ({ ok: true, text: async () => JSON.stringify([RAW_EVENT]) }))
  const dirs = await makeDirs(t)
  const server = await withServer(t, baseDeps(dirs))

  const res = await request(server, { body: { name: 'alice', formation: 'MYIRS1_888' } })

  assert.equal(res.status, 201)
  assert.match(res.body.url, /^https:\/\/edt\.example\.fr\/[a-f0-9]{32}\/edt\.ics$/)
})

test('méthode GET sur /api/register : 404', async (t) => {
  const dirs = await makeDirs(t)
  const server = await withServer(t, baseDeps(dirs))

  const res = await request(server, { method: 'GET', path: '/api/register' })

  assert.equal(res.status, 404)
})

test('chemin inconnu : 404', async (t) => {
  const dirs = await makeDirs(t)
  const server = await withServer(t, baseDeps(dirs))

  const res = await request(server, { path: '/autre-chose', body: {} })

  assert.equal(res.status, 404)
})

test('JSON malformé : 400', async (t) => {
  const dirs = await makeDirs(t)
  const server = await withServer(t, baseDeps(dirs))

  const res = await request(server, { raw: '{ not valid json' })

  assert.equal(res.status, 400)
})

test('corps trop volumineux : 413', async (t) => {
  const dirs = await makeDirs(t)
  const server = await withServer(t, baseDeps(dirs))

  const res = await request(server, { raw: JSON.stringify({ name: 'a'.repeat(20000), formation: 'MYIRS1_888' }) })

  assert.equal(res.status, 413)
})

test('POST /api/unregister : suppression réussie renvoie 200', async (t) => {
  const dirs = await makeDirs(t)
  const student = await registerStudent(dirs.registryPath, { name: 'alice', formation: 'MYIRS1_888' })
  const server = await withServer(t, baseDeps(dirs))

  const res = await request(server, { path: '/api/unregister', body: { token: student.token } })

  assert.equal(res.status, 200)
  assert.equal(res.body.name, 'alice')
})

test('POST /api/unregister : token inconnu renvoie 404', async (t) => {
  const dirs = await makeDirs(t)
  const server = await withServer(t, baseDeps(dirs))

  const res = await request(server, { path: '/api/unregister', body: { token: 'f'.repeat(32) } })

  assert.equal(res.status, 404)
})
