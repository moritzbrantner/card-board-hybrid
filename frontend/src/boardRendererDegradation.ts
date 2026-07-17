import { useCallback, useEffect, useReducer, useRef } from "react";
import type { BoardVisualMode } from "./types";
import {
  boardRendererFallbackMessage,
  canCreateWebGLContext,
  selectBoardRenderer,
  type BoardRendererFallbackReason,
  type BoardRendererKind,
} from "./boardRenderer";

const ASSET_FAILURE_NOTICE =
  "Some 3D models are unavailable, so procedural miniatures are shown.";

export type BoardRendererDegradationState = {
  requestedMode: BoardVisualMode;
  webglFailed: boolean;
  fallbackReason: BoardRendererFallbackReason | null;
  assetFailureCount: number;
};

export type BoardRendererDegradationEvent =
  | {
      type: "requested-mode-changed";
      requestedMode: BoardVisualMode;
      webglAvailable: boolean;
    }
  | { type: "fatal-render-failure" }
  | { type: "asset-failure" };

export type BoardRendererDegradation = {
  renderer: BoardRendererKind;
  fallbackReason: BoardRendererFallbackReason | null;
  notice: string | null;
  assetFailureCount: number;
  reportFatalRenderFailure: () => void;
  reportAssetFailure: () => void;
};

export function createBoardRendererDegradationState({
  requestedMode,
  webglAvailable,
}: {
  requestedMode: BoardVisualMode;
  webglAvailable: boolean;
}): BoardRendererDegradationState {
  const webglFailed = requestedMode === "3d" && !webglAvailable;

  return {
    requestedMode,
    webglFailed,
    fallbackReason: webglFailed ? "webgl-unavailable" : null,
    assetFailureCount: 0,
  };
}

export function reduceBoardRendererDegradation(
  state: BoardRendererDegradationState,
  event: BoardRendererDegradationEvent,
): BoardRendererDegradationState {
  switch (event.type) {
    case "requested-mode-changed":
      return createBoardRendererDegradationState(event);
    case "fatal-render-failure":
      if (selectRenderer(state, false) !== "3d") {
        return state;
      }

      return {
        ...state,
        webglFailed: true,
        fallbackReason: "render-failed",
      };
    case "asset-failure":
      if (selectRenderer(state, false) !== "3d") {
        return state;
      }

      return {
        ...state,
        assetFailureCount: state.assetFailureCount + 1,
      };
  }
}

export function selectBoardRendererDegradation(
  state: BoardRendererDegradationState,
  readOnly: boolean,
): Pick<
  BoardRendererDegradation,
  "renderer" | "fallbackReason" | "notice" | "assetFailureCount"
> {
  const renderer = selectRenderer(state, readOnly);
  const notice =
    renderer === "3d"
      ? state.assetFailureCount > 0
        ? ASSET_FAILURE_NOTICE
        : null
      : state.fallbackReason
        ? boardRendererFallbackMessage(state.fallbackReason)
        : null;

  return {
    renderer,
    fallbackReason: state.fallbackReason,
    notice,
    assetFailureCount: state.assetFailureCount,
  };
}

export function useBoardRendererDegradation({
  requestedMode,
  readOnly,
  probeWebGL = canCreateWebGLContext,
}: {
  requestedMode: BoardVisualMode;
  readOnly: boolean;
  probeWebGL?: () => boolean;
}): BoardRendererDegradation {
  const [state, dispatch] = useReducer(
    reduceBoardRendererDegradation,
    requestedMode,
    (initialRequestedMode) =>
      createBoardRendererDegradationState({
        requestedMode: initialRequestedMode,
        webglAvailable: initialRequestedMode === "2d" || probeWebGL(),
      }),
  );
  const previousRequestedMode = useRef(requestedMode);

  useEffect(() => {
    if (previousRequestedMode.current === requestedMode) {
      return;
    }

    previousRequestedMode.current = requestedMode;
    dispatch({
      type: "requested-mode-changed",
      requestedMode,
      webglAvailable: requestedMode === "2d" || probeWebGL(),
    });
  }, [probeWebGL, requestedMode]);

  const reportFatalRenderFailure = useCallback(() => {
    dispatch({ type: "fatal-render-failure" });
  }, []);
  const reportAssetFailure = useCallback(() => {
    dispatch({ type: "asset-failure" });
  }, []);

  const effectiveState =
    state.requestedMode === requestedMode
      ? state
      : createBoardRendererDegradationState({
          requestedMode,
          webglAvailable: true,
        });

  return {
    ...selectBoardRendererDegradation(effectiveState, readOnly),
    reportFatalRenderFailure,
    reportAssetFailure,
  };
}

function selectRenderer(state: BoardRendererDegradationState, readOnly: boolean) {
  return selectBoardRenderer({
    requestedMode: state.requestedMode,
    webglFailed: state.webglFailed,
    readOnly,
  });
}
