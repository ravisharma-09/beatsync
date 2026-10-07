import type { Client, InStatement } from "@libsql/client";
import { Database, type SQLQueryBindings } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Persistent storage for accounts, the per-user library, playlists and permanent rooms.
 *
 * All reads and writes go to a local SQLite database, so the rest of the server stays
 * simple and synchronous. Live room state (clients, playback position, chat) is not
 * stored here; it stays in memory in RoomManager.
 *
 * Where the data survives depends on the host:
 *
 * - With a disk (your own machine, a VPS, a host with a volume): the SQLite file at
 *   DATABASE_PATH is the storage. Nothing else is needed.
 * - Without a disk (free hosts that wipe files on every restart): set TURSO_DATABASE_URL
 *   and TURSO_AUTH_TOKEN. The local database is then only a working copy: it is filled
 *   from Turso at startup, and every write is also sent to Turso (see connectRemoteDatabase).
 */
const isTest = process.env.NODE_ENV === "test";
const usesRemote = !isTest && !!process.env.TURSO_DATABASE_URL;
// With a remote copy, never start from a stale local file: the remote one is the truth
const DATABASE_PATH = usesRemote || isTest ? ":memory:" : (process.env.DATABASE_PATH ?? "./data/beatsync.db");

if (DATABASE_PATH !== ":memory:") {
  mkdirSync(dirname(DATABASE_PATH), { recursive: true });
}

const local = new Database(DATABASE_PATH, { create: true, strict: true });

