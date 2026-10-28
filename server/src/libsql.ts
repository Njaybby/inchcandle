import { createClient, type InValue } from "@libsql/client";
import { schema, type Db } from "./db";

// The directory's storage on libSQL: a local file in development and Turso when hosted. The statements are the same SQLite as node:sqlite.

export async function openLibsql(url: string, authToken?: string): Promise<Db> {
  const client = createClient({ url, authToken });
  await client.executeMultiple(schema);
  const args = (params: unknown[]) => params.map((p) => (p === undefined ? null : p)) as InValue[];
  return {
    async run(sql, ...params) {
      const result = await client.execute({ sql, args: args(params) });
      return { changes: result.rowsAffected };
    },
    async get(sql, ...params) {
      const result = await client.execute({ sql, args: args(params) });
      return (result.rows[0] ? plain(result.columns, result.rows[0]) : undefined) as never;
    },
    async all(sql, ...params) {
      const result = await client.execute({ sql, args: args(params) });
      return result.rows.map((row) => plain(result.columns, row)) as never;
    },
  };
}

/** libSQL rows are array-like objects; the app reads plain objects with number columns, as node:sqlite returns them. */
function plain(columns: string[], row: ArrayLike<unknown>) {
  const out: Record<string, unknown> = {};
  columns.forEach((name, i) => {
    const value = row[i];
    out[name] = typeof value === "bigint" ? Number(value) : value;
  });
  return out;
}
