import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/service");

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
});

function setRows(rows: { school_slug: string }[]) {
  return {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: rows, error: null }),
      }),
    }),
  };
}

describe("getCurrentUserSchools", () => {
  // Déploiement single-school : seul "neoma" est un slug valide. Toute autre
  // valeur en DB (héritée d'EDH, école renommée) doit être écartée. Le résultat
  // suit l'ordre de la constante SCHOOLS, qui ne contient que "neoma".
  it("returns only the valid neoma slug, filtering foreign rows", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(
      setRows([
        { school_slug: "other-school" },
        { school_slug: "neoma" },
        { school_slug: "another-foreign" },
      ])
    );
    const { getCurrentUserSchools } = await import("@/lib/schools/access");
    const slugs = await getCurrentUserSchools("u1");
    expect(slugs).toEqual(["neoma"]);
  });

  it("returns empty array when user has no rows", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(
      setRows([])
    );
    const { getCurrentUserSchools } = await import("@/lib/schools/access");
    expect(await getCurrentUserSchools("u1")).toEqual([]);
  });

  it("filters out unknown slugs (defensive)", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(
      setRows([
        { school_slug: "neoma" },
        { school_slug: "old-renamed-school" }, // n'existe plus dans SCHOOLS
      ])
    );
    const { getCurrentUserSchools } = await import("@/lib/schools/access");
    expect(await getCurrentUserSchools("u1")).toEqual(["neoma"]);
  });

});
