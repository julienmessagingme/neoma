# Mes tableaux (Custom Dashboards) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a third sub-tab "Mes tableaux" under the Stats nav, where each EDH user (Kelberg, Hassani, …) builds their own per-school funnel dashboards by drag-and-drop sequencing custom events / URL clicks, persisted in DB, with a horizontal bar-chart visualisation of step volumes and conversions.

**Architecture:** New `/dashboards` route at the root of `(app)`, sibling of `/urls` and `/stats`. Sub-nav extended to 3 entries (URLs / Stats / Mes tableaux). Two new Supabase tables (`dashboards`, `dashboard_steps`). API CRUD + a `/data` endpoint that runs N parallel COUNT queries on `mm_occurrences` and `clicks`. UI uses `@dnd-kit/core` + `@dnd-kit/sortable` for the builder and recharts (already installed) for the funnel chart.

**Tech Stack:** Next.js 15 App Router, Supabase (service-role), Zod, `@dnd-kit/core`, `@dnd-kit/sortable`, recharts.

**Reference design:** `docs/plans/2026-05-01-dashboards-design.md` (validated 2026-05-01).

**Workspace:** Main worktree `C:\Users\julie\EDH\`. Every Bash call that touches the repo MUST start with `cd /c/Users/julie/EDH && ...`. Never edit in `.claude/worktrees/*`.

**Git identity (no global config):**
```bash
git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "..."
```

**Phases:**
0. Schéma DB Supabase (migration 004) + types partagés
1. Lib helper `resolveDateRange` + tests
2. API CRUD `/api/dashboards` + `/api/dashboards/[id]` + tests
3. API `/api/dashboards/[id]/data` (calcul volumes) + tests
4. Sub-nav 3 entrées + scaffold page liste `/dashboards`
5. Page liste : fetch + cards + bouton "Nouveau funnel" + modal
6. Page builder `/dashboards/[id]` : squelette + palette (mm_events + redirect_events)
7. Drag-and-drop (dnd-kit) + zone funnel + auto-save debounced
8. Visualisation : BarChart horizontal + table conv
9. Polish : edge cases (source disparue, 404 cross-école, empty/error states)
10. Deploy + smoke test prod

---

## Phase 0 — DB schema + types

### Task 0.1: Migration SQL 004

**Files:** Create `supabase/migrations/004_dashboards.sql`

**Step 1:** Write the migration verbatim from design doc section 2.

**Step 2:** Verify locally:
```bash
cd /c/Users/julie/EDH && wc -l supabase/migrations/004_dashboards.sql
```
Expected: ~30 lines.

**Step 3:** Apply via Supabase SQL Editor at https://supabase.com/dashboard/project/odmpeakltuzwvtydbpfu/sql/new. Paste the migration → Run. Verify:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_name LIKE 'dashboard%'
ORDER BY table_name;
```
Expected: `dashboard_steps, dashboards`.

**Step 4: Commit**
```bash
cd /c/Users/julie/EDH && git add supabase/migrations/004_dashboards.sql && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(db): migration 004 — dashboards + dashboard_steps tables"
```

### Task 0.2: Types partagés

**Files:** Create `src/lib/dashboards/types.ts`

**Step 1:** Define and export :
```ts
export type StepType = "mm_event" | "url_click";
export type DatePreset = "7d" | "30d" | "90d" | "custom";

export interface DashboardStep {
  id: string;
  position: number;
  step_type: StepType;
  event_ns: string | null;
  redirect_event_id: string | null;
}

export interface Dashboard {
  id: string;
  school_slug: string;
  created_by: string;
  name: string;
  type: "funnel";
  date_preset: DatePreset;
  date_from: string | null;
  date_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface DashboardWithSteps extends Dashboard {
  steps: DashboardStep[];
}

export interface ComputedStep {
  position: number;
  step_type: StepType;
  ref_id: string;       // event_ns or redirect_event_id
  label: string;
  count: number;
  available: boolean;
}
```

**Step 2: Commit**
```bash
cd /c/Users/julie/EDH && git add src/lib/dashboards/types.ts && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(dashboards): partage types Dashboard + DashboardStep + ComputedStep"
```

---

## Phase 1 — Lib helper resolveDateRange + tests

### Task 1.1: Implement resolveDateRange (TDD)

**Files:**
- Create: `src/lib/dashboards/date-range.ts`
- Test: `src/lib/dashboards/date-range.test.ts`

**Step 1: Write failing test**
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveDateRange } from "./date-range";

describe("resolveDateRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T12:34:56Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("7d → today − 6 to today", () => {
    expect(resolveDateRange({ preset: "7d" })).toEqual({
      from: "2026-05-09",
      to: "2026-05-15",
    });
  });

  it("30d → today − 29 to today", () => {
    expect(resolveDateRange({ preset: "30d" })).toEqual({
      from: "2026-04-16",
      to: "2026-05-15",
    });
  });

  it("90d → today − 89 to today", () => {
    expect(resolveDateRange({ preset: "90d" }).from).toBe("2026-02-15");
  });

  it("custom uses provided dates", () => {
    expect(
      resolveDateRange({ preset: "custom", from: "2026-01-01", to: "2026-01-31" })
    ).toEqual({ from: "2026-01-01", to: "2026-01-31" });
  });

  it("custom without dates falls back to 30d", () => {
    expect(resolveDateRange({ preset: "custom" })).toEqual({
      from: "2026-04-16",
      to: "2026-05-15",
    });
  });
});
```

**Step 2: Run, verify it fails**
```bash
cd /c/Users/julie/EDH && npx vitest run src/lib/dashboards/date-range.test.ts
```
Expected: FAIL — `resolveDateRange` is not defined.

**Step 3: Implement**
```ts
import type { DatePreset } from "./types";

export function resolveDateRange(input: {
  preset: DatePreset;
  from?: string | null;
  to?: string | null;
}): { from: string; to: string } {
  if (input.preset === "custom" && input.from && input.to) {
    return { from: input.from, to: input.to };
  }
  const days = input.preset === "7d" ? 7 : input.preset === "90d" ? 90 : 30;
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const fromDate = new Date(today);
  fromDate.setUTCDate(fromDate.getUTCDate() - (days - 1));
  return { from: fromDate.toISOString().slice(0, 10), to };
}
```

**Step 4: Run tests, verify pass**
```bash
cd /c/Users/julie/EDH && npx vitest run src/lib/dashboards/date-range.test.ts
```
Expected: 5/5 pass.

**Step 5: Commit**
```bash
cd /c/Users/julie/EDH && git add src/lib/dashboards/ && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(dashboards): resolveDateRange helper + tests"
```

---

## Phase 2 — API CRUD

Reference existing patterns: `src/app/api/events/route.ts` (POST list+create), `src/app/api/events/[id]/route.ts` (PATCH/DELETE), `tests/api/knowledge/themes.test.ts` (mock pattern with `vi.mock` for `@/lib/supabase/service`, `@/lib/schools/context`, `@/lib/auth/require-user`).

### Task 2.1: GET /api/dashboards (list)

**Files:**
- Create: `src/app/api/dashboards/route.ts`
- Test: `tests/api/dashboards/route.test.ts`

**Step 1: Write failing test** for `GET /api/dashboards` returning `{dashboards: [...]}` filtered by `created_by = user.userId AND school_slug = currentSchool`. Mock supabase `from('dashboards').select(...).eq('created_by', 'u1').eq('school_slug', 'efap').order('updated_at', {ascending: false})`. Test 401 on missing user, 200 with empty list.

**Step 2:** Run test, verify FAIL.

**Step 3: Implement** the GET handler with `requireUser()` + `getCurrentSchoolSlug()` + supabase query + JSON response `{dashboards}`. `runtime = "nodejs"`.

**Step 4:** Run tests, verify PASS.

**Step 5: Commit:**
```bash
cd /c/Users/julie/EDH && git add src/app/api/dashboards/ tests/api/dashboards/ && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(api): GET /api/dashboards — list current user's dashboards for current school"
```

### Task 2.2: POST /api/dashboards (create)

**Step 1: Write failing test** for POST with `{name: "JPO EFAP"}` → inserts row with `created_by, school_slug, name, type='funnel', date_preset='30d'`, returns `{id}`. Test 400 on empty name, 401 on unauth.

**Step 2-4:** Run fail, implement, run pass.

**Step 5: Commit:**
```bash
cd /c/Users/julie/EDH && git add src/app/api/dashboards/route.ts tests/api/dashboards/route.test.ts && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(api): POST /api/dashboards — create dashboard"
```

### Task 2.3: GET /api/dashboards/[id] (read with steps)

**Files:**
- Create: `src/app/api/dashboards/[id]/route.ts`
- Test: `tests/api/dashboards/by-id.test.ts`

**Step 1: Write failing test** : returns `{dashboard: {...steps: [...] order by position asc}}`. 404 if dashboard's `created_by ≠ me` OR `school_slug ≠ currentSchool`.

**Step 2-4:** TDD cycle.

**Step 5: Commit:**
```bash
cd /c/Users/julie/EDH && git add src/app/api/dashboards/\[id\]/route.ts tests/api/dashboards/by-id.test.ts && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(api): GET /api/dashboards/[id] — read dashboard + steps"
```

### Task 2.4: PATCH /api/dashboards/[id] (update)

**Step 1: Write failing test** for PATCH with partial body : `name?`, `date_preset?`, `date_from?`, `date_to?`, `steps?`. When `steps` is present, replace the whole list atomically (DELETE all then INSERT new with positions = index). 404 on cross-user/school. 400 on Zod failure (e.g. duplicate position, mm_event without event_ns, etc.).

**Step 2-4:** TDD cycle. Use Zod discriminated union for steps :
```ts
const StepSchema = z.discriminatedUnion("step_type", [
  z.object({ step_type: z.literal("mm_event"), event_ns: z.string().min(1) }),
  z.object({ step_type: z.literal("url_click"), redirect_event_id: z.string().uuid() }),
]);
const Body = z.object({
  name: z.string().min(1).max(200).optional(),
  date_preset: z.enum(["7d","30d","90d","custom"]).optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  steps: z.array(StepSchema).max(50).optional(),
});
```

**Step 5: Commit:**
```bash
cd /c/Users/julie/EDH && git add src/app/api/dashboards/\[id\]/route.ts tests/api/dashboards/by-id.test.ts && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(api): PATCH /api/dashboards/[id] — partial update incl. atomic steps replace"
```

### Task 2.5: DELETE /api/dashboards/[id]

**Step 1: Write failing test** : `DELETE` removes the row, cascades to `dashboard_steps`. 404 cross-user/school.

**Step 2-4:** TDD cycle.

**Step 5: Commit:**
```bash
cd /c/Users/julie/EDH && git add src/app/api/dashboards/\[id\]/route.ts tests/api/dashboards/by-id.test.ts && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(api): DELETE /api/dashboards/[id]"
```

---

## Phase 3 — API /data (calcul volumes)

### Task 3.1: GET /api/dashboards/[id]/data

**Files:**
- Create: `src/app/api/dashboards/[id]/data/route.ts`
- Test: `tests/api/dashboards/data.test.ts`

**Step 1: Write failing test** : seeds 2 mm_event steps + 1 url_click step. For mm_event: count `mm_occurrences` rows in date range. For url_click: count `clicks` rows in date range. For both : if the source event no longer exists, return `available: false, count: 0` with a fallback label `"(indisponible)"`. Test the response shape:
```json
{
  "from": "2026-04-16",
  "to": "2026-05-15",
  "steps": [
    { "position": 0, "step_type": "mm_event",  "ref_id": "evt_x", "label": "Relance benin", "count": 1234, "available": true },
    { "position": 1, "step_type": "url_click", "ref_id": "uuid",  "label": "Clic JPO",      "count": 456,  "available": true }
  ]
}
```

**Step 2:** Run fail.

**Step 3: Implement** :
1. `requireUser()` + `getCurrentSchoolSlug()`.
2. Fetch dashboard + steps. 404 if cross-user/school.
3. `resolveDateRange()` from preset.
4. Pre-fetch labels in parallel:
   - `mm_events`: `SELECT event_ns, name FROM mm_events WHERE school_slug = $1 AND event_ns IN (...)`
   - `redirect_events`: `SELECT id, name FROM redirect_events WHERE id IN (...)`
5. For each step in parallel (`Promise.all`), run the appropriate `count(*)` query — both with `school_slug` filter (mm_occurrences directly, clicks via join or trust event_id since `redirect_events.school_slug` already enforces scope).

   ```ts
   // mm_event
   const { count } = await sb.from("mm_occurrences")
     .select("*", { count: "exact", head: true })
     .eq("school_slug", schoolSlug)
     .eq("event_ns", step.event_ns)
     .gte("occurred_at", `${from}T00:00:00Z`)
     .lt("occurred_at", `${nextDay(to)}T00:00:00Z`);

   // url_click — confirm event belongs to school first via the labels lookup
   const { count } = await sb.from("clicks")
     .select("*", { count: "exact", head: true })
     .eq("event_id", step.redirect_event_id)
     .gte("clicked_at", `${from}T00:00:00Z`)
     .lt("clicked_at", `${nextDay(to)}T00:00:00Z`);
   ```

6. Build response.

**Step 4:** Run tests, verify pass.

**Step 5: Commit:**
```bash
cd /c/Users/julie/EDH && git add src/app/api/dashboards/\[id\]/data/ tests/api/dashboards/data.test.ts && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(api): GET /api/dashboards/[id]/data — compute step volumes for current period"
```

---

## Phase 4 — Sub-nav + scaffold page liste

### Task 4.1: Sub-nav 3 entrées

**Files:** Modify `src/app/(app)/sub-nav-stats.tsx`

**Step 1:** Read the current file. Add a 3rd entry `Mes tableaux` linking to `/dashboards`. Keep the same active-link styling.

**Step 2: Commit:**
```bash
cd /c/Users/julie/EDH && git add src/app/\(app\)/sub-nav-stats.tsx && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(ui): sub-nav Stats passe à 3 entrées (URLs / Stats / Mes tableaux)"
```

### Task 4.2: Scaffold /dashboards (server page + empty client)

**Files:**
- Create: `src/app/(app)/dashboards/page.tsx` (server)
- Create: `src/app/(app)/dashboards/dashboards-client.tsx` (client, empty for now)

**Step 1:** `page.tsx` :
```tsx
import { DashboardsClient } from "./dashboards-client";
import { getCurrentSchoolSlug } from "@/lib/schools/context";

export default async function DashboardsPage() {
  const schoolSlug = await getCurrentSchoolSlug();
  return <DashboardsClient key={schoolSlug} />;
}
```

**Step 2:** `dashboards-client.tsx` :
```tsx
"use client";
import { Toaster } from "sonner";
import { SubNavStats } from "../sub-nav-stats";

export function DashboardsClient() {
  return (
    <div className="space-y-4">
      <Toaster richColors position="top-right" />
      <header className="flex justify-between items-center">
        <SubNavStats />
      </header>
      <h2 className="text-xl font-semibold">Mes tableaux</h2>
      <p className="text-zinc-500">À venir.</p>
    </div>
  );
}
```

**Step 3:** Run `npm run build` from `/c/Users/julie/EDH` — build succeeds.

**Step 4: Commit:**
```bash
cd /c/Users/julie/EDH && git add src/app/\(app\)/dashboards/ && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(ui): scaffold /dashboards page + sub-nav refetch via key={schoolSlug}"
```

---

## Phase 5 — Page liste : fetch + cards + nouveau modal

### Task 5.1: Fetch + cards

**Files:** Modify `src/app/(app)/dashboards/dashboards-client.tsx`

**Step 1:** Replace the placeholder with :
- `useState<Dashboard[]>` + `useEffect(load, [])` calling `GET /api/dashboards`
- Loading "Chargement…", empty "Aucun tableau pour cette école — cliquez sur « + Nouveau funnel »", grid of cards.
- Each card : name (cliquable → `/dashboards/[id]`), type, "Modifié le `<formatted updated_at>`", bouton ✕ (avec confirm + DELETE).

**Step 2:** Verify in dev (`npm run dev`) : empty state + create-via-curl + reload shows the dashboard.

**Step 3: Commit:**
```bash
cd /c/Users/julie/EDH && git add src/app/\(app\)/dashboards/dashboards-client.tsx && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(ui): /dashboards liste les tableaux + DELETE inline"
```

### Task 5.2: Bouton "Nouveau funnel" + modal

**Files:**
- Create: `src/app/(app)/dashboards/new-dashboard-dialog.tsx`
- Modify: `src/app/(app)/dashboards/dashboards-client.tsx`

**Step 1:** Build the dialog (shadcn `Dialog` + `Input` + `Button`) asking for name. On submit : `POST /api/dashboards` → on success, redirect to `/dashboards/<id>` via `useRouter().push`.

**Step 2:** Wire in `dashboards-client.tsx` : add the button in the header, controlled `open` state.

**Step 3:** Verify in dev.

**Step 4: Commit:**
```bash
cd /c/Users/julie/EDH && git add src/app/\(app\)/dashboards/ && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(ui): /dashboards bouton + modal Nouveau funnel"
```

---

## Phase 6 — Page builder : squelette + palette

### Task 6.1: Page route + fetch dashboard

**Files:**
- Create: `src/app/(app)/dashboards/[id]/page.tsx`
- Create: `src/app/(app)/dashboards/[id]/builder-client.tsx`

**Step 1:** `page.tsx` :
```tsx
import { BuilderClient } from "./builder-client";
import { getCurrentSchoolSlug } from "@/lib/schools/context";

export default async function DashboardEditPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const schoolSlug = await getCurrentSchoolSlug();
  return <BuilderClient key={`${schoolSlug}-${id}`} dashboardId={id} />;
}
```

**Step 2:** `builder-client.tsx` minimal :
- `useState` for dashboard, steps, palette items.
- `useEffect` : load `GET /api/dashboards/[id]` (404 → `router.replace("/dashboards")` + toast).
- Render top bar with name (read-only for now), date preset selector, 3-column body : palette (placeholder), steps (placeholder), chart (placeholder).

**Step 3:** `npm run build` succeeds.

**Step 4: Commit:**
```bash
cd /c/Users/julie/EDH && git add src/app/\(app\)/dashboards/\[id\]/ && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(ui): scaffold /dashboards/[id] builder + 404 handling"
```

### Task 6.2: Palette (mm_events + redirect_events)

**Files:**
- Create: `src/app/api/dashboards/palette/route.ts` (GET — returns `{ mmEvents: [...], redirectEvents: [...] }` for current school)
- Test: `tests/api/dashboards/palette.test.ts`
- Modify: `src/app/(app)/dashboards/[id]/builder-client.tsx`

**Step 1: Write failing test** : returns 2 lists scoped by school_slug. Pure read, no auth bypass needed but `requireUser()` enforced.

**Step 2-4:** TDD cycle.

**Step 5:** In builder-client, fetch palette and render the 2 sections (`Custom events MM`, `Clics URL`) as a simple list (no DnD yet) with click-to-add behavior (POST steps via PATCH).

**Step 6: Commit:**
```bash
cd /c/Users/julie/EDH && git add src/app/api/dashboards/palette/ tests/api/dashboards/palette.test.ts src/app/\(app\)/dashboards/\[id\]/ && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(dashboards): palette API + UI list (click-to-add, no DnD yet)"
```

### Task 6.3: Steps zone + add/remove

**Files:** Modify `src/app/(app)/dashboards/[id]/builder-client.tsx`

**Step 1:** Render the steps in order, with label resolved from palette (mm_event.name or redirect_event.name). ✕ button removes a step. Use a debounced PATCH (500ms) when steps change.

**Step 2:** Verify : add via clicking palette → step appears + auto-save. Remove → step disappears + auto-save.

**Step 3: Commit:**
```bash
cd /c/Users/julie/EDH && git add src/app/\(app\)/dashboards/\[id\]/builder-client.tsx && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(ui): builder add/remove steps + auto-save 500ms debounce"
```

### Task 6.4: Date pickers

**Step 1:** Add the 3 preset buttons (7j/30j/90j) + 2 date inputs (custom). Same UX as `stats-client.tsx`. PATCH on change, with `date_preset` set accordingly.

**Step 2:** Verify in dev.

**Step 3: Commit:**
```bash
cd /c/Users/julie/EDH && git add src/app/\(app\)/dashboards/\[id\]/builder-client.tsx && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(ui): builder date range picker (presets + custom) + auto-save"
```

### Task 6.5: Inline rename + delete dashboard

**Step 1:** Make the name in the top bar editable inline (`<input>` on focus, blur → PATCH `{name}`). Add a "Supprimer le tableau" button → confirm dialog → DELETE → `router.push("/dashboards")`.

**Step 2: Commit:**
```bash
cd /c/Users/julie/EDH && git add src/app/\(app\)/dashboards/\[id\]/builder-client.tsx && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(ui): builder inline rename + delete dashboard"
```

---

## Phase 7 — Drag-and-drop (dnd-kit)

### Task 7.1: Install dnd-kit

```bash
cd /c/Users/julie/EDH && npm install @dnd-kit/core@^6 @dnd-kit/sortable@^8 @dnd-kit/utilities@^3
```

**Commit:**
```bash
cd /c/Users/julie/EDH && git add package.json package-lock.json && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "chore: ajoute @dnd-kit/{core,sortable,utilities} pour le builder"
```

### Task 7.2: Wrap builder in DndContext + sortable steps

**Files:** Modify `src/app/(app)/dashboards/[id]/builder-client.tsx`

**Step 1:** Wrap the steps zone in `<DndContext><SortableContext items={...} strategy={verticalListSortingStrategy}>...`. Each step row uses `useSortable`. On `onDragEnd`, reorder the array and trigger debounced PATCH.

**Step 2:** Verify : drag step from position 0 to position 2 → array reorders → after 500ms auto-save → reload page, order persists.

**Step 3: Commit:**
```bash
cd /c/Users/julie/EDH && git add src/app/\(app\)/dashboards/\[id\]/builder-client.tsx && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(ui): builder reorder steps via dnd-kit sortable"
```

### Task 7.3: Drag from palette to steps zone

**Step 1:** Make palette items draggable (own `useDraggable`). Make the steps zone a `useDroppable`. On drop : append the dragged item to the steps array (with proper `step_type` + ref). The DndContext lives at the page level so palette → steps drag works.

**Step 2:** Verify : drag a palette item into the empty steps zone → it appears at the end → auto-save fires.

**Step 3: Commit:**
```bash
cd /c/Users/julie/EDH && git add src/app/\(app\)/dashboards/\[id\]/builder-client.tsx && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(ui): drag from palette to steps zone via dnd-kit"
```

---

## Phase 8 — Visualisation

### Task 8.1: Fetch /data + state

**Files:** Modify `src/app/(app)/dashboards/[id]/builder-client.tsx`

**Step 1:** Add `useEffect` that calls `GET /api/dashboards/[id]/data` whenever the steps array OR date range OR `updated_at` changes. Use a separate state `computedData: ComputedStep[] | null`.

**Step 2:** Render below the steps zone : if `loading` show "Chargement…", if 0 steps show "Ajoutez au moins une étape", if error show "Impossible de charger les données".

**Step 3: Commit:**
```bash
cd /c/Users/julie/EDH && git add src/app/\(app\)/dashboards/\[id\]/builder-client.tsx && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(ui): builder fetch /data on changes + loading/empty/error states"
```

### Task 8.2: BarChart horizontal

**Files:**
- Create: `src/app/(app)/dashboards/[id]/funnel-chart.tsx`

**Step 1:** Component receives `ComputedStep[]`. Render `<BarChart layout="vertical" data={...}>` with `<YAxis type="category" dataKey="label" />`, `<XAxis type="number" />`, single `<Bar dataKey="count" fill="#27272a" />`. Compute conversion vs previous + vs first as derived state, show as labels.

**Step 2:** Wire into builder-client below the steps zone.

**Step 3:** Verify in dev with seeded data : 3 steps with counts 1000 / 300 / 100 render decreasing horizontal bars.

**Step 4: Commit:**
```bash
cd /c/Users/julie/EDH && git add src/app/\(app\)/dashboards/\[id\]/funnel-chart.tsx src/app/\(app\)/dashboards/\[id\]/builder-client.tsx && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(ui): funnel BarChart horizontal recharts"
```

### Task 8.3: Table récap

**Files:**
- Create: `src/app/(app)/dashboards/[id]/funnel-table.tsx`

**Step 1:** Plain HTML `<table>`, 4 columns : Étape, Volume, Conv. vs précédent, Conv. vs étape 1. Format percentages with one decimal, gracefully render `—` for the first row's "vs précédent" and "vs étape 1".

**Step 2:** Wire below the chart.

**Step 3: Commit:**
```bash
cd /c/Users/julie/EDH && git add src/app/\(app\)/dashboards/\[id\]/funnel-table.tsx src/app/\(app\)/dashboards/\[id\]/builder-client.tsx && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(ui): funnel table récap (volumes + conversions)"
```

---

## Phase 9 — Polish

### Task 9.1: Source disparue → étape grisée

**Step 1:** When `available: false` from `/data`, render the step row with `opacity-40` + badge "indisponible" + tooltip "Cet event n'existe plus pour cette école". The chart still includes it (count = 0).

**Step 2: Commit:**
```bash
cd /c/Users/julie/EDH && git add src/app/\(app\)/dashboards/\[id\]/builder-client.tsx && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(ui): builder grisé + badge pour les étapes dont la source a disparu"
```

### Task 9.2: Lint + build clean

```bash
cd /c/Users/julie/EDH && npm run lint && npm run build
```

Fix any new warning/error introduced by the feature.

**Step 2:** Run all tests : `npx vitest run`. Expected : all green, no regression.

**Step 3:** If anything is fixed, commit :
```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "chore: lint + build clean for /dashboards"
```

---

## Phase 10 — Deploy + smoke prod

### Task 10.1: Push + redeploy VPS

```bash
cd /c/Users/julie/EDH && git push origin main
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 \
  "sudo bash -c 'cd /root/edh && git pull && docker compose up -d --build'"
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 \
  "sudo docker logs --tail 20 edh-app"
```

Expected: container restarts, no error in logs.

### Task 10.2: Smoke test prod

1. Open https://edh.messagingme.app, log in.
2. Click sub-nav `Mes tableaux` → empty list, create funnel "Smoke test".
3. Drag 2 mm events + 1 URL click → bar chart renders with non-zero counts.
4. Switch école → list resets to that école's dashboards (empty).
5. Switch back → "Smoke test" still there.
6. Delete "Smoke test" → confirm gone.

### Task 10.3: Update CLAUDE.md + features.md + wip.md → todo.md

**Files:** Modify `CLAUDE.md` (add row "12 — Mes tableaux" to the state table), `features.md` (add Mes tableaux user-facing description), `wip.md` → clear, `todo.md` → add follow-ups (autres types de report, partage, export CSV).

**Step 2: Commit:**
```bash
cd /c/Users/julie/EDH && git add CLAUDE.md features.md wip.md todo.md && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "docs: Mes tableaux live en prod — update CLAUDE/features/wip/todo" && git push origin main
```

---

## Done criteria

- All 10 phases committed and pushed.
- `npm run build` + `npm run lint` + `npx vitest run` green from `/c/Users/julie/EDH`.
- https://edh.messagingme.app/dashboards loads, builder works end-to-end on at least 2 schools.
- DB rows visible in Supabase for the test funnel.
