"use client";
import { queryKeys } from "@/components/account/shared";
import { GlobalVolumeControl } from "@/components/dashboard/GlobalVolumeControl";
import { MobileNudgeControl } from "@/components/dashboard/MobileNudgeControl";
import { NudgeControl } from "@/components/dashboard/NudgeControl";
import { SpatialAudio } from "@/components/dashboard/right/SpatialAudio";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fetchPlaylists, fetchRoomInfo, saveRoomTrack } from "@/lib/accountApi";
import { audioContextManager } from "@/lib/audioContextManager";
import { cn, extractFileNameFromUrl } from "@/lib/utils";
import { youtubePlayer } from "@/lib/youtubePlayer";
import { useAuthStore } from "@/store/auth";
import { MAX_NTP_MEASUREMENTS, useGlobalStore } from "@/store/global";
import { useRoomStore } from "@/store/room";
import { isYouTubeQueueUrl } from "@beatsync/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AudioLines,
  Check,
  ChevronLeft,
  Copy,
  ListPlus,
  LogOut,
  MoreHorizontal,
  Music,
  SlidersHorizontal,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCodeLib from "qrcode";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

export const APP_NAME = "Syncpo";

/** "429439" → "429 439": easier to read aloud and type. */
export const formatRoomCode = (roomId: string) => roomId.replace(/^(\d{3})(\d{3})$/, "$1 $2");

export const Logo = ({ className }: { className?: string }) => (
  <Link
    href="/"
    className={cn("flex min-h-11 items-center gap-2 text-[17px] font-semibold text-white", className)}
    aria-label={`${APP_NAME} home`}
  >
    <AudioLines className="size-[22px] text-green-500" aria-hidden />
    {APP_NAME}
  </Link>
);

/** The logo without a link, for inside a room, where a stray click must not end the music. */
export const LogoMark = ({ className }: { className?: string }) => (
  <div className={cn("flex min-h-11 items-center gap-2 text-[17px] font-semibold text-white", className)}>
    <AudioLines className="size-[22px] text-green-500" aria-hidden />
    {APP_NAME}
  </div>
);

const pillButton =
  "flex h-11 cursor-pointer items-center gap-2 rounded-full bg-neutral-800 px-4 text-sm text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50";

// ── Invite ──────────────────────────────────────────────────────────────────

