import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getSupabase } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/auth/require-user";
import { isValidScopeSlug } from "@/lib/schools";
import type { AdminUser } from "@/lib/admin/types";

export const runtime = "nodejs";

const PostBody = z.object({
  email: z.string().email().toLowerCase(),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(8).max(200),
  is_admin: z.boolean(),
  schools: z.array(z.string()).default([]),
});

export async function GET() {
  try {
    await requireAdmin();
  } catch (e) {
    const status = (e as { status?: number }).status ?? 401;
    return NextResponse.json({ error: "forbidden" }, { status });
  }

  const sb = getSupabase();
  const { data: users, error: uErr } = await sb
    .from("users")
    .select("id, email, name, is_admin, deactivated_at, last_login_at, created_at")
    .order("created_at", { ascending: true });
  if (uErr)
    return NextResponse.json({ error: uErr.message }, { status: 500 });

  const userIds = ((users ?? []) as { id: string }[]).map((u) => u.id);
  let accessByUser = new Map<string, string[]>();
  if (userIds.length > 0) {
    const { data: access, error: aErr } = await sb
      .from("user_school_access")
      .select("user_id, school_slug")
      .in("user_id", userIds);
    if (aErr)
      return NextResponse.json({ error: aErr.message }, { status: 500 });
    accessByUser = (access ?? []).reduce((acc, row) => {
      const r = row as { user_id: string; school_slug: string };
      const arr = acc.get(r.user_id) ?? [];
      arr.push(r.school_slug);
      acc.set(r.user_id, arr);
      return acc;
    }, new Map<string, string[]>());
  }

  const out: AdminUser[] = ((users ?? []) as AdminUser[]).map((u) => ({
    ...u,
    schools: accessByUser.get(u.id) ?? [],
  }));
  return NextResponse.json({ users: out });
}

export async function POST(req: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    const status = (e as { status?: number }).status ?? 401;
    return NextResponse.json({ error: "forbidden" }, { status });
  }

  const parsed = PostBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { email, name, password, is_admin, schools } = parsed.data;
  // isValidScopeSlug autorise les 9 écoles + le scope sentinelle 'edh'.
  const validSchools = schools.filter(isValidScopeSlug);

  const sb = getSupabase();
  const passwordHash = await bcrypt.hash(password, 10);

  const { data: created, error: insErr } = await sb
    .from("users")
    .insert({
      email,
      name,
      password_hash: passwordHash,
      is_admin,
    })
    .select("id")
    .single();
  if (insErr) {
    if ((insErr as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "duplicate", message: "Cet email existe déjà." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  if (validSchools.length > 0) {
    const { error: aErr } = await sb.from("user_school_access").insert(
      validSchools.map((s) => ({
        user_id: created.id,
        school_slug: s,
      }))
    );
    if (aErr)
      return NextResponse.json({ error: aErr.message }, { status: 500 });
  }

  return NextResponse.json({ id: created.id });
}
