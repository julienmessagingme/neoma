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
  it("passes the watermark as start_id cursor and ingests every returned row", async () => {
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

    // The client now filters server-side via start_id, so the generator only
    // ever yields rows with id > watermark, ordered ascending. Capture the
    // startId arg to prove sync threads the watermark through.
    let receivedStartId: number | undefined;
    vi.spyOn(clientMod, "iterOccurrences").mockImplementation(
      async function* (_opts, _eventNs, startId) {
        receivedStartId = startId;
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
            id: 101,
            user_ns: "u",
            event_ns: "ns1",
            text_value: "",
            price_value: "0",
            number_value: 1,
            created_at: "2026-04-02T00:00:00Z",
          },
        ];
        yield [
          {
            id: 102,
            user_ns: "u",
            event_ns: "ns1",
            text_value: "",
            price_value: "0",
            number_value: 1,
            created_at: "2026-04-03T00:00:00Z",
          },
        ];
      }
    );

    const inserts: { id: number }[] = [];
    const upserts: { table: string; row: Record<string, unknown> }[] = [];

    const { getSupabaseScoped } = await import("@/lib/supabase/service");
    (
      getSupabaseScoped as unknown as { mockReturnValue: (v: unknown) => void }
    ).mockReturnValue({
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
                    Promise.resolve({
                      data: { last_occurrence_id: 99 },
                      error: null,
                    }),
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
      {
        slug: "neoma",
        name: "Neoma",
        tokenEnv: "MM_TOKEN_NEOMA",
        vectorStoreEnv: "OPENAI_VS_NEOMA",
        logo: "/logos/neoma.png",
      },
      "tok"
    );

    // Watermark (99) must be forwarded as the start_id cursor.
    expect(receivedStartId).toBe(99);

    // Every row the API returns is new (id > watermark) → all ingested,
    // across both pages, with NO early-stop.
    expect(inserts.map((r) => r.id)).toEqual([100, 101, 102]);

    // Watermark must advance to the highest id seen.
    const stateUpserts = upserts.filter((u) => u.table === "mm_sync_state");
    const watermarkUpdate = stateUpserts.find(
      (u) => u.row.last_occurrence_id === 102
    );
    expect(watermarkUpdate).toBeDefined();
  });
});
