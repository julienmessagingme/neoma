# Module Admin — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ajouter un tab "Admin" niveau 1 visible uniquement par les admins, qui permet de lister, inviter, modifier et désactiver des utilisateurs ; chaque user a une liste d'écoles auxquelles il a accès, vérifiée par toutes les routes API et la sidebar.

**Architecture:** Migration 006 (flag `is_admin` + `deactivated_at` + `last_login_at` sur `users`, table `user_school_access`). Nouveau helper `requireAdmin` + `getCurrentUserSchools`. Toutes les routes user-facing existantes ajoutent un check d'accès école. Nouvelle page `/admin` avec sa palette de modals.

**Tech Stack:** Inchangé.

**Reference design :** `docs/plans/2026-05-01-admin-design.md` (validé 2026-05-01).

**Workspace :** Main worktree `C:\Users\julie\EDH\`. Chaque Bash call qui touche le repo : `cd /c/Users/julie/EDH && ...`.

**Git identity :**
```bash
git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "..."
```

**Phases :**
0. Migration 006 (schema + backfill + Julien admin) + types
1. Helpers `requireAdmin`, `getCurrentUserSchools`, `getCurrentSchoolSlugChecked` + tests
2. Login modifié : `last_login_at` + check `deactivated_at` + tests
3. Routes API admin (`/api/admin/users` GET/POST/PATCH/DELETE) + tests
4. Filtrage école sur les routes existantes (`/api/school` POST, `/api/dashboards`, `/api/events`, `/api/stats/custom-events`, `/api/knowledge/*`)
5. Layout app : niveau 1 nav avec onglet Admin conditionnel, sidebar filtrée
6. Page `/admin` : liste cards
7. Modals Invite + Edit + Désactiver/Réactiver
8. Polish + lint + build clean
9. Deploy + smoke + docs

---

## Phase 0 — Migration 006 + types

### Task 0.1 : Migration SQL 006

**Files:** Create `supabase/migrations/006_admin.sql`

```sql
-- 006_admin.sql — Admin tab : flags + accès par école
-- Apply via: Supabase SQL Editor → paste this whole file → Run.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_admin       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_login_at  timestamptz;

CREATE INDEX IF NOT EXISTS idx_users_active_email
  ON users (email) WHERE deactivated_at IS NULL;

CREATE TABLE IF NOT EXISTS user_school_access (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_slug text NOT NULL,
  PRIMARY KEY (user_id, school_slug)
);

-- Backfill : tous les users existants ont accès aux 9 écoles
INSERT INTO user_school_access (user_id, school_slug)
SELECT u.id, s
FROM users u
CROSS JOIN unnest(ARRAY['efap','3wa','brassart','cesine','efj','esec','ecole-bleue','icart','ifa']) AS s
ON CONFLICT DO NOTHING;

-- Julien promu admin (à adapter à l'email réel en DB)
UPDATE users SET is_admin = true WHERE email = 'julien@messagingme.fr';

COMMIT;
```

Apply via Supabase SQL Editor + verify :
```sql
SELECT email, is_admin, deactivated_at, last_login_at FROM users;
SELECT user_id, school_slug FROM user_school_access ORDER BY user_id, school_slug;
```

Commit :
```bash
cd /c/Users/julie/EDH && git add supabase/migrations/006_admin.sql && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(db): migration 006 — is_admin/deactivated_at/last_login_at + user_school_access"
```

### Task 0.2 : Types partagés

**Files:** Create `src/lib/admin/types.ts`

```ts
export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  is_admin: boolean;
  deactivated_at: string | null;
  last_login_at: string | null;
  created_at: string;
  schools: string[];
}
```

Commit.

---

## Phase 1 — Helpers

### Task 1.1 : `getCurrentUserSchools(userId)` + tests

**Files:**
- Create: `src/lib/schools/access.ts`
- Test: `src/lib/schools/access.test.ts`

Function returns the school slugs the user has access to, ordered by `SCHOOLS` constant (so the sidebar order is deterministic). Test : returns subset, returns [] if user has no rows, doesn't include unknown slugs.

### Task 1.2 : `getCurrentSchoolSlugChecked()` + tests

**Files:** Modify `src/lib/schools/context.ts`

Add export :

```ts
export async function getCurrentSchoolSlugChecked(): Promise<string> {
  const slug = await getCurrentSchoolSlug();
  const user = await requireUser();
  const schools = await getCurrentUserSchools(user.userId);
  if (schools.includes(slug)) return slug;
  if (schools.length === 0) {
    throw Object.assign(new Error("no school access"), { status: 403 });
  }
  // Fallback : reset cookie côté client à la 1re école accessible n'est pas
  // possible depuis un Server Component → on retourne juste la 1re école
  // accessible et on la retournera au client via la sidebar pour qu'il
  // mette à jour le cookie.
  return schools[0];
}
```

Test couverture des 3 cas.

### Task 1.3 : `requireAdmin()` + tests

**Files:** Modify `src/lib/auth/require-user.ts` (ajouter à côté de `requireUser`)

```ts
export async function requireAdmin(): Promise<SessionPayload & { isAdmin: true }> {
  const user = await requireUser();
  // Vérifie en DB que is_admin est toujours true (l'admin a pu être rétrogradé)
  const sb = getSupabase();
  const { data } = await sb
    .from("users")
    .select("is_admin, deactivated_at")
    .eq("id", user.userId)
    .maybeSingle();
  if (!data || data.deactivated_at || !data.is_admin) {
    throw Object.assign(new Error("forbidden"), { status: 403 });
  }
  return { ...user, isAdmin: true };
}
```

Test.

---

## Phase 2 — Login modifié

### Task 2.1 : Update `/api/auth/login`

**Files:** Modify `src/app/api/auth/login/route.ts`

- Après le bcrypt OK : check `deactivated_at` → 401 si désactivé
- Update `last_login_at = now()` après le bcrypt OK + non-désactivé
- Test à mettre à jour : un user désactivé reçoit le même 401 générique.

### Task 2.2 : Update `requireUser()`

**Files:** Modify `src/lib/auth/require-user.ts`

Le `requireUser` actuel ne vérifie que le JWT. Ajouter un check DB : si l'user a été désactivé entre-temps, 401. Penser au coût (1 query par requête authentifiée) : on peut cacher en mémoire avec un TTL court (ex 30s) si ça devient trop lourd. V1 : un check à chaque appel, mesurer en prod.

Tests à adapter.

---

## Phase 3 — Routes API admin

### Task 3.1 : GET `/api/admin/users` + tests

**Files:**
- Create: `src/app/api/admin/users/route.ts`
- Create: `tests/api/admin/users.test.ts`

`requireAdmin()` puis SELECT users + JOIN schools agrégées (`array_agg(school_slug)`). Renvoie `{ users: AdminUser[] }` ordonné par `created_at`.

Test 403 si non-admin.

### Task 3.2 : POST `/api/admin/users` + tests

`requireAdmin()`, Zod body `{ email, name, password, is_admin, schools[] }`, bcrypt le password, INSERT users, INSERT user_school_access en batch. 409 sur duplicate email.

Test : 403 non-admin, 400 validation, 200 + crée les rows.

### Task 3.3 : PATCH `/api/admin/users/[id]` + tests

`requireAdmin()`, Zod body avec tous les champs optionnels. Si `is_admin: false` est demandé sur le seul admin restant → 400. Si `password` non-vide → bcrypt. Update users + atomic replace de user_school_access (DELETE + INSERT) si schools fourni.

### Task 3.4 : DELETE (soft-delete) `/api/admin/users/[id]` + tests

`requireAdmin()`, refuse si target = self (400 "cannot deactivate self"), refuse si dernier admin actif (400). Sinon : `UPDATE users SET deactivated_at = now() WHERE id = $1`.

### Task 3.5 : Reactivate via PATCH ?

Au lieu d'un endpoint `/reactivate` séparé, on autorise PATCH `{ deactivated_at: null }`. Couvert dans le PATCH générique.

---

## Phase 4 — Filtrage école sur routes existantes

Pour chacune des routes ci-dessous, remplacer `getCurrentSchoolSlug()` par `getCurrentSchoolSlugChecked()` (ou ajouter un check explicite).

### Task 4.1 : `/api/school` POST

`getCurrentSchoolSlugChecked()` n'est pas applicable ici (on ne CHANGE pas vers le slug courant). Vérifier que le slug demandé est dans `user_school_access` → 403 sinon.

### Task 4.2 : Routes existantes

À adapter : `/api/events` GET+POST, `/api/events/[id]` PATCH+DELETE, `/api/stats/custom-events` + 2 sous-routes, `/api/knowledge/*` (~10 routes), `/api/dashboards*` + sous-routes. Soit ~20 fichiers.

Stratégie : on remplace `await getCurrentSchoolSlug()` par `await getCurrentSchoolSlugChecked()` dans chaque route. Le helper renvoie un slug autorisé (fallback) ou throw 403.

Tests : ajouter un cas "user sans accès à l'école courante → 403" dans 1-2 suites représentatives.

### Task 4.3 : `/r/:slug` reste public

Le redirect `/r/:slug` n'a aucune notion de user → pas de filtrage. OK.

### Task 4.4 : Cron `/api/cron/sync`

Authentifié par `INTERNAL_API_KEY` (pas par session user) → pas concerné.

---

## Phase 5 — Layout app : nav admin + sidebar filtrée

### Task 5.1 : Récupérer is_admin côté layout

**Files:** Modify `src/app/(app)/layout.tsx`, `src/lib/auth/session.ts` (ou direct)

Dans le layout, après `requireUser()`, lire `is_admin` depuis la DB. Passer au composant `<HeaderTabs isAdmin={...} />`.

### Task 5.2 : `<HeaderTabs>` avec onglet Admin conditionnel

**Files:** Modify `src/app/(app)/header-tabs.tsx`

Si `isAdmin` → ajouter `{ href: "/admin", label: "Admin" }` à la liste.

### Task 5.3 : Sidebar filtrée par accès école

**Files:** Modify `src/app/(app)/layout.tsx`, `src/app/(app)/sidebar.tsx`

`SCHOOLS.filter(s => userSchools.includes(s.slug))`. Si `userSchools` est vide → afficher uniquement le bouton "Se déconnecter" + un message "Contactez l'admin".

Si l'école courante du cookie n'est plus dans `userSchools`, le layout déclenche un fetch POST vers `/api/school` pour basculer sur `userSchools[0]`. Cas rare : l'admin vient de retirer l'accès en temps réel.

---

## Phase 6 — Page `/admin` liste

### Task 6.1 : Route protégée par middleware

**Files:** Modify `src/middleware.ts`

Ajouter : si `pathname.startsWith("/admin")` et `is_admin === false` → redirect `/`.

Le middleware n'a pas accès à la DB → il vérifie le JWT mais le flag `is_admin` doit être inclus dans le payload JWT (au moment du login). Sinon on fait le check côté server component qui retourne `notFound()`.

V1 simple : check côté server component du `/admin/layout.tsx` ou `/admin/page.tsx` → `notFound()` si non-admin. Pas besoin de toucher au middleware.

### Task 6.2 : Page server + client

**Files:**
- Create: `src/app/(app)/admin/page.tsx`
- Create: `src/app/(app)/admin/admin-client.tsx`

Server : `requireAdmin()` (404 sinon) + render client. Client : fetch `/api/admin/users`, render cards.

### Task 6.3 : Cards de users

Card par user :
- Nom (gras) + email (gris)
- Badge admin/member, badge "Désactivé" si applicable, badge "Vous" sur sa propre card
- Dernière connexion en relative time ("il y a 2h", "jamais")
- Chips des écoles assignées (max 5 visibles puis "+N")
- Boutons "Modifier" et "Désactiver/Réactiver"

---

## Phase 7 — Modals Invite + Edit

### Task 7.1 : Modal Inviter

Modal avec :
- Input email (validation format)
- Input nom
- Input mdp temp avec bouton "Régénérer" (alphabet sécurisé, 16 chars)
- Bouton copier-le-mdp
- Grid de 9 checkboxes écoles (toutes cochées par défaut)
- Checkbox is_admin
- Bouton "Créer" → POST `/api/admin/users` → toast affiche le mdp avec bouton copier

### Task 7.2 : Modal Modifier

Pareil que Invite mais email read-only + champ password optionnel (vide = inchangé) + pré-rempli avec les valeurs courantes.

### Task 7.3 : Bouton Désactiver/Réactiver

Click → confirm → DELETE (désactive) ou PATCH `{deactivated_at: null}` (réactive). Refresh la liste.

---

## Phase 8 — Polish + lint + build

### Task 8.1 : Lint + build

```bash
cd /c/Users/julie/EDH && npm run lint && npm run build && npx vitest run
```
Fix any issue.

### Task 8.2 : Cas dégradés UI

- Liste vide → ne devrait pas arriver (Julien est toujours là)
- User désactivé puis tente une action → 401 propre + redirect login
- User retire ses propres droits admin → toast + reload UI sans le tab Admin

---

## Phase 9 — Deploy + smoke + docs

### Task 9.1 : Push + redeploy

```bash
cd /c/Users/julie/EDH && git push origin main
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 \
  "sudo bash -c 'cd /root/edh && git pull && docker compose up -d --build'"
```

### Task 9.2 : Smoke prod

1. Login Julien → tab Admin visible
2. Inviter Kelberg avec is_admin=true + 9 écoles cochées → mdp affiché
3. Logout, login en Kelberg → tab Admin visible aussi
4. Inviter un user X non-admin avec uniquement EFAP coché → mdp affiché
5. Logout, login en X → tab Admin invisible, sidebar montre uniquement EFAP, accès aux autres écoles refusé
6. Désactiver X depuis le compte de Julien → X tente de se logger → 401 message générique
7. Réactiver X → X peut se logger à nouveau

### Task 9.3 : Docs

Update `CLAUDE.md` (phase 14), `features.md` (section Admin), `documentation.md` (DB schema + table users + table user_school_access), `wip.md` (clear), `todo.md` (ajouter self-service password change, magic link, audit log en V2).

Commit + push.

---

## Done criteria

- Migration 006 appliquée en prod (3 colonnes ajoutées sur `users`, `user_school_access` créée, Julien admin, 9 lignes de schools par user existant).
- Tests verts depuis `/c/Users/julie/EDH`.
- `/admin` accessible uniquement aux admins, redirect/404 sinon.
- Smoke prod : invite + désactive + accès école = OK sur https://edh.messagingme.app.
- Docs CLAUDE.md / features.md / documentation.md à jour.
