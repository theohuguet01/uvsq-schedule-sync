#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { resolve, join } from 'node:path'

import { config, buildStudentConfig } from '../config.js'
import { fetchSchedule } from './fetchSchedule.js'
import { parseEvent } from './parseEvent.js'
import { generateIcs } from './generateIcs.js'
import { writeAtomic } from './writeAtomic.js'
import { writeFailureStatus, writeSuccessStatus } from './heartbeat.js'
import { loadStudents } from './students.js'

export function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      out: { type: 'string', short: 'o' },
      status: { type: 'string', short: 's' },
      students: { type: 'string' },
      'out-dir': { type: 'string' },
    },
  })
  return values
}

// Génère le calendrier d'une seule config (un étudiant, ou l'unique formation
// en mode mono-utilisateur) : fetch, parsing, écriture, statut. Utilisée à la
// fois par le mode legacy et par la boucle multi-étudiants.
async function syncOne(cfg, outPath, statusPath) {
  try {
    const rawEvents = await fetchSchedule(cfg)
    console.error(`[index] ${rawEvents.length} événement(s) reçu(s) depuis l'API (${cfg.formation})`)

    const events = rawEvents
      .map((rawEvent) => parseEvent(rawEvent, cfg.formation))
      .filter((event) => event !== null)
    console.error(`[index] ${events.length} événement(s) valide(s) après nettoyage (${cfg.formation})`)

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

// Mode multi-étudiants : un fetch/génération/statut par étudiant du registre,
// sous ${outDir}/<token>/edt.ics. Le token (jamais le name) fait office de
// composant secret de l'URL, comme en mode mono-utilisateur.
// L'échec d'un étudiant n'empêche pas les autres d'être traités ; l'échec
// global n'est signalé (process qui rejette) qu'une fois tout le monde traité,
// pour que la surveillance externe (systemd/cron) détecte le souci sans
// priver les autres étudiants de leur calendrier à jour.
async function runForStudents(studentsPath, outDir, baseCfg) {
  const students = await loadStudents(studentsPath)
  console.error(`[index] Mode multi-étudiants : ${students.length} étudiant(s) dans le registre`)

  const results = []
  for (const student of students) {
    const studentCfg = buildStudentConfig(baseCfg, student)
    const outPath = join(outDir, student.token, 'edt.ics')
    const statusPath = `${outPath}.status.json`

    try {
      const { eventCount } = await syncOne(studentCfg, outPath, statusPath)
      console.error(`[index] [${student.name}] OK (${eventCount} événement(s))`)
      results.push({ name: student.name, ok: true, eventCount })
    } catch (error) {
      console.error(`[index] [${student.name}] ÉCHEC : ${error.message}`)
      results.push({ name: student.name, ok: false, error: error.message })
    }
  }

  await writeAtomic(join(outDir, 'status.json'), JSON.stringify({
    ok: results.every((result) => result.ok),
    students: results,
  }, null, 2))

  const failures = results.filter((result) => !result.ok)
  if (failures.length > 0) {
    throw new Error(`${failures.length}/${results.length} étudiant(s) en échec : ${failures.map((f) => f.name).join(', ')}`)
  }

  return { students: results }
}

export async function run(argv, cfg = config, env = process.env) {
  const args = parseCliArgs(argv)

  const studentsPath = args.students ?? env.UVSQ_STUDENTS_PATH
  if (studentsPath) {
    const outDirArg = args['out-dir'] ?? env.UVSQ_OUT_DIR
    if (!outDirArg) {
      throw new Error('--out-dir (ou UVSQ_OUT_DIR) est requis en mode multi-étudiants')
    }
    return runForStudents(resolve(studentsPath), resolve(outDirArg), cfg)
  }

  // --out/--status ont priorité sur les variables d'environnement, elles-mêmes
  // utilisées en repli pour un déploiement cron sans avoir à répéter les flags.
  const out = args.out ?? env.UVSQ_OUT_PATH
  const outPath = out ? resolve(out) : null
  const statusArg = args.status ?? env.UVSQ_STATUS_PATH
  // Par défaut, le fichier de statut vit à côté du calendrier publié, pour
  // qu'une surveillance externe sache si la dernière exécution a réussi et
  // depuis quand le calendrier n'a plus été rafraîchi avec succès.
  const statusPath = statusArg ? resolve(statusArg) : outPath ? `${outPath}.status.json` : null

  return syncOne(cfg, outPath, statusPath)
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
