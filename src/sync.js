import { fetchSchedule } from './fetchSchedule.js'
import { parseEvent } from './parseEvent.js'
import { generateIcs } from './generateIcs.js'
import { writeAtomic } from './writeAtomic.js'
import { writeFailureStatus, writeSuccessStatus } from './heartbeat.js'
import { loadManualEvents } from './manualEvents.js'
import { applyAforpFeed, mergeWithExcel } from './mergeSchedule.js'
import { fetchAforpIcs } from './fetchAforpIcs.js'

// Formations dont le planning Excel officiel (retranscrit dans
// src/manualEvents/<formation>.json) enrichit les créneaux de l'API UVSQ :
// horaires et salles viennent de l'API, noms des profs de l'Excel (voir
// src/mergeSchedule.js). Les autres formations se contentent d'additionner
// les éventuels événements manuels à ceux de l'API.
const EXCEL_ENRICHED_FORMATIONS = new Set(['MYIRS1_888'])

// Remplace les créneaux AFORP manuels par le flux Net-YPareo du groupe de
// l'étudiant, quand il en a un et que son URL est configurée. Un flux en
// panne n'est pas un échec de sync : les créneaux manuels restent en place.
async function withAforpFeed(manualEvents, cfg) {
  const url = cfg.aforpGroup ? cfg.aforpIcsUrls?.[cfg.aforpGroup] : null
  if (!url) {
    return manualEvents
  }

  try {
    const feed = await fetchAforpIcs(url, cfg.fetch)
    const { events, stats } = applyAforpFeed(manualEvents, feed)
    console.error(
      `[sync] AFORP ${cfg.aforpGroup} : ${stats.added} cours du flux, ${stats.replaced} créneau(x) manuel(s) remplacé(s) (${cfg.formation})`,
    )
    return events
  } catch (error) {
    console.error(`[sync] AFORP ${cfg.aforpGroup} : flux indisponible, créneaux manuels conservés (${error.message})`)
    return manualEvents
  }
}

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

    const manualEvents = await withAforpFeed(await loadManualEvents(cfg.formation), cfg)

    let events
    if (EXCEL_ENRICHED_FORMATIONS.has(cfg.formation)) {
      const { events: merged, stats } = mergeWithExcel(parsedEvents, manualEvents)
      console.error(
        `[sync] Excel : ${stats.byOverlap} créneau(x) enrichi(s) par horaire, ${stats.byName} par nom de cours, `
          + `${stats.unmatched} sans prof connu, ${merged.length - parsedEvents.length} événement(s) hors API ajouté(s) (${cfg.formation})`,
      )
      events = merged
    } else {
      if (manualEvents.length > 0) {
        console.error(`[sync] ${manualEvents.length} événement(s) manuel(s) ajouté(s) (${cfg.formation})`)
      }
      events = [...parsedEvents, ...manualEvents]
    }

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
