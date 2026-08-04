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
| `UVSQ_STUDENTS_PATH` | _(aucun)_ | Repli pour `--students` (active le [mode multi-étudiants](#mode-multi-étudiants)) |
| `UVSQ_OUT_DIR` | _(aucun)_ | Repli pour `--out-dir` (obligatoire avec `UVSQ_STUDENTS_PATH`) |

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

## Mode multi-étudiants

Par défaut, le service publie un seul calendrier (une formation, un token,
voir ci-dessus). Il peut aussi publier un calendrier **par personne**, chacune
avec sa propre formation UVSQ et son propre token secret - utile pour ouvrir
le service à d'autres étudiants ou personnes de l'UVSQ sans qu'ils partagent
la même URL.

Ce mode s'active avec deux options (CLI ou variables d'environnement) à la
place de `--out`/`UVSQ_OUT_PATH` :

- `--students`/`UVSQ_STUDENTS_PATH` : chemin vers un registre JSON (voir
  [`deploy/students.json.example`](./deploy/students.json.example)), un
  tableau d'objets `{ name, token, formation, calendarName?, prodId? }`.
  `name` est un identifiant interne (logs, statut agrégé) et ne fait **pas**
  partie de l'URL ; `token` (généré avec `openssl rand -hex 16`, comme pour le
  mode mono-utilisateur) en fait partie. `calendarName`/`prodId` sont
  optionnels et remplacent les valeurs globales pour cet étudiant seulement -
  la période, le fuseau horaire et les paramètres réseau restent communs à
  tous. Comme le fichier d'environnement en mode mono-utilisateur, **ce
  registre ne doit jamais être committé dans ce dépôt** puisqu'il contient les
  tokens : il vit hors git, ex. `/etc/uvsq-schedule-sync/students.json`.
- `--out-dir`/`UVSQ_OUT_DIR` : répertoire de base où publier les calendriers.
  Chaque étudiant obtient `${outDir}/<son-token>/edt.ics` (et son fichier de
  statut `edt.ics.status.json` juste à côté) - exactement le même schéma d'URL
  que le mode mono-utilisateur, juste un dossier par token au lieu d'un seul.

```bash
node src/index.js --students /etc/uvsq-schedule-sync/students.json --out-dir /var/www/edt.upsclay.thuguet.fr
```

L'échec de récupération d'un étudiant (réseau, formation invalide...) n'empêche
pas le traitement des autres : chacun a son fichier de statut indépendant.
Un statut agrégé est en plus écrit dans `${outDir}/status.json` :

```json
{
  "ok": false,
  "students": [
    { "name": "alice", "ok": true, "eventCount": 42 },
    { "name": "bob", "ok": false, "error": "Échec de récupération de l'emploi du temps après 3 tentatives : ..." }
  ]
}
```

Si au moins un étudiant échoue, le processus quitte tout de même avec un code
de sortie non nul (pour que systemd/cron/monitoring détecte le souci), mais
seulement **après** avoir traité et publié le calendrier de tous les autres.

Pour ajouter ou retirer une personne, éditer le registre puis relancer une
exécution (`sudo systemctl start uvsq-schedule-sync.service` avec systemd) :
aucun redémarrage du timer n'est nécessaire.

## Auto-inscription (page web)

Plutôt que d'éditer le registre à la main pour chaque nouvelle personne,
[`public/inscription.html`](./public/inscription.html) permet à chacun de
générer lui-même son lien : un formulaire (nom + code de formation), un écran
de confirmation, puis le lien webcal/https une fois le token créé.

