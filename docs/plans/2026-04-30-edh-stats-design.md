# Design — EDH Stats

> Date : 2026-04-30
> Repo : https://github.com/julienmessagingme/edh
> Domaine prod : https://edh.messagingme.app
> Statut : design validé, plan d'implémentation à produire

---

## 1. Contexte & objectif

EDH est un client de MessagingMe. On lui livre une interface web interne avec deux fonctions :

1. **URLs trackées pour templates WhatsApp** — créer des URLs courtes server-side qui redirigent vers des destinations configurables, et compter chaque clic. Les URLs courtes sont intégrées aux templates WhatsApp (validés Meta), elles **ne doivent jamais bouger** une fois créées.
2. **Pilotage des stats** — récupérer chaque jour les custom events MessagingMe via leur API, afficher leur volumétrie quotidienne, et les comparer avec les clics URL pour calculer des taux (exemple : `clics template_CESINE / envois whatsapp_envoyé_promo`).

Une seule app, un seul container Docker, sur le VPS OVH `146.59.233.252`.

---

## 2. Décisions de cadrage

| Sujet | Choix |
|-------|-------|
| Multi-écoles | 9 écoles (1 bearer token par école) — UI sidebar gauche listant les écoles, contexte d'école sélectionnée filtre URLs et Stats. Liste : EFAP, 3WA, Brassart, CESINE, EJF, ESEC, École Bleue, ICART, IFA |
| Stockage écoles + tokens | Env vars (`MM_TOKEN_EFAP`, `MM_TOKEN_3WA`, …) + constante `SCHOOLS` dans le code. Ajout d'école = redeploy. |
| Création d'URLs | À la demande (pas de pool pré-généré), scopée à l'école sélectionnée |
| Slug | Aléatoire 8 chars (nanoid) — global unique, le nom est un label libre, non unique |
| Comptage clics | 1 row par clic avec timestamp + IP + user-agent + referer |
| Auth | 2 utilisateurs (Julien + EDH), même droits, accès aux 10 écoles, email + password bcrypt |
| Hébergement | Docker sur VPS, derrière NPM existant, sous `edh.messagingme.app` |
| Versioning destination | Quand on change la destination, nouvelle version créée — historique des clics par version conservé |
| Mapping URL ↔ custom event | Sélection libre dans l'UI stats (pas de mapping en base), au sein de la même école |
| Cron sync messagingme | 22:00 Europe/Paris, séquentiel sur les 10 écoles, `node-cron` dans le process Next.js |
| Stack | Next.js 15 App Router, Tailwind 4 + shadcn, Supabase (REST), bcrypt + jose |
| DNS | A record `edh` → `146.59.233.252` (proxied Cloudflare, cohérent avec `mieuxassure`) |

---

## 3. Architecture

```
┌─────────────────────────┐    ┌──────────────────────┐
│   VPS OVH 146.59.233    │    │   Supabase EU        │
│                         │    │   "EDH Stats"        │
│  NPM (Docker, déjà là)  │    │                      │
│   ↓ reverse proxy       │    │  Postgres + REST     │
│  edh.messagingme.app    │    │                      │
│   ↓                     │───▶│  - users             │
│  edh-app (Docker)       │    │  - redirect_events   │
│   - Next.js 15 standalone│    │  - redirect_versions │
│   - /r/<slug> redirect   │    │  - clicks            │
│   - /app UI (auth)       │    │  - mm_events         │
│   - /api/cron (interne)  │    │  - mm_occurrences    │
│   - node-cron 22:00 P.   │    │  - mm_sync_state     │
└─────────────────────────┘    └──────────────────────┘
                                          ▲
                                          │
                  ┌───────────────────────┘
                  │
         ┌────────┴───────────────┐
         │ ai.messagingme.app/api │
         │ /flow/custom-events    │
         │ /flow/custom-events/   │
         │   data                 │
         └────────────────────────┘
```

