#!/usr/bin/env node
import { createServer as createHttpServer } from 'node:http'
import { resolve } from 'node:path'

import { config } from '../config.js'
import { handleRegister } from './registerHandler.js'
import { handleUnregister } from './unregisterHandler.js'
import { createRateLimiter } from './rateLimiter.js'

const MAX_BODY_BYTES = 16 * 1024

function readBody(req) {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0
    let rejected = false
    const chunks = []
    req.on('data', (chunk) => {
      if (rejected) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        // On ne détruit pas le socket ici : ça couperait la connexion avant
        // que la réponse 413 ait pu partir ("socket hang up" côté client). On
        // laisse simplement le flux se vider (les chunks restants sont
        // ignorés) pendant que le code appelant écrit sa réponse.
        rejected = true
        rejectPromise(Object.assign(new Error('Corps de requête trop volumineux'), { status: 413 }))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!rejected) {
        resolvePromise(Buffer.concat(chunks).toString('utf8'))
      }
    })
    req.on('error', rejectPromise)
  })
}

// Ce process n'est censé être joignable qu'en local (127.0.0.1 par défaut,
// voir loadDepsFromEnv/isDirectRun ci-dessous) : Caddy fait le reverse proxy
// public et ajoute X-Forwarded-For, qu'on peut donc lui faire confiance ici -
// personne d'autre ne peut parler directement à ce process pour usurper une IP.
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  return req.socket.remoteAddress
}

const ROUTES = {
  '/api/register': handleRegister,
  '/api/unregister': handleUnregister,
}

// Serveur HTTP minimal (pas de dépendance ajoutée) exposant POST /api/register
// (public/inscription.html) et POST /api/unregister (droit à l'effacement,
// voir public/uvsq/confidentialite.html). Toute la logique métier vit dans
// registerHandler.js/unregisterHandler.js ; cette couche ne fait que parser
// la requête et sérialiser la réponse.
export function createServer(deps) {
  return createHttpServer(async (req, res) => {
    const handle = req.method === 'POST' ? ROUTES[req.url] : undefined
    if (!handle) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Introuvable' }))
      return
    }

    try {
      const raw = await readBody(req)
      let body
      try {
        body = raw ? JSON.parse(raw) : {}
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'JSON invalide' }))
        return
      }

      const result = await handle({ ip: clientIp(req), body }, deps)
      res.writeHead(result.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result.body))
    } catch (error) {
      if (error.status) {
        res.writeHead(error.status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: error.message }))
        return
      }
      console.error(`[server] erreur inattendue : ${error.stack}`)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Erreur interne' }))
    }
  })
}

function loadDepsFromEnv(env = process.env) {
  const registryPath = env.UVSQ_STUDENTS_PATH
  const outDir = env.UVSQ_OUT_DIR
  const publicBaseUrl = env.UVSQ_PUBLIC_BASE_URL

  if (!registryPath || !outDir || !publicBaseUrl) {
    throw new Error(
      'UVSQ_STUDENTS_PATH, UVSQ_OUT_DIR et UVSQ_PUBLIC_BASE_URL sont requis pour lancer le serveur d\'inscription',
    )
  }

  const windowMs = Number(env.UVSQ_REGISTER_RATE_WINDOW_MS ?? 10 * 60 * 1000)
  const max = Number(env.UVSQ_REGISTER_RATE_MAX ?? 5)

  return {
    registryPath: resolve(registryPath),
    outDir: resolve(outDir),
    baseCfg: config,
    publicBaseUrl,
    rateLimiter: createRateLimiter({ windowMs, max }),
  }
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`

if (isDirectRun) {
  const deps = loadDepsFromEnv()
  const port = Number(process.env.UVSQ_REGISTER_PORT ?? 8787)
  const host = process.env.UVSQ_REGISTER_HOST ?? '127.0.0.1'

  // Purge périodique du rate limiter : sans ça, un process longue durée
  // accumulerait indéfiniment en mémoire une entrée par IP déjà vue.
  setInterval(() => deps.rateLimiter.prune(), 5 * 60 * 1000).unref()

  createServer(deps).listen(port, host, () => {
    console.error(`[server] serveur d'inscription à l'écoute sur ${host}:${port}`)
  })
}
