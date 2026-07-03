import type { HexCoord, HotkeyCommandId, MatchState, Side } from "./types";

export type BoardCursorDirectionCommand =
  | "cursorNorthwest"
  | "cursorNortheast"
  | "cursorEast"
  | "cursorWest"
  | "cursorSouthwest"
  | "cursorSoutheast";

export type BoardCursorSelection =
  | { type: "card"; cardId: string }
  | { type: "piece"; pieceId: string }
  | null;

export type BoardCursorFocusedPiece = {
  id: string;
  side: Side;
} | null;

export type BoardCursorState = {
  coord: HexCoord | null;
  visible: boolean;
};

export type BoardCursorConfirmIntent =
  | { type: "selectPiece"; pieceId: string }
  | { type: "targetHex"; coord: HexCoord }
  | { type: "none" };

export const BOARD_CURSOR_DIRECTIONS: Record<BoardCursorDirectionCommand, HexCoord> = {
  cursorNorthwest: { q: 0, r: -1 },
  cursorNortheast: { q: 1, r: -1 },
  cursorEast: { q: 1, r: 0 },
  cursorWest: { q: -1, r: 0 },
  cursorSouthwest: { q: -1, r: 1 },
  cursorSoutheast: { q: 0, r: 1 },
};

export function isBoardCursorDirectionCommand(
  commandId: HotkeyCommandId,
): commandId is BoardCursorDirectionCommand {
  return commandId in BOARD_CURSOR_DIRECTIONS;
}

export function initialBoardCursorCoord(match: MatchState, viewerSide: Side): HexCoord {
  return participantForSide(match, viewerSide).wizard.position;
}

export function moveBoardCursorCoord(
  coord: HexCoord,
  commandId: BoardCursorDirectionCommand,
  radius: number,
): HexCoord {
  const direction = BOARD_CURSOR_DIRECTIONS[commandId];
  const next = { q: coord.q + direction.q, r: coord.r + direction.r };
  return isCoordInHexRadius(next, radius) ? next : coord;
}

export function isCoordInHexRadius(coord: HexCoord, radius: number) {
  return hexDistance({ q: 0, r: 0 }, coord) <= radius;
}

export function boardCursorConfirmIntent({
  coord,
  selection,
  focusedPiece,
  viewerSide,
}: {
  coord: HexCoord;
  selection: BoardCursorSelection;
  focusedPiece: BoardCursorFocusedPiece;
  viewerSide: Side;
}): BoardCursorConfirmIntent {
  if (selection) {
    return { type: "targetHex", coord };
  }

  if (focusedPiece?.side === viewerSide) {
    return { type: "selectPiece", pieceId: focusedPiece.id };
  }

  return { type: "none" };
}

export function hideBoardCursor(state: BoardCursorState): BoardCursorState {
  return { ...state, visible: false };
}

function participantForSide(match: MatchState, side: Side) {
  return side === "player" ? match.player : match.opponent;
}

function hexDistance(a: HexCoord, b: HexCoord) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = -a.q - a.r - (-b.q - b.r);
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
}