**Surface publique** :
- `/r/<slug>` — redirect 302 (pas d'auth)
- Tout le reste — auth-gated

**Réseau** : `edh-app` rejoint le réseau Docker existant de NPM pour que NPM puisse proxy `edh.messagingme.app` → `http://edh-app:3000`.

---

## 4. Stack

| Couche | Choix |
|--------|-------|
| Framework | Next.js 15 App Router (`output: 'standalone'`) |
| Runtime | Node 22 LTS |
| UI | Tailwind 4 + shadcn/ui (accordéons, date pickers, dialogs) |
| Charts | Recharts 3 |
| Auth | `bcryptjs` + `jose` (JWT HS256, cookie `edh_session`, TTL 7j) |
| DB | Supabase (Postgres 17), client `@supabase/supabase-js` v2 service-role |
| Validation | `zod` v4 |
| Cron | `node-cron` interne au process Next.js |
| Slug | `nanoid` (8 chars, alphabet sans ambigu) |
| Date | `date-fns` v4 + `date-fns-tz` (locale `fr`) |
| Container | `node:22-alpine` multi-stage |
| Reverse proxy | Nginx Proxy Manager existant sur VPS |

---

## 5. Schéma DB

**Note multi-écoles** : la liste des écoles n'est PAS en DB (env-driven). Mais chaque row liée à une école porte un `school_slug text not null` (ex: `"efap"`, `"iscom"`) servant de discriminant. L'app valide à l'écriture que `school_slug` ∈ `SCHOOLS` (constante code).

```sql
users
  id              uuid PK default gen_random_uuid()
  email           text unique not null
  password_hash   text not null
  name            text
  created_at      timestamptz default now()

redirect_events
  id              uuid PK
  school_slug     text not null              -- école propriétaire
  slug            text unique not null       -- global unique (l'URL /r/<slug> est cross-école)
  name            text not null              -- ex: "template_CESINE"
  created_by      uuid FK users
  created_at      timestamptz default now()
  archived_at     timestamptz

redirect_versions
  id              uuid PK
  event_id        uuid FK redirect_events
  destination_url text not null
  version         int not null
  active_from     timestamptz default now()
  active_to       timestamptz
  -- index partial unique : (event_id) WHERE active_to IS NULL

clicks
  id              uuid PK
  event_id        uuid FK redirect_events
  version_id      uuid FK redirect_versions
  clicked_at      timestamptz default now()
  ip              inet
  user_agent      text
  referer         text
  country         text

mm_events
  event_ns        text not null              -- ID messagingme (ex: "f257795ev111183")
  school_slug     text not null              -- école propriétaire
  name            text not null
  description     text
  text_label      text
  price_label     text
  number_label    text
  last_synced_at  timestamptz
  -- PK composite (school_slug, event_ns) car un event_ns pourrait théoriquement
  -- collider entre instances messagingme

mm_occurrences
  id              bigint not null            -- id messagingme
  school_slug     text not null
  event_ns        text not null
  user_ns         text
  text_value      text
  price_value     numeric
  number_value    numeric
  occurred_at     timestamptz
  -- PK composite (school_slug, id)
  -- FK (school_slug, event_ns) → mm_events

mm_sync_state
  school_slug         text not null
  event_ns            text not null
  last_occurrence_id  bigint
  last_run_at         timestamptz
  last_run_status     text                   -- 'success' | 'error'
  last_run_error      text
  -- PK composite (school_slug, event_ns)
```

**Index** :
- `redirect_events(school_slug, archived_at)` — liste de l'école courante
- `clicks(event_id, clicked_at)` — histogramme par event
- `mm_occurrences(school_slug, event_ns, occurred_at)` — histogramme par event de l'école
- `redirect_versions(event_id) WHERE active_to IS NULL` (partial unique)

**Pas de RLS.** Service-role server-side uniquement. Le filtrage par `school_slug` est appliqué côté app dans toutes les queries.

---

## 6. Layout général + sélection d'école

```
┌─────────────────────────────────────────────────────────────┐
│  EDH Stats                          julien@... [↪ Se déco]  │
├─────────────┬───────────────────────────────────────────────┤
│ Écoles      │  [URLs] [Stats]                               │
│             │                                               │
│ • EFAP   ●  │   ... contenu de l'école sélectionnée         │
│ • ISCOM     │                                               │
│ • ICART     │                                               │
│ • SUP'DE.   │                                               │
│ • IFAG      │                                               │
│ • ESDAC     │                                               │
│ • ...       │                                               │
│             │                                               │
└─────────────┴───────────────────────────────────────────────┘
```

- Sidebar gauche fixe (~200 px), liste des 10 écoles depuis la constante `SCHOOLS` (importée depuis env vars au boot).
- École sélectionnée surlignée + persistée en cookie `edh_school` (1 an).
- Default école au premier login = première de la liste (`EFAP`).
- Toutes les pages auth-gated (`URLs`, `Stats`) sont scopées par cette sélection.
- Cliquer une école → `router.push('/?school=<slug>')` ou simplement update du cookie + reload du contenu.
- L'URL `/r/<slug>` (redirect public) est **cross-école** : un slug est unique globalement, peu importe quelle école l'a créé.

---

## 7. Onglet 1 — Pilotage des URLs

**Liste de cards** : pour chaque event non archivé **de l'école courante**, affichage du nom, slug, URL courte, destination courante (avec n° de version), total clics, dernier clic.

**Création** : modal `+ Nouvel événement` → champs `Nom` + `Destination URL` (zod validation http/https) → `POST /api/events` (l'école courante est lue depuis le cookie côté serveur) génère slug nanoid, insert event + version v1 avec `school_slug` = école courante.

**Modifier la destination** : modal → `POST /api/events/:id/versions` → ferme version courante (`active_to = now()`), insère v+1. Le slug est immuable.

**Historique versions** : modal liste v1, v2, … avec dates et compteur de clics par version.

**Archiver** : `archived_at = now()` — disparaît de la liste, redirect continue de marcher (un template Meta peut être encore actif).

**Endpoint redirect public** `GET /r/:slug` :

1. Lookup event par slug (cache mémoire 60s, key = slug).
2. Lookup version active.
3. Insert click **non bloquant** (`Promise.resolve().then(...)` après le redirect).
4. `302 Found` vers `destination_url`.

Latence cible : <50ms.

**Sécurité redirect** :
- Validation stricte URL à la création (zod, scheme http/https, pas de `javascript:`).
- Rate-limit en mémoire : 100 hits/IP/minute → 429 si dépassé.

---

## 8. Onglet 2 — Stats

**Sélecteur de période** en haut : 2 date pickers + presets 7j / 30j / 90j. Default = 30 derniers jours.

**Liste accordéons** triée par nom des `mm_events` **de l'école courante**. En-tête fermé : nom + total occurrences sur la période.

**Quand on ouvre un accordéon** :
- Histogramme journalier (BarChart) des occurrences en Europe/Paris.
- Dropdown "Comparer avec…" listant tous les `redirect_events` non archivés **de l'école courante**.
- Quand une URL est sélectionnée :
  - BarChart 2 séries (occurrences + clics) côte-à-côte.
  - LineChart du ratio quotidien `clics / occurrences`.
  - Bandeau résumé : taux global (somme/somme), taux moyen quotidien (moyenne des ratios journaliers, jours à 0 dénominateur ignorés).

**Ratio edge case** : `occurrences=0 & clicks>0` → afficher `—` (pas Infinity).

**Bouton "⟳ Re-sync"** → `POST /api/cron/sync` (auth Bearer interne) pour forcer un sync hors de 22:00.

**Endpoints** (l'école courante est lue depuis le cookie côté serveur) :
- `GET /api/stats/custom-events?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/stats/custom-events/:event_ns/daily?from=...&to=...`
- `GET /api/stats/clicks/:event_id/daily?from=...&to=...`
- `POST /api/cron/sync` — relance manuelle, sync les 10 écoles séquentiellement

**Buckets en Europe/Paris** : une occurrence à 23h UTC le 14 avril compte pour le 15 avril.

---

## 9. Cron sync messagingme (10 écoles)

**Schedule** : `0 22 * * *` Europe/Paris, dans le process Next.js via `node-cron`. Bootstrap dans `src/instrumentation.ts` (Next 15).

**Algorithme `syncAllSchools()`** :

```
for school of SCHOOLS:                       # séquentiel (10 écoles)
  try:
    syncSchool(school)                        # token = school.bearerToken (env)
  catch err:
    log err pour cette école, continue
```

**`syncSchool(school)`** :

1. Refresh `mm_events` pour cette école :
   - GET `/api/flow/custom-events` avec Bearer = token école (paginer si > 1 page).
   - Upsert chaque event sur `(school_slug, event_ns)`.
2. Pour chaque event de cette école :
   - Lire `mm_sync_state.last_occurrence_id` (NULL au premier run).
   - GET `/api/flow/custom-events/data?event_ns=X&page=N` (du plus récent au plus ancien).
   - Insérer les rows avec `id > last_occurrence_id` et `school_slug = school.slug`. Stop dès qu'on tombe sur `id <= last_occurrence_id`.
   - Update `mm_sync_state` : `last_occurrence_id = max(id ingéré)`, `last_run_at = now()`, `last_run_status = 'success'`.
3. En cas d'erreur sur un event : log dans `mm_sync_state.last_run_error`, continue avec les autres events de la même école.

**Trigger manuel** : `POST /api/cron/sync` avec header `Authorization: Bearer ${INTERNAL_API_KEY}` → exécute le même `syncAllSchools()`. Optionnel : query param `?school=efap` pour ne sync qu'une école.

**Premier run** : ingest complet de toutes les écoles. Si chaque école a ~4 events × ~84 pages ≈ 1-2 min, total ≈ 10-20 min. OK pour un one-shot.

**Retry** : 2 retries avec backoff sur 5xx + timeouts, fail-fast sur 4xx.

---

## 10. Auth

- `/login` (UI) → `POST /api/auth/login` → bcrypt.compare → cookie `edh_session` JWT HS256 signé `AUTH_SECRET`, TTL 7j.
- `POST /api/auth/logout` → clear cookie.
- **Middleware Edge** (`src/middleware.ts`) : redirect `/login` si pas de cookie valide, sauf `/login`, `/r/*`, `/api/auth/*`.
- **Pas de signup UI**. 2 users seedés via SQL one-shot (script `scripts/seed-users.ts` qui hash + INSERT).

---

## 11. Variables d'environnement

| Variable | Usage |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server |
| `SUPABASE_SERVICE_ROLE_KEY` | server only |
| `AUTH_SECRET` | JWT signing, 64 chars hex |
| `MESSAGINGME_API_BASE` | `https://ai.messagingme.app/api` |
| `MM_TOKEN_EFAP` | Bearer EFAP (déjà connu) |
| `MM_TOKEN_ISCOM` | Bearer ISCOM |
| `MM_TOKEN_ICART` | Bearer ICART |
| `MM_TOKEN_<…>` | 7 autres écoles (à fournir) |
| `INTERNAL_API_KEY` | Bearer pour `/api/cron/sync` manuel |
| `CRON_TIMEZONE` | `Europe/Paris` |
| `PUBLIC_BASE_URL` | `https://edh.messagingme.app` |

**Constante `SCHOOLS`** dans `src/lib/schools.ts` :

```ts
export const SCHOOLS = [
  { slug: "efap",   name: "EFAP",   tokenEnv: "MM_TOKEN_EFAP" },
  { slug: "iscom",  name: "ISCOM",  tokenEnv: "MM_TOKEN_ISCOM" },
  // ... 8 autres
] as const;

export type SchoolSlug = (typeof SCHOOLS)[number]["slug"];
```

Au boot, on vérifie que toutes les `tokenEnv` sont définies, sinon on log un warning (l'école sera sautée par le cron mais l'app continuera de tourner pour les écoles configurées).

`.env.example` versionné. En prod : fichier `.env` lu par `docker compose` (`env_file`).

---

## 12. Tests & gestion d'erreurs

**Tests (vitest)** :
- API `/r/:slug` : 302 OK, slug introuvable, archivé, sans version active, insert click correct.
- API `/api/events` (POST) : crée event + v1, slug unique.
- API `/api/events/:id/versions` (POST) : ferme courante, crée v+1, refuse URL invalide.
- API `/api/auth/login` : succès, mauvais password, email inexistant.
- Cron : mock fetch messagingme, vérifie watermark incremental.
- **Pas de tests UI**. Validation manuelle avant deploy.

**Gestion d'erreurs** :

| Surface | Stratégie |
|---------|-----------|
| `/r/:slug` redirect | DB down → 503 ; slug not found → 404 ; jamais de 500 leak |
| Insert click | Try/catch, log, **ne bloque pas le redirect** |
| Cron sync | Try/catch par event_ns, autres events continuent ; erreur loggée + visible UI |
| Appels messagingme | 2 retries backoff sur 5xx/timeouts ; fail-fast 4xx |
| UI fetch | Toast erreur, pas de crash de page |

**Logs** : `console.log` JSON structuré. `docker logs edh-app` pour debug. Pas d'APM/Sentry au démarrage.

---

## 13. Déploiement

**Structure repo** :

```
.
├─ Dockerfile                    multi-stage : deps → builder → runner alpine
├─ docker-compose.yml            1 service edh-app, expose 3000, env_file, network NPM
├─ .env.example
├─ src/
│   ├─ app/
│   │   ├─ (app)/                routes auth-gated (URLs, Stats)
│   │   ├─ login/
│   │   ├─ r/[slug]/route.ts     redirect public
│   │   └─ api/
│   │       ├─ auth/
│   │       ├─ events/
│   │       ├─ stats/
│   │       └─ cron/sync/
│   ├─ lib/
│   │   ├─ supabase/
│   │   ├─ auth/
│   │   ├─ cron/
│   │   └─ messagingme/
│   ├─ middleware.ts
│   └─ instrumentation.ts        bootstrap node-cron
├─ supabase/
│   └─ migrations/
│       ├─ 001_init.sql
│       └─ 002_seed_users.sql    appliquée à la main
└─ scripts/
    └─ seed-users.ts             bcrypt hash + INSERT
```

**Workflow** :

1. Push `origin main` depuis `C:\Users\julie\EDH`.
2. SSH VPS → `cd /root/edh && git pull && docker compose up -d --build`.
3. Logs : `docker logs -f edh-app`.

**DNS Cloudflare** : A record `edh` → `146.59.233.252`, proxied (orange cloud) — cohérent avec `mieuxassure`.

**NPM proxy host** : `edh.messagingme.app` → `http://edh-app:3000`. HTTPS Let's Encrypt automatique côté NPM. Config inspirée du proxy host `mieuxassure` (sans le bloc SSO `auth_request`).

---

## 14. Convention docs projet (5 fichiers, suit CLAUDE.md global)

| Fichier | Contenu |
|---------|---------|
| `CLAUDE.md` | But en 2 lignes, commandes essentielles (dev, build, deploy), workflow VPS, liens vers les 4 autres |
| `documentation.md` | Archi, stack, schéma DB, env vars, déploiement, patterns code |
| `features.md` | Vue produit : "URLs trackées", "Stats avec comparaison", côté utilisateur |
| `wip.md` | Vide au démarrage |
| `todo.md` | Backlog : RGPD (hash IP), retention clicks, export CSV, mobile, etc. |

**Workflow git** (suit CLAUDE.md global) :
- Tout sur `main`, push `origin main`, jamais de branche `claude/*`, jamais de worktree.
- Main worktree = `C:\Users\julie\EDH`. Chaque Bash call qui touche le repo préfixé par `cd /c/Users/julie/EDH &&`.

---

## 15. Hors scope (pour un V2 si besoin)

- Hash IP RGPD-strict (actuellement IP en clair, outil interne).
- Retention policy `clicks` (purge > 1 an).
- Export CSV des clics.
- Multi-tenant (autres clients que EDH).
- Geo-IP enrichment (`country` reste vide pour l'instant).
- A/B testing destinations.
- Webhook side du redirect (notifier un autre service à chaque clic).
