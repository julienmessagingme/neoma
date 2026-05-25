# Design — Module Admin

**Date :** 2026-05-01
**Statut :** validé, prêt pour implémentation

## Vision

Tab "Admin" niveau 1 du header (à côté de `Stats` et `Base de connaissance`), visible uniquement quand l'user connecté a `is_admin = true`. Permet à un nombre restreint d'utilisateurs (Julien, Kelberg, Hassani) de :

1. Lister les users existants (email, nom, statut admin/member, dernière connexion, écoles assignées)
2. Inviter de nouveaux users (email + nom + mdp temporaire + écoles + flag admin)
3. Modifier un user (changer ses écoles, son flag admin, réinitialiser son MDP)
4. Désactiver un user (soft-delete : ne peut plus se logger, dashboards préservés)

L'objectif principal est de donner accès à des **employés école-spécifique** (ex : un commercial EFAP qui n'a rien à faire chez ICART). Les accès école sont stockés dans une table dédiée `user_school_access`. L'admin coche les cases.

## Décisions de cadrage validées

| # | Décision | Choix |
|---|---|---|
| Q1 | Définition d'admin | Flag `is_admin boolean` sur `users` |
| Q2 | Périmètre des accès | Per-école (table `user_school_access`) |
| Q3 | Flow d'invitation | Création directe par l'admin (mdp temp affiché) |
| 1 | Premier admin | Julien promu via SQL ; Kelberg + Hassani invités via UI après deploy |
| 2 | Placement UI | Tab niveau 1 dans header, visible uniquement aux admins |
| 3 | Page Admin | Cards par user + bouton `+ Inviter` |
| 4 | Modal Invite | email + nom + mdp temp affiché + checkboxes écoles + checkbox is_admin |
| 5 | Modal Modifier | pareil + champ "Réinitialiser le MDP" (vide = inchangé) |
| 6 | Désactivation | Soft-delete (`deactivated_at`) + 401 immédiat sur sessions actives |
| 7 | `last_login_at` | mis à jour à chaque login réussi |
| 8 | Sidebar | filtre les écoles selon `user_school_access` |
| 9 | API filtrage | toutes les routes user-facing vérifient l'accès école → 401 si refus |
| 10 | Hors scope V1 | self-service password change, magic link, audit log, 2FA |

## Architecture

### DB — migration 006

```sql
ALTER TABLE users
  ADD COLUMN is_admin       boolean NOT NULL DEFAULT false,
  ADD COLUMN deactivated_at timestamptz,
  ADD COLUMN last_login_at  timestamptz;

CREATE INDEX idx_users_active_email
  ON users (email) WHERE deactivated_at IS NULL;

CREATE TABLE user_school_access (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_slug text NOT NULL,
  PRIMARY KEY (user_id, school_slug)
);

-- Backfill : users existants ont accès aux 9 écoles
INSERT INTO user_school_access (user_id, school_slug)
SELECT u.id, s
FROM users u
CROSS JOIN unnest(ARRAY['efap','3wa','brassart','cesine','efj','esec','ecole-bleue','icart','ifa']) AS s
ON CONFLICT DO NOTHING;

-- Julien promu admin (à ajuster selon l'email réel en DB)
UPDATE users SET is_admin = true WHERE email = 'julien@messagingme.fr';
```

### Routes API

| Route | Méthode | Auth | Rôle |
|---|---|---|---|
| `/api/admin/users` | GET | admin | Liste tous les users actifs + désactivés |
| `/api/admin/users` | POST | admin | Crée un user (email, name, password temp, schools[], is_admin) |
| `/api/admin/users/[id]` | PATCH | admin | Update partiel (name, password?, schools, is_admin, deactivated_at) |
| `/api/admin/users/[id]` | DELETE | admin | Soft-delete (set deactivated_at = now()) |

**Helper** `requireAdmin()` réutilise `requireUser()` puis check `is_admin = true`. Sinon 403.

**Helper** `requireUser()` modifié : vérifie aussi que `deactivated_at IS NULL`. Sinon 401.

### Routes existantes — filtrage école

Toutes les routes qui dépendent de `getCurrentSchoolSlug()` doivent passer par un nouveau helper `getCurrentSchoolSlugChecked()` qui :

