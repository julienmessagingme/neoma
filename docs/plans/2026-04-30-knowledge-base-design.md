# Design — Module "Base de connaissance" pour EDH

> Date : 2026-04-30
> Statut : design validé, plan d'implémentation à produire
> Référence : pattern repris de `granddole/src/features/knowledge/` et
> `mieuxassure/src/features/knowledge/`, adapté Next.js 15 + Supabase + 9 écoles.

---

## 1. Contexte & objectif

EDH veut alimenter les **vector stores OpenAI** des 9 écoles depuis l'interface
existante. Chaque école a son propre vector store (déjà créé), partagé sous une
même clé API OpenAI. L'interface doit dupliquer la logique des projets
granddole / mieuxassure / keolis-auxerre :

- 4 modes d'ajout de contenu : upload PDF/TXT, saisie texte libre, Q/R
  structurées (avec thème + sous-thème), import Excel en masse
- Historique paginé + recherche full-text + filtres par type/thème
- Gestion CRUD des thèmes et sous-thèmes par école
- Détection des doublons Q/R par école
- Modification d'une Q/R (delete-then-recreate côté OpenAI)

Pas de cron, pas de tâche de fond : toutes les opérations sont synchrones,
déclenchées par l'utilisateur depuis l'UI.

---

## 2. Décisions de cadrage

| Sujet | Choix |
|-------|-------|
| Scope | Tout : 4 modes + historique + recherche + thèmes + doublons + retry auto |
| Stockage métadata | Supabase (cohérent avec le reste du projet) |
| Thèmes | Par école (pas globaux), un thème EFAP n'apparaît pas pour ICART |
| Sous-thèmes | Par école, optionnellement rattachés à un thème |
| Source de vérité contenu | Vector store OpenAI ; Supabase = métadata seul |
| Auth | Mêmes que le reste : Julien + 2 EDH ont les droits |
| Détection doublons | Par école (même question peut exister pour 2 écoles) |
| Génération PDF | `pdf-lib` (pure JS, marche dans Docker Alpine) |
| Génération Q/R | `.txt` plutôt que PDF (plus léger, format plain text exploité par GPT) |
| Parsing Excel | `xlsx` côté **client** (allège le serveur, pas de fichier transféré) |
| Limites | 10 MB par fichier, formats `.pdf`/`.txt`/`.xlsx`/`.xls` |
| Nav | Header niveau 1 `[Stats] [Base de connaissance]`, sub-nav `[URLs] [Stats]` quand Stats actif |

---

## 3. Architecture

```
┌─────────────────────────┐    ┌──────────────────────┐
│   VPS edh-app (Docker)  │    │  Supabase (existant) │
│                         │    │                      │
│  Next.js 15 ──────────► │    │  + knowledge_items   │
│   ├ /knowledge          │    │  + knowledge_themes  │
│   ├ /api/knowledge/*    │───▶│  + knowledge_subth.. │
│   └ lib/openai-kb.ts    │    │  (toutes scoped      │
│                         │    │   school_slug)       │
└─────────────────────────┘    └──────────────────────┘
            │
            ▼
   ┌─────────────────────────────┐
   │   OpenAI API                │
   │   - Files API               │
   │   - Vector Stores API       │
   │     (1 vs_id par école      │
   │      en env var)            │
   └─────────────────────────────┘
```

- **Pas de nouveau service** : tout dans le container `edh-app` existant.
- **9 vector stores OpenAI** déjà créés. Mappés par école via env vars
  `OPENAI_VS_<SLUG>=vs_xxx`.
- **OpenAI API key** unique pour les 9 vector stores (env var `OPENAI_API_KEY`).
- **Source de vérité** = vector store OpenAI. Supabase = métadata + index pour
  l'UI (historique, recherche, thèmes).
- **Pas de cron** — toutes les ops sont déclenchées par l'UI.

---

## 4. Schéma DB Supabase (migration 002)

