"use client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  deleteTrack,
  fetchPlaylist,
  fetchPlaylists,
  fetchTracks,
  setPlaylistTracks,
  uploadTrackToLibrary,
} from "@/lib/accountApi";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListPlus, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorNote, IconButton, Panel, queryKeys, Row } from "./shared";

export const TracksPanel = () => {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);

  const tracks = useQuery({ queryKey: queryKeys.tracks, queryFn: fetchTracks });
  const playlists = useQuery({ queryKey: queryKeys.playlists, queryFn: fetchPlaylists });

  const uploadFiles = async (files: File[]) => {
    const audioFiles = files.filter((file) => file.type.startsWith("audio/"));
    if (audioFiles.length < files.length) toast.error("Only audio files can be uploaded");
    if (audioFiles.length === 0) return;

    let failed = 0;
    setUploadProgress({ done: 0, total: audioFiles.length });
    for (const [index, file] of audioFiles.entries()) {
      try {
        await uploadTrackToLibrary(file);
      } catch (error) {
        failed++;
        toast.error(`${file.name}: ${error instanceof Error ? error.message : "upload failed"}`);
      }
      setUploadProgress({ done: index + 1, total: audioFiles.length });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tracks });
    }
    setUploadProgress(null);
    if (failed < audioFiles.length) toast.success(`Added ${audioFiles.length - failed} to your library`);
  };

  const remove = useMutation({
    mutationFn: deleteTrack,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["library"] }),
    onError: (error) => toast.error(error.message),
  });

  const addToPlaylist = useMutation({
    mutationFn: async ({ playlistId, trackId }: { playlistId: string; trackId: string }) => {
      const playlist = await fetchPlaylist(playlistId);
      if (playlist.tracks.some((track) => track.id === trackId)) return { playlist, alreadyThere: true };
      const updated = await setPlaylistTracks(playlistId, [...playlist.tracks.map((track) => track.id), trackId]);
      return { playlist: updated, alreadyThere: false };
    },
    onSuccess: ({ playlist, alreadyThere }) => {
      toast.success(alreadyThere ? `Already in ${playlist.name}` : `Added to ${playlist.name}`);
      void queryClient.invalidateQueries({ queryKey: ["library"] });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-neutral-500">Music you upload here stays in your account.</p>
        <input
          ref={fileInput}
          type="file"
          accept="audio/*"
          multiple
          className="hidden"
          onChange={(event) => {
            void uploadFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <Button
          size="sm"
          className="rounded-full shrink-0"
          disabled={uploadProgress !== null}
          onClick={() => fileInput.current?.click()}
        >
          <Upload />
          {uploadProgress ? `Uploading ${uploadProgress.done}/${uploadProgress.total}…` : "Upload music"}
        </Button>
      </div>

      <Panel>
        <ErrorNote error={tracks.error} />
        {tracks.data?.length === 0 && (
          <EmptyState title="No music yet" hint="Upload audio files to play them in any room." />
        )}
        <ul>
          {tracks.data?.map((track) => (
            <Row key={track.id}>
              <span className="flex-1 truncate">{track.title}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label={`Add ${track.title} to a playlist`}>
                    <ListPlus className="size-4" />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Add to playlist</DropdownMenuLabel>
                  {playlists.data?.length ? (
                    playlists.data.map((playlist) => (
                      <DropdownMenuItem
                        key={playlist.id}
                        onSelect={() => addToPlaylist.mutate({ playlistId: playlist.id, trackId: track.id })}
                      >
                        {playlist.name}
                      </DropdownMenuItem>
                    ))
                  ) : (
                    <DropdownMenuItem disabled>Create a playlist first</DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <IconButton
                label={`Delete ${track.title}`}
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Delete "${track.title}" from your library? This cannot be undone.`)) {
                    remove.mutate(track.id);
                  }
                }}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </Row>
          ))}
        </ul>
      </Panel>
    </div>
  );
};
