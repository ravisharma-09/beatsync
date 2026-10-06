"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createPlaylist,
  deletePlaylist,
  fetchPlaylist,
  fetchPlaylists,
  renamePlaylist,
  setPlaylistTracks,
} from "@/lib/accountApi";
import { PLAYLIST_NAME_MAX_LENGTH } from "@beatsync/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, ChevronRight, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorNote, IconButton, Panel, queryKeys, Row } from "./shared";

export const PlaylistsPanel = () => {
  const [openPlaylistId, setOpenPlaylistId] = useState<string | null>(null);
  return openPlaylistId ? (
    <PlaylistDetail playlistId={openPlaylistId} onBack={() => setOpenPlaylistId(null)} />
  ) : (
    <PlaylistList onOpen={setOpenPlaylistId} />
  );
};

const PlaylistList = ({ onOpen }: { onOpen: (playlistId: string) => void }) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const playlists = useQuery({ queryKey: queryKeys.playlists, queryFn: fetchPlaylists });

  const create = useMutation({
    mutationFn: createPlaylist,
    onSuccess: (playlist) => {
      setName("");
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists });
      onOpen(playlist.id);
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) create.mutate(name.trim());
        }}
      >
        <Input
          aria-label="New playlist name"
          placeholder="New playlist name"
          maxLength={PLAYLIST_NAME_MAX_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" className="rounded-full shrink-0" disabled={!name.trim() || create.isPending}>
          <Plus />
          Create
        </Button>
      </form>

      <Panel>
        <ErrorNote error={playlists.error} />
        {playlists.data?.length === 0 && (
          <EmptyState title="No playlists yet" hint="Create one here, or save a room's queue as a playlist." />
        )}
        <ul>
          {playlists.data?.map((playlist) => (
            <Row key={playlist.id} className="p-0">
              <button
                type="button"
                className="flex flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-neutral-800/50 transition-colors cursor-pointer min-w-0"
                onClick={() => onOpen(playlist.id)}
              >
                <span className="flex-1 truncate">{playlist.name}</span>
                <span className="text-xs text-neutral-500 shrink-0">
                  {playlist.trackCount} {playlist.trackCount === 1 ? "track" : "tracks"}
                </span>
                <ChevronRight className="size-4 text-neutral-600 shrink-0" />
              </button>
            </Row>
          ))}
        </ul>
      </Panel>
    </div>
  );
};

const PlaylistDetail = ({ playlistId, onBack }: { playlistId: string; onBack: () => void }) => {
  const queryClient = useQueryClient();
  const playlist = useQuery({ queryKey: queryKeys.playlist(playlistId), queryFn: () => fetchPlaylist(playlistId) });
  const [draftName, setDraftName] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["library"] });

  const rename = useMutation({
    mutationFn: (name: string) => renamePlaylist(playlistId, name),
    onSuccess: () => {
      setDraftName(null);
      void refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const setTracks = useMutation({
    mutationFn: (trackIds: string[]) => setPlaylistTracks(playlistId, trackIds),
    onSuccess: (updated) => queryClient.setQueryData(queryKeys.playlist(playlistId), updated),
    onError: (error) => toast.error(error.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.playlists }),
  });

  const remove = useMutation({
    mutationFn: () => deletePlaylist(playlistId),
    onSuccess: () => {
      void refresh();
      onBack();
    },
    onError: (error) => toast.error(error.message),
  });

  const tracks = playlist.data?.tracks ?? [];
  const trackIds = tracks.map((track) => track.id);

  const move = (index: number, direction: -1 | 1) => {
    const next = [...trackIds];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    setTracks.mutate(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 min-h-9">
        <IconButton label="Back to playlists" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </IconButton>

        {draftName === null ? (
          <>
            <h2 className="flex-1 truncate text-sm font-medium text-white">{playlist.data?.name}</h2>
            <IconButton label="Rename playlist" onClick={() => setDraftName(playlist.data?.name ?? "")}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton
              label="Delete playlist"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(`Delete the playlist "${playlist.data?.name}"? Your tracks stay in your library.`)) {
                  remove.mutate();
                }
              }}
            >
              <Trash2 className="size-4" />
            </IconButton>
          </>
        ) : (
          <form
            className="flex flex-1 gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (draftName.trim()) rename.mutate(draftName.trim());
            }}
          >
            <Input
              autoFocus
              aria-label="Playlist name"
              maxLength={PLAYLIST_NAME_MAX_LENGTH}
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
            />
            <Button type="submit" size="sm" className="rounded-full" disabled={!draftName.trim() || rename.isPending}>
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDraftName(null)}>
              Cancel
            </Button>
          </form>
        )}
      </div>

      <Panel>
        <ErrorNote error={playlist.error} />
        {playlist.data && tracks.length === 0 && (
          <EmptyState title="This playlist is empty" hint="Open the Tracks tab and add music to it." />
        )}
        <ol>
          {tracks.map((track, index) => (
            <Row key={track.id}>
              <span className="w-5 text-xs text-neutral-600 tabular-nums shrink-0">{index + 1}</span>
              <span className="flex-1 truncate">{track.title}</span>
              <IconButton
                label={`Move ${track.title} up`}
                disabled={index === 0 || setTracks.isPending}
                onClick={() => move(index, -1)}
              >
                <ArrowUp className="size-4" />
              </IconButton>
              <IconButton
                label={`Move ${track.title} down`}
                disabled={index === tracks.length - 1 || setTracks.isPending}
                onClick={() => move(index, 1)}
              >
                <ArrowDown className="size-4" />
              </IconButton>
              <IconButton
                label={`Remove ${track.title} from playlist`}
                disabled={setTracks.isPending}
                onClick={() => setTracks.mutate(trackIds.filter((id) => id !== track.id))}
              >
                <X className="size-4" />
              </IconButton>
            </Row>
          ))}
        </ol>
      </Panel>
    </div>
  );
};
