import { describe, it, expect, vi, beforeEach } from "vitest";

// `getSupabaseScoped` (utilisé par la route palette) délègue au même mock que
// `getSupabase` ; sans ce pont, l'automock renvoie `undefined`.
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

describe("GET /api/dashboards/palette", () => {
  it("401 when unauth", async () => {
    const { requireUser } = await import("@/lib/auth/require-user");
    (requireUser as unknown as { mockRejectedValueOnce: (e: unknown) => void })
      .mockRejectedValueOnce(new Error("unauth"));
    const { GET } = await import("@/app/api/dashboards/palette/route");
    const res = await GET(new Request("http://x/api/dashboards/palette"));
    expect(res.status).toBe(401);
  });

  it("returns mm_events + active redirect_events for current school", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      from: (table: string) => {
        if (table === "mm_events") {
          // .select(...).order("name").eq("school_slug", X)
          return {
            select: () => ({
              order: () => ({
                eq: () =>
                  Promise.resolve({
                    data: [
                      {
                        school_slug: "neoma",
                        event_ns: "evt_a",
                        name: "Relance benin",
                        text_label: "",
                      },
                      {
                        school_slug: "neoma",
                        event_ns: "evt_b",
                        name: "Remplissage dossier",
                        text_label: "",
                      },
                    ],
                    error: null,
                  }),
              }),
            }),
          };
        }
        // redirect_events : .select().is("archived_at").order("name").eq()
        return {
          select: () => ({
            is: () => ({
              order: () => ({
                eq: () =>
                  Promise.resolve({
                    data: [
                      {
                        id: "uuid-1",
                        name: "Clic JPO",
                        school_slug: "neoma",
                      },
                    ],
                    error: null,
                  }),
              }),
            }),
          }),
        };
      },
    });

    const { GET } = await import("@/app/api/dashboards/palette/route");
    const res = await GET(new Request("http://x/api/dashboards/palette"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mmEvents: Array<{
        step_type: string;
        ref_id: string;
        label: string;
        school_slug?: string;
        has_text_value?: boolean;
      }>;
      redirectEvents: Array<{
        step_type: string;
        ref_id: string;
        label: string;
        school_slug?: string;
      }>;
    };
    expect(body.mmEvents).toHaveLength(2);
    // En mode école-précise, ref_id = event_ns brut, et school_slug est
    // omis sur l'item palette (il est implicite via le scope). La route
    // annote chaque mm_event avec `has_text_value` (text_label vide → false).
    expect(body.mmEvents[0]).toEqual({
      step_type: "mm_event",
      ref_id: "evt_a",
      label: "Relance benin",
      has_text_value: false,
    });
    expect(body.redirectEvents).toHaveLength(1);
    expect(body.redirectEvents[0]).toEqual({
      step_type: "url_click",
      ref_id: "uuid-1",
      label: "Clic JPO",
    });
  });
});
