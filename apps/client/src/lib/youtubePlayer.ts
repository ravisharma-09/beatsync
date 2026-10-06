/**
 * Plays YouTube queue items in YouTube's own embedded player and keeps it in step with
 * the room.
 *
 * This is "loose" sync. The uploaded-file engine schedules raw audio to the millisecond;
 * here the only controls are play, pause and seek on a player we do not own, so the goal is
 * everyone within about half a second. The player is told where the room is and, once a
 * second, nudged back with a seek if it has drifted (slow start, buffering, an advert).
 *
 * YouTube's terms shape this file: the player must stay visible and unmodified, and the
 * audio is never separated from the video, so nothing here hides, mutes around or
 * extracts from the player.
 */

// Minimal typing for the parts of the IFrame Player API used here
interface YTPlayer {
  loadVideoById(options: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setVolume(volume: number): void;
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      width?: string;
      height?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (event: { data: number }) => void;
        onError?: (event: { data: number }) => void;
      };
    }
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const PlayerState = { ENDED: 0, PLAYING: 1, PAUSED: 2 } as const;

/** Drift beyond this is corrected with a seek. Smaller than this is not audible as "out of sync" across rooms. */
export const MAX_DRIFT_SECONDS = 0.5;
/** A seek takes a moment to land, so aim slightly ahead of where the room is now. */
const SEEK_LEAD_SECONDS = 0.15;
/** Never seek more often than this: each seek rebuffers, and seeking in a loop never settles. */
const MIN_SECONDS_BETWEEN_SEEKS = 3;
const DRIFT_CHECK_INTERVAL_MS = 1000;
/** After telling the player to play, give it this long before treating "paused" as stuck. */
const RESUME_GRACE_MS = 2500;

export interface YouTubeRoomHooks {
  /** Where the room says this video should be right now, or null when the room is not playing it. */
  getExpectedPosition: (videoId: string) => number | null;
  onEnded: (videoId: string) => void;
  onDuration: (videoId: string, seconds: number) => void;
  onError: (videoId: string, message: string) => void;
}

/**
 * Decides what to do about drift. Kept pure so the rule can be tested without a player.
 * Returns the position to seek to, or null to leave the player alone.
 */
export function planDriftCorrection(input: {
  expected: number;
  actual: number;
  secondsSinceLastSeek: number;
}): number | null {
  if (Math.abs(input.actual - input.expected) <= MAX_DRIFT_SECONDS) return null;
  if (input.secondsSinceLastSeek < MIN_SECONDS_BETWEEN_SEEKS) return null;
  return Math.max(0, input.expected + SEEK_LEAD_SECONDS);
}

let apiPromise: Promise<YTNamespace> | null = null;

function loadIframeApi(): Promise<YTNamespace> {
  apiPromise ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT!);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      apiPromise = null;
      reject(new Error("Could not load the YouTube player"));
    };
    document.head.appendChild(script);
  });
  return apiPromise;
}

const ERROR_MESSAGES: Record<number, string> = {
  2: "This YouTube link is not valid",
  5: "This video cannot be played in the embedded player",
  100: "This video was removed or is private",
  101: "The owner does not allow this video to be played on other sites",
  150: "The owner does not allow this video to be played on other sites",
};

class YouTubeController {
  private hooks: YouTubeRoomHooks | null = null;
  private player: YTPlayer | null = null;
  private isReady = false;
  private host: HTMLElement | null = null;

  /** The video the room wants in the player (whether or not the player exists yet). */
  private videoId: string | null = null;
  private loadedVideoId: string | null = null;
  private volume = 1;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private driftTimer: ReturnType<typeof setInterval> | null = null;
  private lastSeekAt = 0;
  private lastPlayCommandAt = 0;
  private endedFor: string | null = null;
  private readonly durations = new Map<string, number>();

  setHooks(hooks: YouTubeRoomHooks): void {
    this.hooks = hooks;
  }

  /** Duration in seconds if this video has been loaded before, else 0. */
  getKnownDuration(videoId: string): number {
    return this.durations.get(videoId) ?? 0;
  }

  /** Called by the visible player area when it appears. Creates the player inside it. */
  async attach(host: HTMLElement): Promise<void> {
    this.host = host;
    let YT: YTNamespace;
    try {
      YT = await loadIframeApi();
    } catch (error) {
      if (this.videoId) this.hooks?.onError(this.videoId, error instanceof Error ? error.message : String(error));
      return;
    }
    // The area may have gone away, or been replaced, while the script loaded
    if (this.host !== host || this.player) return;

    const mount = document.createElement("div");
    host.replaceChildren(mount);

    this.player = new YT.Player(mount, {
      width: "100%",
      height: "100%",
      // playsinline: stay inside the page on iPhones instead of going full screen
      playerVars: { playsinline: 1, rel: 0, origin: window.location.origin },
      events: {
        onReady: () => {
          this.isReady = true;
          this.player?.setVolume(Math.round(this.volume * 100));
          this.catchUp();
        },
        onStateChange: ({ data }) => this.handleStateChange(data),
        onError: ({ data }) => {
          if (this.videoId) {
            this.hooks?.onError(this.videoId, ERROR_MESSAGES[data] ?? "YouTube could not play this video");
          }
        },
      },
    });
  }

