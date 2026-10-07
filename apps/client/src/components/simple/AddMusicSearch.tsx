"use client";
import { queryKeys } from "@/components/account/shared";
import { addTracksToRoom, fetchTracks } from "@/lib/accountApi";
import { fetchFeatures } from "@/lib/api";
import { searchSongs } from "@/lib/songSearch";
import { watchAdd } from "@/lib/addWatch";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/auth";
import { useCanMutate, useGlobalStore } from "@/store/global";
import { useRoomStore } from "@/store/room";
import { sendWSRequest } from "@/utils/ws";
import { ClientActionEnum, parseYouTubeVideoId } from "@beatsync/shared";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, MonitorPlay, Music, Plus, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

const SEARCH_DELAY_MS = 350;
const MIN_QUERY_LENGTH = 2;

/** The typed text, but only after the user has paused typing. */
function useSettledValue(value: string, delayMs: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

const formatLength = (seconds: number) =>
  seconds > 0 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "";

interface ResultRowProps {
  title: string;
  subtitle: ReactNode;
  source: string;
  artworkUrl?: string;
  length?: string;
  isAdded: boolean;
  onAdd: () => void;
}

const ResultRow = ({ title, subtitle, source, artworkUrl, length, isAdded, onAdd }: ResultRowProps) => (
  <li className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-neutral-800/70">
    <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-neutral-800 text-neutral-500">
      {artworkUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- small external cover art; next/image would need every host allow-listed
        <img src={artworkUrl} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        <Music className="size-4" />
      )}
    </div>
    <div className="min-w-0 flex-1">
      <div className="truncate text-sm text-white">{title}</div>
      <div className="flex items-center gap-1.5 text-xs text-neutral-400">
        <span className="truncate">{subtitle}</span>
        <span className="shrink-0 rounded-full bg-neutral-800 px-2 py-px text-[11px] text-neutral-300">{source}</span>
      </div>
    </div>
    {length && <span className="shrink-0 text-xs text-neutral-400">{length}</span>}
    <button
      type="button"
      aria-label={isAdded ? `${title} added` : `Add ${title} to the queue`}
      disabled={isAdded}
      onClick={onAdd}
      className={cn(
        "flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors",
        isAdded ? "bg-green-500/15 text-green-400" : "bg-neutral-800 text-white hover:bg-neutral-700"
      )}
    >
      {isAdded ? <Check className="size-4" /> : <Plus className="size-4" />}
    </button>
  </li>
);

const SectionTitle = ({ children }: { children: ReactNode }) => (
  <h3 className="px-2 pt-3 pb-1 text-xs font-medium text-neutral-400">{children}</h3>
);

interface AddMusicSearchProps {
  /** "dropdown": results float under the box (computer header). "inline": results fill the page (phone). */
  variant: "dropdown" | "inline";
  className?: string;
}

/**
 * The one search box: songs by name, Audius, your own uploads, or a pasted YouTube link.
 * Results stay open after adding, so several songs can be added in a row.
 */