```sql
-- Items uploadés (un fichier par row)
CREATE TABLE knowledge_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_slug           text NOT NULL,
  type                  text NOT NULL,        -- 'file' | 'text' | 'qa'
  file_name             text NOT NULL,
  title                 text,                  -- pour type='text'
  question              text,                  -- pour type='qa'
  answer                text,                  -- pour type='qa'
  theme_id              uuid REFERENCES knowledge_themes(id) ON DELETE SET NULL,
  subtheme_id           uuid REFERENCES knowledge_subthemes(id) ON DELETE SET NULL,
  vector_store_file_id  text NOT NULL,
  openai_file_id        text NOT NULL,
  status                text,                  -- 'completed' | 'in_progress' | 'failed'
  uploaded_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_knowledge_items_school_uploaded_at
  ON knowledge_items (school_slug, uploaded_at DESC);

CREATE INDEX idx_knowledge_items_school_type
  ON knowledge_items (school_slug, type);

-- Full-text search (français) pour la recherche dans l'historique
CREATE INDEX idx_knowledge_items_search_question
  ON knowledge_items USING gin (to_tsvector('french', coalesce(question, '')));

CREATE INDEX idx_knowledge_items_search_answer
  ON knowledge_items USING gin (to_tsvector('french', coalesce(answer, '')));

-- Thèmes (par école)
CREATE TABLE knowledge_themes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_slug text NOT NULL,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_slug, name)
);

-- Sous-thèmes (par école, optionnellement rattachés à un thème)
CREATE TABLE knowledge_subthemes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_slug text NOT NULL,
  theme_id    uuid REFERENCES knowledge_themes(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_slug, name)
);

CREATE INDEX idx_knowledge_subthemes_theme ON knowledge_subthemes (theme_id);
```

**Notes** :
- `school_slug` répété sur chaque table pour permettre les queries directes
  sans join. L'app valide qu'un theme/subtheme appartient bien à l'école
  courante avant rattachement.
- `to_tsvector('french')` pour une recherche full-text efficace (granddole
  utilise `LIKE %term%`, pas optimal).
