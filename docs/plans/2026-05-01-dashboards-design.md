# Design — Module "Mes tableaux" (custom dashboards)

**Date :** 2026-05-01
**Statut :** validé, prêt pour implémentation

## Vision

Troisième sous-onglet de Stats : `URLs / Stats / Mes tableaux`. Chaque user UI (Kelberg, Hassani, …) construit ses propres tableaux de pilotage, persistés en DB, rattachés à une école.

V1 = un seul type de report : **funnel**. L'user choisit N custom events / clics URL, les ordonne en drag-and-drop, et voit un bar chart horizontal décroissant avec les volumes et les conversions entre étapes.

Pas de matching utilisateur : les funnels comparent des **volumes purs** d'occurrences sur la même période. C'est un view esthétique de N nombres, pas une analyse causale.

## Décisions de cadrage

| # | Décision | Choix |
|---|---|---|
| 1 | Sémantique funnel | Volumes purs, pas de matching `user_ns` |
| 2 | Scope | Par école (un dashboard est rattaché à une école) |
| 3 | Visibilité | Strictement privé (`created_by = me`, jamais partagé) |
| 4 | Étapes éligibles | Custom events MM **+** clics URL |
| 5 | Persistance | DB Supabase, retrouvée d'une session à l'autre |
| 6 | Drag-and-drop | `@dnd-kit/core` + `@dnd-kit/sortable` |
| 7 | Visualisation | Bar chart recharts horizontal (`layout="vertical"`) + table récap |
| 8 | Sauvegarde | Auto-save debounced 500ms, toast discret |

## Architecture

### Routing

- `/dashboards` (liste) et `/dashboards/[id]` (builder + viewer) — sœurs de `/urls` et `/stats`, pas nichées.
- `sub-nav-stats.tsx` passe à 3 entrées : URLs, Stats, Mes tableaux.

### DB — migration `004_dashboards.sql`

```sql
CREATE TABLE dashboards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_slug text NOT NULL,
  created_by  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  type        text NOT NULL DEFAULT 'funnel' CHECK (type IN ('funnel')),
  date_preset text NOT NULL DEFAULT '30d'
              CHECK (date_preset IN ('7d','30d','90d','custom')),
  date_from   date,
  date_to     date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_dashboards_user_school
  ON dashboards (created_by, school_slug, updated_at DESC);

CREATE TABLE dashboard_steps (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id      uuid NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  position          int  NOT NULL,
  step_type         text NOT NULL CHECK (step_type IN ('mm_event','url_click')),
  event_ns          text,
  redirect_event_id uuid REFERENCES redirect_events(id) ON DELETE CASCADE,
  CONSTRAINT one_ref CHECK (
    (step_type='mm_event'  AND event_ns IS NOT NULL AND redirect_event_id IS NULL)
 OR (step_type='url_click' AND event_ns IS NULL    AND redirect_event_id IS NOT NULL)
  ),
  UNIQUE (dashboard_id, position)
);

CREATE INDEX idx_dashboard_steps_dashboard
  ON dashboard_steps (dashboard_id, position);
```

Notes :