Cette page appelle en `fetch` (même origine, chemin relatif) un petit serveur
HTTP dédié, [`src/server.js`](./src/server.js) (`http` natif, aucune
dépendance ajoutée), qui expose uniquement `POST /api/register`. Contrairement
au reste du projet (un script `oneshot` + un timer), ce serveur tourne en
continu - c'est lui qui reçoit les inscriptions, ajoute l'entrée au registre
(même fichier que le [mode multi-étudiants](#mode-multi-étudiants), donc
compatible avec des entrées déjà ajoutées à la main), puis déclenche
immédiatement une synchronisation pour ce seul étudiant afin que son lien soit
utilisable tout de suite. Le timer périodique existant continue de rafraîchir
tout le monde en tâche de fond, y compris les inscrits par ce formulaire.

Le formulaire étant public (accessible à quiconque a l'URL, comme le reste du
site - voir [Servir le calendrier derrière Caddy](#servir-le-calendrier-derrière-caddy)),
plusieurs garde-fous limitent les abus :

- **Format strict** du code de formation (lettres/chiffres/underscore
  uniquement) avant tout envoi à l'API UVSQ - empêche l'injection de
  caractères arbitraires dans la requête sortante.
- **Rate limiting par IP** (fenêtre glissante en mémoire, `UVSQ_REGISTER_RATE_MAX`
  tentatives par `UVSQ_REGISTER_RATE_WINDOW_MS` - 5 / 10 min par défaut).
- **Honeypot** : un champ caché du formulaire, invisible pour un humain, qui
  fait rejeter la requête s'il est rempli (signe d'un bot qui remplit tous
  les champs du DOM).
- Un nom déjà pris est refusé (409) plutôt que d'écraser l'entrée existante.

Un code de formation invalide (faute de frappe, formation inexistante) ne
fait pas échouer l'inscription : l'API UVSQ renvoie simplement 0 événement
sans erreur HTTP dans ce cas (voir note plus haut) - le formulaire le détecte
et affiche un avertissement (`eventCount: 0` dans la réponse de
`/api/register`) plutôt que de laisser croire que tout s'est bien passé.

Le formulaire suit la charte graphique de l'UVSQ (voir
[Charte graphique](#charte-graphique-uvsq)).

### Suppression des données (droit à l'effacement)

[`public/confidentialite.html`](./public/confidentialite.html)
inclut un formulaire de suppression en libre-service : coller le lien de
calendrier reçu à l'inscription suffit à retirer l'entrée du registre et les
fichiers publiés (`edt.ics` + statut), via `POST /api/unregister`. Le token
contenu dans le lien fait office de preuve de possession, aucune autre
vérification n'est demandée. Voir
[`src/unregisterHandler.js`](./src/unregisterHandler.js).

### Déployer le serveur d'inscription

En plus des variables du [mode multi-étudiants](#mode-multi-étudiants)
(`UVSQ_STUDENTS_PATH`, `UVSQ_OUT_DIR`), ce serveur a besoin de
`UVSQ_PUBLIC_BASE_URL` (le domaine public, pour construire le lien renvoyé) -
voir [`deploy/env.example`](./deploy/env.example) pour le détail des variables
(port d'écoute, rate limiting).

```bash
# 1. Ajouter UVSQ_PUBLIC_BASE_URL (et ajuster les autres variables si besoin)
#    dans /etc/uvsq-schedule-sync/env - voir deploy/env.example.

# 2. Installer et démarrer le service (écoute en 127.0.0.1 uniquement, jamais
#    exposé directement : c'est Caddy qui le rend joignable via /api/register
#    et /api/unregister, voir deploy/Caddyfile.example)
sudo cp deploy/uvsq-schedule-register.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now uvsq-schedule-register.service

# 3. Publier les pages (voir la section Page d'accueil du domaine, qui
#    inclut déjà inscription.html et confidentialite.html)
```

Vérifier :

```bash
journalctl -u uvsq-schedule-register.service -f   # logs en direct
```

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
# 1. Cloner le code (en tant que votre utilisateur normal, PAS root/sudo) et
#    installer les dépendances de production. Un vrai clone git (plutôt qu'un
#    simple cp) permet de mettre à jour ensuite avec un `git pull`.
sudo mkdir -p /opt/uvsq-schedule-sync
sudo chown "$(whoami)" /opt/uvsq-schedule-sync
git clone https://github.com/theohuguet01/uvsq-schedule-sync.git /opt/uvsq-schedule-sync
cd /opt/uvsq-schedule-sync && npm install --omit=dev

# 2. Créer un utilisateur système dédié, sans shell interactif. Il n'a besoin
#    QUE de lire /opt/uvsq-schedule-sync (permissions par défaut suffisent,
#    inutile de lui en donner la propriété) - il écrit uniquement dans
#    /var/www/edt.upsclay.thuguet.fr.
sudo useradd --system --no-create-home --shell /usr/sbin/nologin uvsq-schedule-sync

# 3. Générer un token secret et créer le répertoire de sortie (voir la
#    section Caddy ci-dessous pour le rôle de ce token dans l'URL)
TOKEN=$(openssl rand -hex 16)
sudo mkdir -p "/var/www/edt.upsclay.thuguet.fr/$TOKEN"
sudo chown -R uvsq-schedule-sync:caddy /var/www/edt.upsclay.thuguet.fr

# 4. Créer le fichier d'environnement (hors dépôt git, contient le token)
sudo mkdir -p /etc/uvsq-schedule-sync
echo "UVSQ_OUT_PATH=/var/www/edt.upsclay.thuguet.fr/$TOKEN/edt.ics" | sudo tee /etc/uvsq-schedule-sync/env
echo "URL du calendrier : https://edt.upsclay.thuguet.fr/$TOKEN/edt.ics"

# 5. Installer les unités (adapter ExecStart/WorkingDirectory dans le
#    .service si vos chemins diffèrent, ex. `which node`)
sudo cp deploy/uvsq-schedule-sync.service deploy/uvsq-schedule-sync.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now uvsq-schedule-sync.timer
```

Les étapes 3-4 ci-dessus déploient le [mode mono-utilisateur](#configuration).
Pour publier un calendrier par étudiant à la place, remplacer l'étape 4 par un
registre `UVSQ_STUDENTS_PATH`/`UVSQ_OUT_DIR` - voir
[Mode multi-étudiants](#mode-multi-étudiants).

Pour les mises à jour suivantes, en tant que propriétaire du dossier (pas
besoin de sudo) :

```bash
cd /opt/uvsq-schedule-sync
git pull
npm install --omit=dev   # si package.json/package-lock.json ont changé
```

Puis recopier les fichiers `deploy/`/`public/` modifiés le cas échéant
(`.service`/`.timer` → `/etc/systemd/system/` + `daemon-reload`, fichiers
statiques → `/var/www/edt.upsclay.thuguet.fr/`).

Vérifier :

```bash
systemctl list-timers uvsq-schedule-sync.timer   # prochaine exécution
journalctl -u uvsq-schedule-sync.service -f      # logs en direct
sudo systemctl start uvsq-schedule-sync.service  # forcer une exécution immédiate
```

### Avec cron (alternative)

```cron
*/5 * * * * cd /chemin/vers/uvsq-schedule-sync && /usr/bin/node src/index.js --out /var/www/edt.upsclay.thuguet.fr/<token>/edt.ics >> /var/log/uvsq-schedule-sync.log 2>&1
```

### Servir le calendrier derrière Caddy

Un exemple est fourni dans [`deploy/Caddyfile.example`](./deploy/Caddyfile.example) :
un sous-domaine dédié, servi en statique (`file_server`), avec le bon
`Content-Type` pour un fichier `.ics`. Comme le fichier est écrit sous
`/var/www/edt.upsclay.thuguet.fr/<token>/edt.ics` (token généré à l'étape 3 du déploiement
systemd), l'URL du calendrier n'est ni protégée par mot de passe ni devinable :

- Caddy ne liste jamais le contenu d'un répertoire sans la directive `browse`
  (absente ici) : le dossier `<token>/` seul (sans `edt.ics`) renvoie une erreur 404.
- Sans authentification, aucun souci de compatibilité côté clients calendrier
  (Apple Calendar/Google Agenda gèrent mal le Basic Auth sur `webcal://`).

La racine `/var/www/edt.upsclay.thuguet.fr/` sert elle une page d'accueil statique
(voir section suivante) : elle ne dévoile rien sur le token, juste une page
d'atterrissage neutre pour qui tombe sur le domaine sans le lien complet.

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

### Page d'accueil du domaine

[`public/index.html`](./public/index.html) affiche le blason UVSQ, pour que
la racine du domaine (sans le token) ne tombe pas sur une 404. Contrairement à
`edt.ics`, ce n'est pas généré par le service : ce sont des fichiers statiques,
à copier une seule fois (ou à chaque mise à jour du dépôt) :

```bash
sudo cp public/index.html public/404.html public/inscription.html public/confidentialite.html public/blason-uvsq-paris-saclay.png public/robots.txt /var/www/edt.upsclay.thuguet.fr/
sudo chown uvsq-schedule-sync:caddy /var/www/edt.upsclay.thuguet.fr/index.html /var/www/edt.upsclay.thuguet.fr/404.html /var/www/edt.upsclay.thuguet.fr/inscription.html /var/www/edt.upsclay.thuguet.fr/confidentialite.html /var/www/edt.upsclay.thuguet.fr/blason-uvsq-paris-saclay.png /var/www/edt.upsclay.thuguet.fr/robots.txt
```

[`public/404.html`](./public/404.html) est servi pour toute page introuvable
(voir la directive `handle_errors` de
[`deploy/Caddyfile.example`](./deploy/Caddyfile.example)) - y compris un
token de calendrier inconnu, qui reste ainsi indiscernable d'une page qui
n'existe pas.

`public/inscription.html` et `public/confidentialite.html` (voir
[Auto-inscription](#auto-inscription-page-web) et
[Suppression des données](#suppression-des-données-droit-à-leffacement)) ne
sont utiles que si le serveur d'inscription est déployé - déjà inclus dans la
commande de copie ci-dessus.

Le fichier logo ([`public/blason-uvsq-paris-saclay.png`](./public/blason-uvsq-paris-saclay.png),
copie de `branding/2025_BLASON_UVSQ.png`) provient du dossier `branding/`
(assets officiels fournis directement par l'établissement) et n'est pas
modifié ici (pas de recadrage, de changement de couleur). Leur charte impose
que le logo UVSQ n'apparaisse jamais seul, toujours accompagné du bandeau
« université Paris-Saclay ».

Le site n'est volontairement pas destiné à être indexé par les moteurs de
recherche (calendrier personnel) : `public/robots.txt` (`Disallow: /`), une
balise `<meta name="robots" content="noindex, nofollow, noarchive">` sur la
page d'accueil, et l'en-tête `X-Robots-Tag` envoyé par Caddy pour tout le
site (y compris `edt.ics`, qui n'a pas de balise `<meta>` puisque ce n'est
pas du HTML) - trois couches redondantes plutôt qu'une seule, en plus du
chemin secret déjà en place.

### Charte graphique UVSQ

Toutes les pages statiques (page d'accueil, inscription, confidentialité,
404) suivent la charte graphique de l'**UVSQ**, calée à la fois sur leur
charte graphique PDF (couleurs, typographie) et sur le rendu réel de
[uvsq.fr](https://www.uvsq.fr) (mise en page, usage effectif des couleurs -
assez différent des gabarits internes PowerPoint/newsletters de leur charte) :

- Teal institutionnel `#0092BB` **en aplat** (jamais en dégradé - contrairement
  aux documents internes UVSQ, leur vrai site ne l'utilise qu'en couleur
  pleine) pour la barre d'en-tête des cartes, repris du bandeau des modules
  de leur page d'accueil.
- Pied de page en prune plein (`#69043C`) : c'est ainsi que leur vrai site
  signale l'affiliation à l'Université Paris-Saclay.
- En-tête pleine largeur avec logo en haut à gauche sur fond blanc, comme sur
  leur vrai site - sans aucun lien de navigation cliquable (ce service n'est
  pas un portail officiel de l'université).
- Thème clair forcé (`color-scheme: light`, pas de variante sombre) : leur
  vrai site n'a pas de mode sombre, en avoir un ici casserait la fidélité au
  rendu réel plutôt que de l'améliorer.
- Repli Century Gothic/Avenir Next pour Gotham (police propriétaire UVSQ,
  non incluse ici faute de licence).

## Licence

ISC
