import {
  clearFailedLogins,
  createSession,
  createUser,
  deleteSession,
  EmailTakenError,
  getBearerToken,
  getUserFromRequest,
  isLoginBlocked,
  recordFailedLogin,
  verifyCredentials,
} from "@/auth";
import * as repo from "@/db/repo";
import {
  copyObject,
  createUserKey,
  deleteObject,
  deleteObjectsWithPrefix,
  extractOwnKeyFromUrl,
  generateAudioFileName,
  generatePresignedUserUploadUrl,
  getPublicUrlForKey,
  isUserKey,
  objectExists,
  titleFromFileName,
  validateR2Config,
} from "@/lib/r2";
import { globalManager } from "@/managers";
import { errorResponse, jsonResponse, sendBroadcast } from "@/utils/responses";
import type { BunServer } from "@/utils/websocket";
import type { AuthResponseType, LibraryTrackType, UploadUrlResponseType, UserType } from "@beatsync/shared";
import {
  AddPlaylistToRoomSchema,
  CreateRoomSchema,
  LibraryUploadCompleteSchema,
  LibraryUploadUrlSchema,
  LoginSchema,
  PlaybackControlsPermissionsEnum,
  PlaylistNameSchema,
  RegisterSchema,
  SaveQueueSchema,
  SetPlaylistTracksSchema,
} from "@beatsync/shared";
import type { z } from "zod";

/** Thrown inside handlers to return an error response without nesting. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function requireUser(req: Request): UserType {
  const user = getUserFromRequest(req);
  if (!user) throw new HttpError(401, "Please log in");
  return user;
}

async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(400, result.error.issues[0]?.message ?? "Invalid request");
  }
  return result.data;
}

function requireStorage(): void {
  const validation = validateR2Config();
  if (!validation.isValid) {
    console.error("R2 configuration errors:", validation.errors);
    throw new HttpError(500, "File storage is not configured on this server");
  }
}

/**
 * Routes for accounts, the personal library, playlists and permanent rooms.
 * Returns null when the path is not one of ours so the caller can continue routing.
 */
export async function handleAccountRoutes(req: Request, url: URL, server: BunServer): Promise<Response | null> {
  const segments = url.pathname.split("/").filter(Boolean);
  const [area] = segments;
  if (area !== "auth" && area !== "library" && area !== "playlists" && area !== "rooms") return null;

  try {
    const response = await route(req, segments, server);
    return response ?? errorResponse("Not found", 404);
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error.message, error.status);
    throw error;
  }
}

async function route(req: Request, segments: string[], server: BunServer): Promise<Response | null> {
  const [area, a, b] = segments;
  const { method } = req;
  const at = (length: number) => segments.length === length;

  // ── Auth ──────────────────────────────────────────────────────────────────
  if (area === "auth" && at(2)) {
    if (a === "register" && method === "POST") return await register(req);
    if (a === "login" && method === "POST") return await login(req, server);
    if (a === "logout" && method === "POST") {
      const token = getBearerToken(req);
      if (token) deleteSession(token);
      return jsonResponse({ success: true });
    }
    if (a === "me" && method === "GET") return jsonResponse(requireUser(req));
    return null;
  }

  // ── Library ───────────────────────────────────────────────────────────────
  if (area === "library") {
    const user = requireUser(req);
    if (a === "tracks" && at(2) && method === "GET") return jsonResponse(repo.listTracks(user.id));
    if (a === "tracks" && at(3) && method === "DELETE") return await deleteTrack(user, b);
    if (a === "upload-url" && at(2) && method === "POST") return await libraryUploadUrl(req, user);
    if (a === "upload-complete" && at(2) && method === "POST") return await libraryUploadComplete(req, user);
    return null;
  }

  // ── Playlists ─────────────────────────────────────────────────────────────
  if (area === "playlists") {
    const user = requireUser(req);
    if (at(1) && method === "GET") return jsonResponse(repo.listPlaylists(user.id));
    if (at(1) && method === "POST") {
      const { name } = await parseBody(req, PlaylistNameSchema);
      if (repo.countPlaylists(user.id) >= repo.MAX_PLAYLISTS_PER_USER) {
        throw new HttpError(400, `You can have at most ${repo.MAX_PLAYLISTS_PER_USER} playlists`);
      }
      return jsonResponse(repo.createPlaylist(user.id, name), 201);
    }
    if (at(2) && method === "GET") {
      const playlist = repo.getPlaylist(user.id, a);
      if (!playlist) throw new HttpError(404, "Playlist not found");
      return jsonResponse(playlist);
    }
    if (at(2) && method === "PATCH") {
      const { name } = await parseBody(req, PlaylistNameSchema);
      if (!repo.renamePlaylist(user.id, a, name)) throw new HttpError(404, "Playlist not found");
      return jsonResponse(repo.getPlaylist(user.id, a));
    }
    if (at(2) && method === "DELETE") {
      if (!repo.deletePlaylist(user.id, a)) throw new HttpError(404, "Playlist not found");
      return jsonResponse({ success: true });
    }
    if (at(3) && b === "tracks" && method === "PUT") {
      const { trackIds } = await parseBody(req, SetPlaylistTracksSchema);
      const playlist = repo.setPlaylistTracks(user.id, a, trackIds);
      if (!playlist) throw new HttpError(404, "Playlist not found");
      return jsonResponse(playlist);
    }
    return null;
  }

  // ── Rooms ─────────────────────────────────────────────────────────────────
  if (area === "rooms") {
    // Public: lets anyone with the code see the room's name before joining.
    if (at(3) && b === "info" && method === "GET") return jsonResponse(repo.getRoomInfo(a));

    const user = requireUser(req);
    if (at(1) && method === "GET") return jsonResponse(repo.listRooms(user.id));
    if (at(1) && method === "POST") {
      const { name } = await parseBody(req, CreateRoomSchema);
      if (repo.countRooms(user.id) >= repo.MAX_ROOMS_PER_USER) {
        throw new HttpError(400, `You can have at most ${repo.MAX_ROOMS_PER_USER} permanent rooms`);
      }
      const room = repo.createRoom(user.id, name, (roomId) => globalManager.hasRoom(roomId));
      return jsonResponse(room, 201);
    }
    if (at(2) && method === "PATCH") {
      const { name } = await parseBody(req, CreateRoomSchema);
      if (!repo.renameRoom(user.id, a, name)) throw new HttpError(404, "Room not found");
      return jsonResponse({ success: true });
    }
    if (at(2) && method === "DELETE") return await deleteRoom(user, a);
    if (at(3) && b === "add-playlist" && method === "POST") return await addPlaylistToRoom(req, user, a, server);
    if (at(3) && b === "save-queue" && method === "POST") return await saveQueueAsPlaylist(req, user, a);
    return null;
  }

  return null;
}

