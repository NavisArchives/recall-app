/**
 * A Supabase client that answers plausibly and remembers what it was asked.
 *
 * The tenancy bug class is not "the wrong row came back" — it is "the query
 * never said which family it meant". That is a property of the *question*, not
 * of the answer, so it can be checked without a database: record every query
 * the routes issue, then assert each one that touches a family's table carried
 * an archive constraint.
 *
 * This keeps the suite offline and fast, and it catches a new route the day it
 * is written rather than the day someone notices.
 */

export interface RecordedQuery {
  table: string;
  op: "select" | "insert" | "update" | "delete" | "upsert";
  select?: string;
  filters: { method: string; column: string; value: unknown }[];
  payload?: Record<string, unknown> | Record<string, unknown>[];
}

export type ResponseMap = Record<string, Record<string, unknown>[]>;

const FILTER_METHODS = [
  "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike",
  "is", "in", "contains", "containedBy", "match", "not", "filter", "or",
] as const;

const PASSTHROUGH_METHODS = [
  "order", "limit", "range", "abortSignal", "returns", "overrideTypes",
  "throwOnError", "explain", "csv", "geojson", "setHeader",
] as const;

export class SupabaseRecorder {
  readonly queries: RecordedQuery[] = [];
  responses: ResponseMap = {};
  /**
   * Rows for ONE query shape, when a request asks the same table two
   * different questions (059).
   *
   * `responses` is keyed by table, so every query against `media_files`
   * inside one upload gets the same rows — but that route reads the last
   * display_order and then reads back what it inserted, and a test about the
   * second cannot express itself through the first. The keys are
   * `table:op` or, more specifically, `table:op:select`; the specific key
   * wins, and an absent key falls through to `responses`.
   *
   * The select discriminator is the same one `failNext` already carries, for
   * the same reason: a test should be able to name the read it means.
   */
  opResponses: ResponseMap = {};
  /** Set to simulate an unreachable database, which is what the fallback is for. */
  failure: { message: string } | null = null;
  /**
   * Fail exactly the next query matching this table and op, then clear.
   *
   * `failure` is an outage — every query dies. This is a single refusal, for
   * the cases where one statement loses a race the database referees: two
   * screens pairing at once resolve to one winner because the unique index
   * answers the loser with 23505, and that answer is what the route must
   * translate kindly.
   */
  failNext: {
    table: string;
    op: RecordedQuery["op"];
    /*
      Optional discriminator for routes that read the same table twice
      (M185). The delete-person route does: requireRole reloads the caller
      from `people`, then the last-admin guard counts `people` again. A
      failNext keyed on (table, op) alone dies at the middleware, and a test
      that meant to break the guard's count silently pins the wrong read —
      which is exactly how the guard's fail-closed branch went unpinned.
      Matched exactly against the query's select string, so the test names
      the read it intends to kill.
    */
    select?: string;
    error: { message: string; code?: string };
  } | null = null;

  reset(responses: ResponseMap = {}, opResponses: ResponseMap = {}) {
    this.queries.length = 0;
    this.responses = responses;
    this.opResponses = opResponses;
    this.failure = null;
    this.failNext = null;
  }

  /** Queries issued against `table`, in order. */
  forTable(table: string): RecordedQuery[] {
    return this.queries.filter((q) => q.table === table);
  }

  private rowsFor(record: RecordedQuery): Record<string, unknown>[] {
    const specific =
      record.select !== undefined
        ? this.opResponses[`${record.table}:${record.op}:${record.select}`]
        : undefined;
    return specific ?? this.opResponses[`${record.table}:${record.op}`] ?? this.responses[record.table] ?? [];
  }

  private builder(record: RecordedQuery) {
    let wantsSingle = false;

    const result = () => {
      if (this.failure) {
        return { data: null, error: this.failure, count: 0, status: 503 };
      }
      if (
        this.failNext &&
        this.failNext.table === record.table &&
        this.failNext.op === record.op &&
        (this.failNext.select === undefined || this.failNext.select === record.select)
      ) {
        const { error } = this.failNext;
        this.failNext = null;
        return { data: null, error, count: 0, status: 409 };
      }
      const rows = this.rowsFor(record);
      const data = wantsSingle ? (rows[0] ?? null) : rows;
      return { data, error: null, count: rows.length, status: 200 };
    };

    const api: Record<string, unknown> = {};

    for (const method of FILTER_METHODS) {
      api[method] = (column: string, value: unknown) => {
        record.filters.push({ method, column, value });
        return api;
      };
    }
    for (const method of PASSTHROUGH_METHODS) {
      api[method] = () => api;
    }

    api.select = (columns?: string) => {
      if (columns !== undefined) record.select = columns;
      return api;
    };
    api.single = () => {
      wantsSingle = true;
      return api;
    };
    api.maybeSingle = () => {
      wantsSingle = true;
      return api;
    };

    // Thenable: `await query` resolves the way the real client does.
    api.then = (onFulfilled?: (v: unknown) => unknown, onRejected?: unknown) => {
      void onRejected;
      return Promise.resolve(result()).then(onFulfilled);
    };

    return api;
  }

  private table(name: string) {
    const start = (op: RecordedQuery["op"], payload?: RecordedQuery["payload"]) => {
      const record: RecordedQuery = { table: name, op, filters: [], payload };
      this.queries.push(record);
      return this.builder(record);
    };

    return {
      select: (columns?: string) => {
        const query = start("select");
        return (query as { select: (c?: string) => unknown }).select(columns);
      },
      insert: (payload: RecordedQuery["payload"]) => start("insert", payload),
      upsert: (payload: RecordedQuery["payload"]) => start("upsert", payload),
      update: (payload: RecordedQuery["payload"]) => start("update", payload),
      delete: () => start("delete"),
    };
  }

  get client() {
    const storageBucket = {
      upload: async () => ({ data: { path: "stub/path.jpg" }, error: null }),
      remove: async () => ({ data: [], error: null }),
      download: async () => ({ data: null, error: null }),
      createSignedUrl: async () => ({ data: { signedUrl: "https://example.invalid/x" }, error: null }),
      list: async () => ({ data: [], error: null }),
    };

    return {
      from: (name: string) => this.table(name),
      rpc: (fn: string, args?: Record<string, unknown>) => {
        const record: RecordedQuery = {
          table: `rpc:${fn}`,
          op: "select",
          filters: [],
          payload: args,
        };
        this.queries.push(record);
        return this.builder(record);
      },
      storage: { from: () => storageBucket },
      auth: { persistSession: false },
    };
  }
}

export const recorder = new SupabaseRecorder();
