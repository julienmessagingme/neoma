# WIP — Neoma Dashboard

## En cours

- **Bootstrap initial du projet** (2026-05-25) — clone de EDH simplifié single-school.
  - [x] Copie du codebase EDH dans `neoma/`
  - [x] Simplification `SCHOOLS` à 1 entrée `neoma`
  - [x] Rebrand UI (title, login header, logo alt)
  - [x] Cookies renommés (`neoma_session`, `neoma_school`)
  - [x] Admin : masquage de la case « EDH groupe »
  - [x] Docker (`neoma-app`, `docker-compose.yml`)
  - [x] Docs (CLAUDE.md, documentation.md, features.md, wip.md, todo.md)
  - [x] `.env.example` adapté
  - [x] Script `seed-users.ts` adapté (Julien admin + accès `neoma`)
  - [ ] Création vector store OpenAI Neoma via API (récupère l'ID `vs_xxx`)
  - [ ] `.env.local` rempli avec clés réelles (UChat + OpenAI + Supabase + AUTH_SECRET)
  - [ ] `npm install` + `npm run build` local pour valider
  - [ ] `npm run seed:users` pour créer Julien admin avec accès `neoma`
  - [ ] `git init` + repo GitHub `julienmessagingme/neoma` + premier push
  - [ ] Clone sur VPS, `docker compose up -d --build`
  - [ ] NPM proxy host `neoma.messagingme.app` + cert Let's Encrypt
  - [ ] DNS Cloudflare : A record `neoma` → `146.59.233.252` proxied
  - [ ] Smoke test : login Julien sur https://neoma.messagingme.app/login

## À surveiller

- **Logo Neoma** : actuellement un placeholder copié depuis `/logos/edh.png` lors du scaffold. À remplacer par le vrai logo Neoma (`public/logos/neoma.png`).
- **Vector store OpenAI** : créé via API au bootstrap, l'ID est mis en `OPENAI_VS_NEOMA`. Si la clé OpenAI est rotée, le vector store reste mais les uploads échoueront jusqu'à mise à jour de la clé.
