import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase/service";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";
import { resolveDateRange } from "@/lib/dashboards/date-range";
import { getSchoolBySlug, isEdhScope } from "@/lib/schools";
import { groupMetaCostsByCountry } from "@/lib/meta-pricing";
import type {
  MetaCostBreakdownItem,
  CampaignCostSummary,
} from "@/lib/dashboards/types";
import type {
  ComputedRef,
  ComputedStep,
  ComputedDashboardData,
  DatePreset,
  StepType,
} from "@/lib/dashboards/types";

export const runtime = "nodejs";

interface DashboardRow {
  id: string;
  created_by: string;
  school_slug: string;
  date_preset: DatePreset;
  date_from: string | null;
  date_to: string | null;
  campaign_id: string | null;
}

interface StepRow {
  id: string;
  position: number;
  label: string | null;
}

interface RefRow {
  id: string;
  step_id: string;
  ref_position: number;
  step_type: StepType;
  event_ns: string | null;
  redirect_event_id: string | null;
  event_school_slug: string | null;
}

function nextDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const sb = getSupabase();
  const scope = await getCurrentSchoolSlugChecked();
  const isEdh = isEdhScope(scope);

  const { data: dash } = await sb
    .from("dashboards")
    .select(
      "id, created_by, school_slug, date_preset, date_from, date_to, campaign_id, is_shared"
    )
    .eq("id", id)
    .maybeSingle<DashboardRow>();

  if (!dash || dash.school_slug !== scope) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Visibilité : owner OR is_shared OR lié à une campagne (les
  // tableaux de campagne s'affichent à tous ceux qui voient la
  // campagne, géré côté campagne). On accepte les 3 cas ici puisque
  // l'API listing les filtre déjà en amont — c'est un garde-fou.
  // Note : `is_shared` n'existe que sur les tableaux libres (campaign_id
  // null) ; pour un tableau de campagne, la visibilité est gérée par
  // les ACL de la campagne (cf. /campaigns/[id]/campaign-page-client).
  const dashAny = dash as DashboardRow & { is_shared?: boolean };
  const visible =
    dashAny.created_by === user.userId ||
    dashAny.is_shared === true ||
    dashAny.campaign_id !== null;
  if (!visible) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Capture non-null pour que TS ne perde pas le narrowing à l'intérieur
  // de la closure `computeRef`.
  const dashSchool = dash.school_slug;

  const { data: stepsData, error: stepsErr } = await sb
    .from("dashboard_steps")
    .select("id, position, label")
    .eq("dashboard_id", id)
    .order("position", { ascending: true });
  if (stepsErr)
    return NextResponse.json({ error: stepsErr.message }, { status: 500 });

  const stepRows = (stepsData ?? []) as StepRow[];

  const { from, to } = resolveDateRange({
    preset: dash.date_preset,
    from: dash.date_from,
    to: dash.date_to,
  });
  const fromTs = `${from}T00:00:00Z`;
  const toTs = `${nextDay(to)}T00:00:00Z`;

  if (stepRows.length === 0) {
    const empty: ComputedDashboardData = { from, to, steps: [] };
    return NextResponse.json(empty);
  }

  const stepIds = stepRows.map((s) => s.id);
  const { data: refsData, error: refsErr } = await sb
    .from("dashboard_step_refs")
    .select(
      "id, step_id, ref_position, step_type, event_ns, redirect_event_id, event_school_slug"
    )
    .in("step_id", stepIds)
    .order("ref_position", { ascending: true });
  if (refsErr)
    return NextResponse.json({ error: refsErr.message }, { status: 500 });

  const refRows = (refsData ?? []) as RefRow[];

  // Pour chaque mm_event ref, l'école est event_school_slug en mode EDH,
  // sinon le school_slug du dashboard. Pour les url_click on stocke par
  // redirect_event_id (uuid global) et on lira l'école côté redirect_events.
  type MmKey = string; // `${school}|${event_ns}`
  const mmKeys = new Set<MmKey>();
  for (const r of refRows) {
    if (r.step_type === "mm_event" && r.event_ns) {
      const sch = isEdh ? r.event_school_slug : dashSchool;
      if (sch) mmKeys.add(`${sch}|${r.event_ns}`);
    }
  }
  const mmKeyList = Array.from(mmKeys);
  const redirectIdList = Array.from(
    new Set(
      refRows
        .filter((r) => r.step_type === "url_click")
        .map((r) => r.redirect_event_id!)
    )
  );

  // Préchargement des labels :
  //  - mm_events filtré par couples (school_slug, event_ns) : Supabase
  //    n'a pas de WHERE composé (a,b) IN ((..,..)) donc on charge en
  //    bloc par les écoles concernées et on filtre côté JS.
  const involvedSchools = Array.from(
    new Set(mmKeyList.map((k) => k.split("|")[0]!))
  );
  const [mmLabelsRes, redirectLabelsRes] = await Promise.all([
    involvedSchools.length > 0
      ? sb
          .from("mm_events")
          .select("school_slug, event_ns, name, text_label")
          .in("school_slug", involvedSchools)
      : Promise.resolve({ data: [], error: null }),
    redirectIdList.length > 0
      ? sb
          .from("redirect_events")
          .select("id, name, school_slug")
          .in("id", redirectIdList)
      : Promise.resolve({ data: [], error: null }),
  ]);

  // mmLabels = nom de l'event + indicateur "porteur de texte" (text_label
  // non vide). On stocke l'objet entier pour pouvoir décider, dans
  // computeRef, si l'event mérite un calcul de coût Meta.
  const mmLabels = new Map<MmKey, { name: string; textLabel: string }>();
  for (const r of (mmLabelsRes.data as {
    school_slug: string;
    event_ns: string;
    name: string;
    text_label: string | null;
  }[]) ?? []) {
    mmLabels.set(`${r.school_slug}|${r.event_ns}`, {
      name: r.name,
      textLabel: (r.text_label ?? "").trim(),
    });
  }
  const redirectLabels = new Map<
    string,
    { name: string; school_slug: string }
  >();
  for (const r of (redirectLabelsRes.data as {
    id: string;
    name: string;
    school_slug: string;
  }[]) ?? []) {
    // En mode école-précise, on n'expose que les redirects de l'école
    // courante (les autres écoles peuvent partager le même uuid en
    // théorie, mais c'est un uuid donc unique : juste un garde-fou).
    if (isEdh || r.school_slug === dashSchool) {
      redirectLabels.set(r.id, { name: r.name, school_slug: r.school_slug });
    }
  }

  const refsByStep = new Map<string, RefRow[]>();
  for (const r of refRows) {
    const arr = refsByStep.get(r.step_id) ?? [];
    arr.push(r);
    refsByStep.set(r.step_id, arr);
  }

  function chipLabel(name: string, schoolSlug: string | null): string {
    if (!isEdh || !schoolSlug) return name;
    const sch = getSchoolBySlug(schoolSlug);
    return `${sch?.name ?? schoolSlug} · ${name}`;
  }

  async function computeRef(r: RefRow): Promise<ComputedRef> {
    if (r.step_type === "mm_event") {
      const evNs = r.event_ns!;
      const refSchool = isEdh ? r.event_school_slug : dashSchool;
      const key = refSchool ? `${refSchool}|${evNs}` : null;
      const available = !!(key && mmLabels.has(key));
      if (!available || !refSchool) {
        return {
          step_type: "mm_event",
          ref_id: evNs,
          label: "(indisponible)",
          count: 0,
          available: false,
          ...(isEdh && refSchool
            ? {
                school_slug: refSchool,
                school_name: getSchoolBySlug(refSchool)?.name ?? refSchool,
              }
            : {}),
        };
      }
      const meta = mmLabels.get(key!)!;
      const isPhoneCarrier = meta.textLabel.length > 0;

      let count: number;
      let metaCostEur: number | null;
      let metaBreakdown: MetaCostBreakdownItem[] | undefined;
      if (isPhoneCarrier) {
        // Event porteur (text_label non vide) → on fetch les text_value
        // pour calculer le coût Meta marketing par indicatif. Limite à
        // 10 000 rows par event/période (au-delà, le coût sera sous-évalué
        // et un warning serait à ajouter en V2).
        const { data: occRows, error: occErr } = await sb
          .from("mm_occurrences")
          .select("text_value")
          .eq("school_slug", refSchool)
          .eq("event_ns", evNs)
          .gte("occurred_at", fromTs)
          .lt("occurred_at", toTs)
          .limit(10000);
        if (occErr) {
          count = 0;
          metaCostEur = null;
        } else {
          const rows = (occRows ?? []) as { text_value: string | null }[];
          count = rows.length;
          const phones = rows
            .map((r) => r.text_value ?? "")
            .filter((p) => p.length > 0);
          const breakdown = groupMetaCostsByCountry(phones);
          metaBreakdown = breakdown.map((b) => ({
            iso: b.iso,
            name: b.name,
            count: b.count,
            rate_eur: b.rateEur,
            total_eur: b.totalEur,
          }));
          metaCostEur = metaBreakdown.reduce((s, b) => s + b.total_eur, 0);
        }
      } else {
        // Event "compteur" classique : count(*) suffit.
        const { count: c } = await sb
          .from("mm_occurrences")
          .select("*", { count: "exact", head: true })
          .eq("school_slug", refSchool)
          .eq("event_ns", evNs)
          .gte("occurred_at", fromTs)
          .lt("occurred_at", toTs);
        count = c ?? 0;
        metaCostEur = null;
      }

      return {
        step_type: "mm_event",
        ref_id: evNs,
        label: chipLabel(meta.name, refSchool),
        count,
        available: true,
        meta_cost_eur: metaCostEur,
        ...(metaBreakdown ? { meta_breakdown: metaBreakdown } : {}),
        ...(isEdh
          ? {
              school_slug: refSchool,
              school_name: getSchoolBySlug(refSchool)?.name ?? refSchool,
            }
          : {}),
      };
    }
    const reId = r.redirect_event_id!;
    const meta = redirectLabels.get(reId);
    if (!meta) {
      return {
        step_type: "url_click",
        ref_id: reId,
        label: "(indisponible)",
        count: 0,
        available: false,
      };
    }
    const { count } = await sb
      .from("clicks")
      .select("*", { count: "exact", head: true })
      .eq("event_id", reId)
      .gte("clicked_at", fromTs)
      .lt("clicked_at", toTs);
    return {
      step_type: "url_click",
      ref_id: reId,
      label: chipLabel(meta.name, meta.school_slug),
      count: count ?? 0,
      available: true,
      ...(isEdh
        ? {
            school_slug: meta.school_slug,
            school_name:
              getSchoolBySlug(meta.school_slug)?.name ?? meta.school_slug,
          }
        : {}),
    };
  }

  const computed: ComputedStep[] = await Promise.all(
    stepRows.map(async (s): Promise<ComputedStep> => {
      const stepRefs = refsByStep.get(s.id) ?? [];
      const computedRefs = await Promise.all(stepRefs.map(computeRef));
      const total = computedRefs
        .filter((r) => r.available)
        .reduce((sum, r) => sum + r.count, 0);
      const anyAvailable = computedRefs.some((r) => r.available);
      const fallbackLabel =
        computedRefs.length === 0
          ? "(vide)"
          : computedRefs.map((r) => r.label).join(" + ");
      // Coût Meta de l'étape = somme des coûts des refs porteurs. NULL si
      // aucune ref n'a de coût → la colonne « Coût Meta » de la table
      // récap reste masquée pour cette étape (et masquée globalement si
      // aucune étape n'a de coût).
      const carriers = computedRefs.filter(
        (r) => r.available && r.meta_cost_eur != null
      );
      const metaCostEur =
        carriers.length > 0
          ? carriers.reduce((acc, r) => acc + (r.meta_cost_eur ?? 0), 0)
          : null;
      // Fusion des breakdown des refs porteurs en un seul breakdown au
      // niveau du step. Si deux refs ramènent du même pays, on additionne
      // count + total et on garde le rate (cohérent par hypothèse).
      let metaBreakdown: MetaCostBreakdownItem[] | undefined;
      if (carriers.length > 0) {
        const merged = new Map<string, MetaCostBreakdownItem>();
        for (const r of carriers) {
          for (const b of r.meta_breakdown ?? []) {
            const existing = merged.get(b.iso);
            if (existing) {
              existing.count += b.count;
              existing.total_eur += b.total_eur;
            } else {
              merged.set(b.iso, { ...b });
            }
          }
        }
        metaBreakdown = Array.from(merged.values()).sort(
          (a, b) => b.total_eur - a.total_eur
        );
      }
      return {
        position: s.position,
        label: s.label && s.label.trim() ? s.label : fallbackLabel,
        count: anyAvailable ? total : 0,
        available: anyAvailable && computedRefs.length > 0,
        refs: computedRefs,
        meta_cost_eur: metaCostEur,
        ...(metaBreakdown ? { meta_breakdown: metaBreakdown } : {}),
      };
    })
  );

  // --- Synthèse campagne (Phase 25) ---
  // Si le dashboard est lié à une campagne avec un launch défini, on
  // calcule le coût Meta brut (lancement), le failed éventuel, et le
  // net (= lancement scaled par le ratio des envois réussis).
  let campaignSummary: CampaignCostSummary | null = null;
  if (dash.campaign_id) {
    const { data: campaignRefs } = await sb
      .from("campaign_refs")
      .select(
        "step_type, event_ns, event_school_slug, role"
      )
      .eq("campaign_id", dash.campaign_id)
      .in("role", ["launch", "failed"]);

    const launchRef = (campaignRefs ?? []).find(
      (r) => r.role === "launch"
    );
    const failedRef = (campaignRefs ?? []).find(
      (r) => r.role === "failed"
    );

    if (launchRef && launchRef.step_type === "mm_event" && launchRef.event_ns) {
      const launchSchool = isEdh
        ? launchRef.event_school_slug
        : dashSchool;
      const launchKey = launchSchool
        ? `${launchSchool}|${launchRef.event_ns}`
        : null;
      const launchLabelMeta = launchKey ? mmLabels.get(launchKey) : null;

      if (launchSchool && launchLabelMeta) {
        const { data: launchOccs } = await sb
          .from("mm_occurrences")
          .select("text_value")
          .eq("school_slug", launchSchool)
          .eq("event_ns", launchRef.event_ns)
          .gte("occurred_at", fromTs)
          .lt("occurred_at", toTs)
          .limit(10000);
        const launchPhones = ((launchOccs ?? []) as {
          text_value: string | null;
        }[])
          .map((r) => r.text_value ?? "")
          .filter((p) => p.length > 0);
        const launchCount = (launchOccs ?? []).length;
        const launchBreakdown = groupMetaCostsByCountry(launchPhones).map(
          (b): MetaCostBreakdownItem => ({
            iso: b.iso,
            name: b.name,
            count: b.count,
            rate_eur: b.rateEur,
            total_eur: b.totalEur,
          })
        );
        const launchCost = launchBreakdown.reduce(
          (s, b) => s + b.total_eur,
          0
        );

        let failedCount = 0;
        let failedLabel = "";
        if (failedRef && failedRef.step_type === "mm_event" && failedRef.event_ns) {
          const failedSchool = isEdh
            ? failedRef.event_school_slug
            : dashSchool;
          if (failedSchool) {
            const failedKey = `${failedSchool}|${failedRef.event_ns}`;
            const failedMeta = mmLabels.get(failedKey);
            if (failedMeta) {
              const { count: fc } = await sb
                .from("mm_occurrences")
                .select("*", { count: "exact", head: true })
                .eq("school_slug", failedSchool)
                .eq("event_ns", failedRef.event_ns)
                .gte("occurred_at", fromTs)
                .lt("occurred_at", toTs);
              failedCount = fc ?? 0;
              failedLabel = chipLabel(failedMeta.name, failedSchool);
            }
          }
        }

        // Net = launch scaled par (net_count / launch_count). On cap à 0
        // si plus de failed que de launch (cas pathologique mais possible
        // si les events sont mal configurés / mal alignés temporellement).
        const netCount = Math.max(0, launchCount - failedCount);
        const ratio = launchCount > 0 ? netCount / launchCount : 0;
        const netBreakdown: MetaCostBreakdownItem[] = launchBreakdown.map(
          (b) => ({
            ...b,
            count: Math.round(b.count * ratio),
            total_eur: b.total_eur * ratio,
          })
        );
        const netCost = launchCost * ratio;

        campaignSummary = {
          launch: {
            count: launchCount,
            cost_eur: launchCost,
            breakdown: launchBreakdown,
            label: chipLabel(launchLabelMeta.name, launchSchool),
            event_ns: launchRef.event_ns,
            event_school_slug: launchRef.event_school_slug ?? null,
          },
          failed:
            failedRef && failedRef.event_ns
              ? {
                  count: failedCount,
                  label: failedLabel || "(indisponible)",
                  event_ns: failedRef.event_ns,
                  event_school_slug: failedRef.event_school_slug ?? null,
                }
              : null,
          net_count: netCount,
          net_cost_eur: netCost,
          net_breakdown: netBreakdown,
        };
      }
    }
  }

  const body: ComputedDashboardData = {
    from,
    to,
    steps: computed,
    campaign_summary: campaignSummary,
  };
  return NextResponse.json(body);
}