1. Lit le cookie comme avant
2. Vérifie que le user a `user_school_access` pour ce slug
3. Sinon → fallback sur la première école accessible
4. Si zéro école accessible → throw avec status 403 (cas rare, traduit en page d'erreur ou message UI)

Routes concernées : `/api/events*`, `/api/stats/*`, `/api/dashboards*`, `/api/knowledge/*`, `/api/admin/sync`. Pratiquement tout sauf `/api/auth/*` et `/api/school` (qui définit le cookie).

La route `/api/school` (POST pour changer d'école) doit aussi vérifier que le slug demandé est dans `user_school_access` → 403 sinon.

### Login

`/api/auth/login` :

1. Look up user par email (sans filtrer sur deactivated_at — on retourne le même message générique pour ne pas leak l'existence d'un compte désactivé)
2. Vérifie bcrypt
3. **Si `deactivated_at IS NOT NULL`** → 401 même message générique
4. Sinon : crée la session JWT + UPDATE `last_login_at = now()`

### UI

#### Header niveau 1

Layout actuel : `[Stats] [Base de connaissance]`. Devient : `[Stats] [Base de connaissance] [Admin]` mais le 3e onglet n'apparaît que si `is_admin`. La détection se fait côté serveur dans le layout `(app)/layout.tsx` qui charge déjà `getCurrentSchoolSlug()` — ajouter `getCurrentUser()` pour récupérer aussi le flag admin.

#### Page `/admin`

- En haut à droite : bouton `+ Inviter`
- Liste de cards (1 par user) :
  - Nom + email
  - Badge `Admin` (zinc-900) ou `Member` (zinc-400)
  - Badge `Désactivé` rouge si applicable
  - Dernière connexion : "il y a 2h" / "jamais"
  - Chips des écoles assignées
  - Bouton "Modifier" (icône stylo)
  - Bouton "Désactiver" / "Réactiver" (selon état)
- Card de l'admin courant : badge "Vous" + bouton "Modifier" disponible mais "Désactiver" disabled (pas le droit de te désactiver toi-même).

#### Modal Inviter

- Champ email (validation format)
- Champ nom
- Champ mdp temporaire (auto-généré au premier focus, copiable, regénérable)
- Grille de checkboxes des 9 écoles (toutes cochées par défaut)
- Checkbox `is_admin` (décochée par défaut)
- Bouton "Créer" → POST → toast "Compte créé. Mot de passe : XXXX (à communiquer en sécurité)" qu'on peut copier d'un clic. Le mdp n'est plus jamais réaffiché ailleurs.

#### Modal Modifier

- Email read-only (immuable une fois créé pour préserver l'identité)
- Nom éditable
- Champ "Nouveau mot de passe" (optionnel, vide = on garde l'actuel)
- Grille de checkboxes des 9 écoles
- Checkbox `is_admin`
- Bouton "Enregistrer"

### Sidebar

Aujourd'hui : 9 écoles en dur depuis `SCHOOLS`. Demain : la liste vient du serveur, filtrée par `user_school_access`. Le layout `(app)/layout.tsx` qui passe déjà `schools={SCHOOLS}` à `<Sidebar>` lit désormais `getCurrentUserSchools(userId)` qui retourne le sous-ensemble.

Si l'école courante (cookie) n'est plus accessible : la route `/api/school` est appelée auto par le layout pour basculer sur la 1<sup>re</sup> école accessible.

### Cas limites

- **Admin se désactive lui-même** : bouton désactivé côté UI + 400 server-side ("cannot deactivate self").
- **Admin retire son propre flag admin** : autorisé (se rétrograder soi-même), mais on affiche un warning. Si plus aucun admin actif : refus côté server (400 "must keep at least one active admin").
- **User désactivé qui essaie de se logger** : 401 message générique.
- **User désactivé avec session JWT encore valide** : `requireUser()` check `deactivated_at IS NULL`, donc 401 immédiat. Cookie de session reste mais inutile.
- **Admin retire l'accès à toutes les écoles d'un user** : autorisé. Le user voit la page vide "Aucune école assignée — contactez l'admin".

### Tests

- **API** : routes `/api/admin/users` (auth admin requise, CRUD, soft-delete), filtre école sur `/api/school` POST + `/api/dashboards` GET (rejet d'une école non accessible).
- **UI** : pas de tests (cohérent projet).

## Hors scope V1

- Self-service password change (l'user voudra changer son mdp lui-même un jour — V2)
- Magic link / email d'invitation auto
- Audit log "qui a fait quoi"
- 2FA
- "Forgot password" reset par email
- Roles plus granulaires (manager, viewer, etc.)
