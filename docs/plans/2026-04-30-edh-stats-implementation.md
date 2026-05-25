# EDH Stats Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a multi-school dashboard for EDH with tracked URL redirects (server-side click counting per template) and a stats tab comparing custom-event volumetry from messagingme.app with redirect click rates, deployed via Docker on VPS at https://edh.messagingme.app.

**Architecture:** Single Next.js 15 container behind existing Nginx Proxy Manager on VPS OVH (146.59.233.252). Supabase as DB (REST). 10 schools driven by env-var bearer tokens + a `SCHOOLS` constant; school context stored in cookie, sidebar switcher. Internal `node-cron` runs nightly at 22:00 Europe/Paris, syncing all 10 schools sequentially via incremental watermark.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind 4, shadcn/ui, Supabase JS v2 (service-role), bcryptjs + jose (auth), node-cron, nanoid, date-fns + date-fns-tz, Recharts 3, vitest, Docker (node:22-alpine).

**Reference design:** `docs/plans/2026-04-30-edh-stats-design.md` (validated 2026-04-30).

**Workspace:** Main worktree `C:\Users\julie\EDH\`. Every Bash call that touches the repo MUST start with `cd /c/Users/julie/EDH && ...` (per global CLAUDE.md). NEVER work in `.claude/worktrees/*`.

**Git identity for commits** (no global config in this env): use `git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit ...` for every commit.

---

## Phase 0 — Repo init

### Task 0.1: Scaffold Next.js 15 + TypeScript

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `next-env.d.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `postcss.config.mjs`, `tailwind.config.ts`

**Step 1: Init via create-next-app (non-interactive)**

```bash
cd /c/Users/julie/EDH && npx --yes create-next-app@15 . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack --use-npm
```

Notes: command runs inside the existing repo dir; `.gitignore` already exists (don't overwrite, accept the prompt or merge after). If `create-next-app` complains about non-empty dir, run with `--yes` and let it skip the existing files. Then verify and reconcile.

**Step 2: Verify the scaffold**

```bash
cd /c/Users/julie/EDH && cat package.json | head -30 && ls src/app
```

Expected: `package.json` shows `next: 15.x`, `react: 19.x`, scripts `dev/build/start/lint`. `src/app/` contains `layout.tsx`, `page.tsx`, `globals.css`, `favicon.ico`.

**Step 3: Configure `next.config.mjs` for standalone output**

Edit `next.config.mjs`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    optimizePackageImports: ["recharts", "date-fns", "lucide-react", "@supabase/supabase-js"],
  },
};

export default nextConfig;
```

**Step 4: Verify build works**

```bash
cd /c/Users/julie/EDH && npm run build 2>&1 | tail -20
```

Expected: build succeeds with output `▲ Next.js 15.x.x` and "Generating static pages". A `.next/standalone/` directory must exist after build.

**Step 5: Commit**

```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "chore: scaffold Next.js 15 with TypeScript + Tailwind"
```

---

### Task 0.2: Install runtime dependencies

**Files:** modify `package.json` via `npm install`

**Step 1: Install deps**

```bash
cd /c/Users/julie/EDH && npm install @supabase/supabase-js bcryptjs jose nanoid node-cron zod date-fns date-fns-tz recharts lucide-react
```

**Step 2: Install dev deps**

```bash
cd /c/Users/julie/EDH && npm install -D @types/bcryptjs @types/node-cron vitest @vitest/ui supertest @types/supertest tsx
```

**Step 3: Add test scripts to `package.json`**

Edit `package.json` `scripts`:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "test": "vitest run",
  "test:watch": "vitest",
  "seed:users": "tsx scripts/seed-users.ts"
}
```

**Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

**Step 5: Smoke-test vitest**

Create `tests/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";
describe("smoke", () => {
  it("runs", () => expect(1 + 1).toBe(2));
});
```

Run: `cd /c/Users/julie/EDH && npm test`
Expected: `1 passed`.

**Step 6: Commit**

```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "chore: install runtime + test deps, add vitest config"
```

---

### Task 0.3: Init shadcn/ui

**Step 1: Init shadcn**

```bash
cd /c/Users/julie/EDH && npx --yes shadcn@latest init -y -d
```

Use defaults: New York style, neutral, CSS vars. This creates `components.json`, `lib/utils.ts` (via alias `@/lib/utils`), and tweaks `globals.css` + `tailwind.config.ts`.

**Step 2: Add components we'll need**

```bash
cd /c/Users/julie/EDH && npx shadcn@latest add -y button input label card dialog dropdown-menu accordion select toast sonner
```

**Step 3: Verify**

```bash
cd /c/Users/julie/EDH && ls src/components/ui
```

Expected: `button.tsx`, `input.tsx`, `card.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `accordion.tsx`, `select.tsx`, `sonner.tsx`, etc.

**Step 4: Commit**

```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "chore: init shadcn/ui with base components"
```

---

### Task 0.4: Create `.env.example` + load helpers

**Files:**
- Create: `.env.example`, `src/lib/env.ts`

**Step 1: `.env.example`**

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://odmpeakltuzwvtydbpfu.supabase.co
SUPABASE_SERVICE_ROLE_KEY=

# Auth
AUTH_SECRET=
INTERNAL_API_KEY=

# Messagingme
MESSAGINGME_API_BASE=https://ai.messagingme.app/api
MM_TOKEN_EFAP=
MM_TOKEN_ISCOM=
MM_TOKEN_ICART=
MM_TOKEN_SCHOOL_4=
MM_TOKEN_SCHOOL_5=
MM_TOKEN_SCHOOL_6=
MM_TOKEN_SCHOOL_7=
MM_TOKEN_SCHOOL_8=
MM_TOKEN_SCHOOL_9=
MM_TOKEN_SCHOOL_10=

# Misc
CRON_TIMEZONE=Europe/Paris
PUBLIC_BASE_URL=https://edh.messagingme.app
```

**Step 2: `src/lib/env.ts`** — single source of truth

```ts
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export const env = {
  supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseServiceKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  authSecret: required("AUTH_SECRET"),
  internalApiKey: required("INTERNAL_API_KEY"),
  messagingmeBase: process.env.MESSAGINGME_API_BASE ?? "https://ai.messagingme.app/api",
  cronTimezone: process.env.CRON_TIMEZONE ?? "Europe/Paris",
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:3000",
} as const;

export function getSchoolToken(envVarName: string): string | undefined {
  return process.env[envVarName];
}
```

**Step 3: Local `.env.local` (NOT committed) — create with real Supabase values**

```bash
cd /c/Users/julie/EDH && cp .env.example .env.local
```

Then edit `.env.local` and fill in (values provided privately by Julien — see Supabase dashboard for service-role key, see brainstorming session transcript for the EFAP bearer token, generate the auth secrets locally):
- `SUPABASE_SERVICE_ROLE_KEY=` (Supabase dashboard → Project Settings → API → service_role key, starts with `sb_secret_`)
- `AUTH_SECRET=` (run `openssl rand -hex 32` and paste)
- `INTERNAL_API_KEY=` (run `openssl rand -hex 24` and paste)
- `MM_TOKEN_EFAP=` (provided by Julien — Bearer for EFAP messagingme account)

Verify `.env.local` is gitignored (`.gitignore` already has `.env.local`).

**Step 4: Commit `.env.example` only**

```bash
cd /c/Users/julie/EDH && git add .env.example src/lib/env.ts && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "chore: env vars contract + .env.example"
```

---

## Phase 1 — DB schema (Supabase)

### Task 1.1: Init migrations folder

**Files:**
- Create: `supabase/migrations/001_init.sql`

**Step 1: Write the migration**

`supabase/migrations/001_init.sql`:

```sql
-- 001_init.sql — EDH Stats schema

-- Users
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Redirect events (one tracked URL = one row)
CREATE TABLE IF NOT EXISTS redirect_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_slug text NOT NULL,
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_redirect_events_school_archived
  ON redirect_events (school_slug, archived_at);

-- Redirect versions (destination history)
CREATE TABLE IF NOT EXISTS redirect_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES redirect_events(id) ON DELETE CASCADE,
  destination_url text NOT NULL,
  version         int NOT NULL,
  active_from     timestamptz NOT NULL DEFAULT now(),
  active_to       timestamptz
);

-- only one active version per event
CREATE UNIQUE INDEX IF NOT EXISTS uniq_redirect_versions_active
  ON redirect_versions (event_id) WHERE active_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_redirect_versions_event
  ON redirect_versions (event_id, version);

-- Clicks (one row per click)
CREATE TABLE IF NOT EXISTS clicks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES redirect_events(id) ON DELETE CASCADE,
  version_id  uuid NOT NULL REFERENCES redirect_versions(id) ON DELETE CASCADE,
  clicked_at  timestamptz NOT NULL DEFAULT now(),
  ip          inet,
  user_agent  text,
  referer     text,
  country     text
);

CREATE INDEX IF NOT EXISTS idx_clicks_event_clicked_at
  ON clicks (event_id, clicked_at);

CREATE INDEX IF NOT EXISTS idx_clicks_version
  ON clicks (version_id);

-- Messagingme custom events cache
CREATE TABLE IF NOT EXISTS mm_events (
  school_slug    text NOT NULL,
  event_ns       text NOT NULL,
  name           text NOT NULL,
  description    text,
  text_label     text,
  price_label    text,
  number_label   text,
  last_synced_at timestamptz,
  PRIMARY KEY (school_slug, event_ns)
);

-- Messagingme occurrences (one row per occurrence)
CREATE TABLE IF NOT EXISTS mm_occurrences (
  id            bigint NOT NULL,
  school_slug   text NOT NULL,
  event_ns      text NOT NULL,
  user_ns       text,
  text_value    text,
  price_value   numeric,
  number_value  numeric,
  occurred_at   timestamptz NOT NULL,
  PRIMARY KEY (school_slug, id),
  FOREIGN KEY (school_slug, event_ns) REFERENCES mm_events(school_slug, event_ns) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mm_occurrences_school_event_occurred
  ON mm_occurrences (school_slug, event_ns, occurred_at);

-- Sync state per (school, event)
CREATE TABLE IF NOT EXISTS mm_sync_state (
  school_slug         text NOT NULL,
  event_ns            text NOT NULL,
  last_occurrence_id  bigint,
  last_run_at         timestamptz,
  last_run_status     text,
  last_run_error      text,
  PRIMARY KEY (school_slug, event_ns)
);
```

**Step 2: Verify file**

```bash
cd /c/Users/julie/EDH && wc -l supabase/migrations/001_init.sql
```

Expected: ~80 lines.

**Step 3: Commit**

```bash
cd /c/Users/julie/EDH && git add supabase/ && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(db): initial schema migration 001"
```

---

### Task 1.2: Apply migration manually via Supabase SQL Editor

**Step 1: Open SQL Editor in Supabase dashboard**

Navigate to https://supabase.com/dashboard/project/odmpeakltuzwvtydbpfu/sql/new

**Step 2: Paste the contents of `supabase/migrations/001_init.sql` and Run**

Expected: "Success. No rows returned" or similar.

**Step 3: Verify tables exist**

In SQL Editor:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;
```

Expected: `clicks, mm_events, mm_occurrences, mm_sync_state, redirect_events, redirect_versions, users` (7 tables).

**Step 4: No commit needed** (migration file already committed in 1.1).

---

## Phase 2 — Auth (login + middleware + sessions)

### Task 2.1: Supabase service client (singleton)

**Files:**
- Create: `src/lib/supabase/service.ts`

**Step 1: Implement**

```ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_client) {
    _client = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false },
    });
  }
  return _client;
}
```

**Step 2: Smoke test**

Create `src/lib/supabase/service.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";

describe("supabase service client", () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    process.env.AUTH_SECRET = "test-secret";
    process.env.INTERNAL_API_KEY = "test-internal";
  });

  it("returns same instance across calls (singleton)", async () => {
    const { getSupabase } = await import("./service");
    const a = getSupabase();
    const b = getSupabase();
    expect(a).toBe(b);
  });
});
```

Run: `cd /c/Users/julie/EDH && npm test -- src/lib/supabase`
Expected: PASS.

**Step 3: Commit**

```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(db): supabase service client singleton"
```

---

### Task 2.2: Session helpers (sign, verify, cookie)

**Files:**
- Create: `src/lib/auth/session.ts`, `src/lib/auth/session.test.ts`

**Step 1: Write failing test**

`src/lib/auth/session.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";

describe("auth session", () => {
  beforeAll(() => {
    process.env.AUTH_SECRET = "0".repeat(64);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
    process.env.INTERNAL_API_KEY = "x";
  });

  it("signs and verifies a session token round-trip", async () => {
    const { signSession, verifySession } = await import("./session");
    const token = await signSession({ userId: "u1", email: "a@b.c" });
    const payload = await verifySession(token);
    expect(payload?.userId).toBe("u1");
    expect(payload?.email).toBe("a@b.c");
  });

  it("returns null on tampered token", async () => {
    const { signSession, verifySession } = await import("./session");
    const token = await signSession({ userId: "u1", email: "a@b.c" });
    const bad = token.slice(0, -3) + "AAA";
    const payload = await verifySession(bad);
    expect(payload).toBeNull();
  });
});
```

Run: `cd /c/Users/julie/EDH && npm test -- src/lib/auth`
Expected: FAIL (module not found).

**Step 2: Implement**

`src/lib/auth/session.ts`:

```ts
import { SignJWT, jwtVerify } from "jose";
import { env } from "@/lib/env";

export interface SessionPayload {
  userId: string;
  email: string;
}

const secret = () => new TextEncoder().encode(env.authSecret);

const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export async function signSession(p: SessionPayload): Promise<string> {
  return await new SignJWT({ userId: p.userId, email: p.email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (typeof payload.userId !== "string" || typeof payload.email !== "string") return null;
    return { userId: payload.userId, email: payload.email };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = "edh_session";
export const SESSION_COOKIE_TTL = TTL_SECONDS;
```

**Step 3: Run test**

```bash
cd /c/Users/julie/EDH && npm test -- src/lib/auth
```

Expected: 2 PASS.

**Step 4: Commit**

```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(auth): session sign/verify with jose JWT HS256"
```

---

### Task 2.3: Login API + page

**Files:**
- Create: `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts`, `src/app/login/page.tsx`, `src/app/login/login-form.tsx`

**Step 1: Write failing test for login API**

`tests/api/auth/login.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/service", () => ({
  getSupabase: vi.fn(),
}));

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "0".repeat(64);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
    process.env.INTERNAL_API_KEY = "x";
  });

  it("returns 401 when email not found", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as any).mockReturnValue({
      from: () => ({
        select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
      }),
    });
    const { POST } = await import("@/app/api/auth/login/route");
    const req = new Request("http://x/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "x@y.z", password: "wrong" }),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(401);
  });

  it("returns 200 + cookie on valid credentials", async () => {
    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.hash("hunter2", 10);
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({
              data: { id: "u1", email: "a@b.c", password_hash: hash, name: "A" },
              error: null,
            }),
          }),
        }),
      }),
    });
    const { POST } = await import("@/app/api/auth/login/route");
    const req = new Request("http://x/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.c", password: "hunter2" }),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("edh_session=");
    expect(setCookie).toContain("HttpOnly");
  });
});
```

Run: `cd /c/Users/julie/EDH && npm test -- tests/api/auth`
Expected: FAIL (module not found).

**Step 2: Implement `src/app/api/auth/login/route.ts`**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getSupabase } from "@/lib/supabase/service";
import { signSession, SESSION_COOKIE_NAME, SESSION_COOKIE_TTL } from "@/lib/auth/session";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const { email, password } = parsed.data;
  const sb = getSupabase();
  const { data: user, error } = await sb
    .from("users")
    .select("id, email, password_hash, name")
    .eq("email", email)
    .single();

  if (error || !user) return NextResponse.json({ error: "invalid credentials" }, { status: 401 });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return NextResponse.json({ error: "invalid credentials" }, { status: 401 });

  const token = await signSession({ userId: user.id, email: user.email });
  const res = NextResponse.json({ ok: true, user: { id: user.id, email: user.email, name: user.name } });
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_COOKIE_TTL,
    path: "/",
  });
  return res;
}
```

**Step 3: Implement `src/app/api/auth/logout/route.ts`**

```ts
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, "", { maxAge: 0, path: "/" });
  return res;
}
```

**Step 4: Run test**

```bash
cd /c/Users/julie/EDH && npm test -- tests/api/auth
```

Expected: 2 PASS.

**Step 5: Implement login page UI**

`src/app/login/page.tsx`:

```tsx
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="min-h-screen grid place-items-center bg-zinc-50 p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-center mb-6">EDH Stats</h1>
        <LoginForm />
      </div>
    </main>
  );
}
```

`src/app/login/login-form.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setError("Identifiants incorrects.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 bg-white p-6 rounded-lg shadow border">
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      </div>
      <div>
        <Label htmlFor="password">Mot de passe</Label>
        <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Connexion…" : "Se connecter"}
      </Button>
    </form>
  );
}
```

**Step 6: Commit**

```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(auth): login API + UI form, logout endpoint"
```

---

### Task 2.4: Edge middleware (auth gating)

**Files:**
- Create: `src/middleware.ts`

**Step 1: Implement**

```ts
import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth/session";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout"];

function isPublic(pathname: string): boolean {
  if (pathname.startsWith("/r/")) return true;
  if (pathname.startsWith("/_next/") || pathname.startsWith("/favicon")) return true;
  return PUBLIC_PATHS.includes(pathname);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const payload = token ? await verifySession(token) : null;
  if (!payload) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

**Step 2: Manual sanity check**

```bash
cd /c/Users/julie/EDH && npm run build
```

Expected: build succeeds, no runtime errors about middleware.

**Step 3: Commit**

```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(auth): edge middleware redirects unauthenticated to /login"
```

---

### Task 2.5: Seed script + run it

**Files:**
- Create: `scripts/seed-users.ts`

**Step 1: Implement script**

```ts
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import path from "node:path";

config({ path: path.resolve(process.cwd(), ".env.local") });

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function upsertUser(email: string, name: string, password: string) {
  const password_hash = await bcrypt.hash(password, 10);
  const { error } = await sb.from("users").upsert(
    { email, name, password_hash },
    { onConflict: "email" }
  );
  if (error) throw error;
  console.log(`✓ ${email}`);
}

async function main() {
  await upsertUser("julien@messagingme.fr", "Julien Dumas", process.env.SEED_JULIEN_PASSWORD ?? "ChangeMe123!");
  await upsertUser("contact@edh.fr", "EDH", process.env.SEED_EDH_PASSWORD ?? "ChangeMe123!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Note: the EDH email is a placeholder — replace with the actual address Julien provides.

**Step 2: Add `dotenv`**

```bash
cd /c/Users/julie/EDH && npm install -D dotenv
```

**Step 3: Run seed**

```bash
cd /c/Users/julie/EDH && SEED_JULIEN_PASSWORD='<choose>' SEED_EDH_PASSWORD='<choose>' npm run seed:users
```

Expected: `✓ julien@messagingme.fr` and `✓ contact@edh.fr`.

**Step 4: Verify in Supabase SQL Editor**

```sql
SELECT email, name FROM users;
```

Expected: 2 rows.

**Step 5: Commit (script only)**

```bash
cd /c/Users/julie/EDH && git add scripts/ package.json package-lock.json && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(auth): seed-users script"
```

---

## Phase 3 — School context (constant + sidebar + cookie)

### Task 3.1: SCHOOLS constant + token loader

**Files:**
- Create: `src/lib/schools.ts`, `src/lib/schools.test.ts`

**Step 1: Write failing test**

`src/lib/schools.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";

describe("schools", () => {
  beforeEach(() => {
    process.env.MM_TOKEN_EFAP = "tok-efap";
    delete process.env.MM_TOKEN_ISCOM;
  });

  it("exposes the SCHOOLS constant", async () => {
    const { SCHOOLS } = await import("./schools");
    expect(SCHOOLS.length).toBe(10);
    expect(SCHOOLS[0].slug).toBe("efap");
  });

  it("isValidSchoolSlug accepts known slugs only", async () => {
    const { isValidSchoolSlug } = await import("./schools");
    expect(isValidSchoolSlug("efap")).toBe(true);
    expect(isValidSchoolSlug("nope")).toBe(false);
  });

  it("getSchoolToken returns env value when set", async () => {
    const { getSchoolToken } = await import("./schools");
    expect(getSchoolToken("efap")).toBe("tok-efap");
    expect(getSchoolToken("iscom")).toBeUndefined();
  });
});
```

Run: `cd /c/Users/julie/EDH && npm test -- src/lib/schools`
Expected: FAIL.

**Step 2: Implement**

`src/lib/schools.ts`:

```ts
export interface School {
  slug: string;
  name: string;
  tokenEnv: string;
}

export const SCHOOLS: readonly School[] = [
  { slug: "efap",     name: "EFAP",     tokenEnv: "MM_TOKEN_EFAP" },
  { slug: "iscom",    name: "ISCOM",    tokenEnv: "MM_TOKEN_ISCOM" },
  { slug: "icart",    name: "ICART",    tokenEnv: "MM_TOKEN_ICART" },
  { slug: "school-4", name: "École 4",  tokenEnv: "MM_TOKEN_SCHOOL_4" },
  { slug: "school-5", name: "École 5",  tokenEnv: "MM_TOKEN_SCHOOL_5" },
  { slug: "school-6", name: "École 6",  tokenEnv: "MM_TOKEN_SCHOOL_6" },
  { slug: "school-7", name: "École 7",  tokenEnv: "MM_TOKEN_SCHOOL_7" },
  { slug: "school-8", name: "École 8",  tokenEnv: "MM_TOKEN_SCHOOL_8" },
  { slug: "school-9", name: "École 9",  tokenEnv: "MM_TOKEN_SCHOOL_9" },
  { slug: "school-10",name: "École 10", tokenEnv: "MM_TOKEN_SCHOOL_10" },
] as const;

const SLUG_SET = new Set(SCHOOLS.map((s) => s.slug));

export function isValidSchoolSlug(slug: string): boolean {
  return SLUG_SET.has(slug);
}

export function getSchoolBySlug(slug: string): School | undefined {
  return SCHOOLS.find((s) => s.slug === slug);
}

export function getSchoolToken(slug: string): string | undefined {
  const s = getSchoolBySlug(slug);
  if (!s) return undefined;
  return process.env[s.tokenEnv];
}

export const DEFAULT_SCHOOL_SLUG = SCHOOLS[0].slug;
```

**Step 3: Run test**

Expected: 3 PASS.

**Step 4: Commit**

```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(schools): SCHOOLS constant + token loader"
```

---

### Task 3.2: Server-side school context (cookie read/write)

**Files:**
- Create: `src/lib/schools/context.ts`

**Step 1: Implement**

```ts
import { cookies } from "next/headers";
import { isValidSchoolSlug, DEFAULT_SCHOOL_SLUG } from "@/lib/schools";

export const SCHOOL_COOKIE_NAME = "edh_school";

export async function getCurrentSchoolSlug(): Promise<string> {
  const c = await cookies();
  const v = c.get(SCHOOL_COOKIE_NAME)?.value;
  if (v && isValidSchoolSlug(v)) return v;
  return DEFAULT_SCHOOL_SLUG;
}
```

**Step 2: API to set school**

`src/app/api/school/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { isValidSchoolSlug } from "@/lib/schools";
import { SCHOOL_COOKIE_NAME } from "@/lib/schools/context";

const Body = z.object({ slug: z.string() });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isValidSchoolSlug(parsed.data.slug)) {
    return NextResponse.json({ error: "invalid slug" }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SCHOOL_COOKIE_NAME, parsed.data.slug, {
    httpOnly: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return res;
}
```

**Step 3: Commit**

```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(schools): cookie-based current school context + API"
```

---

### Task 3.3: App layout with sidebar

**Files:**
- Create: `src/app/(app)/layout.tsx`, `src/app/(app)/sidebar.tsx`, `src/app/(app)/page.tsx`

Move the existing `src/app/page.tsx` into `src/app/(app)/page.tsx` (route group `(app)` for auth-gated pages).

**Step 1: Move existing page**

```bash
cd /c/Users/julie/EDH && mkdir -p "src/app/(app)" && git mv src/app/page.tsx "src/app/(app)/page.tsx"
```

**Step 2: Edit `src/app/(app)/page.tsx`** — replace boilerplate with redirect to `/urls`:

```tsx
import { redirect } from "next/navigation";
export default function HomePage() {
  redirect("/urls");
}
```

**Step 3: Layout `src/app/(app)/layout.tsx`**

```tsx
import { Sidebar } from "./sidebar";
import { getCurrentSchoolSlug } from "@/lib/schools/context";
import { SCHOOLS } from "@/lib/schools";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const currentSlug = await getCurrentSchoolSlug();
  return (
    <div className="min-h-screen flex">
      <Sidebar schools={SCHOOLS.map((s) => ({ slug: s.slug, name: s.name }))} currentSlug={currentSlug} />
      <main className="flex-1 p-6 bg-zinc-50">{children}</main>
    </div>
  );
}
```

**Step 4: `src/app/(app)/sidebar.tsx`**

```tsx
"use client";
import { useRouter } from "next/navigation";

export function Sidebar({
  schools,
  currentSlug,
}: {
  schools: { slug: string; name: string }[];
  currentSlug: string;
}) {
  const router = useRouter();

  async function selectSchool(slug: string) {
    await fetch("/api/school", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug }),
    });
    router.refresh();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="w-56 bg-white border-r flex flex-col p-4 space-y-1">
      <h1 className="font-semibold text-lg mb-4">EDH Stats</h1>
      <p className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Écoles</p>
      {schools.map((s) => (
        <button
          key={s.slug}
          onClick={() => selectSchool(s.slug)}
          className={`text-left px-3 py-2 rounded text-sm ${
            s.slug === currentSlug ? "bg-zinc-900 text-white" : "hover:bg-zinc-100"
          }`}
        >
          {s.name}
        </button>
      ))}
      <div className="flex-1" />
      <button onClick={logout} className="text-sm text-zinc-500 hover:text-zinc-900 text-left px-3 py-2">
        Se déconnecter
      </button>
    </aside>
  );
}
```

**Step 5: Smoke test**

```bash
cd /c/Users/julie/EDH && npm run dev
```

Open `http://localhost:3000` → should redirect to `/login`. Login with seeded creds → should redirect to `/urls` (which 404s for now). Sidebar should show 10 schools, switching updates the cookie. Stop the server.

**Step 6: Commit**

```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(ui): app layout with school sidebar + logout"
```

---

## Phase 4 — Redirect endpoint `/r/:slug`

### Task 4.1: Slug+version lookup with mem cache

**Files:**
- Create: `src/lib/redirect/lookup.ts`, `src/lib/redirect/lookup.test.ts`

**Step 1: Write failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/service", () => ({
  getSupabase: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
  process.env.AUTH_SECRET = "0".repeat(64);
  process.env.INTERNAL_API_KEY = "x";
});

describe("lookupSlug", () => {
  it("returns null when slug not found or archived", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }),
    });
    const { lookupSlug } = await import("./lookup");
    expect(await lookupSlug("nope")).toBeNull();
  });

  it("returns event + active version when present", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as any).mockReturnValue({
      from: (table: string) => {
        if (table === "redirect_events") {
          return {
            select: () => ({
              eq: () => ({
                is: () => ({
                  maybeSingle: () => Promise.resolve({
                    data: { id: "e1", slug: "abc", school_slug: "efap" },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        // redirect_versions
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: () => Promise.resolve({
                  data: { id: "v1", destination_url: "https://x.test/p", version: 1 },
                  error: null,
                }),
              }),
            }),
          }),
        };
      },
    });
    const { lookupSlug } = await import("./lookup");
    const r = await lookupSlug("abc");
    expect(r?.destinationUrl).toBe("https://x.test/p");
    expect(r?.eventId).toBe("e1");
  });
});
```

Run: FAIL.

**Step 2: Implement**

```ts
import { getSupabase } from "@/lib/supabase/service";

export interface RedirectLookup {
  eventId: string;
  versionId: string;
  destinationUrl: string;
  schoolSlug: string;
}

const TTL_MS = 60_000;
const cache = new Map<string, { value: RedirectLookup | null; expiresAt: number }>();

export async function lookupSlug(slug: string): Promise<RedirectLookup | null> {
  const cached = cache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const sb = getSupabase();
  const { data: ev } = await sb
    .from("redirect_events")
    .select("id, slug, school_slug")
    .eq("slug", slug)
    .is("archived_at", null)
    .maybeSingle();

  if (!ev) {
    cache.set(slug, { value: null, expiresAt: Date.now() + TTL_MS });
    return null;
  }

  const { data: ver } = await sb
    .from("redirect_versions")
    .select("id, destination_url, version")
    .eq("event_id", ev.id)
    .is("active_to", null)
    .maybeSingle();

  if (!ver) {
    cache.set(slug, { value: null, expiresAt: Date.now() + TTL_MS });
    return null;
  }

  const value: RedirectLookup = {
    eventId: ev.id,
    versionId: ver.id,
    destinationUrl: ver.destination_url,
    schoolSlug: ev.school_slug,
  };
  cache.set(slug, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

export function invalidateSlugCache(slug: string) {
  cache.delete(slug);
}
```

**Step 3: Run tests** — expect PASS.

**Step 4: Commit**

```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(redirect): slug lookup with 60s mem cache"
```

---

### Task 4.2: `/r/:slug` route handler

**Files:**
- Create: `src/app/r/[slug]/route.ts`, `tests/api/redirect.test.ts`

**Step 1: Failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/redirect/lookup", () => ({
  lookupSlug: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({
  getSupabase: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("GET /r/:slug", () => {
  it("returns 404 when slug unknown", async () => {
    const { lookupSlug } = await import("@/lib/redirect/lookup");
    (lookupSlug as any).mockResolvedValue(null);
    const { GET } = await import("@/app/r/[slug]/route");
    const res = await GET(new Request("http://x/r/nope") as any, { params: Promise.resolve({ slug: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("returns 302 to destination when slug found", async () => {
    const { lookupSlug } = await import("@/lib/redirect/lookup");
    (lookupSlug as any).mockResolvedValue({
      eventId: "e1",
      versionId: "v1",
      destinationUrl: "https://acme.test/p",
      schoolSlug: "efap",
    });
    const { getSupabase } = await import("@/lib/supabase/service");
    const insert = vi.fn().mockResolvedValue({ error: null });
    (getSupabase as any).mockReturnValue({ from: () => ({ insert }) });
    const { GET } = await import("@/app/r/[slug]/route");
    const res = await GET(new Request("http://x/r/abc") as any, { params: Promise.resolve({ slug: "abc" }) });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://acme.test/p");
  });
});
```

Run: FAIL.

**Step 2: Implement `src/app/r/[slug]/route.ts`**

```ts
import { NextResponse } from "next/server";
import { lookupSlug } from "@/lib/redirect/lookup";
import { getSupabase } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ slug: string }> }
) {
  const { slug } = await ctx.params;
  const lookup = await lookupSlug(slug);
  if (!lookup) {
    return new NextResponse("Lien introuvable.", { status: 404 });
  }

  // Capture client metadata before redirecting
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;
  const referer = req.headers.get("referer") ?? null;

  // Fire-and-forget click insert (don't block redirect)
  void getSupabase()
    .from("clicks")
    .insert({
      event_id: lookup.eventId,
      version_id: lookup.versionId,
      ip,
      user_agent: userAgent,
      referer,
    })
    .then(({ error }: { error: { message?: string } | null }) => {
      if (error) console.error(JSON.stringify({ level: "error", msg: "click insert failed", err: error.message }));
    });

  return NextResponse.redirect(lookup.destinationUrl, { status: 302 });
}
```

**Step 3: Run tests** — expect PASS.

**Step 4: Commit**

```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(redirect): /r/:slug handler with non-blocking click insert"
```

---

### Task 4.3: Rate-limit middleware on `/r/:slug`

**Files:**
- Create: `src/lib/redirect/rate-limit.ts`
- Modify: `src/app/r/[slug]/route.ts`

**Step 1: Implement in-memory token bucket**

```ts
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 100;

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

export function checkRate(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now - b.windowStart > WINDOW_MS) {
    buckets.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (b.count >= MAX_PER_WINDOW) return false;
  b.count++;
  return true;
}

// Periodic cleanup to prevent unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.windowStart > WINDOW_MS) buckets.delete(k);
  }
}, WINDOW_MS).unref?.();
```

**Step 2: Integrate in route handler**

In `src/app/r/[slug]/route.ts`, before lookup:

```ts
import { checkRate } from "@/lib/redirect/rate-limit";
// ...
const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
if (!checkRate(ip)) {
  return new NextResponse("Trop de requêtes.", { status: 429 });
}
```

(reorder so `ip` is computed once and reused).

**Step 3: Verify build**

```bash
cd /c/Users/julie/EDH && npm run build 2>&1 | tail -10
```

Expected: build OK.

**Step 4: Commit**

```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(redirect): in-memory rate-limit 100 hits/IP/min on /r/:slug"
```

---

## Phase 5 — Onglet URLs (CRUD events + versions)

### Task 5.1: Server actions / API for events

**Files:**
- Create: `src/app/api/events/route.ts`, `src/app/api/events/[id]/versions/route.ts`, `src/app/api/events/[id]/route.ts`

**Step 1: Failing tests** in `tests/api/events.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/service");
vi.mock("@/lib/schools/context", () => ({
  getCurrentSchoolSlug: vi.fn().mockResolvedValue("efap"),
  SCHOOL_COOKIE_NAME: "edh_school",
}));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: vi.fn().mockResolvedValue({ userId: "u1", email: "a@b.c" }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("POST /api/events", () => {
  it("400 on invalid URL", async () => {
    const { POST } = await import("@/app/api/events/route");
    const res = await POST(new Request("http://x/api/events", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x", destinationUrl: "javascript:alert(1)" }),
    }) as any);
    expect(res.status).toBe(400);
  });

  it("creates event + v1 version on success", async () => {
    const insertEvent = vi.fn().mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: { id: "e1", slug: "abcd1234" }, error: null }) }),
    });
    const insertVersion = vi.fn().mockResolvedValue({ error: null });
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as any).mockReturnValue({
      from: (t: string) => t === "redirect_events" ? { insert: insertEvent } : { insert: insertVersion },
    });
    const { POST } = await import("@/app/api/events/route");
    const res = await POST(new Request("http://x/api/events", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "template_CESINE", destinationUrl: "https://acme.test/p" }),
    }) as any);
    expect(res.status).toBe(200);
    expect(insertEvent).toHaveBeenCalled();
    expect(insertVersion).toHaveBeenCalled();
  });
});
```

**Step 2: Helper `requireUser`**

`src/lib/auth/require-user.ts`:

```ts
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE_NAME, SessionPayload } from "./session";

export async function requireUser(): Promise<SessionPayload> {
  const c = await cookies();
  const tok = c.get(SESSION_COOKIE_NAME)?.value;
  if (!tok) throw Object.assign(new Error("unauthenticated"), { status: 401 });
  const payload = await verifySession(tok);
  if (!payload) throw Object.assign(new Error("invalid session"), { status: 401 });
  return payload;
}
```

**Step 3: Implement `POST /api/events`**

`src/app/api/events/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { customAlphabet } from "nanoid";
import { getSupabase } from "@/lib/supabase/service";
import { getCurrentSchoolSlug } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";

const slugGen = customAlphabet("23456789abcdefghjkmnpqrstuvwxyz", 8);

const Body = z.object({
  name: z.string().min(1).max(120),
  destinationUrl: z.string().url().refine((u) => /^https?:/i.test(u), "must be http(s)"),
});

export async function POST(req: Request) {
  let user;
  try { user = await requireUser(); } catch { return NextResponse.json({ error: "unauth" }, { status: 401 }); }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body", details: parsed.error.flatten() }, { status: 400 });

  const schoolSlug = await getCurrentSchoolSlug();
  const sb = getSupabase();

  // retry on slug collision (very rare)
  for (let i = 0; i < 3; i++) {
    const slug = slugGen();
    const { data: ev, error: e1 } = await sb
      .from("redirect_events")
      .insert({ school_slug: schoolSlug, slug, name: parsed.data.name, created_by: user.userId })
      .select("id, slug")
      .single();
    if (e1) {
      if ((e1 as any).code === "23505") continue; // unique violation, retry
      return NextResponse.json({ error: "db error", details: e1.message }, { status: 500 });
    }
    const { error: e2 } = await sb
      .from("redirect_versions")
      .insert({ event_id: ev.id, destination_url: parsed.data.destinationUrl, version: 1 });
    if (e2) return NextResponse.json({ error: "db error", details: e2.message }, { status: 500 });

    return NextResponse.json({ ok: true, id: ev.id, slug: ev.slug });
  }
  return NextResponse.json({ error: "slug collision" }, { status: 500 });
}
```

**Step 4: Implement `GET /api/events`** (list for current school, non-archived) — append in same file:

```ts
export async function GET() {
  try { await requireUser(); } catch { return NextResponse.json({ error: "unauth" }, { status: 401 }); }
  const schoolSlug = await getCurrentSchoolSlug();
  const sb = getSupabase();

  const { data: events, error } = await sb
    .from("redirect_events")
    .select("id, slug, name, created_at")
    .eq("school_slug", schoolSlug)
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // For each event, fetch the active version + click count + last click. We'll keep this simple
  // (N+1) for now; can be optimized with an RPC later.
  const enriched = await Promise.all(
    (events ?? []).map(async (ev) => {
      const { data: ver } = await sb
        .from("redirect_versions")
        .select("id, destination_url, version, active_from")
        .eq("event_id", ev.id)
        .is("active_to", null)
        .maybeSingle();
      const { count } = await sb
        .from("clicks")
        .select("*", { count: "exact", head: true })
        .eq("event_id", ev.id);
      const { data: lastClick } = await sb
        .from("clicks")
        .select("clicked_at")
        .eq("event_id", ev.id)
        .order("clicked_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return {
        id: ev.id,
        slug: ev.slug,
        name: ev.name,
        createdAt: ev.created_at,
        currentVersion: ver,
        clickCount: count ?? 0,
        lastClickAt: lastClick?.clicked_at ?? null,
      };
    })
  );
  return NextResponse.json({ events: enriched });
}
```

**Step 5: `POST /api/events/[id]/versions`** (new version)

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabase } from "@/lib/supabase/service";
import { getCurrentSchoolSlug } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";
import { invalidateSlugCache } from "@/lib/redirect/lookup";

const Body = z.object({
  destinationUrl: z.string().url().refine((u) => /^https?:/i.test(u), "must be http(s)"),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try { await requireUser(); } catch { return NextResponse.json({ error: "unauth" }, { status: 401 }); }
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const schoolSlug = await getCurrentSchoolSlug();
  const sb = getSupabase();

  // verify event belongs to current school
  const { data: ev } = await sb
    .from("redirect_events")
    .select("id, slug, school_slug")
    .eq("id", id)
    .maybeSingle();
  if (!ev || ev.school_slug !== schoolSlug) return NextResponse.json({ error: "not found" }, { status: 404 });

  // close current version
  const now = new Date().toISOString();
  const { error: e1 } = await sb
    .from("redirect_versions")
    .update({ active_to: now })
    .eq("event_id", id)
    .is("active_to", null);
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

  // find max version
  const { data: maxRow } = await sb
    .from("redirect_versions")
    .select("version")
    .eq("event_id", id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (maxRow?.version ?? 0) + 1;

  const { error: e2 } = await sb
    .from("redirect_versions")
    .insert({ event_id: id, destination_url: parsed.data.destinationUrl, version: nextVersion });
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  invalidateSlugCache(ev.slug);
  return NextResponse.json({ ok: true, version: nextVersion });
}
```

**Step 6: `PATCH/DELETE /api/events/[id]`** — rename + archive

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabase } from "@/lib/supabase/service";
import { getCurrentSchoolSlug } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";
import { invalidateSlugCache } from "@/lib/redirect/lookup";

const Patch = z.object({ name: z.string().min(1).max(120) });

async function ownedByCurrentSchool(id: string): Promise<{ slug: string } | null> {
  const sb = getSupabase();
  const schoolSlug = await getCurrentSchoolSlug();
  const { data } = await sb
    .from("redirect_events").select("slug, school_slug").eq("id", id).maybeSingle();
  if (!data || data.school_slug !== schoolSlug) return null;
  return { slug: data.slug };
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try { await requireUser(); } catch { return NextResponse.json({ error: "unauth" }, { status: 401 }); }
  const { id } = await ctx.params;
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const owned = await ownedByCurrentSchool(id);
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { error } = await getSupabase()
    .from("redirect_events").update({ name: parsed.data.name }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try { await requireUser(); } catch { return NextResponse.json({ error: "unauth" }, { status: 401 }); }
  const { id } = await ctx.params;
  const owned = await ownedByCurrentSchool(id);
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { error } = await getSupabase()
    .from("redirect_events").update({ archived_at: new Date().toISOString() }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  invalidateSlugCache(owned.slug);
  return NextResponse.json({ ok: true });
}
```

**Step 7: Run tests**

```bash
cd /c/Users/julie/EDH && npm test -- tests/api/events
```

Expected: PASS.

**Step 8: Commit**

```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(events): create + list + new-version + rename + archive APIs"
```

---

### Task 5.2: URLs page UI

**Files:**
- Create: `src/app/(app)/urls/page.tsx`, `src/app/(app)/urls/urls-client.tsx`, `src/app/(app)/urls/new-event-dialog.tsx`, `src/app/(app)/urls/edit-destination-dialog.tsx`

**Step 1: Server page** `src/app/(app)/urls/page.tsx`:

```tsx
import { UrlsClient } from "./urls-client";
import { env } from "@/lib/env";

export default function UrlsPage() {
  return <UrlsClient publicBaseUrl={env.publicBaseUrl} />;
}
```

**Step 2: Client component `urls-client.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NewEventDialog } from "./new-event-dialog";
import { EditDestinationDialog } from "./edit-destination-dialog";
import { Copy, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast, Toaster } from "sonner";

interface EventRow {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  currentVersion: { id: string; destination_url: string; version: number; active_from: string } | null;
  clickCount: number;
  lastClickAt: string | null;
}

export function UrlsClient({ publicBaseUrl }: { publicBaseUrl: string }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openNew, setOpenNew] = useState(false);
  const [editing, setEditing] = useState<EventRow | null>(null);

  async function load() {
    setLoading(true);
    const r = await fetch("/api/events");
    const j = await r.json();
    setEvents(j.events ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function copyShortUrl(slug: string) {
    await navigator.clipboard.writeText(`${publicBaseUrl}/r/${slug}`);
    toast.success("URL copiée");
  }

  async function archive(id: string) {
    if (!confirm("Archiver cet événement ?")) return;
    await fetch(`/api/events/${id}`, { method: "DELETE" });
    toast.success("Archivé");
    load();
  }

  async function rename(ev: EventRow) {
    const name = prompt("Nouveau nom :", ev.name);
    if (!name || name === ev.name) return;
    await fetch(`/api/events/${ev.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    load();
  }

  return (
    <div className="space-y-4">
      <Toaster />
      <header className="flex justify-between items-center">
        <div className="flex gap-2">
          <a href="/urls" className="px-3 py-1.5 rounded bg-zinc-900 text-white text-sm">URLs</a>
          <a href="/stats" className="px-3 py-1.5 rounded hover:bg-zinc-100 text-sm">Stats</a>
        </div>
        <Button onClick={() => setOpenNew(true)}>+ Nouvel événement</Button>
      </header>
      <h2 className="text-xl font-semibold">Mes URLs trackées</h2>
      {loading ? (
        <p className="text-zinc-500">Chargement…</p>
      ) : events.length === 0 ? (
        <p className="text-zinc-500">Aucune URL pour cette école. Cliquez sur « + Nouvel événement ».</p>
      ) : (
        <div className="space-y-3">
          {events.map((ev) => (
            <Card key={ev.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium">{ev.name}</h3>
                  <div className="text-sm text-zinc-600 flex items-center gap-2 mt-1">
                    <code className="bg-zinc-100 px-2 py-0.5 rounded">{publicBaseUrl}/r/{ev.slug}</code>
                    <button onClick={() => copyShortUrl(ev.slug)} className="hover:bg-zinc-100 p-1 rounded">
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="text-sm text-zinc-500 mt-1 truncate">
                    → {ev.currentVersion?.destination_url ?? "(aucune destination)"}
                    {ev.currentVersion && <span className="ml-2 text-xs">v{ev.currentVersion.version}</span>}
                  </p>
                  <p className="text-xs text-zinc-400 mt-1">
                    {ev.clickCount} clic{ev.clickCount !== 1 ? "s" : ""}
                    {ev.lastClickAt && ` · dernier clic ${new Date(ev.lastClickAt).toLocaleString("fr-FR")}`}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="p-1.5 rounded hover:bg-zinc-100">
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => setEditing(ev)}>Modifier la destination</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => rename(ev)}>Renommer</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => archive(ev.id)} className="text-red-600">Archiver</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </Card>
          ))}
        </div>
      )}
      <NewEventDialog open={openNew} onOpenChange={setOpenNew} onCreated={load} />
      <EditDestinationDialog
        event={editing}
        onOpenChange={(o) => !o && setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />
    </div>
  );
}
```

**Step 3: `new-event-dialog.tsx`**

```tsx
"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function NewEventDialog({ open, onOpenChange, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const r = await fetch("/api/events", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, destinationUrl: url }),
    });
    setSubmitting(false);
    if (r.ok) {
      toast.success("Événement créé");
      setName(""); setUrl("");
      onOpenChange(false);
      onCreated();
    } else {
      const j = await r.json().catch(() => ({}));
      toast.error(j.error ?? "Erreur");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nouvel événement</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="n">Nom (ex: template_CESINE)</Label>
            <Input id="n" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="u">URL de destination</Label>
            <Input id="u" type="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} required />
          </div>
          <Button type="submit" disabled={submitting}>{submitting ? "Création…" : "Créer"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 4: `edit-destination-dialog.tsx`** (analogous, posts to `/api/events/:id/versions`)

```tsx
"use client";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function EditDestinationDialog({ event, onOpenChange, onSaved }: {
  event: { id: string; currentVersion: { destination_url: string } | null } | null;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl(event?.currentVersion?.destination_url ?? "");
  }, [event]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!event) return;
    const r = await fetch(`/api/events/${event.id}/versions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ destinationUrl: url }),
    });
    if (r.ok) { toast.success("Nouvelle version créée"); onSaved(); }
    else { toast.error("Erreur"); }
  }

  return (
    <Dialog open={!!event} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Modifier la destination</DialogTitle></DialogHeader>
        <p className="text-sm text-zinc-500">Le slug ne change pas. Une nouvelle version est créée et les clics futurs lui sont attribués.</p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="u2">URL</Label>
            <Input id="u2" type="url" value={url} onChange={(e) => setUrl(e.target.value)} required />
          </div>
          <Button type="submit">Enregistrer</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 5: Manual smoke test**

```bash
cd /c/Users/julie/EDH && npm run dev
```

Login → `/urls` shows empty list → create event with name `test_url` + `https://example.com` → card appears with short URL → click "Modifier la destination" → change URL → confirm new version saved → click the short URL in a new tab → must redirect (will probably hit issues if dev server runs without env var fully filled — verify).

**Step 6: Commit**

```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(urls): UI page with create + edit-destination + rename + archive"
```

---

## Phase 6 — Messagingme client + cron + sync

### Task 6.1: Messagingme HTTP client

**Files:**
- Create: `src/lib/messagingme/client.ts`, `src/lib/messagingme/client.test.ts`

**Step 1: Failing test**

```ts
import { describe, it, expect, vi } from "vitest";

describe("messagingme client", () => {
  it("listEvents paginates and aggregates", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ name: "a", event_ns: "1", description: "", text_label: "", price_label: "", number_label: "" }],
        meta: { current_page: 1, last_page: 2 },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ name: "b", event_ns: "2", description: "", text_label: "", price_label: "", number_label: "" }],
        meta: { current_page: 2, last_page: 2 },
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { listEvents } = await import("./client");
    const r = await listEvents({ token: "t", base: "https://api.test/api" });
    expect(r.length).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
```

**Step 2: Implement**

```ts
export interface MmEvent {
  name: string;
  event_ns: string;
  description: string;
  text_label: string;
  price_label: string;
  number_label: string;
}

export interface MmOccurrence {
  id: number;
  user_ns: string;
  event_ns: string;
  text_value: string;
  price_value: string;
  number_value: number;
  created_at: string;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { current_page: number; last_page: number };
}

interface ClientOpts { token: string; base: string; }

async function fetchWithRetry(url: string, init: RequestInit, retries = 2): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, init);
      if (r.status >= 500 && i < retries) {
        await new Promise((res) => setTimeout(res, 500 * (i + 1)));
        continue;
      }
      return r;
    } catch (err) {
      if (i === retries) throw err;
      await new Promise((res) => setTimeout(res, 500 * (i + 1)));
    }
  }
  throw new Error("unreachable");
}

export async function listEvents(opts: ClientOpts): Promise<MmEvent[]> {
  const all: MmEvent[] = [];
  let page = 1;
  while (true) {
    const r = await fetchWithRetry(`${opts.base}/flow/custom-events?page=${page}`, {
      headers: { Authorization: `Bearer ${opts.token}`, Accept: "application/json" },
    });
    if (!r.ok) throw new Error(`listEvents ${r.status}`);
    const j = (await r.json()) as PaginatedResponse<MmEvent>;
    all.push(...j.data);
    if (j.meta.current_page >= j.meta.last_page) break;
    page++;
  }
  return all;
}

export async function* iterOccurrences(
  opts: ClientOpts,
  eventNs: string
): AsyncGenerator<MmOccurrence[], void, void> {
  let page = 1;
  while (true) {
    const url = `${opts.base}/flow/custom-events/data?event_ns=${encodeURIComponent(eventNs)}&page=${page}`;
    const r = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${opts.token}`, Accept: "application/json" },
    });
    if (!r.ok) throw new Error(`iterOccurrences ${r.status}`);
    const j = (await r.json()) as PaginatedResponse<MmOccurrence>;
    yield j.data;
    if (j.meta.current_page >= j.meta.last_page) break;
    page++;
  }
}
```

**Step 3: Test passes**

**Step 4: Commit**

```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(mm): messagingme HTTP client (list events + iterate occurrences with retry)"
```

---

### Task 6.2: Sync logic per school

**Files:**
- Create: `src/lib/messagingme/sync.ts`, `src/lib/messagingme/sync.test.ts`

**Step 1: Failing test** — verify watermark stops pagination

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase/service");
vi.mock("@/lib/messagingme/client");

describe("syncSchool", () => {
  it("stops paginating once it sees an id <= last_occurrence_id", async () => {
    const { listEvents } = await import("@/lib/messagingme/client") as any;
    listEvents.mockResolvedValue([
      { name: "a", event_ns: "ns1", description: "", text_label: "", price_label: "", number_label: "" },
    ]);
    const iter = (await import("@/lib/messagingme/client")) as any;
    iter.iterOccurrences = async function* () {
      yield [{ id: 100, user_ns: "u", event_ns: "ns1", text_value: "", price_value: "0", number_value: 1, created_at: "2026-04-01T00:00:00Z" }];
      yield [{ id: 99, user_ns: "u", event_ns: "ns1", text_value: "", price_value: "0", number_value: 1, created_at: "2026-03-31T00:00:00Z" }];
      yield [{ id: 98, user_ns: "u", event_ns: "ns1", text_value: "", price_value: "0", number_value: 1, created_at: "2026-03-30T00:00:00Z" }];
    };
    const { getSupabase } = await import("@/lib/supabase/service");
    const upserts: any[] = [];
    const inserts: any[] = [];
    (getSupabase as any).mockReturnValue({
      from: (t: string) => {
        if (t === "mm_events") return { upsert: (rows: any) => { upserts.push(rows); return Promise.resolve({ error: null }); } };
        if (t === "mm_occurrences") return { insert: (rows: any) => { inserts.push(...(Array.isArray(rows) ? rows : [rows])); return Promise.resolve({ error: null }); } };
        if (t === "mm_sync_state") {
          return {
            select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { last_occurrence_id: 99 } }) }) }) }),
            upsert: () => Promise.resolve({ error: null }),
          };
        }
        return {};
      },
    });
    const { syncSchool } = await import("./sync");
    await syncSchool({ slug: "efap", name: "EFAP", tokenEnv: "MM_TOKEN_EFAP" }, "tok");
    // Should only ingest id 100 (id 99 == watermark, stop)
    expect(inserts.map((r) => r.id)).toEqual([100]);
  });
});
```

**Step 2: Implement `src/lib/messagingme/sync.ts`**

```ts
import { getSupabase } from "@/lib/supabase/service";
import { listEvents, iterOccurrences, MmOccurrence } from "./client";
import { env } from "@/lib/env";
import type { School } from "@/lib/schools";

export async function syncSchool(school: School, token: string): Promise<void> {
  const sb = getSupabase();
  const base = env.messagingmeBase;
  const events = await listEvents({ token, base });

  // Refresh mm_events
  if (events.length > 0) {
    const { error } = await sb.from("mm_events").upsert(
      events.map((e) => ({
        school_slug: school.slug,
        event_ns: e.event_ns,
        name: e.name,
        description: e.description,
        text_label: e.text_label,
        price_label: e.price_label,
        number_label: e.number_label,
        last_synced_at: new Date().toISOString(),
      })),
      { onConflict: "school_slug,event_ns" }
    );
    if (error) throw error;
  }

  for (const ev of events) {
    try {
      await syncEventOccurrences(school.slug, ev.event_ns);
      await sb.from("mm_sync_state").upsert(
        {
          school_slug: school.slug,
          event_ns: ev.event_ns,
          last_run_at: new Date().toISOString(),
          last_run_status: "success",
          last_run_error: null,
        },
        { onConflict: "school_slug,event_ns" }
      );
    } catch (err: any) {
      console.error(JSON.stringify({ level: "error", msg: "sync failed", school: school.slug, event_ns: ev.event_ns, err: String(err?.message ?? err) }));
      await sb.from("mm_sync_state").upsert(
        {
          school_slug: school.slug,
          event_ns: ev.event_ns,
          last_run_at: new Date().toISOString(),
          last_run_status: "error",
          last_run_error: String(err?.message ?? err),
        },
        { onConflict: "school_slug,event_ns" }
      );
    }
  }
}

async function syncEventOccurrences(schoolSlug: string, eventNs: string): Promise<void> {
  const sb = getSupabase();

  const { data: state } = await sb
    .from("mm_sync_state")
    .select("last_occurrence_id")
    .eq("school_slug", schoolSlug)
    .eq("event_ns", eventNs)
    .maybeSingle();
  const watermark = state?.last_occurrence_id ?? 0;

  let maxIngested = watermark;
  // We need a token from env — pass it through
  const token = process.env[`MM_TOKEN_${schoolSlug.toUpperCase().replace(/-/g, "_")}`];
  // Actually rely on caller passing token; reconstruct via re-read
  // ...this whole function needs the token in scope. Simpler: take it as param.
}
```

**Note for executor:** the function above is sketched. Refactor `syncEventOccurrences` to accept the token + base as args (passed down from `syncSchool`). The watermark logic:

```ts
async function syncEventOccurrences(schoolSlug: string, eventNs: string, token: string, base: string) {
  const sb = getSupabase();
  const { data: state } = await sb
    .from("mm_sync_state")
    .select("last_occurrence_id")
    .eq("school_slug", schoolSlug)
    .eq("event_ns", eventNs)
    .maybeSingle();
  const watermark = state?.last_occurrence_id ?? 0;

  let maxIngested = watermark;
  outer: for await (const batch of iterOccurrences({ token, base }, eventNs)) {
    const fresh: MmOccurrence[] = [];
    for (const occ of batch) {
      if (occ.id <= watermark) break outer;
      fresh.push(occ);
      if (occ.id > maxIngested) maxIngested = occ.id;
    }
    if (fresh.length > 0) {
      const { error } = await sb.from("mm_occurrences").insert(
        fresh.map((o) => ({
          id: o.id,
          school_slug: schoolSlug,
          event_ns: o.event_ns,
          user_ns: o.user_ns,
          text_value: o.text_value,
          price_value: o.price_value,
          number_value: o.number_value,
          occurred_at: o.created_at,
        }))
      );
      if (error) throw error;
    }
  }

  if (maxIngested > watermark) {
    await sb.from("mm_sync_state").upsert(
      { school_slug: schoolSlug, event_ns: eventNs, last_occurrence_id: maxIngested },
      { onConflict: "school_slug,event_ns" }
    );
  }
}
```

Then `syncSchool` calls `syncEventOccurrences(school.slug, ev.event_ns, token, base)`.

**Step 3: Add `syncAllSchools()` driver**

```ts
import { SCHOOLS, getSchoolToken } from "@/lib/schools";

export async function syncAllSchools(): Promise<{ ok: number; errors: number }> {
  let ok = 0; let errors = 0;
  for (const school of SCHOOLS) {
    const token = getSchoolToken(school.slug);
    if (!token) {
      console.warn(JSON.stringify({ level: "warn", msg: "skip school, no token", school: school.slug }));
      continue;
    }
    try {
      await syncSchool(school, token);
      ok++;
    } catch (err: any) {
      console.error(JSON.stringify({ level: "error", msg: "school sync failed", school: school.slug, err: String(err?.message ?? err) }));
      errors++;
    }
  }
  return { ok, errors };
}
```

**Step 4: Run test**

```bash
cd /c/Users/julie/EDH && npm test -- src/lib/messagingme/sync
```

Expected: PASS.

**Step 5: Commit**

```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(mm): per-school sync with id-based watermark, syncAllSchools driver"
```

---

### Task 6.3: Cron bootstrap + manual sync endpoint

**Files:**
- Create: `src/instrumentation.ts`, `src/app/api/cron/sync/route.ts`

**Step 1: `src/instrumentation.ts`** — Next.js 15 instrumentation hook

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { default: cron } = await import("node-cron");
  const { syncAllSchools } = await import("@/lib/messagingme/sync");
  const { env } = await import("@/lib/env");

  if (process.env.DISABLE_CRON === "1") {
    console.log(JSON.stringify({ level: "info", msg: "cron disabled (DISABLE_CRON=1)" }));
    return;
  }

  cron.schedule(
    "0 22 * * *",
    async () => {
      console.log(JSON.stringify({ level: "info", msg: "cron tick: syncAllSchools start" }));
      try {
        const r = await syncAllSchools();
        console.log(JSON.stringify({ level: "info", msg: "syncAllSchools done", ...r }));
      } catch (err: any) {
        console.error(JSON.stringify({ level: "error", msg: "syncAllSchools fatal", err: String(err?.message ?? err) }));
      }
    },
    { timezone: env.cronTimezone }
  );
  console.log(JSON.stringify({ level: "info", msg: "cron scheduled 0 22 * * * Europe/Paris" }));
}
```

Edit `next.config.mjs` to enable instrumentation hook (Next 15 has it on by default; if not, add `experimental: { instrumentationHook: true }`).

**Step 2: Manual sync endpoint** `src/app/api/cron/sync/route.ts`

```ts
import { NextResponse } from "next/server";
import { syncAllSchools, syncSchool } from "@/lib/messagingme/sync";
import { getSchoolToken, getSchoolBySlug } from "@/lib/schools";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${env.internalApiKey}`) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const url = new URL(req.url);
  const schoolSlug = url.searchParams.get("school");

  if (schoolSlug) {
    const school = getSchoolBySlug(schoolSlug);
    const token = getSchoolToken(schoolSlug);
    if (!school || !token) return NextResponse.json({ error: "unknown school or missing token" }, { status: 400 });
    await syncSchool(school, token);
    return NextResponse.json({ ok: true, school: schoolSlug });
  }

  const r = await syncAllSchools();
  return NextResponse.json({ ok: true, ...r });
}
```

**Step 3: Manual smoke test (local)**

```bash
cd /c/Users/julie/EDH && DISABLE_CRON=1 npm run dev
```

In another terminal:

```bash
curl -X POST -H "Authorization: Bearer <INTERNAL_API_KEY>" "http://localhost:3000/api/cron/sync?school=efap"
```

Expected: `{"ok":true,"school":"efap"}` after a 30s-2min wait. In Supabase SQL Editor:

```sql
SELECT COUNT(*) FROM mm_events WHERE school_slug='efap';   -- > 0
SELECT COUNT(*) FROM mm_occurrences WHERE school_slug='efap';  -- > 0
SELECT * FROM mm_sync_state WHERE school_slug='efap';   -- success status
```

Expected: counts > 0, status `success`.

**Step 4: Commit**

```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(cron): node-cron 22:00 Europe/Paris + POST /api/cron/sync manual trigger"
```

---

## Phase 7 — Onglet Stats

### Task 7.1: Stats query layer (daily aggregations)

**Files:**
- Create: `src/lib/stats/daily.ts`

**Step 1: Implement** — dayBucket helpers + Supabase queries

```ts
import { getSupabase } from "@/lib/supabase/service";
import { formatInTimeZone } from "date-fns-tz";

const TZ = "Europe/Paris";

export interface DailyPoint { day: string; count: number; }

function dayKey(iso: string): string {
  return formatInTimeZone(new Date(iso), TZ, "yyyy-MM-dd");
}

export async function getCustomEventDaily(schoolSlug: string, eventNs: string, from: string, to: string): Promise<DailyPoint[]> {
  const sb = getSupabase();
  // pagination through occurrences in [from, to+23:59:59]
  const fromIso = `${from}T00:00:00+02:00`;
  const toIso = `${to}T23:59:59+02:00`;
  const buckets = new Map<string, number>();
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from("mm_occurrences")
      .select("occurred_at")
      .eq("school_slug", schoolSlug)
      .eq("event_ns", eventNs)
      .gte("occurred_at", fromIso)
      .lte("occurred_at", toIso)
      .order("occurred_at")
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) {
      const k = dayKey(row.occurred_at);
      buckets.set(k, (buckets.get(k) ?? 0) + 1);
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return fillRange(from, to, buckets);
}

export async function getClicksDaily(eventId: string, from: string, to: string): Promise<DailyPoint[]> {
  const sb = getSupabase();
  const fromIso = `${from}T00:00:00+02:00`;
  const toIso = `${to}T23:59:59+02:00`;
  const buckets = new Map<string, number>();
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from("clicks")
      .select("clicked_at")
      .eq("event_id", eventId)
      .gte("clicked_at", fromIso)
      .lte("clicked_at", toIso)
      .order("clicked_at")
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) {
      const k = dayKey(row.clicked_at);
      buckets.set(k, (buckets.get(k) ?? 0) + 1);
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return fillRange(from, to, buckets);
}

function fillRange(from: string, to: string, buckets: Map<string, number>): DailyPoint[] {
  const out: DailyPoint[] = [];
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const k = formatInTimeZone(d, TZ, "yyyy-MM-dd");
    out.push({ day: k, count: buckets.get(k) ?? 0 });
  }
  return out;
}
```

**Note:** the `+02:00` offset is a simplification — for daylight-saving correctness we'd compute the offset per-day in Europe/Paris. For an internal tool with daily granularity this is acceptable; the executor can refine if a DST boundary causes a 1-day skew.

**Step 2: Commit**

```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(stats): daily aggregation helpers (Europe/Paris buckets)"
```

---

### Task 7.2: Stats APIs

**Files:**
- Create: `src/app/api/stats/custom-events/route.ts`, `src/app/api/stats/custom-events/[event_ns]/daily/route.ts`, `src/app/api/stats/clicks/[event_id]/daily/route.ts`

**Step 1: `GET /api/stats/custom-events`** — list mm_events of current school + count over period

```ts
import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase/service";
import { getCurrentSchoolSlug } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";
import { z } from "zod";

const Q = z.object({ from: z.string(), to: z.string() });

export async function GET(req: Request) {
  try { await requireUser(); } catch { return NextResponse.json({ error: "unauth" }, { status: 401 }); }
  const url = new URL(req.url);
  const parsed = Q.safeParse({ from: url.searchParams.get("from"), to: url.searchParams.get("to") });
  if (!parsed.success) return NextResponse.json({ error: "missing from/to" }, { status: 400 });

  const schoolSlug = await getCurrentSchoolSlug();
  const sb = getSupabase();

  const { data: events, error } = await sb
    .from("mm_events")
    .select("event_ns, name, description")
    .eq("school_slug", schoolSlug)
    .order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const fromIso = `${parsed.data.from}T00:00:00+02:00`;
  const toIso = `${parsed.data.to}T23:59:59+02:00`;
  const counts = await Promise.all(
    (events ?? []).map(async (ev) => {
      const { count } = await sb
        .from("mm_occurrences")
        .select("*", { count: "exact", head: true })
        .eq("school_slug", schoolSlug)
        .eq("event_ns", ev.event_ns)
        .gte("occurred_at", fromIso)
        .lte("occurred_at", toIso);
      return { ...ev, count: count ?? 0 };
    })
  );

  const { data: syncs } = await sb
    .from("mm_sync_state")
    .select("event_ns, last_run_at, last_run_status, last_run_error")
    .eq("school_slug", schoolSlug);

  return NextResponse.json({ events: counts, syncs: syncs ?? [] });
}
```

**Step 2: Daily endpoints**

`src/app/api/stats/custom-events/[event_ns]/daily/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getCurrentSchoolSlug } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";
import { getCustomEventDaily } from "@/lib/stats/daily";

export async function GET(req: Request, ctx: { params: Promise<{ event_ns: string }> }) {
  try { await requireUser(); } catch { return NextResponse.json({ error: "unauth" }, { status: 401 }); }
  const { event_ns } = await ctx.params;
  const url = new URL(req.url);
  const from = url.searchParams.get("from"); const to = url.searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "missing from/to" }, { status: 400 });
  const schoolSlug = await getCurrentSchoolSlug();
  const series = await getCustomEventDaily(schoolSlug, event_ns, from, to);
  return NextResponse.json({ series });
}
```

`src/app/api/stats/clicks/[event_id]/daily/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase/service";
import { getCurrentSchoolSlug } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";
import { getClicksDaily } from "@/lib/stats/daily";

export async function GET(req: Request, ctx: { params: Promise<{ event_id: string }> }) {
  try { await requireUser(); } catch { return NextResponse.json({ error: "unauth" }, { status: 401 }); }
  const { event_id } = await ctx.params;
  const url = new URL(req.url);
  const from = url.searchParams.get("from"); const to = url.searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "missing from/to" }, { status: 400 });
  const schoolSlug = await getCurrentSchoolSlug();

  // Verify ownership
  const { data: ev } = await getSupabase()
    .from("redirect_events").select("school_slug").eq("id", event_id).maybeSingle();
  if (!ev || ev.school_slug !== schoolSlug) return NextResponse.json({ error: "not found" }, { status: 404 });

  const series = await getClicksDaily(event_id, from, to);
  return NextResponse.json({ series });
}
```

**Step 3: Verify build**

```bash
cd /c/Users/julie/EDH && npm run build 2>&1 | tail -10
```

Expected: build OK.

**Step 4: Commit**

```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(stats): API endpoints for custom-events list + daily series"
```

---

### Task 7.3: Stats UI page with accordions + comparison

**Files:**
- Create: `src/app/(app)/stats/page.tsx`, `src/app/(app)/stats/stats-client.tsx`, `src/app/(app)/stats/event-accordion.tsx`

Structure:
- `stats-client.tsx` holds the date range + accordion list
- `event-accordion.tsx` is one accordion item (lazy-loads its data on open)

**Step 1: `src/app/(app)/stats/page.tsx`**

```tsx
import { StatsClient } from "./stats-client";
export default function StatsPage() {
  return <StatsClient />;
}
```

**Step 2: `stats-client.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import { Accordion } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EventAccordion } from "./event-accordion";
import { toast, Toaster } from "sonner";

interface MmEventListItem { event_ns: string; name: string; description: string | null; count: number; }
interface SyncState { event_ns: string; last_run_at: string | null; last_run_status: string | null; last_run_error: string | null; }

function presetDates(days: number) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days + 1);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

export function StatsClient() {
  const [{ from, to }, setRange] = useState(() => presetDates(30));
  const [events, setEvents] = useState<MmEventListItem[]>([]);
  const [syncs, setSyncs] = useState<SyncState[]>([]);
  const [loading, setLoading] = useState(false);
  const [resync, setResync] = useState(false);

  async function load() {
    setLoading(true);
    const r = await fetch(`/api/stats/custom-events?from=${from}&to=${to}`);
    const j = await r.json();
    setEvents(j.events ?? []);
    setSyncs(j.syncs ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, [from, to]);

  async function manualResync() {
    setResync(true);
    const r = await fetch("/api/cron/sync", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? ""}` },
    });
    setResync(false);
    if (r.ok) { toast.success("Sync terminé"); load(); }
    else { toast.error("Erreur sync"); }
  }

  const lastSync = syncs.reduce<string | null>((acc, s) => {
    if (!s.last_run_at) return acc;
    if (!acc || s.last_run_at > acc) return s.last_run_at;
    return acc;
  }, null);

  return (
    <div className="space-y-4">
      <Toaster />
      <header className="flex justify-between items-center">
        <div className="flex gap-2">
          <a href="/urls" className="px-3 py-1.5 rounded hover:bg-zinc-100 text-sm">URLs</a>
          <a href="/stats" className="px-3 py-1.5 rounded bg-zinc-900 text-white text-sm">Stats</a>
        </div>
      </header>

      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <Label>Du</Label>
          <Input type="date" value={from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        </div>
        <div>
          <Label>Au</Label>
          <Input type="date" value={to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        </div>
        <Button variant="outline" onClick={() => setRange(presetDates(7))}>7j</Button>
        <Button variant="outline" onClick={() => setRange(presetDates(30))}>30j</Button>
        <Button variant="outline" onClick={() => setRange(presetDates(90))}>90j</Button>
      </div>

      <h2 className="text-xl font-semibold">Custom events MessagingMe</h2>

      {loading ? (
        <p className="text-zinc-500">Chargement…</p>
      ) : events.length === 0 ? (
        <p className="text-zinc-500">Aucun custom event pour cette école. Lancez un sync.</p>
      ) : (
        <Accordion type="multiple" className="space-y-2">
          {events.map((ev) => (
            <EventAccordion key={ev.event_ns} ev={ev} from={from} to={to} />
          ))}
        </Accordion>
      )}

      <footer className="text-xs text-zinc-500 flex items-center gap-4 pt-4 border-t">
        <span>Dernier sync MessagingMe : {lastSync ? new Date(lastSync).toLocaleString("fr-FR") : "—"}</span>
        <Button size="sm" variant="ghost" onClick={manualResync} disabled={resync}>
          {resync ? "Sync en cours…" : "⟳ Re-sync"}
        </Button>
      </footer>
    </div>
  );
}
```

**Note:** the manual resync uses `NEXT_PUBLIC_INTERNAL_API_KEY` — but exposing the key client-side defeats its purpose. Better approach: create a tiny `/api/admin/sync` proxy that requires only the user session (no Bearer needed) and internally calls `syncAllSchools()`. The executor should refactor this to a server-only proxy endpoint and remove the Bearer dance from the UI.

Add `src/app/api/admin/sync/route.ts`:

```ts
import { NextResponse } from "next/server";
import { syncAllSchools } from "@/lib/messagingme/sync";
import { requireUser } from "@/lib/auth/require-user";

export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function POST() {
  try { await requireUser(); } catch { return NextResponse.json({ error: "unauth" }, { status: 401 }); }
  const r = await syncAllSchools();
  return NextResponse.json({ ok: true, ...r });
}
```

And in `stats-client.tsx`, change `manualResync` to `fetch("/api/admin/sync", { method: "POST" })`.

**Step 3: `event-accordion.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import { AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from "recharts";

interface DailyPoint { day: string; count: number; }
interface RedirectOption { id: string; name: string; }

export function EventAccordion({ ev, from, to }: {
  ev: { event_ns: string; name: string; count: number };
  from: string; to: string;
}) {
  const [series, setSeries] = useState<DailyPoint[] | null>(null);
  const [redirects, setRedirects] = useState<RedirectOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [clickSeries, setClickSeries] = useState<DailyPoint[] | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function loadOnOpen() {
    if (loaded) return;
    setLoaded(true);
    const [a, b] = await Promise.all([
      fetch(`/api/stats/custom-events/${encodeURIComponent(ev.event_ns)}/daily?from=${from}&to=${to}`).then((r) => r.json()),
      fetch("/api/events").then((r) => r.json()),
    ]);
    setSeries(a.series ?? []);
    setRedirects((b.events ?? []).map((e: any) => ({ id: e.id, name: e.name })));
  }

  // Reload series when range changes
  useEffect(() => {
    if (!loaded) return;
    setSeries(null); setClickSeries(null);
    fetch(`/api/stats/custom-events/${encodeURIComponent(ev.event_ns)}/daily?from=${from}&to=${to}`)
      .then((r) => r.json()).then((j) => setSeries(j.series ?? []));
    if (selectedId) {
      fetch(`/api/stats/clicks/${selectedId}/daily?from=${from}&to=${to}`)
        .then((r) => r.json()).then((j) => setClickSeries(j.series ?? []));
    }
  }, [from, to]);

  async function selectRedirect(id: string) {
    setSelectedId(id);
    const j = await fetch(`/api/stats/clicks/${id}/daily?from=${from}&to=${to}`).then((r) => r.json());
    setClickSeries(j.series ?? []);
  }

  const merged = (series ?? []).map((p, i) => ({
    day: p.day,
    occurrences: p.count,
    clicks: clickSeries?.[i]?.count ?? 0,
    ratio: clickSeries && p.count > 0 ? Number((clickSeries[i].count / p.count).toFixed(3)) : null,
  }));

  const totalOcc = (series ?? []).reduce((s, p) => s + p.count, 0);
  const totalClicks = (clickSeries ?? []).reduce((s, p) => s + p.count, 0);
  const globalRate = totalOcc > 0 ? totalClicks / totalOcc : null;
  const dailyRates = merged.map((m) => m.ratio).filter((r) => r != null) as number[];
  const avgRate = dailyRates.length > 0 ? dailyRates.reduce((s, r) => s + r, 0) / dailyRates.length : null;

  return (
    <AccordionItem value={ev.event_ns} className="border rounded bg-white">
      <AccordionTrigger onClick={loadOnOpen} className="px-4 hover:no-underline">
        <div className="flex justify-between w-full pr-2">
          <span className="font-medium">{ev.name}</span>
          <span className="text-zinc-500 text-sm">{ev.count} occurrence{ev.count !== 1 ? "s" : ""}</span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-4">
        {!series ? <p className="text-sm text-zinc-500">Chargement…</p> : (
          <>
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={merged}>
                  <XAxis dataKey="day" fontSize={10} />
                  <YAxis fontSize={10} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="occurrences" fill="#3b82f6" name="Occurrences" />
                  {selectedId && <Bar dataKey="clicks" fill="#10b981" name="Clics" />}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-sm">Comparer avec :</span>
              <Select value={selectedId ?? ""} onValueChange={selectRedirect}>
                <SelectTrigger className="w-72"><SelectValue placeholder="Sélectionner une URL trackée" /></SelectTrigger>
                <SelectContent>
                  {redirects.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedId && clickSeries && (
              <div className="mt-3 space-y-3">
                <div className="text-sm flex gap-4">
                  <span>Total occurrences : <strong>{totalOcc}</strong></span>
                  <span>Total clics : <strong>{totalClicks}</strong></span>
                  <span>Taux global : <strong>{globalRate != null ? (globalRate * 100).toFixed(1) + "%" : "—"}</strong></span>
                  <span>Taux moyen quotidien : <strong>{avgRate != null ? (avgRate * 100).toFixed(1) + "%" : "—"}</strong></span>
                </div>
                <div className="h-32">
                  <ResponsiveContainer>
                    <LineChart data={merged}>
                      <XAxis dataKey="day" fontSize={10} />
                      <YAxis tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} fontSize={10} />
                      <Tooltip formatter={(v: any) => v != null ? `${(v * 100).toFixed(1)}%` : "—"} />
                      <Line dataKey="ratio" stroke="#a855f7" name="Taux quotidien" connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
```

**Step 4: Manual smoke test**

```bash
cd /c/Users/julie/EDH && npm run dev
```

Login → switch school to EFAP (where data exists) → go to `/stats` → expand "whatsapp envoyé cotonou" → see the histogram → if you have a redirect event with clicks, select it in "Comparer avec…" → see the comparison.

**Step 5: Commit**

```bash
cd /c/Users/julie/EDH && git add -A && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "feat(stats): UI tab with date range, accordions, comparison + ratio chart"
```

---

## Phase 8 — Docker packaging

### Task 8.1: Dockerfile

**Files:**
- Create: `Dockerfile`, `.dockerignore`

**Step 1: `.dockerignore`**

```
node_modules
.next
.git
.env
.env.local
.env.production
*.log
docs
supabase
scripts
tests
```

**Step 2: `Dockerfile`** (multi-stage, alpine, standalone)

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
```

**Step 3: Build locally**

```bash
cd /c/Users/julie/EDH && docker build -t edh-app:local .
```

Expected: image builds, ~150-200 MB.

**Step 4: Run locally**

```bash
docker run --rm -p 3001:3000 --env-file /c/Users/julie/EDH/.env.local -e DISABLE_CRON=1 edh-app:local
```

Open http://localhost:3001 → must show login page.

**Step 5: Commit**

```bash
cd /c/Users/julie/EDH && git add Dockerfile .dockerignore && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "build: Dockerfile multi-stage alpine standalone"
```

---

### Task 8.2: docker-compose for VPS

**Files:**
- Create: `docker-compose.yml`

**Step 1: Identify the existing NPM Docker network on VPS**

SSH to VPS, list networks:

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "sudo docker network ls"
```

Identify the network NPM uses (probably `mcp-robot_default` or similar). Note its name.

**Step 2: `docker-compose.yml`**

```yaml
services:
  edh-app:
    build: .
    image: edh-app:latest
    container_name: edh-app
    restart: unless-stopped
    env_file: .env
    expose:
      - "3000"
    networks:
      - npm

networks:
  npm:
    external: true
    name: mcp-robot_default  # CHANGE THIS to the actual NPM network name
```

**Step 3: Commit**

```bash
cd /c/Users/julie/EDH && git add docker-compose.yml && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "build: docker-compose joining existing NPM network"
```

---

## Phase 9 — Deployment to VPS

### Task 9.1: Clone + first deploy

**Step 1: SSH to VPS, clone the repo into /root/edh**

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "sudo mkdir -p /root/edh && sudo chown ubuntu:ubuntu /root/edh && cd /root/edh && git clone https://github.com/julienmessagingme/edh.git ."
```

Note: if `/root/` requires sudo for git ops, alternatively clone to `/home/ubuntu/edh` and symlink, or run docker compose with sudo. Confirm with Julien which approach matches the existing convention.

**Step 2: Create `.env` on VPS**

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "cd /root/edh && nano .env"
```

Paste the same vars as `.env.local`, plus production `PUBLIC_BASE_URL=https://edh.messagingme.app`. Add ALL 10 `MM_TOKEN_*` env vars (Julien must provide the 9 missing ones).

**Step 3: First build + up**

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "cd /root/edh && sudo docker compose up -d --build"
```

**Step 4: Verify container**

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "sudo docker ps | grep edh-app && sudo docker logs --tail 50 edh-app"
```

Expected: container running, logs show Next.js ready + cron scheduled.

**Step 5: No commit** (deploy step only).

---

### Task 9.2: NPM proxy host

**Step 1: Open NPM admin UI** (whatever URL Julien uses)

**Step 2: Add new Proxy Host**
- Domain: `edh.messagingme.app`
- Forward Hostname / IP: `edh-app`
- Forward Port: `3000`
- Block Common Exploits: ON
- Websockets Support: ON (optional)
- SSL tab: Request a new SSL cert via Let's Encrypt, force SSL, HTTP/2 Support ON.

**Step 3: Verify**

```bash
curl -I https://edh.messagingme.app/login
```

Expected: HTTP 200 with NPM-served HTML.

**Step 4: No commit** (infra config only).

---

### Task 9.3: First production sync + smoke test

**Step 1: Trigger manual sync via Bearer**

```bash
curl -X POST -H "Authorization: Bearer <PROD_INTERNAL_API_KEY>" https://edh.messagingme.app/api/cron/sync
```

Expected: `{"ok":true,"ok":<n>,"errors":<m>}` after up to ~10-20 min for 10 schools.

**Step 2: Verify in Supabase**

```sql
SELECT school_slug, count(*) FROM mm_occurrences GROUP BY school_slug;
```

Expected: rows per school for those with valid tokens.

**Step 3: Smoke test redirect**

In the EDH UI, create a tracked URL `smoke_test` → `https://example.com`. Open the short URL `https://edh.messagingme.app/r/<slug>` in an incognito tab. Then check:

```sql
SELECT * FROM clicks ORDER BY clicked_at DESC LIMIT 5;
```

Expected: 1 row with the IP, UA, etc.

**Step 4: Smoke test stats UI**

Wait until tomorrow's 22:00 cron run, OR trigger manual sync, then verify the Stats tab shows histograms with the comparison working.

**Step 5: No commit** (smoke tests only). Production verified ✅.

---

## Phase 10 — Project docs (5-file convention from CLAUDE.md global)

### Task 10.1: Write CLAUDE.md, documentation.md, features.md, wip.md, todo.md

**Files:** Create at repo root.

**Step 1: `CLAUDE.md`** — short entry point

```markdown
# CLAUDE.md — EDH Stats

Multi-school dashboard for EDH client: tracked URL redirects + custom events stats from messagingme.app. Deployed Docker on VPS at https://edh.messagingme.app.

## Commandes essentielles

```bash
npm run dev          # http://localhost:3000
npm run build        # production build (standalone)
npm run lint
npm test             # vitest unit + API tests
npm run seed:users   # seed users (lit .env.local)
```

## Documentation

- `documentation.md` — archi, stack, schéma DB, env, déploiement
- `features.md` — vue produit URLs + Stats
- `wip.md` — travail en cours
- `todo.md` — backlog
- `docs/plans/2026-04-30-edh-stats-design.md` — design validé
- `docs/plans/2026-04-30-edh-stats-implementation.md` — plan d'exécution

## Workflow VPS

- Main worktree = `C:\Users\julie\EDH`. Chaque Bash call qui touche le repo : `cd /c/Users/julie/EDH && ...`
- Tout sur `main`, jamais de branche `claude/*` ni de worktree.
- Identité git pour les commits (pas de config globale) :
  ```bash
  git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit ...
  ```

## Deploy

```bash
git push origin main
ssh ubuntu@146.59.233.252
cd /root/edh && git pull && sudo docker compose up -d --build
sudo docker logs -f edh-app
```

## Règles spécifiques

- **Le slug d'une URL est immuable** (template WhatsApp validé Meta) — modifier la destination crée une nouvelle version.
- **Migrations SQL appliquées à la main** via Supabase SQL Editor.
- **Le redirect public `/r/:slug` doit toujours marcher** même sans auth, même si la DB est partiellement down (afficher 503 propre, jamais de 500).
- **Cron 22:00 Europe/Paris** dans le process Next.js. `DISABLE_CRON=1` pour le désactiver en dev.
```

**Step 2: `documentation.md`** — copy the relevant technical sections from the design doc (architecture, stack, schéma, env vars, déploiement). Keep it long-form and authoritative.

**Step 3: `features.md`** — product view, no tech jargon:

```markdown
# Features — EDH Stats

## Authentification
- Email + mot de passe. 2 utilisateurs : Julien et EDH, mêmes droits.
- Session 7 jours.

## Switch d'école
- Sidebar gauche, 10 écoles. Cliquer change le contexte de toute l'app (URLs, Stats).

## Onglet "URLs"
- Liste des URLs trackées de l'école courante.
- Créer un événement : nom + URL de destination → l'app génère un slug court (8 chars), l'URL `edh.messagingme.app/r/<slug>` est prête à être collée dans un template WhatsApp.
- Modifier la destination : crée une nouvelle version, le slug ne change pas.
- Renommer / archiver.
- Compteur de clics + dernier clic affichés.

## Onglet "Stats"
- Sélecteur de période (7j / 30j / 90j / custom).
- Liste accordéons : un par custom event MessagingMe de l'école.
- Histogramme journalier des occurrences à l'ouverture.
- Comparaison libre avec une URL trackée → bar chart 2 séries + courbe du taux quotidien (clics/occurrences).
- Bouton ⟳ pour relancer un sync manuel hors de 22:00.
```

**Step 4: `wip.md`** — empty at start

```markdown
# WIP — EDH Stats

(rien en cours)
```

**Step 5: `todo.md`** — backlog from design doc section 15

```markdown
# TODO — EDH Stats

## Backlog

- Hash IP RGPD-strict (actuellement IP en clair, outil interne)
- Retention policy `clicks` (purge > 1 an)
- Export CSV des clics
- Geo-IP enrichment (`country` reste vide)
- A/B testing destinations (split traffic 50/50 entre 2 destinations)
- Webhook side-channel sur clic (notifier un autre service)
- Multi-tenant si d'autres clients que EDH demandent
- Fix DST : la conversion en buckets Europe/Paris assume +02:00 hardcodé (Task 7.1) — utiliser un offset par-jour si une régression apparaît au passage hiver/été
```

**Step 6: Commit**

```bash
cd /c/Users/julie/EDH && git add CLAUDE.md documentation.md features.md wip.md todo.md && git -c user.email="julien@messagingme.fr" -c user.name="Julien Dumas" commit -m "docs: 5-file project doc convention (CLAUDE/documentation/features/wip/todo)"
```

---

## Done

When all phases are committed and pushed:

```bash
cd /c/Users/julie/EDH && git push origin main
```

Verify:
- https://edh.messagingme.app loads, login works.
- Sidebar lists 10 schools, switching works.
- URLs tab CRUD works end-to-end.
- `/r/<slug>` redirects with 302 + click is recorded.
- Stats tab shows histograms; manual re-sync works.
- Cron will fire at 22:00 Europe/Paris automatically.
