import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Persistent storage for accounts, the per-user library, playlists and permanent rooms.
 *
 * SQLite keeps the server a single process with no external services. Live room state
 * (clients, playback position, chat) intentionally stays in memory in RoomManager.
 *
 * Set DATABASE_PATH to choose the file. Tests use an in-memory database.
 */
const isTest = process.env.NODE_ENV === "test";
const DATABASE_PATH = process.env.DATABASE_PATH ?? (isTest ? ":memory:" : "./data/beatsync.db");

if (DATABASE_PATH !== ":memory:") {
  mkdirSync(dirname(DATABASE_PATH), { recursive: true });
}

export const db = new Database(DATABASE_PATH, { create: true, strict: true });

db.run("PRAGMA journal_mode = WAL;");
db.run("PRAGMA foreign_keys = ON;");
db.run("PRAGMA busy_timeout = 5000;");

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
];

function migrate() {
  const { user_version: current } = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!;
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.run(MIGRATIONS[version]);
      db.run(`PRAGMA user_version = ${version + 1}`);
    })();
    console.log(`🗄️  Database migrated to version ${version + 1}`);
  }
}

migrate();
