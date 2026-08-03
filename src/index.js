#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'

import { config } from '../config.js'
import { fetchSchedule } from './fetchSchedule.js'
import { parseEvent } from './parseEvent.js'
import { generateIcs } from './generateIcs.js'
import { writeAtomic } from './writeAtomic.js'
import { writeFailureStatus, writeSuccessStatus } from './heartbeat.js'

export function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      out: { type: 'string', short: 'o' },
      status: { type: 'string', short: 's' },
    },
  })
  return values
}

export async function run(argv, cfg = config, env = process.env) {
  const args = parseCliArgs(argv)
  // --out/--status ont priorité sur les variables d'environnement, elles-mêmes
  // utilisées en repli pour un déploiement cron sans avoir à répéter les flags.
  const out = args.out ?? env.UVSQ_OUT_PATH
  const outPath = out ? resolve(out) : null
  const statusArg = args.status ?? env.UVSQ_STATUS_PATH
  // Par défaut, le fichier de statut vit à côté du calendrier publié, pour
  // qu'une surveillance externe sache si la dernière exécution a réussi et
  // depuis quand le calendrier n'a plus été rafraîchi avec succès.
  const statusPath = statusArg ? resolve(statusArg) : outPath ? `${outPath}.status.json` : null

  try {
    const rawEvents = await fetchSchedule(cfg)
    console.error(`[index] ${rawEvents.length} événement(s) reçu(s) depuis l'API`)

    const events = rawEvents
      .map((rawEvent) => parseEvent(rawEvent, cfg.formation))
      .filter((event) => event !== null)
    console.error(`[index] ${events.length} événement(s) valide(s) après nettoyage`)

    const ics = generateIcs(events, cfg)

    if (outPath) {
      await writeAtomic(outPath, ics)
      console.error(`[index] Calendrier écrit dans ${outPath}`)
    } else {
      process.stdout.write(ics)
    }

    if (statusPath) {
      await writeSuccessStatus(statusPath, { formation: cfg.formation, eventCount: events.length })
    }

    return { eventCount: events.length }
  } catch (error) {
    if (statusPath) {
      await writeFailureStatus(statusPath, { formation: cfg.formation, error }).catch((statusError) => {
        console.error(`[index] Impossible d'écrire le fichier de statut : ${statusError.message}`)
      })
    }
    throw error
  }
}

// N'exécute run() que lorsque ce fichier est lancé directement (node src/index.js),
// pas lorsqu'il est importé par les tests.
const isDirectRun = process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`

if (isDirectRun) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(`[index] Échec de la génération du calendrier : ${error.message}`)
    process.exitCode = 1
  })
}
