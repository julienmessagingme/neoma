# Mes tableaux — Étapes cumulées (multi-refs) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Étendre le module Mes tableaux (livré le 2026-05-01) pour qu'une étape de funnel puisse contenir **plusieurs refs** (mm_event + url_click mixés), dont les volumes sont **sommés** pour donner le volume de l'étape. Permet des rapports cumulés type `Relances V1 + V2 + V3 → Engagement → Conversion`.

**Architecture :** Sous-table `dashboard_step_refs` séparée de `dashboard_steps`. Migration 005 destructive (0 dashboards en prod au moment de l'écriture). API PATCH revoit son Zod schema (refs[] dans chaque step). UI builder : un step devient un "groupe" avec label éditable, chips empilés pour chaque ref, drop-onto-step pour ajouter une ref à un step existant, drop entre deux steps pour créer un nouveau step.

**Tech Stack :** Inchangé (Next.js 15, Supabase, Zod, @dnd-kit, recharts).

**Reference design :** Décisions validées 2026-05-01 :
- Schéma A (sous-table dédiée)
- Label étape éditable, fallback `A + B + C`
- Mix mm + URL autorisé dans une étape
- UX cumul : drag-onto-step + bouton `+ Ajouter` dans chaque étape
- Refs en chips empilés sous le label, ✕ par chip
- Étape `unavailable` seulement si **toutes** ses refs disparues, sinon somme des disponibles

**Workspace :** Main worktree `C:\Users\julie\EDH\`. Chaque Bash call qui touche le repo : `cd /c/Users/julie/EDH && ...`.

**Git identity :**
```bash
git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "..."
```

**Phases :**
0. Migration 005 (sous-table + drop colonnes + label) + types TS
1. API GET + PATCH multi-refs + tests
2. API /data agrégation + tests
3. UI builder : steps avec label éditable + chips refs + drop-onto-step + bouton `+ Ajouter`
4. Polish (UX vide d'étape, tests, build/lint clean)
5. Deploy + smoke

---

## Phase 0 — Migration 005 + types TS

### Task 0.1 : Migration SQL 005

**Files :** Create `supabase/migrations/005_dashboard_step_refs.sql`

**Contenu :**

```sql
-- 005_dashboard_step_refs.sql — Multi-refs par step (cumul)
-- Apply via: Supabase SQL Editor → paste this whole file → Run.
--
-- Restructure dashboard_steps : un step n'a plus une seule ref (event_ns OU
-- redirect_event_id) mais une LISTE de refs stockées dans une sous-table
-- dashboard_step_refs. Le volume du step = somme des volumes de ses refs.
--
-- Migration destructive : suppose qu'il n'existe encore aucun dashboard en
-- prod (le module a été livré le 2026-05-01 sans utilisation préalable).
-- Le SELECT count(*) ci-dessous lèvera une erreur claire sinon. Si tu en
-- as déjà créé, dis-le et on fait une migration data-preserving.

-- Garde-fou : refuser la migration si des steps existent déjà.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM dashboard_steps LIMIT 1) THEN
    RAISE EXCEPTION 'Migration 005 destructive : des dashboard_steps existent déjà. Ne pas appliquer telle quelle.';
  END IF;
END $$;

BEGIN;

-- 1. Drop des colonnes ref + check obsolètes
ALTER TABLE dashboard_steps
  DROP CONSTRAINT IF EXISTS dashboard_steps_one_ref;
ALTER TABLE dashboard_steps DROP COLUMN IF EXISTS step_type;
ALTER TABLE dashboard_steps DROP COLUMN IF EXISTS event_ns;
ALTER TABLE dashboard_steps DROP COLUMN IF EXISTS redirect_event_id;

-- 2. Nouveau label optionnel (NULL = label auto-calculé "A + B + C" côté front)
ALTER TABLE dashboard_steps
  ADD COLUMN IF NOT EXISTS label text;

-- 3. Sous-table refs
CREATE TABLE IF NOT EXISTS dashboard_step_refs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id           uuid NOT NULL REFERENCES dashboard_steps(id) ON DELETE CASCADE,
  ref_position      int  NOT NULL,
  step_type         text NOT NULL CHECK (step_type IN ('mm_event','url_click')),
  event_ns          text,
  redirect_event_id uuid REFERENCES redirect_events(id) ON DELETE CASCADE,
  CONSTRAINT dashboard_step_refs_one_ref CHECK (
    (step_type = 'mm_event'  AND event_ns IS NOT NULL AND redirect_event_id IS NULL)
 OR (step_type = 'url_click' AND event_ns IS NULL    AND redirect_event_id IS NOT NULL)
  ),
  UNIQUE (step_id, ref_position)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_step_refs_step
  ON dashboard_step_refs (step_id, ref_position);

