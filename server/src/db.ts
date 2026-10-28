// The directory's storage. Every query is plain SQLite so the same statements run on node:sqlite locally and on libSQL (Turso) when hosted.

export interface Db {
  run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
  get<T>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
}

export const schema = `
create table if not exists rooms (
  id text primary key,
  network text not null,
  listing text not null,
  name text,
  fingerprint text not null,
  terms text,
  sealed text,
  host text not null,
  host_key text not null,
  closes_at integer,
  opens_round integer,
  vault text,
  paddles integer not null default 0,
  paddle_cap integer not null,
  created_at integer not null
);
create table if not exists codes (
  id text primary key,
  room_id text not null,
  paddle integer not null,
  admission text not null,
  created_at integer not null,
  used_at integer,
  used_by text,
  revoked_at integer
);
create index if not exists codes_room on codes (room_id);
create table if not exists members (
  room_id text not null,
  device text not null,
  device_key text not null,
  paddle integer not null,
  code_id text,
  joined_at integer not null,
  removed_at integer,
  primary key (room_id, device)
);
create table if not exists bids (
  id text primary key,
  room_id text not null,
  paddle integer not null,
  envelope text not null,
  deposit text not null,
  at integer not null,
  seq integer not null
);
create index if not exists bids_room on bids (room_id);
create table if not exists payments (
  id text primary key,
  room_id text not null,
  paddle integer not null,
  claim_key text not null,
  amount text not null,
  at integer not null
);
create table if not exists grants (
  room_id text not null,
  attester text not null,
  sealed text not null,
  primary key (room_id, attester)
);
create table if not exists attestations (
  room_id text not null,
  attester text not null,
  kind text not null,
  body text not null,
  signature text not null,
  at integer not null,
  primary key (room_id, attester)
);
create table if not exists claims (
  vault text primary key,
  room_id text not null,
  destination text not null,
  signature text not null,
  status text not null,
  tx text,
  error text,
  at integer not null
);
create table if not exists settlements (
  room_id text primary key,
  vault text not null,
  kind text not null,
  status text not null,
  tx text,
  error text,
  at integer not null
);
`;

/** Wraps node:sqlite's synchronous API in the async shape the app uses. */
export async function openSqlite(path: string): Promise<Db> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path);
  db.exec("pragma journal_mode = wal; pragma busy_timeout = 2000;");
  db.exec(schema);
  const prepared = new Map<string, ReturnType<typeof db.prepare>>();
  const statement = (sql: string) => {
    let s = prepared.get(sql);
    if (!s) prepared.set(sql, (s = db.prepare(sql)));
    return s;
  };
  return {
    async run(sql, ...params) {
      const result = statement(sql).run(...(params as never[]));
      return { changes: Number(result.changes) };
    },
    async get(sql, ...params) {
      return statement(sql).get(...(params as never[])) as never;
    },
    async all(sql, ...params) {
      return statement(sql).all(...(params as never[])) as never;
    },
  };
}
