import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/service");
vi.mock("@/lib/messagingme/client");

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
  process.env.AUTH_SECRET = "0".repeat(64);
  process.env.INTERNAL_API_KEY = "x";
});

describe("syncSchool watermark", () => {
  it("only inserts occurrences with id > watermark and stops at first older id", async () => {
    const clientMod = await import("@/lib/messagingme/client");
    vi.spyOn(clientMod, "listEvents").mockResolvedValue([
      {
        name: "a",
        event_ns: "ns1",
        description: "",
        text_label: "",
        price_label: "",
        number_label: "",
      },
    ]);
    vi.spyOn(clientMod, "iterOccurrences").mockImplementation(async function* () {
      yield [
        {
          id: 100,
          user_ns: "u",
          event_ns: "ns1",
          text_value: "",
          price_value: "0",
          number_value: 1,
          created_at: "2026-04-01T00:00:00Z",
        },
        {
          id: 99,
          user_ns: "u",
          event_ns: "ns1",
          text_value: "",
          price_value: "0",
          number_value: 1,
          created_at: "2026-03-31T00:00:00Z",
        },
      ];
      yield [
        {
          id: 98,
          user_ns: "u",
          event_ns: "ns1",
          text_value: "",
          price_value: "0",
          number_value: 1,
          created_at: "2026-03-30T00:00:00Z",
        },
      ];
    });

    const inserts: { id: number }[] = [];
    const upserts: { table: string; row: Record<string, unknown> }[] = [];

    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      from: (t: string) => {
        if (t === "mm_events") {
          return {
            upsert: (rows: Record<string, unknown>) => {
              upserts.push({ table: t, row: rows });
              return Promise.resolve({ error: null });
            },
          };
        }
        if (t === "mm_occurrences") {
          return {
            upsert: (rows: { id: number }[]) => {
              for (const r of rows) inserts.push({ id: r.id });
              return Promise.resolve({ error: null });
            },
          };
        }
        if (t === "mm_sync_state") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: { last_occurrence_id: 99 }, error: null }),
                }),
              }),
            }),
            upsert: (row: Record<string, unknown>) => {
              upserts.push({ table: t, row });
              return Promise.resolve({ error: null });
            },
          };
        }
        return {};
      },
    });

    const { syncSchool } = await import("./sync");
    await syncSchool(
      { slug: "efap", name: "EFAP", tokenEnv: "MM_TOKEN_EFAP" },
      "tok"
    );

    // Watermark was 99 → only id 100 should be inserted, iteration must stop
    // at id 99 (id 98 should never reach the DB).
    expect(inserts.map((r) => r.id)).toEqual([100]);

    // Watermark must have been bumped to 100.
    const stateUpserts = upserts.filter((u) => u.table === "mm_sync_state");
    const watermarkUpdate = stateUpserts.find(
      (u) => u.row.last_occurrence_id === 100
    );
    expect(watermarkUpdate).toBeDefined();
  });
});
