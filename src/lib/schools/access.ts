import { getSupabase } from "@/lib/supabase/service";
import { SCHOOLS, EDH_SCOPE_SLUG, isValidSchoolSlug } from "@/lib/schools";

/**
 * Return the school slugs the user has access to, ordered by the canonical
 * `SCHOOLS` constant order so the sidebar is deterministic regardless of
 * insertion order in `user_school_access`.
 *
 * Le scope sentinel 'edh' est volontairement filtré ici : les routes qui
 * veulent savoir si l'utilisateur a l'accès EDH appellent
 * `getCurrentUserHasEdhAccess`. De même, les slugs inconnus en DB
 * (e.g. une école renommée) sont écartés.
 */
export async function getCurrentUserSchools(userId: string): Promise<string[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("user_school_access")
    .select("school_slug")
    .eq("user_id", userId);
  if (error) throw error;
  const allowed = new Set(
    (data ?? [])
      .map((r) => (r as { school_slug: string }).school_slug)
      .filter(isValidSchoolSlug)
  );
  return SCHOOLS.map((s) => s.slug).filter((s) => allowed.has(s));
}

/**
 * `true` ssi l'utilisateur a une row `user_school_access` avec
 * `school_slug = 'edh'`. Utilisé pour conditionner l'affichage de
 * l'entrée EDH dans la sidebar et l'accès aux endpoints en mode EDH.
 */
export async function getCurrentUserHasEdhAccess(
  userId: string
): Promise<boolean> {
  const sb = getSupabase();
  const { count, error } = await sb
    .from("user_school_access")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("school_slug", EDH_SCOPE_SLUG);
  if (error) throw error;
  return (count ?? 0) > 0;
}
