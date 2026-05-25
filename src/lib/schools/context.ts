import { cookies } from "next/headers";
import {
  isValidScopeSlug,
  DEFAULT_SCHOOL_SLUG,
  EDH_SCOPE_SLUG,
} from "@/lib/schools";
import {
  getCurrentUserSchools,
  getCurrentUserHasEdhAccess,
} from "@/lib/schools/access";
import { requireUser } from "@/lib/auth/require-user";

export const SCHOOL_COOKIE_NAME = "neoma_school";

export async function getCurrentSchoolSlug(): Promise<string> {
  const c = await cookies();
  const v = c.get(SCHOOL_COOKIE_NAME)?.value;
  if (v && isValidScopeSlug(v)) return v;
  return DEFAULT_SCHOOL_SLUG;
}

/**
 * Like `getCurrentSchoolSlug` but enforces that the current user has access
 * to the slug. Si le cookie pointe vers `'edh'` mais que l'utilisateur n'a
 * pas l'accès EDH, on rabat sur la première école autorisée. Idem si
 * l'école courante a été révoquée. Throws 403 si l'utilisateur n'a
 * strictement aucun accès (ni école ni EDH).
 *
 * Internally calls `requireUser()` (memoized via React `cache()`) so it's
 * cheap to use even alongside another `requireUser()` call in the same route.
 */
export async function getCurrentSchoolSlugChecked(): Promise<string> {
  const slug = await getCurrentSchoolSlug();
  const user = await requireUser();
  const [schools, hasEdh] = await Promise.all([
    getCurrentUserSchools(user.userId),
    getCurrentUserHasEdhAccess(user.userId),
  ]);
  if (schools.length === 0 && !hasEdh) {
    throw Object.assign(new Error("no school access"), { status: 403 });
  }
  if (slug === EDH_SCOPE_SLUG) {
    if (hasEdh) return EDH_SCOPE_SLUG;
    return schools[0];
  }
  if (schools.includes(slug)) return slug;
  if (schools.length > 0) return schools[0];
  return EDH_SCOPE_SLUG;
}
