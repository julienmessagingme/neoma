import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("listEvents", () => {
  it("paginates and aggregates results", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                name: "a",
                event_ns: "1",
                description: "",
                text_label: "",
                price_label: "",
                number_label: "",
              },
            ],
            meta: { current_page: 1, last_page: 2 },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                name: "b",
                event_ns: "2",
                description: "",
                text_label: "",
                price_label: "",
                number_label: "",
              },
            ],
            meta: { current_page: 2, last_page: 2 },
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const { listEvents } = await import("./client");
    const r = await listEvents({ token: "t", base: "https://api.test/api" });
    expect(r.length).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.map((e) => e.event_ns)).toEqual(["1", "2"]);
  });

  it("throws on 4xx without retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const { listEvents } = await import("./client");
    await expect(
      listEvents({ token: "bad", base: "https://api.test/api" })
    ).rejects.toThrow(/HTTP 401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on 5xx then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("oops", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [],
            meta: { current_page: 1, last_page: 1 },
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const { listEvents } = await import("./client");
    const r = await listEvents({ token: "t", base: "https://api.test/api" });
    expect(r).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("iterOccurrences", () => {
  it("yields each page until last_page reached", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: 100 }, { id: 99 }],
            meta: { current_page: 1, last_page: 2 },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: 98 }],
            meta: { current_page: 2, last_page: 2 },
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const { iterOccurrences } = await import("./client");
    const collected: number[] = [];
    for await (const batch of iterOccurrences(
      { token: "t", base: "https://api.test/api" },
      "ns1"
    )) {
      for (const r of batch) collected.push((r as { id: number }).id);
    }
    expect(collected).toEqual([100, 99, 98]);
  });
});
