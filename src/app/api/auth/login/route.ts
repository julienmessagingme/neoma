import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getSupabase } from "@/lib/supabase/service";
import { signSession, SESSION_COOKIE_NAME, SESSION_COOKIE_TTL } from "@/lib/auth/session";
import { getClientIp } from "@/lib/redirect/client-ip";
import {
  checkLoginRate,
  LOGIN_MAX_PER_IP,
  LOGIN_MAX_PER_EMAIL,
} from "@/lib/auth/login-rate-limit";

export const runtime = "nodejs";

// Fresh response per call — a NextResponse body is a one-shot stream, so we
// can't share a single module-level instance across requests.
const rateLimited = () =>
  NextResponse.json(
    { error: "trop de tentatives, réessayez dans quelques minutes" },
    { status: 429 }
  );

// Pre-computed bcrypt hash used as a decoy when the email is not found,
// so the response time is constant whether or not the email exists.
const DUMMY_HASH = "$2b$10$Auj1Cv8eEatUiGfSC.m8yuokdlDh0jFEdNJAw3/2hhhW/tI0eWYRq";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  // Anti-brute-force : limite par IP (large, tolère un NAT partagé) avant même
  // de parser le body, pour borner un flood. Limite par email (stricte) ensuite.
  const ip = getClientIp(req) ?? "unknown";
  if (!checkLoginRate(`ip:${ip}`, LOGIN_MAX_PER_IP)) return rateLimited();

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const { email, password } = parsed.data;
  if (!checkLoginRate(`email:${email.toLowerCase()}`, LOGIN_MAX_PER_EMAIL))
    return rateLimited();
  const sb = getSupabase();
  const { data: user, error } = await sb
    .from("users")
    .select("id, email, password_hash, name, deactivated_at")
    .eq("email", email)
    .maybeSingle();

  const passwordHash = user?.password_hash ?? DUMMY_HASH;
  const ok = await bcrypt.compare(password, passwordHash);

  // Generic 401 for : missing user, wrong password, deactivated user.
  // We never leak which one it was — an attacker can't probe for valid
  // emails or for deactivated accounts.
  if (error || !user || !ok || user.deactivated_at) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  // Best-effort update of last_login_at — failure shouldn't block login.
  void sb
    .from("users")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", user.id);

  const token = await signSession({ userId: user.id, email: user.email });
  const res = NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email, name: user.name },
  });
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_COOKIE_TTL,
    path: "/",
  });
  return res;
}
