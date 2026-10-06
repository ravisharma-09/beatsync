import { describe, expect, it } from "bun:test";
import { MAX_DRIFT_SECONDS, planDriftCorrection } from "@/lib/youtubePlayer";

describe("YouTube drift correction", () => {
  it("leaves the player alone while it is close enough to the room", () => {
    expect(planDriftCorrection({ expected: 60, actual: 60 + MAX_DRIFT_SECONDS, secondsSinceLastSeek: 99 })).toBeNull();
    expect(planDriftCorrection({ expected: 60, actual: 60 - MAX_DRIFT_SECONDS, secondsSinceLastSeek: 99 })).toBeNull();
  });

  it("seeks slightly ahead of the room when the player fell behind or ran ahead", () => {
    const behind = planDriftCorrection({ expected: 60, actual: 52, secondsSinceLastSeek: 99 });
    const ahead = planDriftCorrection({ expected: 60, actual: 75, secondsSinceLastSeek: 99 });
    expect(behind).toBeGreaterThan(60);
    expect(behind).toBeLessThan(60.5);
    expect(ahead).toBe(behind);
  });

  it("does not seek again while the previous seek is still settling", () => {
    expect(planDriftCorrection({ expected: 60, actual: 30, secondsSinceLastSeek: 1 })).toBeNull();
  });

  it("never seeks before the start of the video", () => {
    expect(planDriftCorrection({ expected: -0.4, actual: 5, secondsSinceLastSeek: 99 })).toBe(0);
  });
});
