# CLAUDE.md — Neoma Dashboard

Dashboard pour **Neoma Business School**. Single-school deployment cloné depuis [EDH](https://github.com/julienmessagingme/edh) avec la même UI/UX. Six modules :

1. **URLs trackées** — slug court → redirect 302, comptage des clics.
2. **Stats** — volumétrie journalière des custom events MessagingMe + clics par URL trackée.
3. **Mes tableaux** — funnel ou pie chart (étapes cumulables, drag-and-drop, partageables).
4. **Campagnes** — regroupements nommés d'events (3 rôles `launch`/`body`/`failed` avec coût Meta WhatsApp).
5. **Base de connaissance** — alimente le vector store OpenAI Neoma (PDF, texte, Q/R, Excel).
6. **Admin** — invitations utilisateurs + désactivation.

**Différence avec EDH** : single-school (1 entrée `neoma` dans `SCHOOLS`). Pas de scope « groupe », pas de sélecteur d'école (un seul item dans la sidebar). L'archi multi-école est conservée à l'identique pour minimiser le diff vs le code EDH d'origine.

Déployé en Docker sur le VPS OVH `146.59.233.252` derrière NPM, sur **`neoma.messagingme.app`**.

## Documentation

- **`documentation.md`** — archi, stack, schéma DB, env vars, déploiement, patterns code
- **`features.md`** — vue produit
- **`wip.md`** — travail en cours
- **`todo.md`** — backlog

## Commandes essentielles

```bash
npm run dev          # http://localhost:3000
npm run build        # production build (Next standalone)
npm run lint         # eslint
npm test             # vitest
npm run seed:users   # seed Julien admin (lit .env.local + SEED_JULIEN_PASSWORD)
```

## Workflow Git — TOUJOURS sur main, jamais de worktree

Le main worktree est `C:\Users\julie\neoma\` (Windows) / `/c/Users/julie/neoma` (bash).

Si Claude Code démarre dans `.claude/worktrees/<name>/`, **NE PAS** y faire d'edits, builds, ou commits. Tout doit se passer dans le main worktree.

- Tout sur `main`, jamais de branche `claude/*`, jamais de worktree
- Push direct sur `origin main` (https://github.com/julienmessagingme/neoma)
- Chaque Bash call qui fait `npm`, `git`, ou touche le repo : `cd /c/Users/julie/neoma && ...`
- Identité git pour les commits :
  ```bash
  git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "..."
  ```

## Déploiement

```bash
# en local
git push origin main

# sur le VPS
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 \
  "sudo bash -c 'cd /root/neoma && git pull && docker compose up -d --build'"

# vérifier
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "sudo docker logs --tail 30 neoma-app"
```

DNS : A record `neoma` → `146.59.233.252` (Cloudflare proxied).
NPM : proxy host `neoma.messagingme.app` → `http://neoma-app:3000`, SSL Let's Encrypt.

## Règles spécifiques au projet

- **Single school = single value `school_slug='neoma'`** dans toutes les tables Supabase. La base est **partagée avec EDH** (même projet Supabase `odmpeakltuzwvtydbpfu`). Les filtres `school_slug` côté app isolent les données.
- **Le slug d'une URL est immuable** une fois créé.
- **Migrations SQL appliquées à la main** via Supabase SQL Editor. Aucune migration spécifique Neoma — le schéma EDH suffit, on n'ajoute que des rows avec `school_slug='neoma'`.
- **`/r/:slug` doit toujours marcher** même sans auth.
- **Cron 22:00 Europe/Paris** dans le process Next.js (sync messagingme pour Neoma). `DISABLE_CRON=1` pour le désactiver en dev.
- **Token MessagingMe** en env var `MM_TOKEN_NEOMA`, vector store OpenAI en `OPENAI_VS_NEOMA`.
- **Pas de RLS Supabase.** Service-role server-side uniquement.
- **UI 100% française** dans les strings affichées.
- **Export PDF : `html-to-image`, pas `html2canvas`** (Tailwind v4 + `oklch()`).
- **Logo `/public/logos/neoma.png`** — vrai logo NEOMA Business School (violet sur banderole). Affiché sur la login page et dans le header.
- **Sync MM = curseur `start_id` ascendant + `limit=100`** (cap dur API, >100 → HTTP 422). Les occurrences arrivent par id CROISSANT : jamais de pagination `page` descendante ni de break précoce sur le watermark (ça gèle le sync après le 1er backfill). Watermark = max id réellement inséré. Cf. `src/lib/messagingme/{client,sync}.ts`. Trou sous le watermark → reset à 0 + resync. (LEARNINGS 2026-06-02 / 06-11.)
- **Agrégation dashboard : paginer les fetch d'occurrences par `.range()`**, jamais `.limit(N)` seul pour compter. PostgREST plafonne à `max-rows` (1000) : un `.limit(10000)` est tronqué EN SILENCE → un event >1000 s'affiche à 1000 et son coût Meta est sous-évalué. Cf. helper `fetchOccurrenceTextValues` dans `src/app/api/dashboards/[id]/data/route.ts`.
- **Tarifs Meta WhatsApp dans `src/lib/meta-pricing.ts`** (table par pays, France 7,15 cts au 2026-06). Meta révise ~2×/an, à recontrôler. Même fichier dans edh.
- **Pie chart = une part par source (volume).** Ne PAS filtrer la palette en mode pie (tout custom event ET clic URL est une part valide). Seul le sélecteur d'event de lancement de campagne filtre sur `has_text_value` (le coût Meta vient des numéros).
