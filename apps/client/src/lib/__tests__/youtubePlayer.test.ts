import { describe, expect, it } from "bun:test";
import {
  DEFAULT_SEEK_LEAD_SECONDS,
  learnSeekLead,
  MAX_DRIFT_SECONDS,
  planDriftCorrection,
  SPEED_MAX_DRIFT_SECONDS,
  SPEED_START_DRIFT_SECONDS,
} from "@/lib/youtubePlayer";

const settled = { secondsSinceLastSeek: 99 };

describe("YouTube drift correction without speed control", () => {
  it("leaves the player alone while it is close enough to the room", () => {
    for (const actual of [60 + MAX_DRIFT_SECONDS, 60 - MAX_DRIFT_SECONDS]) {
      expect(planDriftCorrection({ expected: 60, actual, ...settled })).toEqual({ seekTo: null, speed: "normal" });
    }
  });

  it("seeks slightly ahead of the room when the player fell behind or ran ahead", () => {
    const behind = planDriftCorrection({ expected: 60, actual: 52, ...settled }).seekTo;
    const ahead = planDriftCorrection({ expected: 60, actual: 75, ...settled }).seekTo;
    expect(behind).toBe(60 + DEFAULT_SEEK_LEAD_SECONDS);
    expect(ahead).toBe(behind);
  });

  it("does not seek again while the previous seek is still settling", () => {
    expect(planDriftCorrection({ expected: 60, actual: 30, secondsSinceLastSeek: 1 }).seekTo).toBeNull();
  });

  it("never seeks before the start of the video", () => {
    expect(planDriftCorrection({ expected: -0.4, actual: 5, ...settled }).seekTo).toBe(0);
  });
});

describe("YouTube drift correction with speed control", () => {
  const withSpeed = { ...settled, canAdjustSpeed: true };

  it("speeds up when a little behind and slows down when a little ahead, without seeking", () => {
    expect(planDriftCorrection({ expected: 60, actual: 59.7, ...withSpeed })).toEqual({
      seekTo: null,
      speed: "faster",
    });
    expect(planDriftCorrection({ expected: 60, actual: 60.3, ...withSpeed })).toEqual({
      seekTo: null,
      speed: "slower",
    });
  });

  it("keeps adjusting until nearly exact, but does not start for a drift that small", () => {
    const small = { expected: 60, actual: 60 - SPEED_START_DRIFT_SECONDS / 2, ...withSpeed };
    expect(planDriftCorrection({ ...small, isAdjustingSpeed: true }).speed).toBe("faster");
    expect(planDriftCorrection({ ...small, isAdjustingSpeed: false }).speed).toBe("normal");
  });

  it("seeks, using the learned lead, when too far off for a speed change", () => {
    const plan = planDriftCorrection({
      expected: 60,
      actual: 60 - SPEED_MAX_DRIFT_SECONDS - 0.5,
      seekLeadSeconds: 0.8,
      ...withSpeed,
    });
    expect(plan).toEqual({ seekTo: 60.8, speed: "normal" });
  });
});

describe("learning how long seeks take", () => {
  it("aims further ahead after a seek landed late, and less far after it landed early", () => {
    expect(learnSeekLead(0.15, -0.5)).toBeGreaterThan(0.15);
    expect(learnSeekLead(0.6, 0.3)).toBeLessThan(0.6);
  });

  it("stays within sane bounds", () => {
    expect(learnSeekLead(0.1, 5)).toBe(0);
    expect(learnSeekLead(2, -30)).toBeLessThanOrEqual(2.5);
  });
});
