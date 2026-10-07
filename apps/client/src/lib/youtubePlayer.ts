/**
 * Plays YouTube queue items in YouTube's own embedded player and keeps it in step with
 * the room.
 *
 * This is "loose" sync. The uploaded-file engine schedules raw audio to the millisecond;
 * here the only controls are play, pause, seek and playback speed on a player we do not
 * own. The player is told where the room is and then held there in two ways:
 *
 * - far off (slow start, buffering, an advert): seek to where the room is, aiming ahead by
 *   however long seeks have been taking on this device;
 * - a little off: play slightly faster or slower until it lines up. This is what removes
 *   the echo between two devices in the same room, which a seek is too coarse to fix.
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
  getAvailablePlaybackRates(): number[];
  setPlaybackRate(rate: number): void;
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

/** Without speed control (live streams, hidden tabs), drift beyond this is corrected with a seek. */
export const MAX_DRIFT_SECONDS = 0.5;
/** With speed control: start adjusting beyond START, stop once within STOP (no flip-flopping). */
export const SPEED_START_DRIFT_SECONDS = 0.1;
export const SPEED_STOP_DRIFT_SECONDS = 0.03;
/** Further off than this, changing speed would take too long: seek instead. */
export const SPEED_MAX_DRIFT_SECONDS = 1;
/** A seek takes a moment to land, so aim ahead of where the room is now. Adjusted as seeks are measured. */
export const DEFAULT_SEEK_LEAD_SECONDS = 0.15;
const MAX_SEEK_LEAD_SECONDS = 2.5;
/** Never seek more often than this: each seek rebuffers, and seeking in a loop never settles. */
const MIN_SECONDS_BETWEEN_SEEKS = 3;
/** The player's reported time is only trusted this long after a seek. */
const SEEK_SETTLE_MS = 600;
/**
 * The player reports its position in steps (a few times a second), so it is read often and
 * only used at the moment the value changes, when it is fresh.
 */
const DRIFT_CHECK_INTERVAL_MS = 50;
/** After telling the player to play, give it this long before treating "paused" as stuck. */
const RESUME_GRACE_MS = 2500;

export interface YouTubeRoomHooks {
  /** Where the room says this video should be right now, or null when the room is not playing it. */
  getExpectedPosition: (videoId: string) => number | null;
  onEnded: (videoId: string) => void;
  onDuration: (videoId: string, seconds: number) => void;
  onError: (videoId: string, message: string) => void;
}

export type PlaybackSpeed = "normal" | "faster" | "slower";

export interface DriftCorrection {
  /** Position to seek to, or null for no seek. */
  seekTo: number | null;
  speed: PlaybackSpeed;
}

/**
 * Decides what to do about drift. Kept pure so the rule can be tested without a player.
 */
export function planDriftCorrection(input: {
  expected: number;
  actual: number;
  secondsSinceLastSeek: number;
  /** Whether the player can be sped up and slowed down right now. */
  canAdjustSpeed?: boolean;
  /** Whether it is currently playing faster or slower than normal. */
  isAdjustingSpeed?: boolean;
  seekLeadSeconds?: number;
}): DriftCorrection {
  const drift = input.actual - input.expected; // positive: ahead of the room
  const size = Math.abs(drift);
  const seekLimit = input.canAdjustSpeed ? SPEED_MAX_DRIFT_SECONDS : MAX_DRIFT_SECONDS;

  if (size > seekLimit) {
    if (input.secondsSinceLastSeek < MIN_SECONDS_BETWEEN_SEEKS) return { seekTo: null, speed: "normal" };
    const lead = input.seekLeadSeconds ?? DEFAULT_SEEK_LEAD_SECONDS;
    return { seekTo: Math.max(0, input.expected + lead), speed: "normal" };
  }
  if (!input.canAdjustSpeed) return { seekTo: null, speed: "normal" };

  const threshold = input.isAdjustingSpeed ? SPEED_STOP_DRIFT_SECONDS : SPEED_START_DRIFT_SECONDS;
  if (size <= threshold) return { seekTo: null, speed: "normal" };
  return { seekTo: null, speed: drift < 0 ? "faster" : "slower" };
}

