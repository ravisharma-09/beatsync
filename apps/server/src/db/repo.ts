import { db } from "@/db";
import type {
  AudioSourceType,
  PlaylistSummaryType,
  PlaylistType,
  RoomInfoType,
  SavedRoomType,
  LibraryTrackType,
} from "@beatsync/shared";
import { AudioSourceSchema } from "@beatsync/shared";
import { nanoid } from "nanoid";
import { z } from "zod";

// ── Limits ──────────────────────────────────────────────────────────────────

export const MAX_TRACKS_PER_USER = 1000;
export const MAX_PLAYLISTS_PER_USER = 200;
export const MAX_ROOMS_PER_USER = 20;

// ── Tracks ──────────────────────────────────────────────────────────────────

interface TrackRow {
  id: string;
  user_id: string;
  title: string;
  url: string;
  storage_key: string | null;
  created_at: number;
}

const toTrack = (row: TrackRow): LibraryTrackType => ({
  id: row.id,
  title: row.title,
  url: row.url,
  createdAt: row.created_at,
});

export function listTracks(userId: string): LibraryTrackType[] {
  return db
    .query<TrackRow, [string]>("SELECT * FROM tracks WHERE user_id = ? ORDER BY created_at DESC, rowid DESC")
    .all(userId)
    .map(toTrack);
}

export function countTracks(userId: string): number {
  return db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM tracks WHERE user_id = ?").get(userId)!.n;
}

export function getTrackByUrl(userId: string, url: string): LibraryTrackType | null {
  const row = db
    .query<TrackRow, [string, string]>("SELECT * FROM tracks WHERE user_id = ? AND url = ?")
    .get(userId, url);
  return row ? toTrack(row) : null;
}

/** Adds a track, or returns the existing one if this user already has this URL. */
export function addTrack(input: {
  userId: string;
  title: string;
  url: string;
  storageKey: string | null;
}): LibraryTrackType {
  const existing = getTrackByUrl(input.userId, input.url);
  if (existing) return existing;

  const row: TrackRow = {
    id: nanoid(),
    user_id: input.userId,
    title: input.title,
    url: input.url,
    storage_key: input.storageKey,
    created_at: Date.now(),
  };
  db.query(
    "INSERT INTO tracks (id, user_id, title, url, storage_key, created_at) VALUES ($id, $user_id, $title, $url, $storage_key, $created_at)"
  ).run({ ...row });
  return toTrack(row);
}

/** Deletes the track and returns its storage key (if any) so the caller can delete the file. */
export function deleteTrack(userId: string, trackId: string): { deleted: boolean; storageKey: string | null } {
  const row = db
    .query<TrackRow, [string, string]>("SELECT * FROM tracks WHERE id = ? AND user_id = ?")
    .get(trackId, userId);
  if (!row) return { deleted: false, storageKey: null };
  db.query("DELETE FROM tracks WHERE id = ?").run(trackId);
  return { deleted: true, storageKey: row.storage_key };
}

// ── Playlists ───────────────────────────────────────────────────────────────

interface PlaylistRow {
  id: string;
  user_id: string;
  name: string;
  created_at: number;
  updated_at: number;
  track_count: number;
}

