import { describe, expect, it } from "bun:test";
import { isConfirmedOff, resyncError, type PlayAnchor } from "@/lib/autoResync";

const anchor: PlayAnchor = { url: "a", serverTime: 1_000_000, trackTime: 30, receivedAt: 0 };

describe("auto re-sync", () => {
  it("measures how far a device is from the room, from the server clock", () => {
    // 20s after the play command the room is at 50s
    const serverNow = anchor.serverTime + 20_000;
    expect(resyncError({ anchor, serverNow, localPosition: 50, outputLatencySeconds: 0 })).toBeCloseTo(0);
    expect(resyncError({ anchor, serverNow, localPosition: 49.9, outputLatencySeconds: 0 })).toBeCloseTo(-0.1);
  });

  it("does not count the deliberate head start for speaker delay as being ahead", () => {
    const serverNow = anchor.serverTime + 20_000;
    expect(resyncError({ anchor, serverNow, localPosition: 50.025, outputLatencySeconds: 0.025 })).toBeCloseTo(0);
  });

  it("only acts when two checks agree, so one bad clock reading causes no jump", () => {
    expect(isConfirmedOff(0.09, 0.08, 0.04)).toBe(true);
    expect(isConfirmedOff(0.09, 0.01, 0.04)).toBe(false);
    expect(isConfirmedOff(0.09, -0.09, 0.04)).toBe(false);
  });
});
