import type { ReplayEvent, ReplayFrame } from "./types";

export const LIVE_AI_FRAME_DELAY_MS = 1000;

export function liveAiPlaybackFrames(frames: ReplayFrame[]) {
  return frames.filter((frame) => isOpponentVisibleEvent(frame.event));
}

function isOpponentVisibleEvent(event: ReplayEvent) {
  if (event.type === "matchEnded") {
    return true;
  }

  if (!("side" in event) || event.side !== "opponent") {
    return false;
  }

  return (
    event.type === "actionQueued" ||
    event.type === "unitSummoned" ||
    event.type === "pieceMoved" ||
    event.type === "pieceAttacked" ||
    event.type === "pieceHealed" ||
    event.type === "unitArmorRefreshed" ||
    event.type === "pieceBuffed" ||
    event.type === "pieceDamaged" ||
    event.type === "unitDestroyed" ||
    event.type === "manaGained"
  );
}