  detach(host: HTMLElement): void {
    if (this.host !== host) return;
    this.player?.destroy();
    this.player = null;
    this.isReady = false;
    this.loadedVideoId = null;
    this.host = null;
    host.replaceChildren();
  }

  /** The room started (or re-synced) this video. `delayMs` is how long until the shared start moment. */
  play({ videoId, delayMs }: { videoId: string; delayMs: number }): void {
    this.videoId = videoId;
    this.endedFor = null;
    this.clearStartTimer();
    this.startTimer = setTimeout(
      () => {
        this.startTimer = null;
        this.catchUp();
      },
      Math.max(0, delayMs)
    );
    this.startDriftChecks();
  }

  pause(delayMs: number): void {
    this.clearStartTimer();
    this.stopDriftChecks();
    setTimeout(
      () => {
        // Only pause if the room has not started playing again in the meantime
        if (this.expectedPosition() === null) this.player?.pauseVideo();
      },
      Math.max(0, delayMs)
    );
  }

  /** The room moved on to something that is not this player's business. */
  stop(): void {
    this.clearStartTimer();
    this.stopDriftChecks();
    this.videoId = null;
    if (this.isReady) this.player?.pauseVideo();
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.isReady) this.player?.setVolume(Math.round(this.volume * 100));
  }

  private expectedPosition(): number | null {
    return this.videoId ? (this.hooks?.getExpectedPosition(this.videoId) ?? null) : null;
  }

  /** Puts the player on the right video at the room's current position. Safe to call repeatedly. */
  private catchUp(): void {
    if (!this.player || !this.isReady || !this.videoId || this.startTimer) return;
    const expected = this.expectedPosition();
    if (expected === null) return;

    this.lastPlayCommandAt = Date.now();
    this.lastSeekAt = Date.now();
    if (this.loadedVideoId !== this.videoId) {
      this.loadedVideoId = this.videoId;
      this.player.loadVideoById({ videoId: this.videoId, startSeconds: expected });
    } else {
      this.player.seekTo(expected, true);
      this.player.playVideo();
    }
  }

  private handleStateChange(state: number): void {
    const videoId = this.loadedVideoId;
    if (!videoId) return;

    if (state === PlayerState.PLAYING) {
      const duration = this.player?.getDuration() ?? 0;
      if (duration > 0 && this.durations.get(videoId) !== duration) {
        this.durations.set(videoId, duration);
        this.hooks?.onDuration(videoId, duration);
      }
    }

    if (state === PlayerState.ENDED && this.endedFor !== videoId && videoId === this.videoId) {
      this.endedFor = videoId;
      this.stopDriftChecks();
      this.hooks?.onEnded(videoId);
    }
  }

  private startDriftChecks(): void {
    this.driftTimer ??= setInterval(() => this.checkDrift(), DRIFT_CHECK_INTERVAL_MS);
  }

  private stopDriftChecks(): void {
    if (this.driftTimer) clearInterval(this.driftTimer);
    this.driftTimer = null;
  }

  private checkDrift(): void {
    if (!this.player || !this.isReady || this.startTimer) return;
    const expected = this.expectedPosition();
    if (expected === null) return;

    if (this.loadedVideoId !== this.videoId) {
      this.catchUp();
      return;
    }

    const state = this.player.getPlayerState();
    if (state === PlayerState.PAUSED && Date.now() - this.lastPlayCommandAt > RESUME_GRACE_MS) {
      // The room is playing but this player is not (blocked autoplay, or paused by hand)
      this.catchUp();
      return;
    }
    // Buffering, adverts and the moment before first play: wait, then correct once it plays
    if (state !== PlayerState.PLAYING) return;

    const target = planDriftCorrection({
      expected,
      actual: this.player.getCurrentTime(),
      secondsSinceLastSeek: (Date.now() - this.lastSeekAt) / 1000,
    });
    if (target !== null) {
      this.lastSeekAt = Date.now();
      this.player.seekTo(target, true);
    }
  }

  private clearStartTimer(): void {
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = null;
  }
}

export const youtubePlayer = new YouTubeController();