/**
 * How far to aim ahead on the next seek, given how the last one landed.
 * `driftAfterSeek` is player minus room: negative means the seek landed late.
 */
export function learnSeekLead(currentLead: number, driftAfterSeek: number): number {
  return Math.min(MAX_SEEK_LEAD_SECONDS, Math.max(0, currentLead - driftAfterSeek * 0.6));
}

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

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
  private seekLead = DEFAULT_SEEK_LEAD_SECONDS;
  /** A seek was sent and how it landed has not been measured yet. */
  private isSeekUnmeasured = false;
  /** The video was just loaded: the first correction may happen as soon as it plays. */
  private isFreshLoad = false;
  private speed: PlaybackSpeed = "normal";
  private lastReportedTime = -1;
  private recentDrifts: number[] = [];
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
    this.setSpeed("normal");
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
    this.recentDrifts = [];
    this.isSeekUnmeasured = false;
    this.setSpeed("normal");
    if (this.loadedVideoId !== this.videoId) {
      this.loadedVideoId = this.videoId;
      this.isFreshLoad = true;
      this.player.loadVideoById({ videoId: this.videoId, startSeconds: expected });
    } else {
      this.player.seekTo(Math.max(0, expected + this.seekLead), true);
      this.player.playVideo();
    }
  }

  private setSpeed(speed: PlaybackSpeed): void {
    if (this.speed === speed) return;
    this.speed = speed;
    if (!this.player || !this.isReady) return;
    const rates = this.player.getAvailablePlaybackRates();
    const faster = Math.min(...rates.filter((rate) => rate > 1));
    const slower = Math.max(...rates.filter((rate) => rate < 1));
    const rate = speed === "faster" ? faster : speed === "slower" ? slower : 1;
    this.player.setPlaybackRate(Number.isFinite(rate) ? rate : 1);
  }

  /** Speed can be adjusted when the video offers it and the tab is visible (hidden tabs run timers too rarely). */
  private canAdjustSpeed(): boolean {
    if (!this.player || document.hidden) return false;
    const rates = this.player.getAvailablePlaybackRates();
    return rates.some((rate) => rate > 1) && rates.some((rate) => rate < 1);
  }

  private handleStateChange(state: number): void {
    const videoId = this.loadedVideoId;
    if (!videoId) return;

    if (state === PlayerState.PLAYING) {
      if (this.isFreshLoad) {
        // Loading took an unknown time, so the player starts behind: let it be corrected at once
        this.isFreshLoad = false;
        this.lastSeekAt = 0;
      }
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
    if (state !== PlayerState.PLAYING) {
      this.recentDrifts = [];
      return;
    }

    const actual = this.player.getCurrentTime();
    if (actual === this.lastReportedTime) return; // not a fresh reading
    this.lastReportedTime = actual;
    if (Date.now() - this.lastSeekAt < SEEK_SETTLE_MS) return;

    const drift = actual - expected;
    if (this.isSeekUnmeasured) {
      this.isSeekUnmeasured = false;
      this.seekLead = learnSeekLead(this.seekLead, drift);
    }
    this.recentDrifts = [...this.recentDrifts, drift].slice(-3);

    const isAdjustingSpeed = this.speed !== "normal";
    // Starting a correction needs agreement between readings; stopping one must be prompt
    if (!isAdjustingSpeed && this.recentDrifts.length < 3) return;
    const steadyDrift = isAdjustingSpeed ? drift : median(this.recentDrifts);

    const plan = planDriftCorrection({
      expected,
      actual: expected + steadyDrift,
      secondsSinceLastSeek: (Date.now() - this.lastSeekAt) / 1000,
      canAdjustSpeed: this.canAdjustSpeed(),
      isAdjustingSpeed,
      seekLeadSeconds: this.seekLead,
    });
    this.setSpeed(plan.speed);
    if (plan.seekTo !== null) {
      this.lastSeekAt = Date.now();
      this.isSeekUnmeasured = true;
      this.recentDrifts = [];
      this.player.seekTo(plan.seekTo, true);
    }
  }

  private clearStartTimer(): void {
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = null;
  }
}

export const youtubePlayer = new YouTubeController();
