import { randomUUID } from "node:crypto";

/**
 * An in-memory stand-in for the Supabase admin client, covering the query
 * shapes the admin routes use: select (with an exact head count), insert,
 * update and delete, filtered by eq, neq, in, is and not-is.
 */

type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

type Filter = (row: Row) => boolean;

export function fakeDb(tables: Tables, files: Record<string, Uint8Array> = {}) {
  function from(name: string) {
    tables[name] ??= [];
    const rows = tables[name];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row | Row[] = {};
    let headCount = false;
    let limit = Infinity;
    const filters: Filter[] = [];

    function run() {
      if (op === "insert") {
        const added = (Array.isArray(payload) ? payload : [payload]).map((r) => ({ id: randomUUID(), created_at: new Date().toISOString(), ...r }));
        rows.push(...added);
        return added;
      }
      const matched = rows.filter((r) => filters.every((f) => f(r))).slice(0, limit);
      if (op === "update") for (const r of matched) Object.assign(r, payload);
      if (op === "delete") for (const r of matched) rows.splice(rows.indexOf(r), 1);
      return matched.map((r) => ({ ...r }));
    }

    const builder = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        if (opts?.head) headCount = true;
        return builder;
      },
      insert(value: Row | Row[]) {
        op = "insert";
        payload = value;
        return builder;
      },
      update(value: Row) {
        op = "update";
        payload = value;
        return builder;
      },
      delete() {
        op = "delete";
        return builder;
      },
      eq(col: string, value: unknown) {
        filters.push((r) => r[col] === value);
        return builder;
      },
      neq(col: string, value: unknown) {
        filters.push((r) => r[col] !== value);
        return builder;
      },
      in(col: string, values: unknown[]) {
        filters.push((r) => values.includes(r[col]));
        return builder;
      },
      is(col: string, value: null) {
        filters.push((r) => (r[col] ?? null) === value);
        return builder;
      },
      not(col: string, _op: "is", value: null) {
        filters.push((r) => (r[col] ?? null) !== value);
        return builder;
      },
      order() {
        return builder;
      },
      limit(n: number) {
        limit = n;
        return builder;
      },
      async maybeSingle() {
        return { data: run()[0] ?? null, error: null };
      },
      async single() {
        const [row] = run();
        return row ? { data: row, error: null } : { data: null, error: { message: "no rows" } };
      },
      then(resolve: (result: { data: Row[] | null; error: null; count?: number }) => void) {
        const result = run();
        resolve(headCount ? { data: null, error: null, count: result.length } : { data: result, error: null });
      },
    };
    return builder;
  }

  const storage = {
    from: () => ({
      async upload(path: string, body: Uint8Array | Buffer) {
        files[path] = new Uint8Array(body);
        return { data: { path }, error: null };
      },
      async download(path: string) {
        const bytes = files[path];
        return bytes ? { data: new Blob([bytes as Uint8Array<ArrayBuffer>]), error: null } : { data: null, error: { message: "not found" } };
      },
      async remove(paths: string[]) {
        for (const path of paths) delete files[path];
        return { data: null, error: null };
      },
    }),
  };

  return { from, storage };
}
