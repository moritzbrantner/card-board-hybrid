// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  createBoardRendererDegradationState,
  reduceBoardRendererDegradation,
  selectBoardRendererDegradation,
  useBoardRendererDegradation,
} from "./boardRendererDegradation";

describe("board renderer degradation", () => {
  it("starts unavailable 3D requests in 2D with a WebGL notice", () => {
    const state = createBoardRendererDegradationState({
      requestedMode: "3d",
      webglAvailable: false,
    });

    expect(selectBoardRendererDegradation(state, false)).toEqual({
      renderer: "2d",
      fallbackReason: "webgl-unavailable",
      notice: "3D board unavailable, using 2D.",
      assetFailureCount: 0,
    });
  });

  it("keeps requested 3D presentation on read-only boards", () => {
    const state = createBoardRendererDegradationState({
      requestedMode: "3d",
      webglAvailable: true,
    });

    expect(selectBoardRendererDegradation(state, true).renderer).toBe("3d");
  });

  it("degrades fatal 3D render failures to the complete 2D board", () => {
    const initialState = createBoardRendererDegradationState({
      requestedMode: "3d",
      webglAvailable: true,
    });
    const state = reduceBoardRendererDegradation(initialState, {
      type: "fatal-render-failure",
    });

    expect(selectBoardRendererDegradation(state, false)).toMatchObject({
      renderer: "2d",
      fallbackReason: "render-failed",
      notice: "3D board failed to start, using 2D.",
    });
  });

  it("counts model failures while retaining 3D with a procedural fallback notice", () => {
    const initialState = createBoardRendererDegradationState({
      requestedMode: "3d",
      webglAvailable: true,
    });
    const oneFailure = reduceBoardRendererDegradation(initialState, {
      type: "asset-failure",
    });
    const twoFailures = reduceBoardRendererDegradation(oneFailure, {
      type: "asset-failure",
    });

    expect(selectBoardRendererDegradation(twoFailures, false)).toEqual({
      renderer: "3d",
      fallbackReason: null,
      notice: "Some 3D models are unavailable, so procedural miniatures are shown.",
      assetFailureCount: 2,
    });
  });

  it("resets degradation when the player explicitly requests 2D", () => {
    const failed3d = reduceBoardRendererDegradation(
      createBoardRendererDegradationState({ requestedMode: "3d", webglAvailable: true }),
      { type: "fatal-render-failure" },
    );
    const state = reduceBoardRendererDegradation(failed3d, {
      type: "requested-mode-changed",
      requestedMode: "2d",
      webglAvailable: true,
    });

    expect(selectBoardRendererDegradation(state, false)).toEqual({
      renderer: "2d",
      fallbackReason: null,
      notice: null,
      assetFailureCount: 0,
    });
  });

  it("re-probes WebGL when the player requests 3D again", () => {
    const explicit2d = createBoardRendererDegradationState({
      requestedMode: "2d",
      webglAvailable: true,
    });
    const unavailable3d = reduceBoardRendererDegradation(explicit2d, {
      type: "requested-mode-changed",
      requestedMode: "3d",
      webglAvailable: false,
    });
    const available3d = reduceBoardRendererDegradation(unavailable3d, {
      type: "requested-mode-changed",
      requestedMode: "3d",
      webglAvailable: true,
    });

    expect(selectBoardRendererDegradation(unavailable3d, false).renderer).toBe("2d");
    expect(selectBoardRendererDegradation(available3d, false)).toMatchObject({
      renderer: "3d",
      fallbackReason: null,
      notice: null,
    });
  });

  it("owns WebGL probing across requested mode changes", async () => {
    const probeWebGL = vi.fn(() => false);
    const { result, rerender } = renderHook(
      ({ requestedMode }) =>
        useBoardRendererDegradation({ requestedMode, readOnly: false, probeWebGL }),
      { initialProps: { requestedMode: "2d" as "2d" | "3d" } },
    );

    expect(result.current.renderer).toBe("2d");
    expect(probeWebGL).not.toHaveBeenCalled();

    rerender({ requestedMode: "3d" });

    await waitFor(() => expect(result.current.fallbackReason).toBe("webgl-unavailable"));
    expect(probeWebGL).toHaveBeenCalledOnce();

    act(() => {
      result.current.reportFatalRenderFailure();
      result.current.reportAssetFailure();
    });
    expect(result.current.assetFailureCount).toBe(0);

    rerender({ requestedMode: "2d" });
    await waitFor(() => expect(result.current.fallbackReason).toBeNull());
    expect(result.current.notice).toBeNull();
  });
});
