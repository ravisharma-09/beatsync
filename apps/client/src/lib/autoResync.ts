/**
 * Auto re-sync: every few seconds each device compares where it is in the track with where
 * the room is, worked out fresh from the shared server clock, and fixes itself if the two
 * have moved apart.
 *
 * Why devices move apart after a correct start: the start is planned with the clock estimate
 * the device had at that moment, and then runs on the device's own audio clock. The estimate
 * keeps improving after the start, and audio clocks do not all tick at exactly the same
 * speed, so the gap grows slowly over a song.
 */

/** How often each device checks itself. */
export const AUTO_RESYNC_INTERVAL_MS = 10_000;
/** A device found off is checked once more after this long, so one bad clock reading does not cause a jump. */
export const AUTO_RESYNC_CONFIRM_MS = 1_000;
/** Restarting an audio track is a short audible cut, so only do it for a gap that can be heard. */
export const AUDIO_RESYNC_THRESHOLD_SECONDS = 0.04;
/** The embedded player follows the room clock smoothly, so the clock itself can be kept exact. */
export const EXTERNAL_RESYNC_THRESHOLD_SECONDS = 0.02;
/** Leave a play command alone this long: it is still being set up. */
export const RESYNC_MIN_AGE_MS = 3_000;

/** The room's last play command: at `serverTime` (ms) the track was at `trackTime` (s). */
export interface PlayAnchor {
  url: string;
  serverTime: number;
  trackTime: number;
  /** Local time (ms) this device received it. */
  receivedAt: number;
}

/** Where the room is in the track right now, in seconds. `serverNow` is this device's estimate of server time. */
export const roomPosition = (anchor: PlayAnchor, serverNow: number): number =>
  anchor.trackTime + (serverNow - anchor.serverTime) / 1000;

/**
 * How far this device is from where it should be, in seconds (positive: ahead).
 * `outputLatencySeconds`: audio tracks are fed to the speakers that much early on purpose.
 */
export function resyncError(input: {
  anchor: PlayAnchor;
  serverNow: number;
  localPosition: number;
  outputLatencySeconds: number;
}): number {
  return input.localPosition - (roomPosition(input.anchor, input.serverNow) + input.outputLatencySeconds);
}

/** Whether two checks agree that the device is off: both past the limit, in the same direction. */
export const isConfirmedOff = (first: number, second: number, threshold: number): boolean =>
  Math.abs(first) > threshold && Math.abs(second) > threshold && Math.sign(first) === Math.sign(second);