- `uploaded_by` = audit (3 utilisateurs).
- Suppression hard (l'OpenAI delete est de toute façon irréversible).
- Pas de RLS, service-role server-side comme tout le reste.

---

## 5. Couche OpenAI (`src/lib/openai-kb.ts`)

Wrapper concentrant les appels Files API + Vector Stores API. Pattern repris
de granddole, adapté TypeScript.

**Méthodes :**

```ts
getVectorStoreId(schoolSlug: string): string;

uploadToVectorStore(
  schoolSlug: string,
  fileBuffer: Buffer,
  fileName: string,
  options?: { skipIndexation?: boolean }
): Promise<{ vectorStoreFileId: string; fileId: string; status: string }>;

deleteFromVectorStore(schoolSlug: string, vectorStoreFileId: string): Promise<void>;
deleteOpenAIFile(fileId: string): Promise<void>;

waitForIndexation(schoolSlug: string, vectorStoreFileId: string): Promise<string>;
```

**Choix techniques** :
- `OpenAI` SDK officiel pour les Files API.
- `fetch` natif pour les Vector Stores API (header `OpenAI-Beta: assistants=v2`).
- Retry x2 backoff sur 5xx + timeouts, fail-fast sur 4xx.
- Mapping `SCHOOLS` étendu avec `vectorStoreEnv` :
  ```ts
  { slug: "efap", name: "EFAP", tokenEnv: "MM_TOKEN_EFAP", vectorStoreEnv: "OPENAI_VS_EFAP" }
  ```

**Génération de fichiers (helper séparé `src/lib/knowledge/file-gen.ts`)** :
- `pdf-lib` pour générer un PDF à partir de texte libre (option B "Saisie Manuelle").
- Q/R structurées : `.txt` (plus léger pour le vector store) avec format :
  ```
  THÈME: <theme>
  SOUS-THÈME: <subtheme>

  QUESTION:
  <question>

  RÉPONSE:
  <answer>
  ```

---

## 6. Routes API

Toutes auth-gatées via `requireUser()`, scopées par `getCurrentSchoolSlug()`.

```
POST   /api/knowledge/upload-file         multipart, .pdf/.txt, max 10MB
POST   /api/knowledge/upload-text         { text, title }
POST   /api/knowledge/upload-qa           { question, answer, themeId?, subthemeId? }
PATCH  /api/knowledge/items/:id           Q/R uniquement : update q+r+thème
DELETE /api/knowledge/items/:id           tous types : delete OpenAI + DB
GET    /api/knowledge/items               liste paginée + search + filtres
POST   /api/knowledge/import-excel        SSE stream pour la progression bulk

GET    /api/knowledge/themes              liste pour école courante
POST   /api/knowledge/themes              { name }
PATCH  /api/knowledge/themes/:id          { name }
DELETE /api/knowledge/themes/:id          (CASCADE supprime les subthemes)

GET    /api/knowledge/subthemes           liste, filtrable par theme_id
POST   /api/knowledge/subthemes           { name, themeId? }
PATCH  /api/knowledge/subthemes/:id       { name, themeId? }
DELETE /api/knowledge/subthemes/:id
```

**Détails importants** :

- **`POST /upload-file`** : `multipart/form-data` champ `file`. Validation
  serveur (taille, magic bytes pas seulement extension). Insert row avec
  `type='file'`. Retourne l'item complet.
- **`POST /upload-qa`** : génère `.txt`, vérifie doublon par école, upload,
  insert. Doublon → `409 { error: "duplicate", field: "question" | "answer" }`.
- **`PATCH /items/:id`** : delete-then-recreate côté OpenAI (pas d'API "update"
  sur vector store files).
- **`POST /import-excel`** : reçoit JSON `{ pairs: [{question, answer, theme?, subtheme?}] }`
  (parsing `.xlsx` côté client avec SheetJS). Stream **SSE** : `progress`,
  `success`, `failure`, `retry`, `themes_created`, `cancelled`, `done`. Retry
  x3 par paire, backoff. Skip indexation pendant le bulk.
- **Recherche** : `GET /items?q=foo&type=qa&themeId=...&page=1&limit=50`,
  full-text français + fallback `LIKE` si vide.
- **Audit** : log JSON structuré `{ level, action: "knowledge_*", school, item_id, user }`.

---

## 7. UI

```
src/app/(app)/knowledge/
├── page.tsx                    server component
├── knowledge-client.tsx        layout 4 sub-tabs + historique
├── upload-file-tab.tsx         drag-and-drop
├── upload-text-tab.tsx         textarea + titre
├── upload-qa-tab.tsx           selects thème/sous-thème + 2 textareas
├── upload-excel-tab.tsx        SheetJS + preview + SSE progress
├── history-list.tsx            paginée + recherche + filtres
├── edit-qa-dialog.tsx          modal modif Q/R
└── themes-manager.tsx          CRUD thèmes/sous-thèmes
```

**Restructuration nav (impacte les pages existantes)** :

`src/app/(app)/layout.tsx` étendu avec un composant `header-tabs.tsx` qui
calcule le tab niveau 1 actif depuis le pathname :
- `/urls`, `/stats` → `Stats` actif → sub-nav `[URLs] [Stats]` visible
- `/knowledge` → `Base de connaissance` actif → pas de sub-nav

Les composants `urls-client.tsx` et `stats-client.tsx` voient leur sub-nav
interne refactorisée vers ce composant partagé.

**Comportements clés** :
- Switch d'école → tout rechargé, query courante (recherche/page/filtre) reset.
- Toasts (sonner) sur chaque action.
- Badge "indexation" tant que `status !== 'completed'` ; polling 5s, max 60s.
- Modal Themes Manager : 2 panels (thèmes / sous-thèmes filtrés par thème).
  Suppression d'un thème → confirmation (CASCADE delete subthemes,
  `knowledge_items.theme_id` passe à `NULL`).
- Excel : drop → `xlsx.read()` → choix feuille → choix colonnes
  (question*, réponse*, thème, sous-thème) → preview 5 lignes → "Importer N
  lignes" → `EventSource` pour la progression → bouton "Annuler".

---

## 8. Variables d'environnement

