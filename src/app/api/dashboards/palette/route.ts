import { NextResponse } from "next/server";
import { getSupabaseScoped } from "@/lib/supabase/service";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";
import { getSchoolBySlug, isEdhScope, EDH_SCHOOL_SLUGS } from "@/lib/schools";
import type { Palette, PaletteItem } from "@/lib/dashboards/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const schoolSlug = await getCurrentSchoolSlugChecked();
  const sb = getSupabaseScoped(schoolSlug);
  const isEdh = isEdhScope(schoolSlug);

  // `?textOnly=true` : restreint aux events porteurs de valeur texte
  // (text_label non-vide). Utilisé par le builder en mode pie chart, où
  // on veut ne montrer que les events dont les occurrences portent une
  // donnée scalaire (numéro de tel, pays, etc.) — ces events sont les
  // candidats naturels à une viz de répartition.
  const url = new URL(req.url);
  const textOnly = url.searchParams.get("textOnly") === "true";

  // En mode EDH on agrège sur les 9 écoles EDH (filtre IN obligatoire car
  // la DB est partagée avec d'autres projets). Chaque item porte alors
  // `school_slug` + `school_name` pour l'affichage (chip).
  let mmQuery = sb
    .from("mm_events")
    .select("school_slug, event_ns, name, text_label")
    .order("school_slug")
    .order("name");
  if (textOnly) {
    // text_label est défini comme NOT NULL DEFAULT "" côté Smartlink — donc
    // « porteur de texte » = label non vide (≠ "").
    mmQuery = mmQuery.not("text_label", "is", null).neq("text_label", "");
  }
  const redirectQuery = sb
    .from("redirect_events")
    .select("id, name, school_slug")
    .is("archived_at", null)
    .order("school_slug")
    .order("name");

  // En mode `textOnly`, on filtre AUSSI les URLs trackées (les redirects
  // n'ont jamais de "valeur portée" texte côté Meta — un clic est un
  // événement vide de donnée scalaire). Donc on les exclut entièrement
  // de la palette pour un pie chart « par valeur texte ».
  const [mmRes, redirectsRes] = await Promise.all([
    isEdh
      ? mmQuery.in("school_slug", EDH_SCHOOL_SLUGS as string[])
      : mmQuery.eq("school_slug", schoolSlug),
    textOnly
      ? Promise.resolve({ data: [] as unknown[], error: null })
      : isEdh
        ? redirectQuery.in("school_slug", EDH_SCHOOL_SLUGS as string[])
        : redirectQuery.eq("school_slug", schoolSlug),
  ]);
  if (mmRes.error)
    return NextResponse.json({ error: mmRes.error.message }, { status: 500 });
  if (redirectsRes.error)
    return NextResponse.json({ error: redirectsRes.error.message }, { status: 500 });

  const mmEvents: PaletteItem[] = (
    (mmRes.data ?? []) as {
      school_slug: string;
      event_ns: string;
      name: string;
      text_label: string | null;
    }[]
  ).map((r) => {
    const item: PaletteItem = {
      step_type: "mm_event",
      // En EDH, l'identité d'une ref est (school, event_ns) : on
      // compose un id composite côté UI pour ne pas écraser un event
      // qui s'appellerait pareil dans deux écoles.
      ref_id: isEdh ? `${r.school_slug}:${r.event_ns}` : r.event_ns,
      label: r.name,
      has_text_value: (r.text_label ?? "").trim().length > 0,
    };
    if (isEdh) {
      item.school_slug = r.school_slug;
      item.school_name = getSchoolBySlug(r.school_slug)?.name ?? r.school_slug;
    }
    return item;
  });
  const redirectEvents: PaletteItem[] = (
    (redirectsRes.data ?? []) as {
      id: string;
      name: string;
      school_slug: string;
    }[]
  ).map((r) => {
    const item: PaletteItem = {
      step_type: "url_click",
      ref_id: r.id,
      label: r.name,
    };
    if (isEdh) {
      item.school_slug = r.school_slug;
      item.school_name = getSchoolBySlug(r.school_slug)?.name ?? r.school_slug;
    }
    return item;
  });

  const body: Palette = { mmEvents, redirectEvents };
  return NextResponse.json(body);
}
