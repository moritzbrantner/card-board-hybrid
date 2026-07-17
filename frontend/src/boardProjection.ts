import { coordKey } from "./matchBoardHelpers";
import type { HexCoord } from "./types";

const POSITION_CHANGE_THRESHOLD_PX = 0.25;

export type BoardProjectedPosition = {
  x: number;
  y: number;
  visible: boolean;
};

export type BoardProjectionSample = {
  coord: HexCoord;
  position: BoardProjectedPosition;
};

export interface BoardProjection {
  positionAt(coord: HexCoord): BoardProjectedPosition | undefined;
}

export interface BoardProjectionAdapter<Context> {
  project(
    coords: readonly HexCoord[],
    context: Context,
    previous?: BoardProjection,
  ): BoardProjection;
}

class KeyedBoardProjection implements BoardProjection {
  constructor(readonly positions: Map<string, BoardProjectedPosition>) {}

  positionAt(coord: HexCoord) {
    return this.positions.get(coordKey(coord));
  }
}

export function createBoardProjection(
  samples: readonly BoardProjectionSample[],
  previous?: BoardProjection,
): BoardProjection {
  const positions = new Map(
    samples.map(({ coord, position }) => [coordKey(coord), position]),
  );

  if (previous instanceof KeyedBoardProjection && projectionsEqual(previous.positions, positions)) {
    return previous;
  }

  return new KeyedBoardProjection(positions);
}

function projectionsEqual(
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
      Math.abs(currentPosition.x - nextPosition.x) > POSITION_CHANGE_THRESHOLD_PX ||
      Math.abs(currentPosition.y - nextPosition.y) > POSITION_CHANGE_THRESHOLD_PX
    ) {
      return false;
    }
  }

  return true;
}
