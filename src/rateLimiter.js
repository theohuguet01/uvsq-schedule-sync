// Fenêtre glissante en mémoire, par clé (IP) : limite le nombre d'appels
// autorisés sur une fenêtre de temps donnée. Suffisant pour un service
// mono-process ; une vraie infra distribuée voudrait un store partagé.
export function createRateLimiter({ windowMs, max }) {
  const hits = new Map() // clé -> timestamps (ms) dans la fenêtre courante

  return {
    // Retourne true si l'appel est autorisé (et l'enregistre), false sinon.
    // `now` est injectable pour des tests déterministes sans attendre en vrai.
    check(key, now = Date.now()) {
      const windowStart = now - windowMs
      const timestamps = (hits.get(key) ?? []).filter((ts) => ts > windowStart)

      if (timestamps.length >= max) {
        hits.set(key, timestamps)
        return false
      }

      timestamps.push(now)
      hits.set(key, timestamps)
      return true
    },

    // Purge les clés sans timestamp encore dans la fenêtre, pour qu'un process
    // longue durée n'accumule pas indéfiniment des IP inactives en mémoire.
    prune(now = Date.now()) {
      const windowStart = now - windowMs
      for (const [key, timestamps] of hits) {
        const fresh = timestamps.filter((ts) => ts > windowStart)
        if (fresh.length === 0) {
          hits.delete(key)
        } else {
          hits.set(key, fresh)
        }
      }
    },
  }
}