export const AddMusicSearch = ({ variant, className }: AddMusicSearchProps) => {
  const canMutate = useCanMutate();
  const socket = useGlobalStore((state) => state.socket);
  const roomId = useRoomStore((state) => state.roomId);
  const user = useAuthStore((state) => state.user);

  const [text, setText] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  const query = useSettledValue(text.trim(), SEARCH_DELAY_MS);
  const isLink = parseYouTubeVideoId(text) !== null;
  const canSearch = query.length >= MIN_QUERY_LENGTH && !isLink && query === text.trim();

  const features = useQuery({ queryKey: ["features"], queryFn: fetchFeatures, staleTime: 5 * 60_000 });
  const songSearchEnabled = features.data?.songSearch ?? false;

  // Songs by name (plays on YouTube)
  const songs = useQuery({
    queryKey: ["song-search", query],
    queryFn: ({ signal }) => searchSongs(query, signal),
    enabled: canSearch && songSearchEnabled,
    staleTime: 10 * 60_000,
    retry: false,
  });

  // Your own uploads
  const library = useQuery({ queryKey: queryKeys.tracks, queryFn: fetchTracks, enabled: !!user, staleTime: 30_000 });
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const libraryMatches = canSearch
    ? (library.data ?? [])
        .filter((track) => words.every((word) => track.title.toLowerCase().includes(word)))
        .slice(0, 4)
    : [];

  // Audius, through the room connection
  const audiusResults = useGlobalStore((state) => state.searchResults);
  const isSearchingAudius = useGlobalStore((state) => state.isSearching);
  const audiusQuery = useGlobalStore((state) => state.searchQuery);
  useEffect(() => {
    if (!canSearch || !socket || !canMutate) return;
    const store = useGlobalStore.getState();
    if (store.searchQuery === query && store.searchResults) return;
    store.setSearchOffset(0);
    store.setHasMoreResults(false);
    store.setIsSearching(true);
    store.setSearchQuery(query);
    sendWSRequest({ ws: socket, request: { type: ClientActionEnum.enum.SEARCH_MUSIC, query } });
  }, [canSearch, query, socket, canMutate]);
  const audiusTracks =
    canSearch && audiusQuery === query && audiusResults?.type === "success"
      ? audiusResults.response.data.tracks.items.slice(0, 8)
      : [];

  // Close the dropdown when clicking elsewhere or pressing Escape
  useEffect(() => {
    if (variant !== "dropdown" || !isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [variant, isOpen]);

  const markAdded = (key: string) => setAdded((current) => new Set(current).add(key));
  const unmarkAdded = (key: string) =>
    setAdded((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });

  /** Sends an add request, shows the tick, and takes it back if the server never answers. */
  const sendAdd = (key: string, request: Parameters<typeof sendWSRequest>[0]["request"]) => {
    if (!send(request)) return;
    markAdded(key);
    watchAdd(
      () => useGlobalStore.getState().audioSources.length,
      () => {
        unmarkAdded(key);
        toast.error("That was not added: the room did not answer. Try again.");
      }
    );
  };

  const send = (request: Parameters<typeof sendWSRequest>[0]["request"]): boolean => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      toast.error("Reconnecting to the room. Try again in a moment.");
      return false;
    }
    sendWSRequest({ ws: socket, request });
    return true;
  };

  const addLink = () => {
    if (send({ type: ClientActionEnum.enum.ADD_YOUTUBE_VIDEO, url: text.trim() })) {
      toast.success("Video added to the queue");
      setText("");
    }
  };

  const showResults = variant === "inline" || isOpen;
  const hasText = text.trim().length >= MIN_QUERY_LENGTH;
  const isLoading = canSearch && ((songSearchEnabled && songs.isFetching) || isSearchingAudius);
  const isWaitingForPause = hasText && !isLink && !canSearch;
  const nothingFound =
    canSearch &&
    !isLoading &&
    libraryMatches.length === 0 &&
    audiusTracks.length === 0 &&
    (songs.data?.length ?? 0) === 0;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          if (isLink) addLink();
        }}
      >
        <label htmlFor={`add-music-${variant}`} className="sr-only">
          Search songs, or paste a YouTube link
        </label>
        <Search className="pointer-events-none absolute top-3.5 left-4 size-[18px] text-neutral-400" aria-hidden />
        <input
          id={`add-music-${variant}`}
          type="text"
          inputMode="search"
          autoComplete="off"
          disabled={!canMutate}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setIsOpen(false);
          }}
          placeholder={canMutate ? "Search songs, or paste a YouTube link" : "Only room admins can add music"}
          className="h-12 w-full rounded-full border border-neutral-700 bg-neutral-900 pr-11 pl-11 text-[15px] text-white placeholder:text-neutral-500 focus:border-neutral-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />
        {text && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setText("")}
            className="absolute top-1 right-1 flex size-10 cursor-pointer items-center justify-center rounded-full text-neutral-400 hover:text-white"
          >
            <X className="size-4" />
          </button>
        )}
      </form>

      {showResults && (hasText || isLink) && (
        <div
          className={cn(
            variant === "dropdown" &&
              "absolute top-full right-0 left-0 z-40 mt-2 max-h-[70dvh] overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-900 p-2 shadow-2xl",
            variant === "inline" && "mt-2"
          )}
        >
          {isLink && (
            <button
              type="button"
              onClick={addLink}
              className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-neutral-800/70"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-neutral-800 text-neutral-300">
                <MonitorPlay className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-white">Add this YouTube video</span>
                <span className="block text-xs text-neutral-400">
                  Everyone watches it together. Press Enter or tap.
                </span>
              </span>
              <Plus className="size-4 text-neutral-300" />
            </button>
          )}

          {(isLoading || isWaitingForPause) && (
            <p className="flex items-center gap-2 px-2 py-3 text-sm text-neutral-400" role="status">
              <Loader2 className="size-4 animate-spin" /> Searching…
            </p>
          )}

          {libraryMatches.length > 0 && (
            <section aria-label="Your music">
              <SectionTitle>Your music</SectionTitle>
              <ul>
                {libraryMatches.map((track) => (
                  <ResultRow
                    key={track.id}
                    title={track.title}
                    subtitle="Uploaded by you"
                    source="My music"
                    isAdded={added.has(`library:${track.id}`)}
                    onAdd={() => {
                      addTracksToRoom(roomId, [track.id])
                        .then(() => markAdded(`library:${track.id}`))
                        .catch((error: Error) => toast.error(error.message));
                    }}
                  />
                ))}
              </ul>
            </section>
          )}

          {(songs.data?.length ?? 0) > 0 && canSearch && (
            <section aria-label="Songs">
              <SectionTitle>Songs</SectionTitle>
              <ul>
                {songs.data!.map((song) => (
                  <ResultRow
                    key={song.id}
                    title={song.title}
                    subtitle={
                      <>
                        {song.artist}
                        {song.appleMusicUrl && (
                          <>
                            {" · "}
                            <a
                              href={song.appleMusicUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline underline-offset-2 hover:text-white"
                            >
                              Apple Music
                            </a>
                          </>
                        )}
                      </>
                    }
                    source="YouTube"
                    artworkUrl={song.artworkUrl}
                    length={formatLength(song.durationSeconds)}
                    isAdded={added.has(`song:${song.id}`)}
                    onAdd={() => {
                      sendAdd(`song:${song.id}`, {
                        type: ClientActionEnum.enum.ADD_SONG,
                        title: song.title,
                        artist: song.artist,
                      });
                    }}
                  />
                ))}
              </ul>
            </section>
          )}

          {audiusTracks.length > 0 && (
            <section aria-label="From Audius">
              <SectionTitle>
                Independent artists, from{" "}
                <a
                  href="https://audius.co"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-white"
                >
                  Audius
                </a>
              </SectionTitle>
              <ul>
                {audiusTracks.map((track) => (
                  <ResultRow
                    key={track.id}
                    title={track.title}
                    subtitle={track.performer.name}
                    source="Audius"
                    artworkUrl={track.album.image.thumbnail || track.album.image.small}
                    length={formatLength(track.duration)}
                    isAdded={added.has(`audius:${track.id}`)}
                    onAdd={() => {
                      const trackName = `${track.performer.name} - ${track.title}`.trim();
                      sendAdd(`audius:${track.id}`, {
                        type: ClientActionEnum.enum.STREAM_MUSIC,
                        trackId: track.id,
                        trackName,
                      });
                    }}
                  />
                ))}
              </ul>
            </section>
          )}

          {songs.error && canSearch && <p className="px-2 py-2 text-xs text-neutral-400">{songs.error.message}</p>}

          {nothingFound && (
            <p className="px-2 py-4 text-sm text-neutral-400">
              Nothing found for &ldquo;{query}&rdquo;. Try other words, or paste a YouTube link.
            </p>
          )}

          {canSearch && !songSearchEnabled && features.isSuccess && (
            <p className="px-2 pt-3 pb-1 text-xs text-neutral-500">
              Chart songs by name are off on this server (no search key set up). Paste a YouTube link to play anything.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
