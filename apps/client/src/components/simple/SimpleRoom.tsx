"use client";
import { AudioUploaderMinimal } from "@/components/AudioUploaderMinimal";
import { ConnectedUsersList } from "@/components/dashboard/ConnectedUsersList";
import { GlobalVolumeControl } from "@/components/dashboard/GlobalVolumeControl";
import { PlaybackPermissions } from "@/components/dashboard/PlaybackPermissions";
import { PlaylistActions } from "@/components/dashboard/PlaylistActions";
import { Chat } from "@/components/dashboard/right/Chat";
import { Queue } from "@/components/Queue";
import { Player } from "@/components/room/Player";
import { addPlaylistToRoom } from "@/lib/accountApi";
import { fetchFeatures } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/auth";
import { useCanMutate, useGlobalStore } from "@/store/global";
import { useRoomStore } from "@/store/room";
import { useQuery } from "@tanstack/react-query";
import { ListMusic, MessageCircle, PlusCircle, Users } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AddMusicSearch } from "./AddMusicSearch";
import {
  AccountButton,
  CoverPlaceholder,
  InviteButton,
  LeaveRoomButton,
  LogoMark,
  NowPlayingTitle,
  RoomActions,
  RoomFacts,
  useRoomName,
  YouTubeHost,
} from "./RoomParts";

/** Phones and narrow windows get the tabbed layout. */
function useIsNarrow(): boolean {
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return isNarrow;
}

/**
 * "Play this playlist" on the home page opens a new room with ?playlist=…;
 * once connected, the playlist is added to the queue.
 */
function useStartWithPlaylist() {
  const roomId = useRoomStore((state) => state.roomId);
  const user = useAuthStore((state) => state.user);
  const canMutate = useCanMutate();
  const isConnected = useGlobalStore((state) => state.currentUser !== null);
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current || !roomId || !user || !canMutate || !isConnected) return;
    const params = new URLSearchParams(window.location.search);
    const playlistId = params.get("playlist");
    if (!playlistId) return;
    hasRun.current = true;

    params.delete("playlist");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);

    addPlaylistToRoom(roomId, playlistId)
      .then(({ added }) => toast.success(`Added ${added} ${added === 1 ? "track" : "tracks"} from your playlist`))
      .catch((error: Error) => toast.error(error.message));
  }, [roomId, user, canMutate, isConnected]);
}

const UpNext = () => {
  const features = useQuery({ queryKey: ["features"], queryFn: fetchFeatures, staleTime: 5 * 60_000 });
  return (
    <div className="flex flex-col gap-3">
      <PlaylistActions />
      <Queue />
      {features.data?.uploads && <AudioUploaderMinimal />}
    </div>
  );
};

const People = () => (
  <div className="flex flex-col gap-2">
    <PlaybackPermissions />
    <ConnectedUsersList />
  </div>
);

type PanelTab = "queue" | "people" | "chat";