COMMIT;
```

**Steps :**

1. Écrire le fichier.
2. `cd /c/Users/julie/EDH && wc -l supabase/migrations/005_dashboard_step_refs.sql` — attendu ~50 lignes.
3. Appliquer via Supabase SQL Editor (validation explicite par l'user vu le caractère destructif).
4. Vérifier :
   ```sql
   SELECT column_name FROM information_schema.columns
   WHERE table_name = 'dashboard_steps' ORDER BY ordinal_position;
   -- Attendu : id, dashboard_id, position, label

   SELECT table_name FROM information_schema.tables
   WHERE table_schema='public' AND table_name = 'dashboard_step_refs';
   -- Attendu : 1 ligne
   ```
5. Commit :
   ```bash
   cd /c/Users/julie/EDH && git add supabase/migrations/005_dashboard_step_refs.sql && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(db): migration 005 — dashboard_step_refs (cumul de refs par step)"
   ```

### Task 0.2 : Update types TS

**Files :** Modify `src/lib/dashboards/types.ts`

**Step 1 :** Remplacer `DashboardStep` :

```ts
export interface StepRef {
  id: string;
  ref_position: number;
  step_type: StepType;
  event_ns: string | null;
  redirect_event_id: string | null;
}

export interface DashboardStep {
  id: string;
  position: number;
  label: string | null;     // NULL => fallback auto "A + B + C" côté UI
  refs: StepRef[];
}
```

**Step 2 :** Update `ComputedStep` :

```ts
export interface ComputedRef {
  step_type: StepType;
  ref_id: string;
  label: string;
  count: number;
  available: boolean;
}

export interface ComputedStep {
  position: number;
  label: string;            // résolu côté API (le label stocké, ou fallback)
  count: number;            // somme des refs disponibles
  available: boolean;       // false ssi toutes les refs sont unavailable
  refs: ComputedRef[];
}
```

**Step 3 :** Commit :
```bash
cd /c/Users/julie/EDH && git add src/lib/dashboards/types.ts && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(dashboards): types DashboardStep multi-refs + ComputedStep agrégé"
```

---

## Phase 1 — API GET + PATCH multi-refs + tests

### Task 1.1 : Update GET /api/dashboards/[id]

**Files :** Modify `src/app/api/dashboards/[id]/route.ts`

**Step 1 :** Au lieu d'un seul SELECT sur `dashboard_steps`, en faire 2 (steps + refs) en parallèle, puis grouper côté Node :

```ts
const [dashRes, stepsRes, refsRes] = await Promise.all([
  sb.from("dashboards").select(/* … */).eq("id", id).single(),
  sb.from("dashboard_steps")
    .select("id, position, label")
    .eq("dashboard_id", id)
    .order("position"),
  sb.from("dashboard_step_refs")
    .select("id, step_id, ref_position, step_type, event_ns, redirect_event_id")
    .in("step_id",
        // sub-select sur les steps de ce dashboard
        // ou : refetch après stepsRes pour utiliser les ids
    )
]);
```

Plus simple : fetch les steps d'abord, puis fetch les refs en utilisant `IN (step_ids)`. 2 round-trips séquentielles, OK pour V1.

**Step 2 :** Map dans la forme `DashboardStep` avec `refs: StepRef[]` triées par `ref_position`.

**Step 3 :** Update test `tests/api/dashboards/by-id.test.ts` — adapter le mock pour 3 tables (`dashboards`, `dashboard_steps`, `dashboard_step_refs`).

**Step 4 :** Run tests, vérifier pass. Commit.

### Task 1.2 : Update PATCH /api/dashboards/[id]

**Step 1 :** Nouveau Zod schema :

```ts
const RefSchema = z.discriminatedUnion("step_type", [
  z.object({
    step_type: z.literal("mm_event"),
    event_ns: z.string().min(1),
  }),
  z.object({
    step_type: z.literal("url_click"),
    redirect_event_id: z.string().uuid(),
  }),
]);
const StepSchema = z.object({
  label: z.string().trim().max(200).nullable().optional(),
  refs: z.array(RefSchema).min(1).max(20),
});
const PatchBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    date_preset: z.enum(["7d", "30d", "90d", "custom"]).optional(),
    date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    steps: z.array(StepSchema).max(50).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "empty patch");
