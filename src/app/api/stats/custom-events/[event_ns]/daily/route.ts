import { NextResponse } from "next/server";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";
import { getCustomEventDaily } from "@/lib/stats/daily";
import { isEdhScope, isValidSchoolSlug } from "@/lib/schools";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ event_ns: string }> }
) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const { event_ns } = await ctx.params;
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const schoolParam = url.searchParams.get("school");
  if (
    !from ||
    !to ||
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(to)
  ) {
    return NextResponse.json({ error: "missing or bad from/to" }, { status: 400 });
  }
  const scope = await getCurrentSchoolSlugChecked();

  // Mode EDH : la route attend un paramètre `school` (event_ns n'est pas
  // unique entre écoles). En mode école-précise, on ignore `school` et on
  // utilise le scope courant.
  let schoolSlug = scope;
  if (isEdhScope(scope)) {
    if (!schoolParam || !isValidSchoolSlug(schoolParam)) {
      return NextResponse.json(
        { error: "missing school param" },
        { status: 400 }
      );
    }
    schoolSlug = schoolParam;
  }

  const series = await getCustomEventDaily(schoolSlug, event_ns, from, to);
  return NextResponse.json({ series });
}