const PanelTabs = ({ tab, onChange }: { tab: PanelTab; onChange: (tab: PanelTab) => void }) => {
  const people = useGlobalStore((state) => state.connectedClients.length);
  const tabs: { id: PanelTab; label: string }[] = [
    { id: "queue", label: "Up next" },
    { id: "people", label: `People (${people})` },
    { id: "chat", label: "Chat" },
  ];
  return (
    <div role="tablist" aria-label="Side panel" className="flex gap-1.5">
      {tabs.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          onClick={() => onChange(id)}
          className={cn(
            "h-10 cursor-pointer rounded-full px-4 text-sm transition-colors",
            tab === id
              ? "bg-white font-semibold text-neutral-950"
              : "bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
};

const PlayerBar = ({ showVolume }: { showVolume: boolean }) => (
  <footer className="relative z-10 shrink-0 border-t border-neutral-800 bg-neutral-950 px-4 py-3">
    <div className="mx-auto flex max-w-7xl items-center gap-6">
      <div className="mx-auto max-w-3xl flex-1">
        <Player />
      </div>
      {showVolume && <GlobalVolumeControl />}
    </div>
  </footer>
);

// ── Computer ────────────────────────────────────────────────────────────────

const DesktopRoom = () => {
  const roomName = useRoomName();
  const [tab, setTab] = useState<PanelTab>("queue");

  return (
    <>
      <header className="flex shrink-0 items-center gap-4 border-b border-neutral-800 px-5 py-3">
        <LogoMark />
        <AddMusicSearch variant="dropdown" className="mx-auto max-w-2xl flex-1" />
        <div className="flex items-center gap-2.5">
          <InviteButton />
          <AccountButton inRoom />
          <LeaveRoomButton variant="pill" />
        </div>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-900 px-5 py-2.5 text-[13px]">
        <span className="text-sm font-medium text-white">{roomName}</span>
        <RoomFacts />
      </div>

      <main className="flex min-h-0 flex-1 gap-6 px-5 py-5">
        <section aria-label="Now playing" className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto">
          <YouTubeHost className="max-h-[52dvh] shrink-0" />
          <CoverPlaceholder className="aspect-video max-h-[46dvh] shrink-0" />
          <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3">
            <NowPlayingTitle className="flex-1 basis-64" />
            <RoomActions isPhone={false} />
          </div>
        </section>

        <aside aria-label="Queue, people and chat" className="flex w-[380px] shrink-0 flex-col gap-3">
          <PanelTabs tab={tab} onChange={setTab} />
          <div className={cn("min-h-0 flex-1", tab === "chat" ? "overflow-hidden" : "overflow-y-auto pr-1")}>
            {tab === "queue" && <UpNext />}
            {tab === "people" && <People />}
            {tab === "chat" && <Chat />}
          </div>
        </aside>
      </main>

      <PlayerBar showVolume />
    </>
  );
};

// ── Phone ───────────────────────────────────────────────────────────────────

type PhoneTab = "playing" | "add" | "people" | "chat";

const PhoneRoom = () => {
  const roomName = useRoomName();
  const [tab, setTab] = useState<PhoneTab>("playing");
  const features = useQuery({ queryKey: ["features"], queryFn: fetchFeatures, staleTime: 5 * 60_000 });

  const tabs: { id: PhoneTab; label: string; icon: ReactNode }[] = [
    { id: "playing", label: "Playing", icon: <ListMusic className="size-[22px]" aria-hidden /> },
    { id: "add", label: "Add music", icon: <PlusCircle className="size-[22px]" aria-hidden /> },
    { id: "people", label: "People", icon: <Users className="size-[22px]" aria-hidden /> },
    { id: "chat", label: "Chat", icon: <MessageCircle className="size-[22px]" aria-hidden /> },
  ];

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-neutral-800 px-3 py-2">
        <LeaveRoomButton variant="icon" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-white">{roomName}</div>
          <RoomFacts className="text-xs" />
        </div>
        <InviteButton />
      </header>

      {/* The video stays on screen on every tab while it plays: YouTube requires a visible player */}
      <div className="shrink-0 px-3 pt-3 empty:hidden">
        <YouTubeHost className="max-h-[32dvh]" />
      </div>

      <main className={cn("min-h-0 flex-1 px-3 py-3", tab === "chat" ? "overflow-hidden" : "overflow-y-auto")}>
        {tab === "playing" && (
          <div className="flex flex-col gap-4">
            <CoverPlaceholder className="h-40" />
            <NowPlayingTitle />
            <RoomActions isPhone />
            <section aria-label="Up next" className="flex flex-col gap-2">
              <h2 className="text-[15px] font-semibold text-white">Up next</h2>
              <UpNext />
            </section>
          </div>
        )}
        {tab === "add" && (
          <div className="flex flex-col gap-3">
            <AddMusicSearch variant="inline" />
            {features.data?.uploads && <AudioUploaderMinimal />}
            <PlaylistActions />
          </div>
        )}
        {tab === "people" && <People />}
        {tab === "chat" && <Chat />}
      </main>

      <PlayerBar showVolume={false} />

      <nav
        aria-label="Room"
        className="grid shrink-0 grid-cols-4 border-t border-neutral-800 bg-neutral-950 px-2 pt-1 pb-safe-plus-4"
      >
        {tabs.map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
            className={cn(
              "flex min-h-12 cursor-pointer flex-col items-center justify-center gap-0.5 text-xs",
              tab === id ? "font-semibold text-white" : "text-neutral-400"
            )}
          >
            {icon}
            {label}
          </button>
        ))}
      </nav>
    </>
  );
};

export const SimpleRoom = () => {
  const isNarrow = useIsNarrow();
  useStartWithPlaylist();
  // Only one layout is mounted at a time, so there is exactly one video player and one search box
  return isNarrow ? <PhoneRoom /> : <DesktopRoom />;
};