local.run("PRAGMA journal_mode = WAL;");
local.run("PRAGMA foreign_keys = ON;");
local.run("PRAGMA busy_timeout = 5000;");

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    username      TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user_id ON sessions(user_id);

  -- A track in a user's library. storage_key is set when the file lives under the
  -- user's own storage prefix (and should be deleted together with the track).
  CREATE TABLE tracks (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    url         TEXT NOT NULL,
    storage_key TEXT,
    created_at  INTEGER NOT NULL,
    UNIQUE (user_id, url)
  );
  CREATE INDEX tracks_user_id ON tracks(user_id, created_at);

  CREATE TABLE playlists (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX playlists_user_id ON playlists(user_id, updated_at);

  CREATE TABLE playlist_tracks (
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id    TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, track_id)
  );
  CREATE INDEX playlist_tracks_order ON playlist_tracks(playlist_id, position);

  -- Permanent rooms: the code never expires and the queue survives everyone leaving.
  CREATE TABLE rooms (
    room_id       TEXT PRIMARY KEY,
    owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    audio_sources TEXT NOT NULL DEFAULT '[]',
    created_at    INTEGER NOT NULL
  );
  CREATE INDEX rooms_owner_id ON rooms(owner_id, created_at);
  `,
  `
  -- Which YouTube video plays a given song ("artist|title", normalised). Looked up once
  -- through YouTube's search and reused, because that search has a small daily limit.
  CREATE TABLE youtube_matches (
    song_key    TEXT PRIMARY KEY,
    video_id    TEXT NOT NULL,
    video_title TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );

  -- Per-day usage counters, e.g. how many YouTube searches were spent today.
  CREATE TABLE daily_counters (
    day   TEXT NOT NULL,
    name  TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, name)
  );
  `,
];

function migrateLocal() {
  const { user_version: current } = local.query<{ user_version: number }, []>("PRAGMA user_version").get()!;
  for (let version = current; version < MIGRATIONS.length; version++) {
    local.transaction(() => {
      local.run(MIGRATIONS[version]);
      local.run(`PRAGMA user_version = ${version + 1}`);
    })();
    console.log(`🗄️  Database migrated to version ${version + 1}`);
  }
}

migrateLocal();

// ── Write mirroring ─────────────────────────────────────────────────────────

const isWrite = (sql: string) => /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql);

type WriteListener = (statements: InStatement[]) => void;
let onWrite: WriteListener | null = null;
/** Statements of the local transaction in progress, sent together once it commits. */
let openTransaction: InStatement[] | null = null;

function recordWrite(sql: string, params: unknown[]): void {
  if (!onWrite) return;
  // Named parameters arrive as one plain object, positional ones as a list
  const [first] = params;
  const isNamed = params.length === 1 && typeof first === "object" && first !== null && !ArrayBuffer.isView(first);
  const statement = { sql, args: isNamed ? first : params } as InStatement;
  if (openTransaction) openTransaction.push(statement);
  else onWrite([statement]);
}

/**
 * The database handle used by the rest of the server. It behaves like the local SQLite
 * database and, when a remote copy is connected, reports every write so it can be mirrored.
 */
export const db = {
  query<Row, Params extends SQLQueryBindings | SQLQueryBindings[]>(sql: string) {
    const statement = local.query<Row, Params>(sql);
    if (!isWrite(sql)) return statement;

    return new Proxy(statement, {
      get(target, property) {
        if (property === "run") {
          return (...params: unknown[]) => {
            const result = (target.run as (...args: unknown[]) => unknown)(...params);
            recordWrite(sql, params);
            return result;
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
  },

  run(sql: string) {
    const result = local.run(sql);
    if (isWrite(sql)) recordWrite(sql, []);
    return result;
  },

  /** Like bun:sqlite's transaction(): all-or-nothing locally, and mirrored as one unit. */
  transaction<T>(work: () => T): () => T {
    return () => {
      const isOutermost = openTransaction === null;
      if (isOutermost) openTransaction = [];
      try {
        const result = local.transaction(work)();
        if (isOutermost) {
          const statements = openTransaction!;
          openTransaction = null;
          if (statements.length > 0) onWrite?.(statements);
        }
        return result;
      } catch (error) {
        if (isOutermost) openTransaction = null; // rolled back locally: nothing to mirror
        throw error;
      }
    };
  },
};

// ── Remote copy (Turso) ─────────────────────────────────────────────────────

/** Parents before children, so rows can be copied in with foreign keys on. */
const TABLES = [
  "users",
  "sessions",
  "tracks",
  "playlists",
  "playlist_tracks",
  "rooms",
  "youtube_matches",
  "daily_counters",
] as const;

const ORPHAN_CLEANUPS = [
  "DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users)",
  "DELETE FROM tracks WHERE user_id NOT IN (SELECT id FROM users)",
  "DELETE FROM playlists WHERE user_id NOT IN (SELECT id FROM users)",
  "DELETE FROM rooms WHERE owner_id NOT IN (SELECT id FROM users)",
  "DELETE FROM playlist_tracks WHERE playlist_id NOT IN (SELECT id FROM playlists) OR track_id NOT IN (SELECT id FROM tracks)",
];

const MAX_SEND_ATTEMPTS = 4;
let sendQueue: Promise<void> = Promise.resolve();

async function sendWithRetry(remote: Client, statements: InStatement[]): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await remote.batch(statements, "write");
      return;
    } catch (error) {
      if (attempt >= MAX_SEND_ATTEMPTS) {
        // The change stays in this process's working copy but will be gone after a restart
        console.error(`❌ Could not save ${statements.length} change(s) to the remote database:`, error);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
}

/**
 * Makes `remote` the durable copy of the database:
 * 1. brings its tables up to date, 2. loads everything it holds into the local working
 * copy, 3. from then on sends every local write to it, in order.
 */
export async function connectRemoteDatabase(remote: Client): Promise<void> {
  await remote.execute("CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER PRIMARY KEY)");
  const applied = await remote.execute("SELECT COALESCE(MAX(version), 0) AS version FROM _schema_version");
  for (let version = Number(applied.rows[0].version); version < MIGRATIONS.length; version++) {
    await remote.executeMultiple(MIGRATIONS[version]);
    await remote.execute({ sql: "INSERT INTO _schema_version (version) VALUES (?)", args: [version + 1] });
    console.log(`🗄️  Remote database migrated to version ${version + 1}`);
  }

  // Load with foreign-key checks off, then drop rows whose parent is gone. The remote
  // database may not cascade deletes the way the local one does, and one such leftover
  // row must not stop the server from starting.
  local.run("PRAGMA foreign_keys = OFF;");
  let total = 0;
  for (const table of TABLES) {
    const { columns, rows } = await remote.execute(`SELECT * FROM ${table}`);
    if (rows.length === 0) continue;
    const insert = local.query(
      `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
    );
    local.transaction(() => {
      for (const row of rows) insert.run(...(columns.map((_, index) => row[index]) as SQLQueryBindings[]));
    })();
    total += rows.length;
  }
  for (const cleanup of ORPHAN_CLEANUPS) local.run(cleanup);
  local.run("PRAGMA foreign_keys = ON;");
  console.log(`🗄️  Loaded ${total} row(s) from the remote database`);

  onWrite = (statements) => {
    sendQueue = sendQueue.then(() => sendWithRetry(remote, statements));
  };
}

/** Where accounts and playlists survive a restart: "remote" (Turso) or "disk" (the local file). */
export const accountStorage = (): "remote" | "disk" => (onWrite ? "remote" : "disk");

/** Resolves once every write made so far has been sent. Call before the process exits. */
export async function flushRemoteWrites(): Promise<void> {
  await sendQueue;
}

/** For tests: stop mirroring and forget the local working copy's rows. */
export function disconnectRemoteDatabase(): void {
  onWrite = null;
  for (const table of [...TABLES].reverse()) local.run(`DELETE FROM ${table}`);
}

/** Connects to Turso when it is configured. Call once at startup, before serving requests. */
export async function initDatabase(): Promise<void> {
  if (!usesRemote) return;
  const { createClient } = await import("@libsql/client/web");
  const remote = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
  await connectRemoteDatabase(remote);
}
