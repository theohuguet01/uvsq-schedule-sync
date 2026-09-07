import { fetchSchedule } from './fetchSchedule.js'
import { parseEvent } from './parseEvent.js'
import { generateIcs } from './generateIcs.js'
import { writeAtomic } from './writeAtomic.js'
import { writeFailureStatus, writeSuccessStatus } from './heartbeat.js'
import { loadManualEvents } from './manualEvents.js'

// Génère le calendrier d'une seule config (un étudiant, ou l'unique formation
// en mode mono-utilisateur) : fetch, parsing, écriture, statut. Utilisée par
// le CLI (mode legacy et boucle multi-étudiants) et par le serveur d'inscription
// (sync immédiate d'un seul étudiant qui vient de s'inscrire).
export async function syncOne(cfg, outPath, statusPath) {
  try {
    const rawEvents = await fetchSchedule(cfg)
    console.error(`[sync] ${rawEvents.length} événement(s) reçu(s) depuis l'API (${cfg.formation})`)

    const parsedEvents = rawEvents
      .map((rawEvent) => parseEvent(rawEvent, cfg.formation))
      .filter((event) => event !== null)
    console.error(`[sync] ${parsedEvents.length} événement(s) valide(s) après nettoyage (${cfg.formation})`)

    const manualEvents = await loadManualEvents(cfg.formation)
    if (manualEvents.length > 0) {
      console.error(`[sync] ${manualEvents.length} événement(s) manuel(s) ajouté(s) (${cfg.formation})`)
    }

    const events = [...parsedEvents, ...manualEvents]

    const ics = generateIcs(events, cfg)

    if (outPath) {
      await writeAtomic(outPath, ics)
      console.error(`[sync] Calendrier écrit dans ${outPath}`)
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
        console.error(`[sync] Impossible d'écrire le fichier de statut : ${statusError.message}`)
      })
    }
    throw error
  }
}
