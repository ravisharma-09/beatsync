import { z } from "zod";

// ── Accounts ────────────────────────────────────────────────────────────────

export const USERNAME_MAX_LENGTH = 32;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

export const RegisterSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  username: z.string().trim().min(2).max(USERNAME_MAX_LENGTH),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});
export type RegisterType = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginType = z.infer<typeof LoginSchema>;

export const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  username: z.string(),
  createdAt: z.number(),
});
export type UserType = z.infer<typeof UserSchema>;

export const AuthResponseSchema = z.object({
  token: z.string(),
  user: UserSchema,
});
export type AuthResponseType = z.infer<typeof AuthResponseSchema>;

// ── Library ─────────────────────────────────────────────────────────────────

export const LibraryTrackSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  createdAt: z.number(),
});
export type LibraryTrackType = z.infer<typeof LibraryTrackSchema>;

const AudioContentTypeSchema = z
  .string()
  .refine(
    (type) => type.startsWith("audio/") || type === "video/webm",
    "Content type must be an audio mime type or video/webm"
  );

export const LibraryUploadUrlSchema = z.object({
  fileName: z.string().min(1).max(500),
  contentType: AudioContentTypeSchema,
});
export type LibraryUploadUrlType = z.infer<typeof LibraryUploadUrlSchema>;

export const LibraryUploadCompleteSchema = z.object({
  fileName: z.string().min(1).max(500),
  publicUrl: z.string().url(),
});
export type LibraryUploadCompleteType = z.infer<typeof LibraryUploadCompleteSchema>;

// ── Playlists ───────────────────────────────────────────────────────────────

export const PLAYLIST_NAME_MAX_LENGTH = 80;

export const PlaylistSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  trackCount: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type PlaylistSummaryType = z.infer<typeof PlaylistSummarySchema>;

export const PlaylistSchema = PlaylistSummarySchema.extend({
  tracks: z.array(LibraryTrackSchema),
});
export type PlaylistType = z.infer<typeof PlaylistSchema>;

export const PlaylistNameSchema = z.object({
  name: z.string().trim().min(1).max(PLAYLIST_NAME_MAX_LENGTH),
});
export type PlaylistNameType = z.infer<typeof PlaylistNameSchema>;

/** Replaces the playlist's tracks with this ordered list (add, remove and reorder in one call). */
export const SetPlaylistTracksSchema = z.object({
  trackIds: z.array(z.string()).max(1000),
});
export type SetPlaylistTracksType = z.infer<typeof SetPlaylistTracksSchema>;

// ── Permanent rooms ─────────────────────────────────────────────────────────

export const ROOM_NAME_MAX_LENGTH = 60;

export const SavedRoomSchema = z.object({
  roomId: z.string(),
  name: z.string(),
  trackCount: z.number(),
  createdAt: z.number(),
});
export type SavedRoomType = z.infer<typeof SavedRoomSchema>;

export const CreateRoomSchema = z.object({
  name: z.string().trim().min(1).max(ROOM_NAME_MAX_LENGTH),
});
export type CreateRoomType = z.infer<typeof CreateRoomSchema>;

/** Public info about a room code, so the client can show a permanent room's name. */
export const RoomInfoSchema = z.object({
  roomId: z.string(),
  isPermanent: z.boolean(),
  name: z.string().nullable(),
  ownerUsername: z.string().nullable(),
});
export type RoomInfoType = z.infer<typeof RoomInfoSchema>;

/** Add every track of a playlist to a live room's queue. The caller must be connected to the room. */
export const AddPlaylistToRoomSchema = z.object({
  playlistId: z.string(),
});
export type AddPlaylistToRoomType = z.infer<typeof AddPlaylistToRoomSchema>;

/** Add tracks from the caller's library to a live room's queue. */
export const AddTracksToRoomSchema = z.object({
  trackIds: z.array(z.string()).min(1).max(100),
});
export type AddTracksToRoomType = z.infer<typeof AddTracksToRoomSchema>;

/** Save a live room's queue as a new playlist in the caller's library. */
export const SaveQueueSchema = z.object({
  name: z.string().trim().min(1).max(PLAYLIST_NAME_MAX_LENGTH),
});
export type SaveQueueType = z.infer<typeof SaveQueueSchema>;
