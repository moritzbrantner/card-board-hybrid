import { useEffect, useMemo, useState } from "react";
import {
  boardRendererFallbackMessage,
  canCreateWebGLContext,
  isBoardRendererInteractive,
  selectBoardRenderer,
  type BoardRendererFallbackReason,
  type BoardRendererKind,
} from "./boardRenderer";
import type { BoardVisualMode } from "./types";

export type BoardRendererDegradationOptions = {
  requestedMode: BoardVisualMode;
  readOnly: boolean;
  disabled: boolean;
  canUseWebGL?: () => boolean;
};

export type BoardRendererDegradation = {
  renderer: BoardRendererKind;
  isInteractive: boolean;
  fallbackReason: BoardRendererFallbackReason | null;
  fallbackMessage: string | null;
  assetFailureCount: number;
  reportFatalRenderError: () => void;
  reportAssetFailure: () => void;
};

export function useBoardRendererDegradation({
  requestedMode,
  readOnly,
  disabled,
  canUseWebGL = canCreateWebGLContext,
}: BoardRendererDegradationOptions): BoardRendererDegradation {
  const [webglFailed, setWebglFailed] = useState(
    () => requestedMode === "3d" && !canUseWebGL(),
  );
  const [fallbackReason, setFallbackReason] =
    useState<BoardRendererFallbackReason | null>(() =>
      requestedMode === "3d" && !canUseWebGL() ? "webgl-unavailable" : null,
    );
  const [assetFailureCount, setAssetFailureCount] = useState(0);

  useEffect(() => {
    if (requestedMode === "2d") {
      setWebglFailed(false);
      setFallbackReason(null);
      setAssetFailureCount(0);
      return;
    }

    if (!canUseWebGL()) {
      setWebglFailed(true);
      setFallbackReason("webgl-unavailable");
      return;
    }

    setWebglFailed(false);
    setFallbackReason(null);
  }, [canUseWebGL, requestedMode]);

  const renderer = selectBoardRenderer({
    requestedMode,
    webglFailed,
    readOnly,
  });
  const isInteractive = isBoardRendererInteractive({ renderer, readOnly, disabled });

  return useMemo(
    () => ({
      renderer,
      isInteractive,
      fallbackReason,
      fallbackMessage: fallbackReason ? boardRendererFallbackMessage(fallbackReason) : null,
      assetFailureCount,
      reportFatalRenderError: () => {
        setWebglFailed(true);
        setFallbackReason("render-failed");
      },
      reportAssetFailure: () => setAssetFailureCount((count) => count + 1),
    }),
    [assetFailureCount, fallbackReason, isInteractive, renderer],
  );
}