```

**Step 2 :** Quand `steps` est présent, atomic replace :
1. DELETE all `dashboard_step_refs` where `step_id IN (steps of this dashboard)` — cascade depuis le delete des steps
2. DELETE all `dashboard_steps` where `dashboard_id = id`
3. Pour chaque step en entrée : INSERT dashboard_steps → récupère son id → INSERT dashboard_step_refs en batch

**Step 3 :** Update tests. Couvrir : step avec 1 ref, step avec 3 refs, label custom, label NULL.

**Step 4 :** Run tests, commit :
```bash
cd /c/Users/julie/EDH && git add src/app/api/dashboards/\[id\]/route.ts tests/api/dashboards/by-id.test.ts && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(api): GET/PATCH /api/dashboards/[id] multi-refs par step + tests"
```

---

## Phase 2 — API /data agrégation + tests

### Task 2.1 : Update GET /api/dashboards/[id]/data

**Files :** Modify `src/app/api/dashboards/[id]/data/route.ts`

**Step 1 :** Charger steps + refs via 2 SELECT (réutilise les mêmes queries que GET).

**Step 2 :** Pour chaque step :
- Pour chaque ref, calculer son count comme avant (mm_occurrences ou clicks).
- `step.count = Σ refs.filter(available).count`
- `step.available = refs.some(r => r.available)`
- `step.label = stored_label ?? refs.map(r => r.label).join(" + ")`
- Inclure les ref details dans la réponse (le front peut vouloir afficher le breakdown au hover).

**Step 3 :** Réponse :
```json
{
  "from": "...",
  "to": "...",
  "steps": [
    {
      "position": 0,
      "label": "Relances",
      "count": 1530,
      "available": true,
      "refs": [
        { "step_type": "mm_event", "ref_id": "evt_a", "label": "Relance V1", "count": 1000, "available": true },
        { "step_type": "mm_event", "ref_id": "evt_b", "label": "Relance V2", "count": 500, "available": true },
        { "step_type": "url_click", "ref_id": "uuid-…", "label": "(indisponible)", "count": 0, "available": false }
      ]
    }
  ]
}
```

**Step 4 :** Update `tests/api/dashboards/data.test.ts` — adapter le mock + ajouter cas "step à 3 refs dont 1 indisponible → count = somme des 2, available = true".

**Step 5 :** Run tests, commit.

---

## Phase 3 — UI builder : steps avec label + chips refs

### Task 3.1 : SortableStep devient SortableStepGroup

**Files :** Modify `src/app/(app)/dashboards/[id]/builder-client.tsx`

**Changements :**

- `SortableStep` → `SortableStepGroup` ; chaque step affiche :
  - Drag handle (gauche)
  - Numéro `1.`
  - Champ `<input>` pour le label (placeholder = fallback auto `A + B + C`)
  - Chips empilés en flexbox wrap : `<EventA ✕>` `<EventB ✕>` `<URLChip ✕>`
  - Bouton `+ Ajouter` à la fin des chips → mini-popover avec la liste palette
  - Badge `MM/URL` si toutes les refs sont du même type, `Mixte` sinon
  - `✕` à droite pour supprimer toute l'étape
- Drop-target : chaque step est aussi un drop target → on peut drag un palette item dessus pour l'ajouter aux refs.

**Step 1 :** Ajouter helper côté state :
```ts
function addRefToStep(stepIdx: number, p: PaletteItem) {
  setSteps((prev) => prev.map((s, i) =>
    i === stepIdx
      ? { ...s, refs: [...s.refs, { id: tmpId(), ref_position: s.refs.length, step_type: p.step_type, event_ns: p.step_type === "mm_event" ? p.ref_id : null, redirect_event_id: p.step_type === "url_click" ? p.ref_id : null }] }
      : s
  ));
}
function removeRefFromStep(stepIdx: number, refIdx: number) { /* … */ }
function setStepLabel(stepIdx: number, label: string) { /* … */ }
```

**Step 2 :** Refactor `handleDragEnd` :
- Si `over.id` est un step (pas STEPS_ZONE_ID) → ajouter la ref à ce step
- Si `over.id` est STEPS_ZONE_ID → créer un nouveau step avec la ref

**Step 3 :** Bouton `+ Ajouter` : popover avec la liste palette (filtrée pour ne pas inclure ce qui est déjà dans le step ? non, on autorise les doublons en V1). Click sur item → addRefToStep + close popover.

**Step 4 :** Update `lookupStep` pour résoudre le label : si `step.label` non vide → l'utiliser, sinon composer depuis les refs.

**Step 5 :** `pendingFromSteps` (ex `stepsToPending`) renvoie maintenant `{ label, refs: [{step_type, event_ns?, redirect_event_id?}] }[]`.

**Step 6 :** Build + dev test manuel : créer un step avec 3 refs, vérifier la sauvegarde. Commit.

### Task 3.2 : Visualisation refs dans FunnelChart + Table

**Files :** Modify `src/app/(app)/dashboards/[id]/funnel-chart.tsx`, `funnel-table.tsx`

**Step 1 :** `FunnelChart` lit `step.label` (déjà résolu par l'API), `step.count` (somme), `step.available`. Pas de changement majeur — juste valider que le label long affiche bien.

**Step 2 :** `FunnelTable` ajoute optionnellement une 5e colonne "Détail" qui affiche les refs en mini-liste avec leurs counts individuels. Ou un tooltip sur la ligne. Mon choix V1 : sous-ligne visible si > 1 ref, indentée, gris clair :

```
1. Relances           1530       —          —
   ├ Relance V1       1000
   ├ Relance V2        500
   └ Clic Teaser        30 (indisponible)
