import type { Camera } from "three";
import {
  createBoardProjection,
  type BoardProjectionAdapter,
} from "../boardProjection";
import {
  projectBoardPositionToViewport,
  type BoardProjectionViewport,
} from "../boardRenderer";

type CameraBoardProjectionContext = {
  camera: Camera;
  viewport: BoardProjectionViewport;
};

export const cameraBoardProjectionAdapter: BoardProjectionAdapter<CameraBoardProjectionContext> = {
  project(coords, { camera, viewport }, previous) {
    return createBoardProjection(
      coords.map((coord) => ({
        coord,
        position: projectBoardPositionToViewport(coord, camera, viewport),
      })),
      previous,
    );
  },
};
