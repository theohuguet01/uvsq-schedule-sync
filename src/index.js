#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { config } from '../config.js'
import { fetchSchedule } from './fetchSchedule.js'
import { parseEvent } from './parseEvent.js'
import { generateIcs } from './generateIcs.js'

function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      out: { type: 'string', short: 'o' },
    },
  })
  return values
}

// Écriture atomique : on écrit dans un fichier temporaire puis on le renomme
// à la place du fichier final. Ainsi, si le script échoue en cours de route,
// le calendrier déjà publié (et servi à Apple Calendar) n'est jamais tronqué
// ou corrompu par une exécution partielle.
async function writeAtomic(path, content) {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true })
  const tmpPath = `${path}.tmp-${process.pid}`

  try {
    await writeFile(tmpPath, content, 'utf8')
    await rename(tmpPath, path)
  } catch (error) {
    await unlink(tmpPath).catch(() => {})
    throw error
  }
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2))

  const rawEvents = await fetchSchedule(config)
  console.error(`[index] ${rawEvents.length} événement(s) reçu(s) depuis l'API`)

  const events = rawEvents.map(parseEvent).filter((event) => event !== null)
  console.error(`[index] ${events.length} événement(s) valide(s) après nettoyage`)

  const ics = generateIcs(events, config)

  if (args.out) {
    const outPath = resolve(args.out)
    await writeAtomic(outPath, ics)
    console.error(`[index] Calendrier écrit dans ${outPath}`)
  } else {
    process.stdout.write(ics)
  }
}

main().catch((error) => {
  console.error(`[index] Échec de la génération du calendrier : ${error.message}`)
  process.exitCode = 1
})
