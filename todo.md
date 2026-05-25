# TODO — Neoma Dashboard

Backlog post-bootstrap. À reprendre une fois la mise en prod faite.

## Backlog produit

- **Logo Neoma réel** — actuellement un placeholder, à remplacer par le logo officiel.
- **Vector store OpenAI** — alimenter avec les premiers documents Neoma (brochures, FAQ étudiants, conditions d'admission, etc.).
- **Premier template WhatsApp Meta-validé** côté Neoma — créer le slug correspondant dans `/urls`.
- **Premiers custom events** dans le flow uchat Neoma pour qu'ils remontent via le sync 22:00 et apparaissent dans Stats.

## Améliorations héritées d'EDH (pertinentes ici aussi)

- **RGPD** : retention policy sur `clicks` (IP truncate après 90j).
- **Export CSV** des clics bruts par URL trackée.
- **Cleanup orphans OpenAI** : job hebdo qui détecte les `openai_file_id` orphelins (présents dans le vector store mais plus dans `knowledge_items`).
- **Webhook entrant** depuis uchat pour avoir les events en quasi-temps réel au lieu du sync 22:00 batch.

## Tech debt à éviter

- **Ne pas créer de tables Neoma-spécifiques** — la base est partagée avec EDH, tout passe par `school_slug='neoma'`. Si une feature exige un schéma custom, créer une migration commune.
- **Garder la sync code-pour-code avec EDH** sur les modules génériques (auth, redirects, stats, dashboards, campagnes, knowledge). Les fixes upstream EDH doivent se cherry-pick proprement.

## À migrer un jour

- **DB Supabase dédiée pour Neoma** — actuellement Neoma partage la DB EDH (`odmpeakltuzwvtydbpfu`) avec isolation par `school_slug='neoma'`. Bloqué au bootstrap par la limite Supabase free (2 projets max par org, déjà occupés par leadgen + verifiermondevis). Migration future : upgrader l'org en Pro (ou libérer un slot), créer projet Supabase neoma, rejouer les 13 migrations EDH, dump/restore des rows `school_slug='neoma'`, switch des env vars `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` en local + VPS.
