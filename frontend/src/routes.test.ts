import { describe, expect, it } from "vitest";
import {
  matchSummaryRouteFromPath,
  sharedMatchRouteFromPath,
  sharedMatchSummaryRouteFromPath,
  sharedReplayRouteFromPath,
} from "./routes";

describe("route parsers", () => {
  it("parses match summary routes", () => {
    expect(matchSummaryRouteFromPath("/matches/rl-123/summary")).toBe("rl-123");
    expect(matchSummaryRouteFromPath("/matches/rl-123/replay")).toBeNull();
  });

  it("parses shared summary and replay routes before shared match routes", () => {
    expect(sharedMatchSummaryRouteFromPath("/match/rl-123/player-token/summary")).toEqual({
      matchId: "rl-123",
      seatToken: "player-token",
    });
    expect(sharedReplayRouteFromPath("/match/rl-123/player-token/replay")).toEqual({
      matchId: "rl-123",
      seatToken: "player-token",
    });
    expect(sharedMatchRouteFromPath("/match/rl-123/player-token/summary")).toBeNull();
    expect(sharedMatchRouteFromPath("/match/rl-123/player-token/replay")).toBeNull();
  });
});
