import { describe, expect, it } from "vitest";
import { PerspectiveCamera } from "three";
import { cameraBoardProjectionAdapter } from "./Board3D/cameraBoardProjection";
import { createBoardProjection } from "./boardProjection";
import { domBoardProjectionAdapter } from "./components/board/domBoardProjection";

describe("board projection", () => {
  it("reuses an equivalent projection and replaces a materially changed projection", () => {
    const initial = createBoardProjection([
      { coord: { q: 0, r: 0 }, position: { x: 10, y: 20, visible: true } },
      { coord: { q: 1, r: 0 }, position: { x: 30, y: 40, visible: false } },
    ]);

    const equivalent = createBoardProjection(
      [
        { coord: { q: 0, r: 0 }, position: { x: 10.2, y: 19.8, visible: true } },
        { coord: { q: 1, r: 0 }, position: { x: 30, y: 40, visible: false } },
      ],
      initial,
    );
    const changed = createBoardProjection(
      [
        { coord: { q: 0, r: 0 }, position: { x: 10.3, y: 20, visible: true } },
        { coord: { q: 1, r: 0 }, position: { x: 30, y: 40, visible: false } },
      ],
      initial,
    );

    expect(equivalent).toBe(initial);
    expect(changed).not.toBe(initial);
    expect(changed.positionAt({ q: 0, r: 0 })).toEqual({ x: 10.3, y: 20, visible: true });
  });

  it("measures 2D tile centers relative to the board field", () => {
    const coord = { q: 1, r: -1 };
    const projection = domBoardProjectionAdapter.project([coord], {
      container: rectProvider({ left: 100, top: 50, width: 400, height: 300 }),
      elementAt: () => rectProvider({ left: 145, top: 90, width: 30, height: 20 }),
    });

    expect(projection.positionAt(coord)).toEqual({ x: 60, y: 50, visible: true });
  });

  it("projects 3D board coordinates through the camera adapter", () => {
    const camera = new PerspectiveCamera(38, 2, 0.1, 60);
    camera.position.set(0, 7.6, 7.9);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();

    const projection = cameraBoardProjectionAdapter.project([{ q: 0, r: 0 }], {
      camera,
      viewport: { width: 200, height: 100 },
    });

    expect(projection.positionAt({ q: 0, r: 0 })).toEqual({ x: 100, y: 50, visible: true });
  });
});

function rectProvider(rect: Pick<DOMRect, "left" | "top" | "width" | "height">) {
  return {
    getBoundingClientRect: () => rect as DOMRect,
  };
}
