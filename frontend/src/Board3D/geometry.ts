import type { HexCoord } from "../types";

export function coordKey(coord: HexCoord) {
  return `${coord.q}:${coord.r}`;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
