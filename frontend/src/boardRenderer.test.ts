import { describe, expect, it } from "vitest";
import { PerspectiveCamera } from "three";
import {
  BOARD_3D_CAMERA,
  BOARD_3D_GROUP_ROTATION_Y,
  BOARD_3D_TILE_ROTATION_Y,
  axialToBoardPosition,
  canCreateWebGLContext,
  isBoardRendererInteractive,
  projectBoardPositionToViewport,
  selectBoardRenderer,
} from "./boardRenderer";

describe("board renderer boundary", () => {
  it("uses 3D when the effective Board visual mode requests it", () => {
    expect(selectBoardRenderer({ requestedMode: "3d", webglFailed: false, readOnly: true })).toBe(
      "3d",
    );
  });

  it("falls back to 2D after a WebGL renderer failure", () => {
    expect(selectBoardRenderer({ requestedMode: "3d", webglFailed: true, readOnly: true })).toBe(
      "2d",
    );
  });

  it("uses 3D for active playable boards when requested", () => {
    expect(selectBoardRenderer({ requestedMode: "3d", webglFailed: false, readOnly: false })).toBe(
      "3d",
    );
  });

  it("detects unavailable WebGL before mounting the 3D canvas", () => {
    expect(canCreateWebGLContext(undefined)).toBe(false);
  });

  it("treats WebGL context creation exceptions as unavailable", () => {
    const documentRef = {
      createElement: () => ({
        getContext: () => {
          throw new Error("webgl disabled");
        },
      }),
    } as unknown as Document;

    expect(canCreateWebGLContext(documentRef)).toBe(false);
  });

  it("keeps read-only boards non-interactive while active 3D boards can be played", () => {
    expect(
      isBoardRendererInteractive({ renderer: "3d", readOnly: false, disabled: false }),
    ).toBe(true);
    expect(
      isBoardRendererInteractive({ renderer: "3d", readOnly: true, disabled: false }),
    ).toBe(false);
    expect(
      isBoardRendererInteractive({ renderer: "2d", readOnly: true, disabled: false }),
    ).toBe(false);
  });

  it("positions radius-3 hexes on a stable axial grid", () => {
    expect(axialToBoardPosition({ q: 0, r: 0 })).toEqual([0, 0, 0]);
    expect(axialToBoardPosition({ q: 1, r: 0 })[0]).toBeCloseTo(Math.sqrt(3));
    expect(axialToBoardPosition({ q: 0, r: 1 })).toEqual([Math.sqrt(3) / 2, 0, 1.5]);
    expect(BOARD_3D_TILE_ROTATION_Y).toBe(0);
  });

  it("projects 3D hex centers through the shared board camera and orientation", () => {
    const camera = new PerspectiveCamera(
      BOARD_3D_CAMERA.fov,
      980 / 620,
      BOARD_3D_CAMERA.near,
      BOARD_3D_CAMERA.far,
    );
    camera.position.set(...BOARD_3D_CAMERA.position);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();

    const center = projectBoardPositionToViewport(
      { q: 0, r: 0 },
      camera,
      { width: 980, height: 620 },
    );
    expect(center.x).toBeCloseTo(490);
    expect(center.y).toBeCloseTo(310);

    const upperRight = projectBoardPositionToViewport(
      { q: 1, r: 0 },
      camera,
      { width: 980, height: 620 },
    );
    const lowerLeft = projectBoardPositionToViewport(
      { q: -1, r: 0 },
      camera,
      { width: 980, height: 620 },
    );
    expect(upperRight.x).toBeGreaterThan(center.x);
    expect(upperRight.y).toBeLessThan(center.y);
    expect(lowerLeft.x).toBeLessThan(center.x);
    expect(lowerLeft.y).toBeGreaterThan(center.y);

    const resized = projectBoardPositionToViewport(
      { q: -1, r: 0 },
      camera,
      { width: 490, height: 310 },
    );
    expect(resized.x).toBeCloseTo(lowerLeft.x / 2);
    expect(resized.y).toBeCloseTo(lowerLeft.y / 2);
    expect(BOARD_3D_GROUP_ROTATION_Y).toBeCloseTo(Math.PI / 6);
  });
});
