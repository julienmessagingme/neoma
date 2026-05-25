# Knowledge Base Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Base de connaissance" module to EDH Stats so each of the 9 schools can manage their OpenAI vector store (file/text/Q&R/Excel uploads, themes, history, search) from the existing dashboard.

**Architecture:** New `/knowledge` route under the existing auth-gated app shell, header restructured to a 2-level nav (`Stats | Base de connaissance`, `Stats` retaining its `URLs | Stats` sub-nav). New tables in Supabase scoped by `school_slug`. Server-side wrapper around OpenAI Files + Vector Stores APIs, one vector store per school configured by env var.

**Tech Stack:** Next.js 15 App Router, Supabase, OpenAI SDK, `pdf-lib` (server PDF generation), `xlsx` (client Excel parsing), Server-Sent Events for bulk import progress.

**Reference design:** `docs/plans/2026-04-30-knowledge-base-design.md` (validated 2026-04-30).

**Workspace:** Main worktree `C:\Users\julie\EDH\`. Every Bash call that touches the repo MUST start with `cd /c/Users/julie/EDH && ...`. Never edit in `.claude/worktrees/*`.

**Git identity (no global config):**
```bash
git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "..."
```

**Phases:**
0. Schéma DB Supabase (migration 002)
1. SCHOOLS étendu + env vars + warnings
2. OpenAI client `lib/openai-kb.ts` + helper file-gen
3. Routes API knowledge (themes/subthemes, items CRUD)
4. Routes API knowledge upload + Excel import (SSE)
5. Header nav restructuré (niveau 1)
6. UI `/knowledge` (tabs upload + historique + themes manager)
7. Deploy + smoke test prod

---

## Phase 0 — DB schema

### Task 0.1: Migration SQL 002

**Files:** Create `supabase/migrations/002_knowledge.sql`

**Step 1: Write the migration**

Use the schema from `docs/plans/2026-04-30-knowledge-base-design.md` section 4. Write all CREATE TABLE / INDEX statements verbatim.

**Step 2: Verify locally**

```bash
cd /c/Users/julie/EDH && wc -l supabase/migrations/002_knowledge.sql
```
Expected: ~50 lines.

**Step 3: Apply via Supabase SQL Editor**

Navigate to https://supabase.com/dashboard/project/odmpeakltuzwvtydbpfu/sql/new, paste the migration, Run. Verify:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'knowledge%'
ORDER BY table_name;
```
Expected: `knowledge_items, knowledge_subthemes, knowledge_themes` (3 rows).

**Step 4: Commit**
```bash
cd /c/Users/julie/EDH && git add supabase/ && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(db): migration 002 — knowledge tables (items + themes + subthemes)"
```

---

## Phase 1 — Schools + env extension

### Task 1.1: Add `vectorStoreEnv` field to SCHOOLS

**Files:** Modify `src/lib/schools.ts`

**Step 1:** Add `vectorStoreEnv: string` to `School` interface.

**Step 2:** Update each row in `SCHOOLS` array — add e.g. `vectorStoreEnv: "OPENAI_VS_EFAP"`.

**Step 3:** Add helpers:
```ts
export function getSchoolVectorStoreId(slug: string): string | undefined {
  const s = getSchoolBySlug(slug);
  if (!s) return undefined;
  return process.env[s.vectorStoreEnv];
}
```

**Step 4:** Extend `warnMissingSchoolTokens` to also warn on missing vector store env vars and missing `OPENAI_API_KEY`. Rename the function to `warnMissingConfig` or keep the name and broaden the scope. Decide based on which is cleaner.

**Step 5:** Update `src/lib/schools.test.ts` — add test that `getSchoolVectorStoreId("efap")` returns the env value, returns undefined for unknown slug.

**Step 6: Run tests**
```bash
cd /c/Users/julie/EDH && npm test -- src/lib/schools
```
Expected: PASS.

**Step 7: Commit**
```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(schools): vectorStoreEnv field + getSchoolVectorStoreId + boot warnings"
```

### Task 1.2: Extend `.env.example` and local `.env.local`

**Files:** Modify `.env.example`

**Step 1:** Add to `.env.example`:
```env
# OpenAI Vector Stores (one per school) — used by the Knowledge Base module
OPENAI_API_KEY=
OPENAI_VS_EFAP=
OPENAI_VS_3WA=
OPENAI_VS_BRASSART=
OPENAI_VS_CESINE=
OPENAI_VS_EJF=
OPENAI_VS_ESEC=
OPENAI_VS_ECOLE_BLEUE=
OPENAI_VS_ICART=
OPENAI_VS_IFA=
```

**Step 2:** Update local `.env.local` (NOT committed) with the real values from the brainstorming session: `OPENAI_API_KEY=sk-proj-...` and the 9 vector store IDs (cf. design doc section 8).

**Step 3:** Update prod `.env` on VPS:
```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "sudo nano /root/edh/.env"
```
Add the 10 OpenAI lines. Save.

**Step 4: Commit (only `.env.example`)**
```bash
cd /c/Users/julie/EDH && git add .env.example && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "chore: env contract for OpenAI vector stores (knowledge module)"
```

---

## Phase 2 — OpenAI client + file generation

### Task 2.1: `src/lib/openai-kb.ts`

**Files:** Create `src/lib/openai-kb.ts`, `src/lib/openai-kb.test.ts`

**Step 1: Add `openai` dependency**
```bash
cd /c/Users/julie/EDH && npm install openai
```

**Step 2: Write failing test in `openai-kb.test.ts`**

Mock global fetch + the `openai` SDK. Tests :
- `getVectorStoreId("efap")` returns the env value, throws if missing
- `uploadToVectorStore` calls Files API then `vector_stores/{id}/files`, both with right headers
- 5xx triggers retry, 4xx fails fast
- `OpenAI-Beta: assistants=v2` header always present on vector store calls

Run: `cd /c/Users/julie/EDH && npm test -- src/lib/openai-kb`
Expected: FAIL (module not found).

**Step 3: Implement `openai-kb.ts`**

Methods (signatures from design doc section 5):
```ts
getVectorStoreId(schoolSlug: string): string;
uploadToVectorStore(schoolSlug, fileBuffer, fileName, options?): Promise<{ vectorStoreFileId, fileId, status }>;
deleteFromVectorStore(schoolSlug, vectorStoreFileId): Promise<void>;
deleteOpenAIFile(fileId): Promise<void>;
waitForIndexation(schoolSlug, vectorStoreFileId, maxAttempts?): Promise<string>;
```

Use the `OpenAI` SDK for Files API (`openai.files.create`, `.del`). Use native `fetch` with retry helper (steal pattern from `src/lib/messagingme/client.ts`) for the vector store HTTP calls. Header `OpenAI-Beta: assistants=v2`. Polling in `waitForIndexation` is 1 s × 60 attempts max.

**Step 4: Run tests**

Expected: PASS.

**Step 5: Commit**
```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(kb): OpenAI vector store client (upload, delete, wait, retry)"
```

### Task 2.2: File generators (PDF + Q&R text)

**Files:** Create `src/lib/knowledge/file-gen.ts`, `src/lib/knowledge/file-gen.test.ts`

**Step 1: Add `pdf-lib`**
```bash
cd /c/Users/julie/EDH && npm install pdf-lib
```

**Step 2: Write failing tests**

Tests :
- `createPdfFromText("hello world", "Mon doc")` returns a Buffer starting with `%PDF-`
- `createTxtFromQA(q, a, theme, subtheme)` returns Buffer of UTF-8 text matching the format in design doc section 5
- `sanitizeFileName("évidemment/malicieux:.pdf")` returns `_videmment_malicieux_.pdf` (or similar safe form)

Run: FAIL.

**Step 3: Implement**

```ts
import { PDFDocument, StandardFonts } from "pdf-lib";

export async function createPdfFromText(text: string, title: string): Promise<Buffer> {
  // Multi-page PDF from text. One page A4 (595×842). Wrap text at ~80 cols.
  // ...
}

export function createTxtFromQA(question: string, answer: string, theme?: string | null, subtheme?: string | null): Buffer {
  const parts = [];
  if (theme) parts.push(`THÈME: ${theme}`);
  if (subtheme) parts.push(`SOUS-THÈME: ${subtheme}`);
  if (parts.length > 0) parts.push("");
  parts.push("QUESTION:", question, "", "RÉPONSE:", answer);
  return Buffer.from(parts.join("\n"), "utf8");
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]/g, "_").substring(0, 200);
}
```

**Step 4: Run tests** — Expected: PASS.

**Step 5: Commit**
```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(kb): file generators (pdf-lib for text, plain UTF-8 for Q&R)"
```

---

## Phase 3 — API: themes + items CRUD

### Task 3.1: Themes routes

**Files:** Create
- `src/app/api/knowledge/themes/route.ts` (GET, POST)
- `src/app/api/knowledge/themes/[id]/route.ts` (PATCH, DELETE)
- `tests/api/knowledge/themes.test.ts`

**Step 1: Failing tests**

Mirror the patterns of existing `tests/api/events.test.ts`. Mock supabase + `requireUser` + `getCurrentSchoolSlug`. Tests:
- POST creates a theme scoped to current school, 409 on duplicate name (unique constraint), 400 on empty name
- GET returns only current school's themes
- PATCH renames, refuses if owned by another school (404)
- DELETE cascades subthemes (verify the DELETE call), refuses if owned by another school (404)

**Step 2: Implement** — see existing event routes for the pattern. Each route handler:
1. `requireUser()` → 401 on miss
2. `getCurrentSchoolSlug()` to scope the query
3. zod-validate the body
4. supabase op + handle constraint violations (`23505` for unique)

**Step 3: Run tests** — Expected: PASS.

**Step 4: Commit**
```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(kb): /api/knowledge/themes CRUD scoped to current school"
```

### Task 3.2: Subthemes routes

**Files:** Create
- `src/app/api/knowledge/subthemes/route.ts` (GET, POST)
- `src/app/api/knowledge/subthemes/[id]/route.ts` (PATCH, DELETE)
- `tests/api/knowledge/subthemes.test.ts`

**Step 1: Failing tests** — same pattern as themes, plus:
- GET supports `?themeId=...` filter
- POST accepts optional `themeId` and verifies the theme belongs to current school before linking

**Step 2: Implement**

**Step 3: Run tests** — Expected: PASS.

**Step 4: Commit**
```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(kb): /api/knowledge/subthemes CRUD with theme link validation"
```

### Task 3.3: Items list + delete

**Files:** Create
- `src/app/api/knowledge/items/route.ts` (GET only)
- `src/app/api/knowledge/items/[id]/route.ts` (DELETE only — PATCH later in Phase 4)
- `tests/api/knowledge/items.test.ts`

**Step 1: Failing tests**

- GET supports pagination (`page`, `limit`, default 50), filter `?type=qa|file|text`, filter `?themeId=...`, full-text search `?q=tarif` (test with mocked supabase response)
- DELETE removes from OpenAI vector store, deletes the OpenAI file, then deletes the row. Each step in try/catch — if OpenAI delete fails, log warning but still delete the DB row.
- DELETE on item from another school → 404.

**Step 2: Implement GET**

Use `to_tsvector('french', ...) @@ plainto_tsquery('french', ?)` for the search. Fallback to `ilike '%q%'` if `q.length < 3`. Join `knowledge_themes` and `knowledge_subthemes` to return their names with each item.

**Step 3: Implement DELETE**

```ts
const item = await sb.from("knowledge_items").select("...").eq("id", id).maybeSingle();
if (!item || item.school_slug !== currentSchool) return 404;

try { await openaiKb.deleteFromVectorStore(item.school_slug, item.vector_store_file_id); } catch (e) { console.warn(...); }
try { await openaiKb.deleteOpenAIFile(item.openai_file_id); } catch (e) { console.warn(...); }

await sb.from("knowledge_items").delete().eq("id", id);
```

**Step 4: Run tests** — Expected: PASS.

**Step 5: Commit**
```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(kb): /api/knowledge/items GET (paginated + search) + DELETE (OpenAI + DB)"
```

---

## Phase 4 — API: uploads + Excel SSE

### Task 4.1: Upload file route

**Files:** Create `src/app/api/knowledge/upload-file/route.ts`, `tests/api/knowledge/upload-file.test.ts`

**Step 1: Failing tests**

- multipart form with a fake PDF buffer succeeds, returns the new item
- file > 10 MB returns 413
- non-PDF/TXT extension returns 400
- magic bytes check rejects file with `.pdf` extension but text content (or vice versa)

**Step 2: Implement**

Use Next 15 native `await req.formData()` (not multer). Validation steps:
1. `file.size > 10 * 1024 * 1024` → 413
2. extension in `['pdf', 'txt']`
3. magic bytes : PDF starts with `%PDF-`, txt has no null bytes in first 1 KB
4. `sanitizeFileName(file.name)`
5. `openaiKb.uploadToVectorStore(school, buffer, name)`
6. insert row `type='file'`, return item

Configure route with `export const runtime = "nodejs"` and remove the body size limit (Next 15: `export const maxDuration = 60`).

**Step 3: Run tests** — Expected: PASS.

**Step 4: Commit**
```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(kb): /api/knowledge/upload-file with magic bytes + 10MB limit"
```

### Task 4.2: Upload text + Q&R routes

**Files:** Create
- `src/app/api/knowledge/upload-text/route.ts`
- `src/app/api/knowledge/upload-qa/route.ts`
- `tests/api/knowledge/upload-text.test.ts`
- `tests/api/knowledge/upload-qa.test.ts`

**Step 1: Failing tests for upload-text**
- valid `{text, title}` → creates PDF, uploads, inserts row `type='text'`
- empty text → 400

**Step 2: Failing tests for upload-qa**
- valid `{question, answer, themeId, subthemeId}` → creates txt, uploads, inserts row
- duplicate question (same `school_slug`, same exact `question` after trim) → 409 `{error:"duplicate", field:"question"}`
- duplicate answer → 409 `{error:"duplicate", field:"answer"}`
- themeId from another school → 400
- subthemeId not linked to provided themeId → 400 (defensive)

**Step 3: Implement both routes**

For Q&R duplicate detection: `SELECT id FROM knowledge_items WHERE school_slug=? AND type='qa' AND (question=? OR answer=?)`. If `question` field returns the dup → field='question', else 'answer'.

**Step 4: PATCH route for items (Q&R only)**

`src/app/api/knowledge/items/[id]/route.ts` — add PATCH method:
1. fetch item, check ownership and `type='qa'`
2. duplicate check excluding self (`id != ?`)
3. delete old OpenAI file + vector store entry
4. generate new txt + upload
5. update row

**Step 5: Run all knowledge tests**
```bash
cd /c/Users/julie/EDH && npm test -- tests/api/knowledge
```
Expected: PASS.

**Step 6: Commit**
```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(kb): /api/knowledge/upload-text + upload-qa + PATCH items (with duplicate guard)"
```

### Task 4.3: Excel import via SSE

**Files:** Create `src/app/api/knowledge/import-excel/route.ts`, `tests/api/knowledge/import-excel.test.ts`

**Step 1: Failing tests**

Test SSE stream output. Mock 3 Q&R pairs, 1 succeeds, 1 has a duplicate, 1 fails. Verify the events emitted:
- `themes_created` once at the start (if any new themes)
- `progress` per row before processing
- `success` or `failure` per row
- `done` at the end with summary

**Step 2: Implement**

Body schema (zod): `{ pairs: Array<{question, answer, theme?: string, subtheme?: string}> }`.

Implementation:
1. Auto-create missing themes/subthemes (find-or-create via `INSERT ... ON CONFLICT (school_slug, name) DO NOTHING RETURNING id`)
2. For each pair, retry x3 with exponential backoff. Use the same upload-qa logic but with `skipIndexation: true` for speed.
3. Emit SSE events as `data: {"type":"progress",...}\n\n` etc.

Set headers:
```ts
return new Response(stream, {
  headers: {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
  },
});
```

**Step 3: Run tests** — Expected: PASS.

**Step 4: Commit**
```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(kb): /api/knowledge/import-excel SSE bulk Q&R with retry + auto-themes"
```

---

## Phase 5 — Header nav (level 1)

### Task 5.1: Header tabs component

**Files:** Create `src/app/(app)/header-tabs.tsx`. Modify `src/app/(app)/layout.tsx`.

**Step 1:** Create `header-tabs.tsx` (client component):
```tsx
"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";

export function HeaderTabs() {
  const pathname = usePathname();
  const isKnowledge = pathname.startsWith("/knowledge");
  return (
    <nav className="flex gap-2">
      <Link href="/urls" className={...active if !isKnowledge}>Stats</Link>
      <Link href="/knowledge" className={...active if isKnowledge}>Base de connaissance</Link>
    </nav>
  );
}
```

**Step 2:** In `(app)/layout.tsx`, render `HeaderTabs` in a top bar above the sidebar+main.

**Step 3:** Refactor `urls-client.tsx` and `stats-client.tsx` — REMOVE their internal `[URLs] [Stats]` sub-nav from each component. Instead create a shared `src/app/(app)/sub-nav-stats.tsx` component, render it inside both `urls-client.tsx` and `stats-client.tsx`. Same JSX as before, just deduplicated.

**Step 4:** Verify `npm run build` and `npm run dev`, manually test the nav switches still work for `/urls` and `/stats`.

**Step 5: Commit**
```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "refactor(ui): 2-level nav (Stats|Knowledge in header, URLs|Stats sub-nav)"
```

---

## Phase 6 — Knowledge UI

### Task 6.1: Page + tabs shell

**Files:** Create
- `src/app/(app)/knowledge/page.tsx`
- `src/app/(app)/knowledge/knowledge-client.tsx`

**Step 1:** Server `page.tsx` just renders `<KnowledgeClient />`.

**Step 2:** `knowledge-client.tsx` :
- Header H1 "Base de connaissance — {schoolName}" (fetch school name from current cookie, or pass via server component)
- 4 sub-tabs `[Fichier] [Texte] [Q/R] [Excel]` (state via `useState`, NOT URL params, since they're sub-modes)
- "Gérer les thèmes" button → opens `<ThemesManagerDialog />` (Task 6.5)
- Below: `<HistoryList />` (Task 6.4)

Smoke test: `npm run dev`, visit `/knowledge`. The 4 tabs render but content is "Coming soon" placeholder.

**Step 3: Commit**
```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(kb-ui): /knowledge page shell with 4 sub-tabs + theme manager button"
```

### Task 6.2: Upload tabs (file, text, Q&R)

**Files:** Create
- `src/app/(app)/knowledge/upload-file-tab.tsx`
- `src/app/(app)/knowledge/upload-text-tab.tsx`
- `src/app/(app)/knowledge/upload-qa-tab.tsx`

For each tab:
- Form with the relevant inputs (drag-and-drop for file, textarea for text, two textareas + 2 selects for Q&R)
- Submit calls the API, displays a toast on success/error
- Loading state with disabled button
- For Q&R : populate the theme select from `GET /api/knowledge/themes`, populate subtheme select on theme change. Both have a "+" button next to them that opens an inline create dialog.

**Step 2: Test manually**

`npm run dev`, log in, switch to school EFAP. Upload a small `.txt` file. Verify in Supabase that a row appears in `knowledge_items`. Verify in OpenAI that the file is in the `vs_69f4514f...` vector store.

**Step 3: Commit**
```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(kb-ui): upload tabs (file + text + Q/R) wired to /api/knowledge/*"
```

### Task 6.3: Excel import tab

**Files:** Create `src/app/(app)/knowledge/upload-excel-tab.tsx`

**Step 1: Add `xlsx` dep**
```bash
cd /c/Users/julie/EDH && npm install xlsx
```

**Step 2: Implement** :
- Drag-and-drop `.xlsx`/`.xls`. On drop: `XLSX.read(buffer)`.
- Sheet selector if multiple sheets.
- Has-headers checkbox.
- Column selectors (question*, answer*, theme, subtheme).
- Preview table showing the first 5 rows of mapped data.
- "Importer N lignes" button → POST to `/api/knowledge/import-excel` with the parsed pairs as JSON, then `new EventSource()` on the same URL (or use a `fetch` POST then read the response stream — choose based on what works with Next 15 SSE).
- Progress bar + log of failures + "Annuler" button (closes the EventSource / aborts the fetch).

**Step 3: Test manually with a 10-row Excel file.**

**Step 4: Commit**
```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(kb-ui): Excel import tab (SheetJS client-side + SSE progress)"
```

### Task 6.4: History list + edit dialog

**Files:** Create
- `src/app/(app)/knowledge/history-list.tsx`
- `src/app/(app)/knowledge/edit-qa-dialog.tsx`

**Step 1: `history-list.tsx`** :
- Search input (debounced 300 ms).
- Filter buttons `[Tous] [Fichiers] [Textes] [Q/R]`.
- List of rows :
  - file/text : name + uploaded_at + uploaded_by + delete button
  - qa : question (1 line, truncated) + theme/subtheme + uploaded_at + edit + delete
- Pagination ‹ N M ›.
- Status badge if `status !== 'completed'` (in_progress: spinner, failed: red).
- Polling: for items with `status === 'in_progress'` AND uploaded < 60 s ago, re-fetch every 5 s.

**Step 2: `edit-qa-dialog.tsx`** :
- Same form as upload-qa-tab but pre-filled.
- PATCH `/api/knowledge/items/:id` on submit.
- Handle 409 duplicate.

**Step 3: Test manually:**
- Create a Q/R, verify appears in history
- Edit it, verify the OpenAI file changes (delete old + new in vector store)
- Delete it, verify removed from both DB and OpenAI

**Step 4: Commit**
```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(kb-ui): history list with search + filters + edit-Q&R dialog + indexation polling"
```

### Task 6.5: Themes manager dialog

**Files:** Create `src/app/(app)/knowledge/themes-manager.tsx`

**Step 1: Implement** :
- Modal with two side-by-side panels.
- Left: "Thèmes". List + inline create + rename + delete (with cascade confirmation).
- Right: "Sous-thèmes" filtered by selected theme on the left. Same operations.
- Each operation hits `/api/knowledge/themes` or `/api/knowledge/subthemes`.

**Step 2: Test manually** : create a theme, create a subtheme under it, rename, delete the theme (verify subthemes auto-deleted).

**Step 3: Commit**
```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(kb-ui): themes manager dialog (CRUD with cascade confirmation)"
```

---

## Phase 7 — Deploy + smoke test prod

### Task 7.1: Code review pass

**Step 1:** Use `feature-dev:code-reviewer` agent to review the entire knowledge surface (lib + api + ui). Focus areas :
- Auth checks on every API route
- School isolation : no leak across schools
- OpenAI calls : retry + error handling
- File upload : magic bytes + size limit + path sanitization
- SSE stream : proper close on cancel
- React hooks : race conditions on rapid school/range/tab switches

Apply fixes, run all tests, commit.

### Task 7.2: Deploy to VPS

**Step 1: Push**
```bash
cd /c/Users/julie/EDH && git push origin main
```

**Step 2: Verify prod `.env` already has the OpenAI vars** (Task 1.2 should have done this — verify):
```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "sudo grep -c '^OPENAI_' /root/edh/.env"
```
Expected: 10 (1 API key + 9 vector stores).

**Step 3: Pull + rebuild**
```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "sudo bash -c 'cd /root/edh && git pull && docker compose up -d --build'"
```

**Step 4: Verify migration 002 was applied to Supabase** (already done in Task 0.1 step 3, but re-verify):
```sql
SELECT count(*) FROM knowledge_items;  -- 0 expected, just confirms table exists
```

**Step 5: Smoke test prod**
- Open https://edh.messagingme.app, log in.
- Switch to EFAP school.
- Click `Base de connaissance` tab.
- Upload a small test .txt → verify it appears in history with status "completed".
- Verify in OpenAI dashboard that the file is in vs_69f4514f75e48191b5ec2bcb6c307a75.
- Delete the test → verify removed from both UI and OpenAI.

**Step 6: Update `wip.md` + `features.md`** to reflect the new module is live. Commit.

```bash
cd /c/Users/julie/EDH && git add wip.md features.md && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "docs: knowledge base module live in prod" && git push origin main
```

---

## Done

When all phases are committed and pushed:
- `https://edh.messagingme.app/knowledge` works for all 9 schools
- All 4 upload modes work, Q&R supports themes/subthemes
- Excel bulk import streams progress
- History supports pagination + full-text search
- Themes manager opens via dialog
- All knowledge data is isolated per school both in Supabase and in OpenAI vector stores