2. Engagement          300      19.6%      19.6%
```

**Step 3 :** Build + dev test manuel. Commit.

---

## Phase 4 — Polish

### Task 4.1 : Validation côté UI

**Step 1 :** Empêcher la sauvegarde si un step a 0 refs (l'API rejette, mais on évite le 400 en désactivant l'UX :
- Si l'user supprime la dernière ref d'un step → on supprime le step entier (pas de step "vide" qui pendouille)

**Step 2 :** Si l'user ajoute une étape "vide" (drop entre deux steps SANS qu'un palette item arrive) → ne rien créer (déjà géré par le pattern actuel — on ne crée que sur drop avec activeId palette).

### Task 4.2 : Lint + build clean + tests verts

```bash
cd /c/Users/julie/EDH && npm run lint && npm run build && npx vitest run
```
Fix any new issue. Commit.

---

## Phase 5 — Deploy + smoke + docs

### Task 5.1 : Push + redeploy VPS

```bash
cd /c/Users/julie/EDH && git push origin main
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 \
  "sudo bash -c 'cd /root/edh && git pull && docker compose up -d --build'"
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "sudo docker logs --tail 20 edh-app"
```

### Task 5.2 : Smoke prod

1. Login sur https://edh.messagingme.app
2. `/dashboards` → Créer "Funnel cumul test"
3. Étape 1 : drag 2 mm events + 1 URL → tous les 3 sommés en chips
4. Étape 2 : drag 1 mm event
5. Vérifier le bar chart : étape 1 = somme, étape 2 = volume seul, conversion calculée correctement
6. Renommer l'étape 1 inline → "Relances" → reload → label persiste
7. Supprimer une chip d'étape 1 → recompute auto

### Task 5.3 : Update docs

**Files :** Modify `CLAUDE.md`, `features.md`, `documentation.md`

- CLAUDE.md : ajouter ligne `13 — Mes tableaux : étapes cumulées (multi-refs par step) + migration 005`. Mettre à jour la phrase intro de la fonction 3 ("Mes tableaux") pour mentionner le cumul.
- features.md : section Mes tableaux → ajouter paragraphe sur le cumul d'events par étape.
- documentation.md : schéma DB section 6 → ajouter `dashboard_step_refs`, supprimer `step_type/event_ns/redirect_event_id` de `dashboard_steps`, ajouter colonne `label`.

Commit + push.

---

## Done criteria

- Migration 005 appliquée en prod (`dashboard_step_refs` existe, colonnes `step_type/event_ns/redirect_event_id` sont retirées de `dashboard_steps`, `label` ajouté).
- `npm run build && npm run lint && npx vitest run` green depuis `/c/Users/julie/EDH`.
- `/dashboards/[id]` permet de cumuler 3+ refs (mm + URL mixés) dans un step, avec label éditable, drag-onto-step + bouton `+ Ajouter`.
- Bar chart + table affichent `count = somme refs disponibles`, `available = at least one ref available`.
- Smoke test passé en prod sur https://edh.messagingme.app.
- Docs CLAUDE.md / features.md / documentation.md à jour.
