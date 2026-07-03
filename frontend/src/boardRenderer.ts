import type { BoardVisualMode, HexCoord } from "./types";

export type BoardRendererKind = "2d" | "3d";
export type BoardRendererFallbackReason = "webgl-unavailable" | "render-failed" | "low-capability";

export type BoardRendererSelection = {
  requestedMode: BoardVisualMode;
  webglFailed: boolean;
  readOnly: boolean;
};

export type BoardInteractionState = {
  renderer: BoardRendererKind;
  readOnly: boolean;
  disabled: boolean;
};

export function selectBoardRenderer({
  requestedMode,
  webglFailed,
}: BoardRendererSelection): BoardRendererKind {
  if (requestedMode === "3d" && !webglFailed) {
    return "3d";
  }

  return "2d";
}

export function boardRendererFallbackMessage(reason: BoardRendererFallbackReason) {
  switch (reason) {
    case "low-capability":
      return "3D board is off on this device, using 2D.";
    case "render-failed":
      return "3D board failed to start, using 2D.";
    case "webgl-unavailable":
      return "3D board unavailable, using 2D.";
  }
}

export function isBoardRendererInteractive({
  renderer,
  readOnly,
  disabled,
}: BoardInteractionState) {
  return renderer === "3d" || renderer === "2d" ? !readOnly && !disabled : false;
}

export function canCreateWebGLContext(documentRef: Document | undefined = globalThis.document) {
  if (!documentRef) {
    return false;
  }

  try {
    const canvas = documentRef.createElement("canvas");
    const context =
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl");

    if (context && "getExtension" in context) {
      context.getExtension("WEBGL_lose_context")?.loseContext();
    }

    return Boolean(context);
  } catch {
    return false;
  }
}

export function axialToBoardPosition(coord: HexCoord, tileRadius = 1): [number, number, number] {
  const x = Math.sqrt(3) * tileRadius * (coord.q + coord.r / 2);
  const z = 1.5 * tileRadius * coord.r;

  return [x, 0, z];
}
