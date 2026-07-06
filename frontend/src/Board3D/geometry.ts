import type { BoardProjectedPosition } from "./types";
import type { HexCoord } from "../types";

export function coordKey(coord: HexCoord) {
  return `${coord.q}:${coord.r}`;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function projectedPositionsEqual(
  left: Map<string, BoardProjectedPosition>,
  right: Map<string, BoardProjectedPosition>,
) {
  if (left.size !== right.size) {
    return false;
  }

  for (const [key, nextPosition] of right) {
    const currentPosition = left.get(key);
    if (
      !currentPosition ||
      currentPosition.visible !== nextPosition.visible ||
      Math.abs(currentPosition.x - nextPosition.x) > 0.25 ||
      Math.abs(currentPosition.y - nextPosition.y) > 0.25
    ) {
      return false;
    }
  }

  return true;
}
