import { NextResponse } from "next/server";
import { z } from "zod";
import { isValidScopeSlug, isEdhScope } from "@/lib/schools";
import { SCHOOL_COOKIE_NAME } from "@/lib/schools/context";
import {
  getCurrentUserSchools,
  getCurrentUserHasEdhAccess,
} from "@/lib/schools/access";
import { requireUser } from "@/lib/auth/require-user";

export const runtime = "nodejs";

const Body = z.object({ slug: z.string() });

export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isValidScopeSlug(parsed.data.slug)) {
    return NextResponse.json({ error: "invalid slug" }, { status: 400 });
  }

  // L'user ne peut basculer que vers un scope auquel il a accès :
  // une de ses écoles, ou l'EDH groupe s'il a la permission.
  if (isEdhScope(parsed.data.slug)) {
    const hasEdh = await getCurrentUserHasEdhAccess(user.userId);
    if (!hasEdh) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  } else {
    const allowed = await getCurrentUserSchools(user.userId);
    if (!allowed.includes(parsed.data.slug)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SCHOOL_COOKIE_NAME, parsed.data.slug, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return res;
}