export const InviteButton = ({ className }: { className?: string }) => {
  const roomId = useRoomStore((state) => state.roomId);
  const [isOpen, setIsOpen] = useState(false);
  const [qrCode, setQrCode] = useState("");
  const [copied, setCopied] = useState(false);

  const roomUrl = typeof window === "undefined" ? "" : `${window.location.origin}/room/${roomId}`;

  useEffect(() => {
    if (!isOpen || !roomUrl) return;
    QRCodeLib.toDataURL(roomUrl, { margin: 1, scale: 10, errorCorrectionLevel: "M" })
      .then(setQrCode)
      .catch(() => setQrCode(""));
  }, [isOpen, roomUrl]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(roomUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy. Select the link and copy it by hand.");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={cn(
          "flex h-11 cursor-pointer items-center gap-2 rounded-full bg-green-500 px-4 text-sm font-semibold text-green-950 transition-colors hover:bg-green-400",
          className
        )}
      >
        <UserPlus className="size-[18px]" aria-hidden />
        Invite
      </button>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Invite people</DialogTitle>
            <DialogDescription>
              They type this code on the home page, open the link, or scan the picture.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4">
            <div className="text-4xl font-semibold tracking-widest text-white tabular-nums">
              {formatRoomCode(roomId)}
            </div>
            {qrCode && (
              // eslint-disable-next-line @next/next/no-img-element -- generated in the browser as a data URL
              <img src={qrCode} alt="QR code that opens this room" className="size-44 rounded-lg" />
            )}
            <div className="flex w-full items-center gap-2">
              <input
                readOnly
                aria-label="Room link"
                value={roomUrl}
                onFocus={(event) => event.target.select()}
                className="h-11 min-w-0 flex-1 rounded-full border border-neutral-700 bg-neutral-900 px-4 text-sm text-neutral-200"
              />
              <button type="button" onClick={() => void copyLink()} className={pillButton}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

/** `inRoom`: open in a new tab, so the room keeps playing in this one. */
export const AccountButton = ({ inRoom = false }: { inRoom?: boolean }) => {
  const user = useAuthStore((state) => state.user);
  return (
    <Link
      href={user ? "/library" : "/account"}
      target={inRoom ? "_blank" : undefined}
      aria-label={user ? `${user.username}: my music` : "Log in or sign up"}
      title={user ? "My music" : "Log in or sign up"}
      className="flex size-11 shrink-0 items-center justify-center rounded-full border border-neutral-700 bg-neutral-800 text-sm font-semibold text-white hover:bg-neutral-700"
    >
      {user ? user.username.slice(0, 1).toUpperCase() : "?"}
    </Link>
  );
};

// ── Leaving the room ────────────────────────────────────────────────────────

/**
 * The only way out of a room: a button that asks first. While it is on screen, the
 * browser's Back (button or swipe) asks the same question instead of leaving, and closing
 * or reloading the tab asks while music is playing.
 */
export const LeaveRoomButton = ({ variant }: { variant: "icon" | "pill" }) => {
  const router = useRouter();
  const [isAsking, setIsAsking] = useState(false);
  const isLeaving = useRef(false);

  useEffect(() => {
    // An extra history entry for this page: Back lands on it instead of leaving
    window.history.pushState(window.history.state, "", window.location.href);
    const onBack = () => {
      if (isLeaving.current) return;
      window.history.pushState(window.history.state, "", window.location.href);
      setIsAsking(true);
    };
    const onUnload = (event: BeforeUnloadEvent) => {
      if (!isLeaving.current && useGlobalStore.getState().isPlaying) event.preventDefault();
    };
    window.addEventListener("popstate", onBack);
    window.addEventListener("beforeunload", onUnload);
    // No pull-down-to-reload on phones while in a room
    const root = document.documentElement;
    const previousOverscroll = root.style.overscrollBehaviorY;
    root.style.overscrollBehaviorY = "contain";
    return () => {
      root.style.overscrollBehaviorY = previousOverscroll;
      window.removeEventListener("popstate", onBack);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);

  const leave = () => {
    isLeaving.current = true;
    router.replace("/");
  };

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          onClick={() => setIsAsking(true)}
          aria-label="Leave room"
          className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-white hover:bg-neutral-800"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
      ) : (
        <button type="button" onClick={() => setIsAsking(true)} className={pillButton}>
          <LogOut className="size-[18px]" aria-hidden />
          Leave
        </button>
      )}
      <Dialog open={isAsking} onOpenChange={setIsAsking}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Leave this room?</DialogTitle>
            <DialogDescription>
              The music stops on this device. You can come back with the same room code.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <button type="button" onClick={() => setIsAsking(false)} className={cn(pillButton, "justify-center")}>
              Stay
            </button>
            <button
              type="button"
              onClick={leave}
              className={cn(pillButton, "justify-center bg-white text-black hover:bg-neutral-200")}
            >
              Leave room
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

// ── Room name line ──────────────────────────────────────────────────────────

export const useRoomName = (): string => {
  const roomId = useRoomStore((state) => state.roomId);
  const info = useQuery({
    queryKey: ["room-info", roomId],
    queryFn: () => fetchRoomInfo(roomId),
    enabled: !!roomId,
    staleTime: 60_000,
  });
  return info.data?.name ?? "Room";
};

export const RoomFacts = ({ className }: { className?: string }) => {
  const roomId = useRoomStore((state) => state.roomId);
  const listeners = useGlobalStore((state) => state.connectedClients.length);
  const isSynced = useGlobalStore((state) => state.isSynced);
  return (
    <span className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-neutral-400", className)}>
      <span>Code {formatRoomCode(roomId)}</span>
      <span className="flex items-center gap-1.5">
        <span className={cn("size-2 rounded-full", isSynced ? "bg-green-500" : "bg-amber-500")} aria-hidden />
        {listeners} {listeners === 1 ? "person" : "people"} listening{isSynced ? ", in sync" : ", syncing…"}
      </span>
    </span>
  );
};

// ── What is playing ─────────────────────────────────────────────────────────

const sourceLabel = (url: string): string => {
  if (isYouTubeQueueUrl(url)) return "YouTube";
  if (url.startsWith("/audius/")) return "Audius";
  return "Upload";
};

/**
 * The visible YouTube player. Rendered once per screen and kept mounted while a video is
 * the current item: YouTube does not allow hidden or audio-only players.
 */
export const YouTubeHost = ({ className }: { className?: string }) => {
  const isYouTubeSelected = useGlobalStore((state) => isYouTubeQueueUrl(state.selectedAudioUrl));
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!isYouTubeSelected || !host) return;
    void youtubePlayer.attach(host);
    return () => youtubePlayer.detach(host);
  }, [isYouTubeSelected]);

  if (!isYouTubeSelected) return null;
  return (
    <div className={cn("aspect-video min-h-[200px] w-full overflow-hidden rounded-xl bg-black", className)}>
      <div ref={hostRef} className="size-full" />
    </div>
  );
};

/** Shown in place of the video for audio tracks, or when nothing is playing. */
export const CoverPlaceholder = ({ className }: { className?: string }) => {
  const isYouTubeSelected = useGlobalStore((state) => isYouTubeQueueUrl(state.selectedAudioUrl));
  const hasTrack = useGlobalStore((state) => !!state.selectedAudioUrl);
  if (isYouTubeSelected) return null;
  return (
    <div
      className={cn(
        "flex w-full flex-col items-center justify-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 text-neutral-400",
        className
      )}
    >
      <Music className="size-10 text-neutral-600" aria-hidden />
      <span className="px-6 text-center text-sm">
        {hasTrack ? "Playing on every device in the room" : "Nothing playing yet. Search for a song to start."}
      </span>
    </div>
  );
};

