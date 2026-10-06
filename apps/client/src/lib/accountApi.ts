import { useAuthStore } from "@/store/auth";
import type {
  AuthResponseType,
  LibraryTrackType,
  LoginType,
  PlaylistSummaryType,
  PlaylistType,
  RegisterType,
  RoomInfoType,
  SavedRoomType,
  UploadUrlResponseType,
} from "@beatsync/shared";
import axios from "axios";
import { getApiUrl } from "./urls";

const client = axios.create({
  get baseURL() {
    return getApiUrl();
  },
});

client.interceptors.request.use((config) => {
  const { token } = useAuthStore.getState();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error)) {
      // The server sends plain-text error messages
      const message = typeof error.response?.data === "string" && error.response.data ? error.response.data : null;
      const hadToken = !!error.config?.headers?.Authorization;
      if (error.response?.status === 401 && hadToken) {
        // Saved login is no longer valid
        useAuthStore.getState().clearSession();
      }
      return Promise.reject(new Error(message ?? "Could not reach the server"));
    }
    return Promise.reject(error);
  }
);

// ── Auth ────────────────────────────────────────────────────────────────────

export const register = async (input: RegisterType) =>
  (await client.post<AuthResponseType>("/auth/register", input)).data;

export const login = async (input: LoginType) => (await client.post<AuthResponseType>("/auth/login", input)).data;

export const logout = async () => {
  try {
    await client.post("/auth/logout");
  } finally {
    useAuthStore.getState().clearSession();
  }
};

// ── Library ─────────────────────────────────────────────────────────────────

export const fetchTracks = async () => (await client.get<LibraryTrackType[]>("/library/tracks")).data;

export const deleteTrack = async (trackId: string) => {
  await client.delete(`/library/tracks/${trackId}`);
};

export const uploadTrackToLibrary = async (file: File) => {
  const { data } = await client.post<UploadUrlResponseType>("/library/upload-url", {
    fileName: file.name,
    contentType: file.type,
  });

  // Upload straight to storage, same as room uploads
  const upload = await fetch(data.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
  if (!upload.ok) throw new Error(`Upload failed: ${upload.statusText}`);

  return (
    await client.post<LibraryTrackType>("/library/upload-complete", {
      fileName: file.name,
      publicUrl: data.publicUrl,
    })
  ).data;
};

// ── Playlists ───────────────────────────────────────────────────────────────

export const fetchPlaylists = async () => (await client.get<PlaylistSummaryType[]>("/playlists")).data;

export const fetchPlaylist = async (playlistId: string) =>
  (await client.get<PlaylistType>(`/playlists/${playlistId}`)).data;

export const createPlaylist = async (name: string) => (await client.post<PlaylistType>("/playlists", { name })).data;

export const renamePlaylist = async (playlistId: string, name: string) =>
  (await client.patch<PlaylistType>(`/playlists/${playlistId}`, { name })).data;

export const deletePlaylist = async (playlistId: string) => {
  await client.delete(`/playlists/${playlistId}`);
};

export const setPlaylistTracks = async (playlistId: string, trackIds: string[]) =>
  (await client.put<PlaylistType>(`/playlists/${playlistId}/tracks`, { trackIds })).data;

// ── Rooms ───────────────────────────────────────────────────────────────────

export const fetchMyRooms = async () => (await client.get<SavedRoomType[]>("/rooms")).data;

export const createPermanentRoom = async (name: string) => (await client.post<SavedRoomType>("/rooms", { name })).data;

export const deletePermanentRoom = async (roomId: string) => {
  await client.delete(`/rooms/${roomId}`);
};

export const fetchRoomInfo = async (roomId: string) => (await client.get<RoomInfoType>(`/rooms/${roomId}/info`)).data;

export const addPlaylistToRoom = async (roomId: string, playlistId: string) =>
  (await client.post<{ added: number; skipped: number }>(`/rooms/${roomId}/add-playlist`, { playlistId })).data;

export const addTracksToRoom = async (roomId: string, trackIds: string[]) =>
  (await client.post<{ added: number; skipped: number }>(`/rooms/${roomId}/add-tracks`, { trackIds })).data;

export const saveQueueAsPlaylist = async (roomId: string, name: string) =>
  (await client.post<{ playlist: PlaylistType; failed: number }>(`/rooms/${roomId}/save-queue`, { name })).data;
