import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getSupabase } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/auth/require-user";
import { isValidScopeSlug } from "@/lib/schools";

export const runtime = "nodejs";

const PatchBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    password: z.string().min(8).max(200).optional(),
    is_admin: z.boolean().optional(),
    schools: z.array(z.string()).optional(),
    deactivated_at: z.null().optional(), // only used to reactivate
  })
  .refine((b) => Object.keys(b).length > 0, "empty patch");

/** Count of currently active admins (excluding the given user). */
async function countOtherActiveAdmins(excludeUserId: string): Promise<number> {
  const sb = getSupabase();
  const { count } = await sb
    .from("users")
    .select("*", { count: "exact", head: true })
    .eq("is_admin", true)
    .is("deactivated_at", null)
    .neq("id", excludeUserId);
  return count ?? 0;
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    const status = (e as { status?: number }).status ?? 401;
    return NextResponse.json({ error: "forbidden" }, { status });
  }
  const { id } = await ctx.params;
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const sb = getSupabase();
  const { data: target } = await sb
    .from("users")
    .select("id, is_admin, deactivated_at")
    .eq("id", id)
    .maybeSingle<{ id: string; is_admin: boolean; deactivated_at: string | null }>();
  if (!target)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  // Refuse de retirer le dernier admin actif (target = admin actif, on tente
  // de le rétrograder ou de le désactiver, et c'est le seul restant).
  const isDemotingSelfOrLast =
    (parsed.data.is_admin === false && target.is_admin && !target.deactivated_at) ||
    false;
  if (isDemotingSelfOrLast) {
    const others = await countOtherActiveAdmins(id);
    if (others === 0) {
      return NextResponse.json(
        { error: "must keep at least one active admin" },
        { status: 400 }
      );
    }
  }

  const fields: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) fields.name = parsed.data.name;
  if (parsed.data.is_admin !== undefined) fields.is_admin = parsed.data.is_admin;
  if (parsed.data.deactivated_at === null) fields.deactivated_at = null;
  if (parsed.data.password !== undefined) {
    fields.password_hash = await bcrypt.hash(parsed.data.password, 10);
  }

  if (Object.keys(fields).length > 0) {
    const { error } = await sb.from("users").update(fields).eq("id", id);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (parsed.data.schools !== undefined) {
    // isValidScopeSlug autorise les 9 écoles + le scope sentinelle 'edh'.
    const validSchools = parsed.data.schools.filter(isValidScopeSlug);
    const { error: delErr } = await sb
      .from("user_school_access")
      .delete()
      .eq("user_id", id);
    if (delErr)
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    if (validSchools.length > 0) {
      const { error: insErr } = await sb.from("user_school_access").insert(
        validSchools.map((s) => ({ user_id: id, school_slug: s }))
      );
      if (insErr)
        return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, byMe: me.userId });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    const status = (e as { status?: number }).status ?? 401;
    return NextResponse.json({ error: "forbidden" }, { status });
  }
  const { id } = await ctx.params;

  if (id === me.userId) {
    return NextResponse.json(
      { error: "cannot deactivate self" },
      { status: 400 }
    );
  }

  const sb = getSupabase();
  const { data: target } = await sb
    .from("users")
    .select("id, is_admin, deactivated_at")
    .eq("id", id)
    .maybeSingle<{ id: string; is_admin: boolean; deactivated_at: string | null }>();
  if (!target)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  if (target.deactivated_at) {
    return NextResponse.json({ error: "already deactivated" }, { status: 400 });
  }
  if (target.is_admin) {
    const others = await countOtherActiveAdmins(id);
    if (others === 0) {
      return NextResponse.json(
        { error: "must keep at least one active admin" },
        { status: 400 }
      );
    }
  }

  const { error } = await sb
    .from("users")
    .update({ deactivated_at: new Date().toISOString() })
    .eq("id", id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