export const NowPlayingTitle = ({ className }: { className?: string }) => {
  const url = useGlobalStore((state) => state.selectedAudioUrl);
  if (!url) return null;
  return (
    <div className={cn("min-w-0", className)}>
      <h1 className="truncate text-xl font-semibold text-white">{extractFileNameFromUrl(url)}</h1>
      <div className="mt-1">
        <span className="rounded-full bg-neutral-800 px-2.5 py-0.5 text-xs text-neutral-300">{sourceLabel(url)}</span>
      </div>
    </div>
  );
};

// ── Actions under the title ─────────────────────────────────────────────────

const SaveToPlaylistButton = () => {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const roomId = useRoomStore((state) => state.roomId);
  const url = useGlobalStore((state) => state.selectedAudioUrl);
  const playlists = useQuery({ queryKey: queryKeys.playlists, queryFn: fetchPlaylists, enabled: !!user });

  const save = useMutation({
    mutationFn: (playlistId?: string) => saveRoomTrack(roomId, url, playlistId),
    onSuccess: ({ playlistName }) => {
      toast.success(playlistName ? `Saved to ${playlistName}` : "Saved to My music");
      void queryClient.invalidateQueries({ queryKey: ["library"] });
    },
    onError: (error) => toast.error(error.message),
  });

  if (!user) {
    return (
      <Link href="/account" target="_blank" className={pillButton}>
        <ListPlus className="size-[18px]" aria-hidden />
        Log in to save
      </Link>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={pillButton} disabled={!url || save.isPending}>
          <ListPlus className="size-[18px]" aria-hidden />
          Save to playlist
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Save this track to</DropdownMenuLabel>
        {playlists.data?.map((playlist) => (
          <DropdownMenuItem key={playlist.id} onSelect={() => save.mutate(playlist.id)}>
            {playlist.name}
          </DropdownMenuItem>
        ))}
        {(playlists.data?.length ?? 0) > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onSelect={() => save.mutate(undefined)}>My music (no playlist)</DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/library" target="_blank">
            Make a new playlist…
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const ToolDialog = ({
  title,
  description,
  isOpen,
  onOpenChange,
  children,
}: {
  title: string;
  description: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) => (
  <Dialog open={isOpen} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {children}
    </DialogContent>
  </Dialog>
);

/** Save, fix delay, and everything advanced behind "More". */
export const RoomActions = ({ isPhone, className }: { isPhone: boolean; className?: string }) => {
  const [openTool, setOpenTool] = useState<"delay" | "more" | null>(null);
  const clockOffset = useGlobalStore((state) => state.offsetEstimate);
  const roundTrip = useGlobalStore((state) => state.roundTripEstimate);
  const measurements = useGlobalStore((state) => state.syncMeasurements.length);

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <SaveToPlaylistButton />
      <button type="button" className={pillButton} onClick={() => setOpenTool("delay")}>
        <SlidersHorizontal className="size-[18px]" aria-hidden />
        Fix sound delay
      </button>
      <button
        type="button"
        aria-label="More sound tools"
        title="More sound tools"
        className="flex size-11 cursor-pointer items-center justify-center rounded-full bg-neutral-800 text-white hover:bg-neutral-700"
        onClick={() => setOpenTool("more")}
      >
        <MoreHorizontal className="size-[18px]" />
      </button>

      <ToolDialog
        title="Fix sound delay"
        description="If this device sounds early or late compared with the others, move it until they match. Bluetooth speakers usually need this."
        isOpen={openTool === "delay"}
        onOpenChange={(open) => setOpenTool(open ? "delay" : null)}
      >
        <div className="rounded-lg bg-neutral-900 p-3">{isPhone ? <MobileNudgeControl /> : <NudgeControl />}</div>
        <p className="text-xs text-neutral-500">
          Tip: turn on the click sound here, then adjust until the clicks from all devices land together.
        </p>
      </ToolDialog>

      <ToolDialog
        title="Sound tools"
        description="Extra controls. Most rooms never need these."
        isOpen={openTool === "more"}
        onOpenChange={(open) => setOpenTool(open ? "more" : null)}
      >
        {isPhone && (
          <div className="rounded-lg bg-neutral-900">
            <GlobalVolumeControl isMobile />
          </div>
        )}
        <div className="rounded-lg bg-neutral-900 py-3">
          <h3 className="px-4 pb-2 text-sm font-medium text-white">Move the sound around the room</h3>
          <SpatialAudio />
        </div>
        <p className="font-mono text-[11px] text-neutral-500">
          Sync details: offset {clockOffset.toFixed(1)}ms · round trip {roundTrip.toFixed(1)}ms · output{" "}
          {((audioContextManager.getContext().outputLatency ?? 0) * 1000).toFixed(0)}ms · {measurements}/
          {MAX_NTP_MEASUREMENTS} checks
        </p>
      </ToolDialog>
    </div>
  );
};
