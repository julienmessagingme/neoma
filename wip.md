# WIP — Neoma Dashboard

## Live

**Prod : https://neoma.messagingme.app**

- Container `neoma-app` sur le VPS (`/root/neoma/`), réseaux Docker `neoma_default` + `mcp-robot_default`.
- NPM proxy host id **17** → `http://neoma-app:3000`, cert Let's Encrypt id **19** (expires 2026-08-23).
- DNS Cloudflare : `neoma.messagingme.app` résout vers les IPs Cloudflare (record préexistant ou wildcard `*.messagingme.app`).
- Cron 22:00 Europe/Paris actif (sync MessagingMe événements Neoma).
- Vector store OpenAI : `vs_6a14a8c7ff548191b60b8e92ebbcc996` (nom `neoma-kb`).
- Julien (`d6092a9f-a238-435e-a911-3e055a384a58`) a accès `school_slug='neoma'` + `is_admin=true` — login avec son mot de passe EDH existant.

## En cours / à faire

- [ ] **Remplacer le logo placeholder** `public/logos/neoma.png` (actuellement copie d'`edh.png`). Refresh dans le Dockerfile via `git pull && docker compose up -d --build`.
- [ ] **Premiers custom events Neoma** dans le flow uchat — pour qu'ils remontent via le sync 22:00 et apparaissent dans Stats.
- [ ] **Premier template WhatsApp Meta-validé** côté Neoma → créer le slug correspondant dans `/urls`.
- [ ] **Alimenter le vector store** `vs_6a14a8c7ff548191b60b8e92ebbcc996` avec les premiers documents Neoma via l'onglet « Base de connaissance ».
- [ ] **Inviter d'autres utilisateurs Neoma** côté client via l'onglet Admin (Julien seul pour l'instant).

## Tech debt connu

- **17 tests vitest échouent** (fixtures hardcodées sur `efap` héritées d'EDH). Le build de prod passe sans souci. À cleaner quand on touche la suite de tests — pour l'instant cosmétique.
