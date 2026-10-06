"use client";
import { queryKeys } from "@/components/account/shared";
import { addTracksToRoom, fetchTracks } from "@/lib/accountApi";
import { useAuthStore } from "@/store/auth";
import { useRoomStore } from "@/store/room";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Music, Plus } from "lucide-react";
import { toast } from "sonner";

const MAX_RESULTS = 5;

/** Every word of the query must appear in the title, in any order. */
const matches = (title: string, query: string) => {
  const haystack = title.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
};

/** Tracks from the logged-in user's own library that match the room search. */
export const LibrarySearchResults = ({ query, onTrackSelect }: { query: string; onTrackSelect?: () => void }) => {
  const user = useAuthStore((state) => state.user);
  const roomId = useRoomStore((state) => state.roomId);
  const tracks = useQuery({ queryKey: queryKeys.tracks, queryFn: fetchTracks, enabled: !!user, staleTime: 30_000 });

  const add = useMutation({
    mutationFn: (trackId: string) => addTracksToRoom(roomId, [trackId]),
    onSuccess: ({ added }) => {
      if (added === 0) toast.info("That track is already in the queue");
      onTrackSelect?.();
    },
    onError: (error) => toast.error(error.message),
  });

  const results = query.trim() ? (tracks.data ?? []).filter((track) => matches(track.title, query)) : [];
  if (results.length === 0) return null;

  return (
    <div className="mb-2">
      <p className="px-3 pt-1 pb-1.5 text-[11px] uppercase tracking-wide text-neutral-500">Your library</p>
      <ul className="space-y-1">
        {results.slice(0, MAX_RESULTS).map((track) => (
          <li key={track.id}>
            <button
              type="button"
              disabled={add.isPending}
              // Keep focus in the search box so the results panel stays open until the click lands
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => add.mutate(track.id)}
              className="group w-full hover:bg-neutral-800 px-3 py-2 transition-colors cursor-pointer flex items-center gap-3 rounded-md text-left disabled:opacity-60"
            >
              <span className="size-10 shrink-0 rounded bg-neutral-800 group-hover:bg-neutral-700 flex items-center justify-center text-neutral-500">
                <Music className="size-4" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-white truncate">{track.title}</span>
                <span className="block text-xs text-neutral-400">Uploaded by you</span>
              </span>
              <Plus className="size-3 text-neutral-400 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