```env
OPENAI_API_KEY=sk-proj-...

OPENAI_VS_EFAP=vs_69f4514f75e48191b5ec2bcb6c307a75
OPENAI_VS_3WA=vs_69f4523dec6481918e3530b06c3bbfae
OPENAI_VS_BRASSART=vs_69f4517bf708819194afdff567db8d1e
OPENAI_VS_CESINE=vs_69f451e3dbe48191b275d00819579e02
OPENAI_VS_EJF=vs_69f451b877588191a83f49c94c8f9fd5
OPENAI_VS_ESEC=vs_69f451a6620481919f5432322a11b2c8
OPENAI_VS_ECOLE_BLEUE=vs_69f451cf577c81918bc9999fc4c58322
OPENAI_VS_ICART=vs_69f45191bb8c8191861efd9b09393fcf
OPENAI_VS_IFA=vs_69f45217232c8191b1581e0c275a0a9f
```

**Note** : la valeur ci-dessus pour `OPENAI_VS_EJF` correspond au futur slug
`efj` (rename à venir, voir backlog). En V1 on garde `EJF` puis on rename.

`.env.example` met à jour avec les noms (sans valeurs). Au boot, log warning
pour chaque école sans `OPENAI_VS_*` ou pour `OPENAI_API_KEY` absent
(extension de `warnMissingSchoolTokens`).

**Dépendances npm à ajouter** :
- `openai` (SDK officiel)
- `pdf-lib` (génération PDF côté serveur)
- `xlsx` (parsing Excel côté **client**)

---

## 9. Tests + sécurité + erreurs

**Tests (vitest)** :
- `lib/openai-kb.test.ts` : mock fetch, header `OpenAI-Beta`, mapping vs_id,
  retries 5xx, fail-fast 4xx.
- `app/api/knowledge/upload-qa/route.test.ts` : OK, doublon question/réponse
  (409), validation zod, école manquante.
- `app/api/knowledge/items/[id]/route.test.ts` : DELETE supprime OpenAI + DB,
  ownership cross-school → 404.
- `app/api/knowledge/themes/route.test.ts` : créer/renommer/supprimer ;
  isolation par école.
- Pas de tests UI (manuel avant deploy).

**Sécurité** :
- Validation upload : magic bytes côté serveur (pas que l'extension).
- Limite 10 MB (Next.js body parser config).
- Path traversal : `fileName` sanitizé (regex `[^a-zA-Z0-9_.-]` → `_`).
- Ownership cross-école : 404 (pas 403 — ne pas leak l'existence).
- Pas de rate-limit en V1 (3 utilisateurs internes).
- `OPENAI_API_KEY` server-only.

**Gestion d'erreurs** :

| Surface | Stratégie |
|---------|-----------|
| OpenAI 5xx pendant upload | retry x2 backoff, sinon erreur claire dans le toast |
| OpenAI 4xx | fail-fast, log structuré + toast français |
| Indexation timeout (>60s) | row insérée `status='in_progress'`, polling UI 5s, max 60s puis `failed_indexation` (item visible mais grisé) |
| Suppression échoue côté OpenAI | log warning, on supprime quand même la row DB |
| Excel — paire qui crash en boucle | retry x3 backoff, après quoi loggée dans `failures[]`, on continue |
| Multipart > 10 MB | `413` avant lecture du body |
| Doublon Q/R | `409 Conflict` |
| DB down pendant upload | rollback : tenter delete OpenAI, sinon log + 500 |

**Logs JSON structurés** :
```json
{ "level": "info", "action": "knowledge_upload", "school": "efap", "type": "qa", "item_id": "...", "user": "..." }
```

**Pas d'APM**, `docker logs edh-app` reste la source de debug.

---

## 10. Hors scope (V2)

- Search vector store côté UI (laisser GPT chercher, pas l'utilisateur direct).
- Versioning des items (modifier garde l'historique).
- Bulk delete depuis l'historique (sélection multi).
- Tags libres en plus des thèmes hiérarchiques.
- Quotas par école (storage, nombre de fichiers).
- Cleanup job des fichiers orphelins OpenAI (en cas de DELETE qui a échoué).
- Webhook OpenAI vers EDH pour tracker l'indexation async.
- **Rename `ejf` → `efj`** (slug + name + env var + DB migration) — différé,
  noté dans `wip.md`.
- **Logos école dans la sidebar** (assets dans `docs/`) — différé, noté dans
  `wip.md`.
