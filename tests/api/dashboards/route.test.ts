import { describe, it, expect, vi, beforeEach } from "vitest";

// `getSupabaseScoped` délègue au même mock que `getSupabase` : la route GET
// utilise getSupabaseScoped (dashboards) ET getSupabase brut (lookup users
// pour can_edit). Sans ce pont, l'automock renvoie `undefined`.
vi.mock("@/lib/supabase/service", () => {
  const getSupabase = vi.fn();
  const getSupabaseScoped = vi.fn(() => getSupabase());
  return { getSupabase, getSupabaseScoped };
});
vi.mock("@/lib/schools/context", () => ({
  getCurrentSchoolSlug: vi.fn().mockResolvedValue("neoma"),
  getCurrentSchoolSlugChecked: vi.fn().mockResolvedValue("neoma"),
  SCHOOL_COOKIE_NAME: "edh_school",
}));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: vi.fn().mockResolvedValue({ userId: "u1", email: "a@b.c" }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
  process.env.AUTH_SECRET = "0".repeat(64);
  process.env.INTERNAL_API_KEY = "x";
});

describe("GET /api/dashboards", () => {
  it("401 when unauth", async () => {
    const { requireUser } = await import("@/lib/auth/require-user");
    (requireUser as unknown as { mockRejectedValueOnce: (e: unknown) => void })
      .mockRejectedValueOnce(new Error("unauth"));

    const { GET } = await import("@/app/api/dashboards/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns dashboards filtered by school + visibility, annotated with can_edit", async () => {
    // Visibilité : .eq("school_slug").is("campaign_id", null).or(...).order(...)
    const eqSchool = vi.fn();
    const isCampaign = vi.fn();
    const or = vi.fn();
    const order = vi.fn().mockResolvedValue({
      data: [
        { id: "d1", name: "Funnel A", created_by: "u1" },
        { id: "d2", name: "Partagé", created_by: "OTHER" },
      ],
      error: null,
    });
    eqSchool.mockReturnValue({ is: isCampaign });
    isCampaign.mockReturnValue({ or });
    or.mockReturnValue({ order });
    const dashboardsSelect = vi.fn().mockReturnValue({ eq: eqSchool });

    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      from: (table: string) => {
        if (table === "dashboards") return { select: dashboardsSelect };
        if (table === "users") {
          // Lookup is_admin pour annoter can_edit. Non-admin ici.
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { is_admin: false }, error: null }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    });

    const { GET } = await import("@/app/api/dashboards/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dashboards: Array<{ id: string; can_edit: boolean }>;
    };
    expect(body.dashboards).toHaveLength(2);
    expect(eqSchool).toHaveBeenCalledWith("school_slug", "neoma");
    // can_edit : owner → true, non-owner (non-admin) → false.
    expect(body.dashboards[0].can_edit).toBe(true);
    expect(body.dashboards[1].can_edit).toBe(false);
  });
});

describe("POST /api/dashboards", () => {
  it("400 on empty name", async () => {
    const { POST } = await import("@/app/api/dashboards/route");
    const res = await POST(
      new Request("http://x/api/dashboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("creates dashboard with current user + school", async () => {
    const insert = vi.fn().mockReturnValue({
      select: () => ({
        single: () =>
          Promise.resolve({ data: { id: "d-new" }, error: null }),
      }),
    });
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      from: () => ({ insert }),
    });

    const { POST } = await import("@/app/api/dashboards/route");
    const res = await POST(
      new Request("http://x/api/dashboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Funnel JPO" }),
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe("d-new");
    expect(insert).toHaveBeenCalledWith({
      school_slug: "neoma",
      created_by: "u1",
      name: "Funnel JPO",
      type: "funnel",
      is_shared: false,
    });
  });
});