// ── Auth handlers ───────────────────────────────────────────────────────────

async function register(req: Request): Promise<Response> {
  const input = await parseBody(req, RegisterSchema);
  try {
    const user = await createUser(input);
    const response: AuthResponseType = { token: createSession(user.id), user };
    return jsonResponse(response, 201);
  } catch (error) {
    if (error instanceof EmailTakenError) throw new HttpError(409, error.message);
    throw error;
  }
}

async function login(req: Request, server: BunServer): Promise<Response> {
  const { email, password } = await parseBody(req, LoginSchema);

  // Throttle per email and per address, so neither one account nor one machine can be hammered.
  const ip = server.requestIP(req)?.address ?? "unknown";
  const keys = [`email:${email}`, `ip:${ip}`];
  if (keys.some(isLoginBlocked)) {
    throw new HttpError(429, "Too many failed attempts. Please try again in a few minutes.");
  }

  const user = await verifyCredentials(email, password);
  if (!user) {
    keys.forEach(recordFailedLogin);
    throw new HttpError(401, "Wrong email or password");
  }

  clearFailedLogins(`email:${email}`);
  const response: AuthResponseType = { token: createSession(user.id), user };
  return jsonResponse(response);
}

// ── Library handlers ────────────────────────────────────────────────────────

async function libraryUploadUrl(req: Request, user: UserType): Promise<Response> {
  requireStorage();
  const { fileName, contentType } = await parseBody(req, LibraryUploadUrlSchema);

  if (repo.countTracks(user.id) >= repo.MAX_TRACKS_PER_USER) {
    throw new HttpError(400, `Your library is full (${repo.MAX_TRACKS_PER_USER} tracks)`);
  }

  const uniqueFileName = generateAudioFileName(fileName);
  const response: UploadUrlResponseType = {
    uploadUrl: await generatePresignedUserUploadUrl(user.id, uniqueFileName, contentType),
    publicUrl: getPublicUrlForKey(createUserKey(user.id, uniqueFileName)),
  };
  return jsonResponse(response);
}

async function libraryUploadComplete(req: Request, user: UserType): Promise<Response> {
  requireStorage();
  const { publicUrl } = await parseBody(req, LibraryUploadCompleteSchema);

  // Only accept files that really are in this user's own storage folder.
  const key = extractOwnKeyFromUrl(publicUrl);
  if (!key || !isUserKey(key, user.id)) throw new HttpError(400, "This file is not in your library folder");
  if (!(await objectExists(key))) throw new HttpError(400, "Upload not found. Please try again.");

  const fileName = key.slice(key.indexOf("/") + 1);
  const track = repo.addTrack({
    userId: user.id,
    title: titleFromFileName(fileName),
    url: publicUrl,
    storageKey: key,
  });
  return jsonResponse(track, 201);
}

