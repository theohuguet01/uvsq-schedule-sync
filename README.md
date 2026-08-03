# uvsq-schedule-sync

Export de l'emploi du temps `edt.uvsq.fr` au format iCal (`.ics`), pensé pour être
hébergé sur un serveur et rafraîchi périodiquement (ex. abonnement Apple Calendar).

Parsing tolérant aux descriptions malformées, décodage HTML complet, et gestion
d'erreur adaptée à un usage cron : retries réseau, validation stricte de la
réponse API, écriture atomique du fichier de sortie, fichier de statut pour
surveiller les échecs.

## Pré-requis

- Node.js ≥ 18 (utilise `fetch` natif)

## Installation

```bash
npm install
```

## Configuration

Les valeurs par défaut (formation, période, fuseau horaire, PRODID) sont dans
[`config.js`](./config.js). Elles peuvent toutes être surchargées par variable
d'environnement, sans modifier le code :

| Variable | Défaut | Description |
|---|---|---|
| `UVSQ_FORMATION` | `MYIRS1_888` | Code de formation (federationIds\[\]) |
| `UVSQ_START` | `2026-09-07` | Début de la période exportée |
| `UVSQ_END` | `2027-08-31` | Fin de la période exportée |
| `UVSQ_TIMEZONE` | `Europe/Paris` | Fuseau horaire des événements |
| `UVSQ_URL` | `https://edt.uvsq.fr/Home/GetCalendarData` | Endpoint de l'API |
| `UVSQ_PROD_ID` | `//EDT M1 IRS Alternance UVSQ Saclay - edit by Théo HUGUET//EN` | PRODID du calendrier |
| `UVSQ_CALENDAR_NAME` | `EDT M1 IRS Alternance UVSQ` | Nom du calendrier |
| `UVSQ_FETCH_RETRIES` | `3` | Nombre de tentatives réseau |
| `UVSQ_FETCH_TIMEOUT_MS` | `15000` | Timeout par tentative (ms) |
| `UVSQ_FETCH_RETRY_DELAY_MS` | `2000` | Délai entre tentatives (ms) |
| `UVSQ_OUT_PATH` | _(aucun, sortie standard)_ | Repli pour `--out` |
| `UVSQ_STATUS_PATH` | _(aucun)_ | Repli pour `--status` |

## Utilisation

Écrire sur la sortie standard :

```bash
node src/index.js > edt.ics
```

Écrire directement dans un fichier (écriture atomique - le fichier existant
n'est jamais tronqué en cas d'échec en cours de route) :

```bash
node src/index.js --out /var/www/html/edt.ics
```

En cas d'erreur (réseau, réponse API invalide), le script quitte avec un code
de sortie non nul et log le détail sur `stderr`, sans toucher au fichier de
sortie précédent.

## Fichier de statut (surveillance)

Quand `--out`/`UVSQ_OUT_PATH` est utilisé, un fichier `<out>.status.json` est
écrit à chaque exécution (chemin personnalisable via `--status`/`UVSQ_STATUS_PATH`) :

```json
{
  "ok": true,
  "formation": "MYIRS1_888",
  "eventCount": 73,
  "lastAttemptAt": "2026-09-07T09:30:00.000Z",
  "lastSuccessAt": "2026-09-07T09:30:00.000Z"
}
```

En cas d'échec, `ok` passe à `false`, `error` contient le détail, et
`lastSuccessAt` conserve la date de la dernière exécution réussie - ce qui
permet à une surveillance externe (script, uptime check) de détecter que le
calendrier n'est plus rafraîchi depuis trop longtemps.

## Tests

```bash
npm test
```

## Déploiement (rafraîchissement périodique)

### Avec systemd (recommandé)

Des unités prêtes à l'emploi sont fournies dans [`deploy/`](./deploy) : un
service `oneshot` (une exécution puis arrêt) déclenché par un timer (équivalent
cron), avec logs consultables via `journalctl` et durcissement de base
(`ProtectSystem`, `NoNewPrivileges`...).

```bash
# 1. Déployer le code et installer les dépendances de production
sudo mkdir -p /opt/uvsq-schedule-sync
sudo cp -r . /opt/uvsq-schedule-sync
cd /opt/uvsq-schedule-sync && sudo npm install --omit=dev

# 2. Créer un utilisateur système dédié, sans shell interactif
sudo useradd --system --no-create-home --shell /usr/sbin/nologin uvsq-schedule-sync

# 3. Générer un token secret et créer le répertoire de sortie (voir la
#    section Caddy ci-dessous pour le rôle de ce token dans l'URL)
TOKEN=$(openssl rand -hex 16)
sudo mkdir -p "/var/www/edt/$TOKEN"
sudo chown -R uvsq-schedule-sync:uvsq-schedule-sync /opt/uvsq-schedule-sync /var/www/edt

# 4. Créer le fichier d'environnement (hors dépôt git, contient le token)
sudo mkdir -p /etc/uvsq-schedule-sync
echo "UVSQ_OUT_PATH=/var/www/edt/$TOKEN/edt.ics" | sudo tee /etc/uvsq-schedule-sync/env
echo "URL du calendrier : https://edt.upsclay.thuguet.fr/$TOKEN/edt.ics"

# 5. Installer les unités (adapter ExecStart/WorkingDirectory dans le
#    .service si vos chemins diffèrent, ex. `which node`)
sudo cp deploy/uvsq-schedule-sync.service deploy/uvsq-schedule-sync.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now uvsq-schedule-sync.timer
```

Vérifier :

```bash
systemctl list-timers uvsq-schedule-sync.timer   # prochaine exécution
journalctl -u uvsq-schedule-sync.service -f      # logs en direct
sudo systemctl start uvsq-schedule-sync.service  # forcer une exécution immédiate
```

### Avec cron (alternative)

```cron
*/15 * * * * cd /chemin/vers/uvsq-schedule-sync && /usr/bin/node src/index.js --out /var/www/edt/<token>/edt.ics >> /var/log/uvsq-schedule-sync.log 2>&1
```

### Servir le calendrier derrière Caddy

Un exemple est fourni dans [`deploy/Caddyfile.example`](./deploy/Caddyfile.example) :
un sous-domaine dédié, servi en statique (`file_server`), avec le bon
`Content-Type` pour un fichier `.ics`. Comme le fichier est écrit sous
`/var/www/edt/<token>/edt.ics` (token généré à l'étape 3 du déploiement
systemd), l'URL du calendrier n'est ni protégée par mot de passe ni devinable :

- Caddy ne liste jamais le contenu d'un répertoire sans la directive `browse`
  (absente ici), donc `/var/www/edt/` seul renvoie une erreur 404.
- Sans authentification, aucun souci de compatibilité côté clients calendrier
  (Apple Calendar/Google Agenda gèrent mal le Basic Auth sur `webcal://`).

À adapter et fusionner dans votre Caddyfile existant, puis valider avant
rechargement :

```bash
caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Ajouter ensuite l'abonnement dans Apple Calendar / Google Agenda / Outlook
avec l'URL affichée à l'étape 4 du déploiement, en `webcal://` (rafraîchi
automatiquement par le client) ou `https://` (import statique, à rafraîchir
manuellement selon l'app).

Important : le token fait partie de l'URL secrète, ne le committez jamais
dans ce dépôt (git). Il ne vit que dans `/etc/uvsq-schedule-sync/env` sur le
serveur - c'est pour ça que `deploy/env.example` ne contient qu'un `<token>`
en placeholder et que `.service` le charge via `EnvironmentFile`.

## Licence

ISC
