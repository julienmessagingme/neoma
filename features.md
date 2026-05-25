# Features — Neoma Dashboard

Vue produit côté utilisateur. Pour la doc technique : `documentation.md`.

## 1. URLs trackées

Création de slugs courts (8 chars) à inclure dans les templates WhatsApp. Quand un destinataire clique, on enregistre le clic (timestamp, IP anonymisée, pays via Cloudflare) puis on redirige en 302 vers l'URL de destination.

- **Versioning** : changer la destination d'un slug existant crée une nouvelle version (slug Meta-validé reste utilisable). L'historique des versions est consultable.
- **Archivage** : un event peut être archivé (n'apparaît plus en création mais reste lisible dans les stats historiques).

## 2. Stats

Deux sections séparées, filtre période commun :

- **Custom events MessagingMe** : volumétrie journalière de chaque event mm avec accordéon par event (label + description + chart Recharts).
- **Clics URL trackées** : volumétrie journalière par URL trackée Neoma.

## 3. Mes tableaux

Chaque utilisateur construit ses propres tableaux. À la création, choix entre :

- **Funnel** — étapes ordonnées, viz Barres verticales ou Entonnoir reaviz (toggle).
- **Pie chart** — parts du gâteau, base 100.

Chaque étape/part peut **cumuler** plusieurs events (mm + URL mixés) → les volumes sont sommés. Drag-and-drop depuis la palette (events mm + URLs Neoma) vers une étape (nouvelle ou existante), label éditable.

- **Filtre palette par campagne** disponible si l'utilisateur a des campagnes (cf. ci-dessous).
- **Coût Meta WhatsApp** affiché automatiquement par event porteur (50 pays couverts, cliquable pour détail par pays).
- **Partage** : un tableau peut être marqué `is_shared` pour être lisible par les autres utilisateurs Neoma (lecture seule).
- **Export Excel** (xlsx) + **PDF** (chart + tableau).

## 4. Campagnes

Regroupement nommé d'events mm + URLs trackées. Privée par défaut ou partagée avec les autres utilisateurs Neoma.

- **3 rôles d'event** : `launch` (envoi initial), `body` (mid-funnel), `failed` (échec).
- Chaque campagne a **son propre tableau drag-and-drop** lié 1:1 (table `dashboards.campaign_id`), édité sur `/campaigns/[id]`. Palette restreinte aux briques de la campagne.
- **Synthèse coût net** affichée dans le builder de la campagne.

Les tableaux de campagne ne s'affichent **pas** dans « Mes tableaux » pour éviter le doublon.

## 5. Base de connaissance

Alimente le vector store OpenAI Neoma (id en env var `OPENAI_VS_NEOMA`). Quatre modes d'ajout :

- **Fichier** : upload PDF / TXT.
- **Texte** : saisie d'un bloc texte avec titre.
- **Q/R structurées** : question + réponse + thème + sous-thème (taxonomie gérable dans l'UI).
- **Import Excel** : upload en masse via fichier xlsx (colonnes : question, réponse, thème, sous-thème). Progress via SSE.

Chaque item est stocké en OpenAI (Files + Vector Stores API) et indexé en Supabase pour les métadonnées (filtre, historique, suppression). La suppression nettoie OpenAI en best-effort puis supprime inconditionnellement la row DB.

## 6. Admin

Onglet visible uniquement par les administrateurs (Julien au lancement). Permet :

- **Inviter** un nouvel utilisateur (email + mot de passe + cocher accès Neoma).
- **Désactiver** un utilisateur (soft-delete, son cookie devient invalide).
- **Cocher la case admin** pour déléguer.

Les non-admins ne voient ni l'onglet ni l'URL `/admin` (middleware + layout).