const toPlaylistSummary = (row: PlaylistRow): PlaylistSummaryType => ({
  id: row.id,
  name: row.name,
  trackCount: row.track_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const PLAYLIST_SELECT = `
  SELECT playlists.*, (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = playlists.id) AS track_count
  FROM playlists`;

export function listPlaylists(userId: string): PlaylistSummaryType[] {
  return db
    .query<PlaylistRow, [string]>(`${PLAYLIST_SELECT} WHERE user_id = ? ORDER BY updated_at DESC, rowid DESC`)
    .all(userId)
    .map(toPlaylistSummary);
}

export function countPlaylists(userId: string): number {
  return db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM playlists WHERE user_id = ?").get(userId)!.n;
}

export function getPlaylist(userId: string, playlistId: string): PlaylistType | null {
  const row = db
    .query<PlaylistRow, [string, string]>(`${PLAYLIST_SELECT} WHERE id = ? AND user_id = ?`)
    .get(playlistId, userId);
  if (!row) return null;

  const tracks = db
    .query<TrackRow, [string]>(
      `SELECT tracks.* FROM playlist_tracks
       JOIN tracks ON tracks.id = playlist_tracks.track_id
       WHERE playlist_tracks.playlist_id = ?
       ORDER BY playlist_tracks.position`
    )
    .all(playlistId)
    .map(toTrack);

  return { ...toPlaylistSummary(row), tracks };
}

export function createPlaylist(userId: string, name: string, trackIds: string[] = []): PlaylistType {
  const id = nanoid();
  const now = Date.now();
  db.transaction(() => {
    db.query("INSERT INTO playlists (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      id,
      userId,
      name,
      now,
      now
    );
    writePlaylistTracks(userId, id, trackIds);
  })();
  return getPlaylist(userId, id)!;
}

export function renamePlaylist(userId: string, playlistId: string, name: string): boolean {
  const result = db
    .query("UPDATE playlists SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(name, Date.now(), playlistId, userId);
  return result.changes > 0;
}

export function deletePlaylist(userId: string, playlistId: string): boolean {
  return db.query("DELETE FROM playlists WHERE id = ? AND user_id = ?").run(playlistId, userId).changes > 0;
}

/** Replaces the playlist's tracks. Ids that are not in the user's library are ignored. */
export function setPlaylistTracks(userId: string, playlistId: string, trackIds: string[]): PlaylistType | null {
  if (!getPlaylist(userId, playlistId)) return null;
  db.transaction(() => {
    writePlaylistTracks(userId, playlistId, trackIds);
    db.query("UPDATE playlists SET updated_at = ? WHERE id = ?").run(Date.now(), playlistId);
  })();
  return getPlaylist(userId, playlistId);
}

function writePlaylistTracks(userId: string, playlistId: string, trackIds: string[]): void {
  db.query("DELETE FROM playlist_tracks WHERE playlist_id = ?").run(playlistId);

  const owns = db.query<{ id: string }, [string, string]>("SELECT id FROM tracks WHERE id = ? AND user_id = ?");
  const insert = db.query("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)");

  let position = 0;
  for (const trackId of new Set(trackIds)) {
    if (!owns.get(trackId, userId)) continue;
    insert.run(playlistId, trackId, position++);
  }
}

// ── Permanent rooms ─────────────────────────────────────────────────────────

interface RoomRow {
  room_id: string;
  owner_id: string;
  name: string;
  audio_sources: string;
  created_at: number;
}

const AudioSourcesSchema = z.array(AudioSourceSchema);

function parseAudioSources(json: string): AudioSourceType[] {
  try {
    const parsed = AudioSourcesSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

const toSavedRoom = (row: RoomRow): SavedRoomType => ({
  roomId: row.room_id,
  name: row.name,
  trackCount: parseAudioSources(row.audio_sources).length,
  createdAt: row.created_at,
});

function getRoomRow(roomId: string): RoomRow | null {
  return db.query<RoomRow, [string]>("SELECT * FROM rooms WHERE room_id = ?").get(roomId);
}

export function isPermanentRoom(roomId: string): boolean {
  return getRoomRow(roomId) !== null;
}

export function getRoomOwnerId(roomId: string): string | null {
  return getRoomRow(roomId)?.owner_id ?? null;
}

export function getPermanentRoomIds(): string[] {
  return db
    .query<{ room_id: string }, []>("SELECT room_id FROM rooms")
    .all()
    .map((row) => row.room_id);
}

export function getRoomInfo(roomId: string): RoomInfoType {
  const row = db
    .query<
      { name: string; username: string },
      [string]
    >("SELECT rooms.name, users.username FROM rooms JOIN users ON users.id = rooms.owner_id WHERE room_id = ?")
    .get(roomId);
  return {
    roomId,
    isPermanent: row !== null,
    name: row?.name ?? null,
    ownerUsername: row?.username ?? null,
  };
}

export function listRooms(ownerId: string): SavedRoomType[] {
  return db
    .query<RoomRow, [string]>("SELECT * FROM rooms WHERE owner_id = ? ORDER BY created_at DESC, rowid DESC")
    .all(ownerId)
    .map(toSavedRoom);
}

export function countRooms(ownerId: string): number {
  return db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM rooms WHERE owner_id = ?").get(ownerId)!.n;
}

/**
 * Creates a permanent room with a fresh 6-digit code.
 * isCodeInUse lets the caller also avoid codes of live temporary rooms.
 */
export function createRoom(ownerId: string, name: string, isCodeInUse: (roomId: string) => boolean): SavedRoomType {
  for (let attempt = 0; attempt < 50; attempt++) {
    const roomId = Math.floor(100000 + Math.random() * 900000).toString();
    if (isCodeInUse(roomId) || isPermanentRoom(roomId)) continue;

    const row: RoomRow = { room_id: roomId, owner_id: ownerId, name, audio_sources: "[]", created_at: Date.now() };
    db.query(
      "INSERT INTO rooms (room_id, owner_id, name, audio_sources, created_at) VALUES ($room_id, $owner_id, $name, $audio_sources, $created_at)"
    ).run({ ...row });
    return toSavedRoom(row);
  }
  throw new Error("Could not find a free room code");
}

export function renameRoom(ownerId: string, roomId: string, name: string): boolean {
  return (
    db.query("UPDATE rooms SET name = ? WHERE room_id = ? AND owner_id = ?").run(name, roomId, ownerId).changes > 0
  );
}

export function deleteRoom(ownerId: string, roomId: string): boolean {
  return db.query("DELETE FROM rooms WHERE room_id = ? AND owner_id = ?").run(roomId, ownerId).changes > 0;
}

export function getSavedQueue(roomId: string): AudioSourceType[] | null {
  const row = getRoomRow(roomId);
  return row ? parseAudioSources(row.audio_sources) : null;
}

/** No-op for rooms that are not permanent. */
export function saveQueue(roomId: string, audioSources: AudioSourceType[]): void {
  db.query("UPDATE rooms SET audio_sources = ? WHERE room_id = ?").run(JSON.stringify(audioSources), roomId);
}