- `type` extensible (CHECK élargi quand on ajoute d'autres types de report).
- Pas de FK `mm_events(school_slug, event_ns)` : un mm_event peut disparaître côté messagingme, on gère côté UI (étape grisée), pas en cascade DB.
- FK `redirect_event_id ON DELETE CASCADE` : si l'event redirect est supprimé, l'étape disparaît automatiquement.
- Migration appliquée à la main via Supabase SQL Editor (cohérent avec le projet).

### API

| Route | Méthode | Rôle |
|---|---|---|
| `/api/dashboards` | GET | Liste les dashboards de `created_by = me, school_slug = current` |
| `/api/dashboards` | POST | Crée un dashboard (`{name}`), renvoie l'id |
| `/api/dashboards/[id]` | GET | Renvoie dashboard + steps ordonnés par position |
| `/api/dashboards/[id]` | PATCH | Update partiel : `name?`, `date_preset?`, `date_from?`, `date_to?`, `steps?` (array atomique, position dérivée de l'index) |
| `/api/dashboards/[id]` | DELETE | Supprime |
| `/api/dashboards/[id]/data` | GET | Calcule les volumes pour la période courante |

**Auth** : toutes les routes appellent `requireUser()` puis check `dashboard.created_by = me AND school_slug = currentSchool`. Si mismatch : 404 (pas 403, pour ne pas leak l'existence d'un dashboard d'un autre user/école).

**Validation Zod** sur PATCH : `name` (1-200 chars), `date_preset` enum, `date_from/to` date strings ISO si preset = 'custom', `steps` array de discriminated union.

**Calcul `/data`** :

1. Lire dashboard + steps.
2. Résoudre `date_from`/`date_to` : si preset = '7d'/'30d'/'90d' → today − N+1 jours → today ; si 'custom' → valeurs stockées.
3. Pour chaque step en parallèle (`Promise.all`) :
   - `mm_event` : `SELECT count(*) FROM mm_occurrences WHERE school_slug=$1 AND event_ns=$2 AND occurred_at >= $from AND occurred_at < $to+1day`
   - `url_click` : `SELECT count(*) FROM clicks WHERE event_id=$1 AND clicked_at >= $from AND clicked_at < $to+1day`
4. Renvoyer `{steps: [{position, label, type, count, available: true|false}, …]}`. Le front calcule les conversions.

Si un step référence un `event_ns` qui n'existe plus dans `mm_events` (ou un `redirect_event_id` qui n'existe plus) : `available: false, count: 0`, label = ce qui était stocké au moment de l'ajout (à conserver dans la table ? non — on lookup au render et fallback sur `"(indisponible)"` ; on accepte le cas dégradé).

## UX builder

### Layout `/dashboards/[id]`

- **Top** : nom (édition inline), date pickers (presets 7j/30j/90j + custom from/to identique à l'onglet Stats), bouton Supprimer.
- **Body gauche (palette ~240px)** : 2 sections empilées scrollables.
  - "Custom events MM" (liste de `mm_events` triés alpha)
  - "Clics URL" (liste de `redirect_events` non archivés triés alpha)
  - Chaque item : draggable + clic = ajoute en fin du funnel.
- **Body droit (zone funnel)** : liste verticale ordonnée des étapes choisies, drag-to-reorder, ✕ par étape. Empty state : "Glissez un custom event ou un clic URL ici".
- **Bottom** : `BarChart` recharts horizontal (barres décroissantes) + table récap.

### Drag-and-drop

`@dnd-kit/core` + `@dnd-kit/sortable`. Deux contextes :

- Palette (drag source uniquement, items draggable mais non sortable)
- Zone funnel (drop target + sortable interne)

Drag entre les deux : au drop dans la zone funnel, l'item est ajouté à la position où il a été lâché. Drag interne à la zone funnel : reorder.

### Sauvegarde

Auto-save debounced 500ms. Chaque modif (rename, reorder, add/remove step, change date) déclenche un `PATCH /api/dashboards/[id]` ; toast discret "Enregistré" bas-droit. Pas de bouton "Save" explicite.

### Doublons

V1 KISS : on autorise le même event à plusieurs positions. Pas de check côté serveur ni client.

### Source supprimée

Étape grisée, badge "indisponible", count = 0, tooltip "Cet event n'existe plus pour cette école".

### Limite d'étapes

Pas de plafond strict ; au-delà de ~12 le chart devient illisible mais on laisse passer.

### Switch d'école

Pattern `key={schoolSlug}` sur les pages `/dashboards` et `/dashboards/[id]` (cohérent avec le fix du commit `140baa3`). Si l'user est sur `/dashboards/[id]` et que ce dashboard appartient à une autre école : 404 → redirect vers `/dashboards`.

## Visualisation

- `BarChart` recharts, `layout="vertical"`. Ordre = ordre des steps.
- Couleurs : dégradé d'une teinte (zinc 900 → zinc 400) pour signaler la décroissance.
- Labels au-dessus de chaque barre : nom de l'étape ; à droite : volume + `(−X%)` vs précédent.
- Sous le chart : table dense 4 colonnes (étape, volume, conv. vs précédent, conv. vs étape 1).
- Loading : "Chargement…". Empty (0 étapes) : "Ajoutez au moins une étape". Erreur : "Impossible de charger les données".

## Cas limites & sécurité

- École sans aucun mm_event ni URL : palette vide → message "Aucun event disponible pour cette école".
- 0 étapes : pas de chart, juste l'invite vide.
- 1 étape : chart à 1 barre, pas de colonne conversion.
- Tableau d'un autre user / d'une autre école → 404.
- Service-role server-side uniquement, jamais d'accès DB depuis le client (cohérent projet).

## Tests

- **API** : les 6 routes — auth, ownership (404 sur dashboard d'un autre user), school scope (404 sur autre école), validation Zod, calcul `/data` avec un seed de `mm_occurrences` + `clicks`.
- **UI** : pas de tests (cohérent avec `tests/` actuel — uniquement API).

## Hors scope V1

- D'autres types de report (autre que funnel)
- Partage entre users (lecture seule par défaut)
- Export PDF/CSV
- Comparaison de périodes (ex : 30j vs 30j précédents)
- Embed / lien public
- Limite stricte de N étapes
- Re-saisie du label au moment de l'ajout d'un step (pour résister à la suppression de la source)
