# Documentation technique — Neoma Dashboard

Clone de [EDH Dashboard](https://github.com/julienmessagingme/edh) simplifié pour une seule école. **Pour la doc complète** (archi modulaire détaillée, patterns, code reviews), se référer à [`edh/documentation.md`](../edh/documentation.md) — les conventions sont identiques. Ce fichier ne note que les **différences** Neoma vs EDH.

## 1. Différences avec EDH

| Aspect | EDH | Neoma |
|---|---|---|
| Nombre d'écoles | 9 (EFAP, 3WA, Brassart, …) | **1** (`neoma`) |
| Scope « groupe » | Oui (vue agrégée toutes-écoles `EDH_SCOPE_SLUG='edh'`) | **Désactivé** (sentinelle `__neoma_group_disabled__` jamais activée) |
| Sidebar | 9 entrées + 1 groupe | **1 entrée** (Neoma) |
| Cookies | `edh_session`, `edh_school` | `neoma_session`, `neoma_school` |
| Domaine | `edh.messagingme.app` | **`neoma.messagingme.app`** |
| Container Docker | `edh-app` | **`neoma-app`** |
| Supabase | Projet `odmpeakltuzwvtydbpfu` | **Même projet** (partage la DB ; isolation via `school_slug='neoma'`) |
| MessagingMe Bearer | 9 tokens | **1 token** (`MM_TOKEN_NEOMA`) |
| OpenAI vector stores | 9 | **1** (`OPENAI_VS_NEOMA`) |

L'archi multi-école (constante `SCHOOLS`, route handlers qui scopent par école, contexte cookie) est conservée à l'identique — Neoma est la « 1re et seule » entrée. Coût : un sélecteur d'école dans la sidebar qui n'a qu'un seul item. Bénéfice : zéro divergence de code avec EDH, les futurs fixes EDH se transposent par cherry-pick.

## 2. Stack

Identique à EDH (Next.js 15.5 standalone, Tailwind 4, shadcn, Supabase, etc.). Voir [`edh/documentation.md` §2](../edh/documentation.md).

## 3. Auth

Identique à EDH. Cookie `neoma_session` (HS256, TTL 7j). Anti-timing-attack login. Voir [`edh/documentation.md` §3](../edh/documentation.md).

## 4. School (single)

`SCHOOLS = [{ slug: "neoma", name: "Neoma", tokenEnv: "MM_TOKEN_NEOMA", vectorStoreEnv: "OPENAI_VS_NEOMA", logo: "/logos/neoma.png" }]`.

Le scope groupe (`isEdhScope`, `EDH_SCHOOL_SLUGS`) est conservé pour compat mais jamais activé : la constante `EDH_SCOPE_SLUG` vaut `"__neoma_group_disabled__"` — aucune row `user_school_access` avec cette valeur n'existe ni ne doit être créée.

Pour ajouter une 2e école (improbable mais possible) :

1. Ajouter une entrée à `SCHOOLS` dans `src/lib/schools.ts`.
2. Ajouter les env vars `MM_TOKEN_<SLUG>` + `OPENAI_VS_<SLUG>`.
3. Déposer le logo en `public/logos/<slug>.png`.
4. Redéploy.

## 5. Redirect public `/r/:slug`

Identique à EDH. Path public, rate-limit, cache 60s, IP picking via `CF-Connecting-IP`.

## 6. Schéma DB

**Schéma partagé avec EDH** dans le même projet Supabase `odmpeakltuzwvtydbpfu`. Aucune migration Neoma à appliquer — les tables existent déjà.

Les rows Neoma sont identifiables par `school_slug='neoma'` dans :

- `redirect_events`, `clicks` (via FK)
- `mm_events`, `mm_occurrences`, `mm_sync_state`
- `knowledge_themes`, `knowledge_subthemes`, `knowledge_items`
- `dashboards`, `dashboard_step_refs.event_school_slug`
- `campaigns`, `campaign_refs`
- `user_school_access`

Les tables `users` et `user_school_access` sont aussi partagées — un même utilisateur peut avoir des rows pour `'efap'` (côté EDH) ET `'neoma'` (côté Neoma) ; chaque app filtre selon ses `SCHOOLS`.

## 7. Variables d'environnement

```
NEXT_PUBLIC_SUPABASE_URL=https://odmpeakltuzwvtydbpfu.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<même clé qu'EDH>
AUTH_SECRET=<nouveau secret 64 chars hex, différent d'EDH>
INTERNAL_API_KEY=<nouveau>
MESSAGINGME_API_BASE=https://ai.messagingme.app/api
MM_TOKEN_NEOMA=<bearer uchat Neoma>
OPENAI_API_KEY=<clé OpenAI Neoma>
OPENAI_VS_NEOMA=<id vector store OpenAI Neoma>
CRON_TIMEZONE=Europe/Paris
PUBLIC_BASE_URL=https://neoma.messagingme.app
DISABLE_CRON=
SEED_JULIEN_PASSWORD=<mot de passe à hasher pour seed>
```

**Local** : `.env.local` (gitignored). **Prod** : `.env` lu par `docker compose` sur le VPS.

## 8. Déploiement prod

```bash
# Push depuis le main worktree local
cd /c/Users/julie/neoma && git push origin main

# SSH VPS + rebuild
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252
sudo bash -c 'cd /root/neoma && git pull && docker compose up -d --build'

# Vérifier
sudo docker logs --tail 30 neoma-app
curl -I https://neoma.messagingme.app/login
```

### Stack VPS

- VPS OVH `146.59.233.252`
- Repo cloné en `/root/neoma/` (root-owned, `sudo` requis)
- `.env` prod en `/root/neoma/.env` (chmod 600)
- Container `neoma-app` sur réseaux Docker `neoma_default` (compose) + `mcp-robot_default` (external, NPM joint)
- DNS Cloudflare : A record `neoma` → `146.59.233.252`, proxied (orange cloud)
- NPM proxy host : `neoma.messagingme.app` → `http://neoma-app:3000`, SSL Let's Encrypt, force SSL, HTTP/2

## 9. Conventions code

Identiques à EDH. Server Components par défaut, Zod pour les bodies POST/PATCH, logs JSON structurés, service-role Supabase server-side uniquement.
