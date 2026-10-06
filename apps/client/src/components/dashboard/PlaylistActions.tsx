"use client";
import { queryKeys } from "@/components/account/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { addPlaylistToRoom, fetchPlaylists, fetchRoomInfo, saveQueueAsPlaylist } from "@/lib/accountApi";
import { useAuthStore } from "@/store/auth";
import { useCanMutate, useGlobalStore } from "@/store/global";
import { useRoomStore } from "@/store/room";
import { PLAYLIST_NAME_MAX_LENGTH } from "@beatsync/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListMusic, Pin, Save } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

/** Row above the queue: the room's name (if permanent) and playlist actions for logged-in users. */
export const PlaylistActions = () => {
  const queryClient = useQueryClient();
  const roomId = useRoomStore((state) => state.roomId);
  const user = useAuthStore((state) => state.user);
  const queueLength = useGlobalStore((state) => state.audioSources.length);
  const canMutate = useCanMutate();

  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [playlistName, setPlaylistName] = useState("");

  const roomInfo = useQuery({
    queryKey: ["room-info", roomId],
    queryFn: () => fetchRoomInfo(roomId),
    enabled: !!roomId,
    staleTime: 60_000,
  });

  const playlists = useQuery({ queryKey: queryKeys.playlists, queryFn: fetchPlaylists, enabled: !!user });

  const addPlaylist = useMutation({
    mutationFn: (playlistId: string) => addPlaylistToRoom(roomId, playlistId),
    onSuccess: ({ added, skipped }) => {
      if (added === 0) {
        toast.info(skipped > 0 ? "Those tracks are already in the queue" : "That playlist is empty");
      } else {
        toast.success(`Added ${added} ${added === 1 ? "track" : "tracks"} to the queue`);
      }
    },
    onError: (error) => toast.error(error.message),
  });

  const saveQueue = useMutation({
    mutationFn: (name: string) => saveQueueAsPlaylist(roomId, name),
    onSuccess: ({ playlist, failed }) => {
      setIsSaveOpen(false);
      setPlaylistName("");
      void queryClient.invalidateQueries({ queryKey: ["library"] });
      if (failed > 0) {
        toast.warning(
          `Saved "${playlist.name}", but ${failed} ${failed === 1 ? "track" : "tracks"} could not be copied`
        );
      } else {
        toast.success(`Saved "${playlist.name}" to your library`);
      }
    },
    onError: (error) => toast.error(error.message),
  });

  const info = roomInfo.data;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-3 min-h-8">
      <div className="flex items-center gap-1.5 text-xs text-neutral-400 min-w-0">
        {info?.isPermanent && (
          <>
            <Pin className="size-3 shrink-0" />
            <span className="truncate">
              <span className="text-neutral-200">{info.name}</span> · {info.ownerUsername}&apos;s permanent room
            </span>
          </>
        )}
      </div>

      {user ? (
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="secondary"
                className="rounded-full"
                disabled={!canMutate || addPlaylist.isPending}
              >
                <ListMusic />
                Add playlist
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Add to this room&apos;s queue</DropdownMenuLabel>
              {playlists.data?.length ? (
                playlists.data.map((playlist) => (
                  <DropdownMenuItem key={playlist.id} onSelect={() => addPlaylist.mutate(playlist.id)}>
                    <span className="flex-1 truncate">{playlist.name}</span>
                    <span className="text-xs text-neutral-500">{playlist.trackCount}</span>
                  </DropdownMenuItem>
                ))
              ) : (
                <DropdownMenuItem asChild>
                  <Link href="/library">Create a playlist in your library</Link>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            size="sm"
            variant="ghost"
            className="rounded-full"
            disabled={queueLength === 0}
            onClick={() => setIsSaveOpen(true)}
          >
            <Save />
            Save queue
          </Button>
        </div>
      ) : (
        <Link href="/account" className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors">
          Log in to save this queue as a playlist
        </Link>
      )}

      <Dialog open={isSaveOpen} onOpenChange={setIsSaveOpen}>
        <DialogContent className="sm:max-w-sm">
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (playlistName.trim()) saveQueue.mutate(playlistName.trim());
            }}
          >
            <DialogHeader>
              <DialogTitle>Save queue as playlist</DialogTitle>
              <DialogDescription>
                The {queueLength} {queueLength === 1 ? "track" : "tracks"} in this queue will be copied to your library.
              </DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              aria-label="Playlist name"
              placeholder="Playlist name"
              maxLength={PLAYLIST_NAME_MAX_LENGTH}
              value={playlistName}
              onChange={(event) => setPlaylistName(event.target.value)}
            />
            <DialogFooter>
              <Button type="submit" className="rounded-full" disabled={!playlistName.trim() || saveQueue.isPending}>
                {saveQueue.isPending ? "Saving…" : "Save playlist"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
