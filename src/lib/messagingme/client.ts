export interface MmEvent {
  name: string;
  event_ns: string;
  description: string;
  text_label: string;
  price_label: string;
  number_label: string;
}

export interface MmOccurrence {
  id: number;
  user_ns: string;
  event_ns: string;
  text_value: string;
  price_value: string;
  number_value: number;
  created_at: string;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { current_page: number; last_page: number };
}

export interface ClientOpts {
  token: string;
  base: string;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 2
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, init);
      // Retry only on 5xx (server errors / transient). 4xx are deterministic
      // (auth, rate-limit, bad params) — fail fast.
      if (r.status >= 500 && attempt < retries) {
        await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
        continue;
      }
      return r;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
    }
  }
  throw new Error("unreachable");
}

export async function listEvents(opts: ClientOpts): Promise<MmEvent[]> {
  const all: MmEvent[] = [];
  let page = 1;
  while (true) {
    const r = await fetchWithRetry(
      `${opts.base}/flow/custom-events?limit=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${opts.token}`,
          Accept: "application/json",
        },
      }
    );
    if (!r.ok) {
      throw new Error(`listEvents failed: HTTP ${r.status} on page ${page}`);
    }
    const j = (await r.json()) as PaginatedResponse<MmEvent>;
    all.push(...j.data);
    if (j.meta.current_page >= j.meta.last_page) break;
    page++;
    // Hard safety net against infinite loops if API misbehaves.
    if (page > 200) {
      throw new Error("listEvents: pagination > 200 pages, aborting");
    }
  }
  return all;
}

/**
 * Iterates occurrences of an event, page by page (100 rows/page, the API max).
 *
 * The API returns rows ordered by id ASCENDING (oldest first) and exposes a
 * `start_id` cursor: passing start_id=N yields only rows with id > N. The sync
 * passes the last ingested id as `startId` so an incremental run fetches only
 * the new occurrences (cheap), and startId=0 (the default) does a full
 * backfill. NOTE: the rows are NOT ordered most-recent-first — never early-stop
 * on a watermark comparison here, the new rows live on the LAST pages.
 */
export async function* iterOccurrences(
  opts: ClientOpts,
  eventNs: string,
  startId = 0
): AsyncGenerator<MmOccurrence[], void, void> {
  let page = 1;
  while (true) {
    const url = `${opts.base}/flow/custom-events/data?event_ns=${encodeURIComponent(
      eventNs
    )}&start_id=${startId}&limit=100&page=${page}`;
    const r = await fetchWithRetry(url, {
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Accept: "application/json",
      },
    });
    if (!r.ok) {
      throw new Error(
        `iterOccurrences failed: HTTP ${r.status} on event ${eventNs} page ${page}`
      );
    }
    const j = (await r.json()) as PaginatedResponse<MmOccurrence>;
    yield j.data;
    if (j.meta.current_page >= j.meta.last_page) break;
    page++;
    if (page > 5000) {
      throw new Error(
        `iterOccurrences: pagination > 5000 pages on ${eventNs}, aborting`
      );
    }
  }
}