async function deleteTrack(user: UserType, trackId: string): Promise<Response> {
  const { deleted, storageKey } = repo.deleteTrack(user.id, trackId);
  if (!deleted) throw new HttpError(404, "Track not found");

  if (storageKey) {
    try {
      await deleteObject(storageKey);
    } catch (error) {
      // The track is gone from the library either way; a leftover file only costs storage.
      console.error(`Failed to delete library file ${storageKey}:`, error);
    }
  }
  return jsonResponse({ success: true });
}

// ── Room handlers ───────────────────────────────────────────────────────────

async function deleteRoom(user: UserType, roomId: string): Promise<Response> {
  if (!repo.deleteRoom(user.id, roomId)) throw new HttpError(404, "Room not found");

  // If people are in the room right now it simply becomes a normal temporary room and is
  // cleaned up when they leave. Otherwise nothing will ever clean its uploads, so do it now.
  if (!globalManager.hasRoom(roomId)) {
    try {
      await deleteObjectsWithPrefix(`room-${roomId}/`);
    } catch (error) {
      console.error(`Failed to delete uploads of room ${roomId}:`, error);
    }
  }
  return jsonResponse({ success: true });
}

async function addPlaylistToRoom(req: Request, user: UserType, roomId: string, server: BunServer): Promise<Response> {
  const { playlistId } = await parseBody(req, AddPlaylistToRoomSchema);

  const room = globalManager.getRoom(roomId);
  const client = room?.getConnectedClientForUser(user.id);
  if (!room || !client) throw new HttpError(403, "Join the room before adding music to it");

  const canMutate =
    client.isAdmin || room.getPlaybackControlsPermissions() === PlaybackControlsPermissionsEnum.enum.EVERYONE;
  if (!canMutate) throw new HttpError(403, "Only room admins can change the queue");

  const playlist = repo.getPlaylist(user.id, playlistId);
  if (!playlist) throw new HttpError(404, "Playlist not found");

  const alreadyQueued = new Set(room.getAudioSources().map((source) => source.url));
  let added = 0;
  for (const track of playlist.tracks) {
    if (alreadyQueued.has(track.url)) continue;
    room.addAudioSource({ url: track.url });
    alreadyQueued.add(track.url);
    added++;
  }

  if (added > 0) {
    sendBroadcast({
      server,
      roomId,
      message: { type: "ROOM_EVENT", event: { type: "SET_AUDIO_SOURCES", sources: room.getAudioSources() } },
    });
  }

  return jsonResponse({ added, skipped: playlist.tracks.length - added });
}

async function saveQueueAsPlaylist(req: Request, user: UserType, roomId: string): Promise<Response> {
  const { name } = await parseBody(req, SaveQueueSchema);

  const room = globalManager.getRoom(roomId);
  if (!room?.getConnectedClientForUser(user.id)) throw new HttpError(403, "Join the room before saving its queue");

  const sources = room.getAudioSources();
  if (sources.length === 0) throw new HttpError(400, "The queue is empty");

  if (repo.countPlaylists(user.id) >= repo.MAX_PLAYLISTS_PER_USER) {
    throw new HttpError(400, `You can have at most ${repo.MAX_PLAYLISTS_PER_USER} playlists`);
  }

  const tracks: LibraryTrackType[] = [];
  let failed = 0;
  for (const source of sources) {
    try {
      tracks.push(await saveSourceToLibrary(user, source.url));
    } catch (error) {
      failed++;
      console.error(`Failed to save ${source.url} to library of ${user.id}:`, error);
    }
  }

  if (tracks.length === 0) throw new HttpError(500, "Could not save any track from the queue");

  const playlist = repo.createPlaylist(
    user.id,
    name,
    tracks.map((track) => track.id)
  );
  return jsonResponse({ playlist, failed }, 201);
}

/**
 * Makes sure a queue item is in the user's library and returns the library track.
 * Room uploads are deleted with their room, so files from our bucket are copied into the
 * user's own folder. External URLs (e.g. default tracks) are saved as links.
 */
async function saveSourceToLibrary(user: UserType, url: string): Promise<LibraryTrackType> {
  const existing = repo.getTrackByUrl(user.id, url);
  if (existing) return existing;

  const fileNameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
  const sourceKey = extractOwnKeyFromUrl(url);

  if (!sourceKey) {
    const fileName = decodeURIComponent(fileNameOf(new URL(url, "http://local").pathname));
    return repo.addTrack({ userId: user.id, title: titleFromFileName(fileName), url, storageKey: null });
  }

  if (repo.countTracks(user.id) >= repo.MAX_TRACKS_PER_USER) {
    throw new Error("Library is full");
  }

  const fileName = fileNameOf(sourceKey);
  const destinationKey = createUserKey(user.id, fileName);
  if (sourceKey !== destinationKey) {
    await copyObject(sourceKey, destinationKey);
  }
  return repo.addTrack({
    userId: user.id,
    title: titleFromFileName(fileName),
    url: getPublicUrlForKey(destinationKey),
    storageKey: destinationKey,
  });
}
