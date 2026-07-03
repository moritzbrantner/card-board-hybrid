import type { BoardVisualMode, HexCoord } from "./types";

export type BoardRendererKind = "2d" | "3d";

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
  readOnly,
}: BoardRendererSelection): BoardRendererKind {
  if (requestedMode === "3d" && readOnly && !webglFailed) {
    return "3d";
  }

  return "2d";
}

export function isBoardRendererInteractive({
  renderer,
  readOnly,
  disabled,
}: BoardInteractionState) {
  if (renderer === "3d") {
    return false;
  }

  return !readOnly && !disabled;
}

export function canCreateWebGLContext(documentRef: Document | undefined = globalThis.document) {
  if (!documentRef) {
    return false;
  }

  const canvas = documentRef.createElement("canvas");
  const context =
    canvas.getContext("webgl2") ??
    canvas.getContext("webgl") ??
    canvas.getContext("experimental-webgl");

  return Boolean(context);
}

export function axialToBoardPosition(coord: HexCoord, tileRadius = 1): [number, number, number] {
  const x = Math.sqrt(3) * tileRadius * (coord.q + coord.r / 2);
  const z = 1.5 * tileRadius * coord.r;

  return [x, 0, z];
}
