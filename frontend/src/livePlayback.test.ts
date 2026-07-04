import { describe, expect, it } from "vitest";
import { liveAiPlaybackFrames } from "./livePlayback";
import type { MatchState, ReplayFrame } from "./types";

describe("liveAiPlaybackFrames", () => {
  it("keeps opponent visible action frames for paced live playback", () => {
    const frames = [
      makeFrame(0, { type: "turnStarted", side: "opponent", round: 1 }),
      makeFrame(1, {
        type: "actionQueued",
        side: "opponent",
        item: {
          id: "stack-1",
          side: "opponent",
          priority: 0,
          action: {
            type: "movePiece",
            pieceId: "opponent-hero",
            from: { q: 0, r: -3 },
            to: { q: 0, r: -2 },
          },
        },
      }),
      makeFrame(2, {
        type: "pieceMoved",
        side: "opponent",
        pieceId: "opponent-hero",
        from: { q: 0, r: -3 },
        to: { q: 0, r: -2 },
      }),
      makeFrame(3, {
        type: "pieceMoved",
        side: "player",
        pieceId: "player-hero",
        from: { q: 0, r: 3 },
        to: { q: 0, r: 2 },
      }),
    ] satisfies ReplayFrame[];

    expect(liveAiPlaybackFrames(frames).map((frame) => frame.frameIndex)).toEqual([1, 2]);
  });
});

function makeFrame(
  frameIndex: number,
  event: ReplayFrame["event"],
): ReplayFrame {
  return {
    frameIndex,
    actionIndex: 1,
    event,
    matchState: {} as MatchState,
  };
}
