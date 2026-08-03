# uvsq-schedule-sync

Export de l'emploi du temps `edt.uvsq.fr` au format iCal (`.ics`), pensé pour être
hébergé sur un serveur et rafraîchi périodiquement (ex. abonnement Apple Calendar).

Réécriture Node.js du script bash original, avec parsing renforcé (tolérance aux
descriptions malformées, décodage HTML complet) et gestion d'erreur adaptée à un
usage cron : retries réseau, validation stricte de la réponse API, écriture
atomique du fichier de sortie.

## Pré-requis

- Node.js ≥ 18 (utilise `fetch` natif)

## Installation

```bash
npm install
```

## Configuration

Toute la configuration (formation, période, fuseau horaire, PRODID) se trouve
dans [`config.js`](./config.js).

## Utilisation

Écrire sur la sortie standard :

```bash
node src/index.js > edt.ics
```

Écrire directement dans un fichier (écriture atomique — le fichier existant
n'est jamais tronqué en cas d'échec en cours de route) :

```bash
node src/index.js --out /var/www/html/edt.ics
```

En cas d'erreur (réseau, réponse API invalide), le script quitte avec un code
de sortie non nul et log le détail sur `stderr`, sans toucher au fichier de
sortie précédent.

## Tests

```bash
npm test
```

## Déploiement (rafraîchissement périodique)

Exemple de crontab pour régénérer le calendrier toutes les 15 minutes et le
servir depuis un répertoire accessible par un serveur web :

```cron
*/15 * * * * cd /chemin/vers/uvsq-schedule-sync && /usr/bin/node src/index.js --out /var/www/html/edt.ics >> /var/log/uvsq-schedule-sync.log 2>&1
```

Le fichier `edt.ics` peut ensuite être servi tel quel par nginx/Caddy/Apache et
ajouté comme abonnement de calendrier (URL `webcal://` ou `https://`) dans
Apple Calendar, Google Agenda ou Outlook, qui se chargeront de le rafraîchir
automatiquement.

## Licence

GPL-3.0, comme le script bash original dont ce projet s'inspire.
