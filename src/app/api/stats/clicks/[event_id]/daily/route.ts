import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase/service";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";
import { getClicksDaily } from "@/lib/stats/daily";
import { isEdhScope, EDH_SCHOOL_SLUGS } from "@/lib/schools";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ event_id: string }> }
) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const { event_id } = await ctx.params;
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (
    !from ||
    !to ||
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(to)
  ) {
    return NextResponse.json({ error: "missing or bad from/to" }, { status: 400 });
  }
  const scope = await getCurrentSchoolSlugChecked();

  // En mode école-précise, l'event doit appartenir à cette école. En mode
  // EDH groupe, l'event doit appartenir à l'une des 9 écoles EDH (filtre
  // explicite car la DB est partagée avec d'autres projets).
  const { data: ev } = await getSupabase()
    .from("redirect_events")
    .select("school_slug")
    .eq("id", event_id)
    .maybeSingle();
  if (!ev) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (isEdhScope(scope)) {
    if (!EDH_SCHOOL_SLUGS.includes(ev.school_slug)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
  } else if (ev.school_slug !== scope) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const series = await getClicksDaily(event_id, from, to);
  return NextResponse.json({ series });
}
