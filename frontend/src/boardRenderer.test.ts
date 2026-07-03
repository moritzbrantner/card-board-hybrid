import { describe, expect, it } from "vitest";
import {
  axialToBoardPosition,
  canCreateWebGLContext,
  isBoardRendererInteractive,
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

  it("keeps active playable boards on the 2D renderer until 3D interaction parity ships", () => {
    expect(selectBoardRenderer({ requestedMode: "3d", webglFailed: false, readOnly: false })).toBe(
      "2d",
    );
  });

  it("detects unavailable WebGL before mounting the 3D canvas", () => {
    expect(canCreateWebGLContext(undefined)).toBe(false);
  });

  it("keeps the 3D shell non-interactive for replay-safe rendering in this slice", () => {
    expect(
      isBoardRendererInteractive({ renderer: "3d", readOnly: false, disabled: false }),
    ).toBe(false);
    expect(
      isBoardRendererInteractive({ renderer: "2d", readOnly: true, disabled: false }),
    ).toBe(false);
  });

  it("positions radius-3 hexes on a stable axial grid", () => {
    expect(axialToBoardPosition({ q: 0, r: 0 })).toEqual([0, 0, 0]);
    expect(axialToBoardPosition({ q: 1, r: 0 })[0]).toBeCloseTo(Math.sqrt(3));
    expect(axialToBoardPosition({ q: 0, r: 1 })).toEqual([Math.sqrt(3) / 2, 0, 1.5]);
  });
});
