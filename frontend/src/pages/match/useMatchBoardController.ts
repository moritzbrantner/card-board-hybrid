import { useEffect, useMemo, useState } from "react";

import type { BoardPiece, BoardUnit, Selection, UnitContextMenu } from "../../appTypes";
import {
  boardCursorConfirmIntent,
  hideBoardCursor,
  initialBoardCursorCoord,
  isBoardCursorDirectionCommand,
  moveBoardCursorCoord,
  type BoardCursorSelection,
  type BoardCursorState,
} from "../../boardCursor";
import {
  buildingAt,
  buildingEffectIsActivated,
  cardTargetForTile,
  distance,
  handForSide,
  isLegalAttack,
  isLegalMove,
  piecesInMatch,
  pieceAt,
  pieceById,
  sameTeam,
  tileAt,
} from "../../matchBoardHelpers";
import type {
  Card,
  HexTile,
  MatchActionRequest,
  MatchState,
  Side,
} from "../../types";
import type { HotkeyHandlers } from "../../hotkeyRuntime";

type MatchBoardControllerOptions = {
  match: MatchState | null;
  viewerSide: Side;
  submitAction: (action: MatchActionRequest) => void;
  readOnly?: boolean;
  cursorDisabled?: boolean;
  contextMenuDisabled?: boolean;
  onNotice?: (message: string | null) => void;
};

export function useMatchBoardController({
  match,
  viewerSide,
  submitAction,
  readOnly = false,
  cursorDisabled = readOnly,
  contextMenuDisabled = readOnly,
  onNotice,
}: MatchBoardControllerOptions) {
  const [selection, setSelection] = useState<Selection>(null);
  const [boardCursor, setBoardCursor] = useState<BoardCursorState>(() => ({
    coord: match ? initialBoardCursorCoord(match, viewerSide) : null,
    visible: false,
  }));
  const [focusedUnitPieceId, setFocusedUnitPieceId] = useState<string | null>(null);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [playedCardId, setPlayedCardId] = useState<string | null>(null);
  const [unitModalPieceId, setUnitModalPieceId] = useState<string | null>(null);
  const [unitContextMenu, setUnitContextMenu] = useState<UnitContextMenu>(null);

  const selectedCard = useMemo(() => {
    if (!match || selection?.type !== "card") {
      return null;
    }

    return handForSide(match, viewerSide).find((card) => card.id === selection.cardId) ?? null;
  }, [match, selection, viewerSide]);

  const selectedPiece = useMemo(() => {
    if (!match || selection?.type !== "piece") {
      return null;
    }

    return pieceById(match, selection.pieceId);
  }, [match, selection]);

  const modalUnit = useMemo<BoardUnit | null>(() => {
    if (!match || unitModalPieceId === null) {
      return null;
    }

    const piece = pieceById(match, unitModalPieceId);
    return piece?.pieceType === "unit" ? piece : null;
  }, [match, unitModalPieceId]);

  const contextMenuUnit = useMemo<BoardPiece | null>(() => {
    if (!match || unitContextMenu === null) {
      return null;
    }

    const piece = pieceById(match, unitContextMenu.pieceId);
    return piece;
  }, [match, unitContextMenu]);

  const focusedUnit = useMemo<BoardPiece | null>(() => {
    if (!match || focusedUnitPieceId === null) {
      return null;
    }

    const piece = pieceById(match, focusedUnitPieceId);
    return piece?.pieceType === "unit" ? piece : null;
  }, [match, focusedUnitPieceId]);

  useEffect(() => {
    if (!match || boardCursor.coord) {
      return;
    }

    setBoardCursor({ coord: initialBoardCursorCoord(match, viewerSide), visible: false });
  }, [boardCursor.coord, match, viewerSide]);

  function clearTransientState() {
    setSelection(null);
    setFocusedUnitPieceId(null);
    setDraggedCardId(null);
    setPlayedCardId(null);
    setUnitModalPieceId(null);
    setUnitContextMenu(null);
  }

  function selectCard(card: Card) {
    setUnitContextMenu(null);
    setFocusedUnitPieceId(null);
    setSelection((current) =>
      current?.type === "card" && current.cardId === card.id ? null : { type: "card", cardId: card.id },
    );
    setUnitModalPieceId(null);
    onNotice?.(null);
  }

  function selectPiece(pieceId: string) {
    setSelection({ type: "piece", pieceId });
    setBoardCursor((current) => hideBoardCursor(current));
    onNotice?.(null);
  }

  function cancelTransientState() {
    const hadContext =
      selection !== null ||
      boardCursor.visible ||
      draggedCardId !== null ||
      playedCardId !== null ||
      unitModalPieceId !== null ||
      unitContextMenu !== null;
    if (!hadContext) {
      return false;
    }

    setSelection(null);
    setBoardCursor(hideBoardCursor);
    setDraggedCardId(null);
    setPlayedCardId(null);
    setUnitModalPieceId(null);
    setUnitContextMenu(null);
    onNotice?.(null);
    return true;
  }

  function handleTileClick(tile: HexTile) {
    if (!match || readOnly || match.phase === "matchOver") {
      return;
    }

    setUnitContextMenu(null);
    const piece = pieceAt(match, tile.coord);
    setFocusedUnitPieceId(piece?.id ?? null);
    const building = buildingAt(match, tile.coord);

    if (selectedCard) {
      const target = cardTargetForTile(match, viewerSide, selectedCard, tile);
      if (target) {
        setPlayedCardId(selectedCard.id);
        submitAction({ type: "playCard", cardId: selectedCard.id, target });
      } else {
        onNotice?.("That card cannot target this hex.");
      }
      return;
    }

    if (selectedPiece) {
      if (!piece && isLegalMove(match, viewerSide, selectedPiece, tile.coord)) {
        submitAction({ type: "movePiece", pieceId: selectedPiece.id, to: tile.coord });
        return;
      }

      if (piece && isLegalAttack(match, viewerSide, selectedPiece, piece)) {
        submitAction({ type: "attack", attackerId: selectedPiece.id, targetId: piece.id });
        return;
      }
    }

    if (
      building &&
      !selectedPiece &&
      buildingEffectIsActivated(building.effect) &&
      !building.activatedThisTurn &&
      match.actionStack.length === 0 &&
      match.activeSide === viewerSide &&
      piece?.side === viewerSide &&
      piece.apRemaining > 0
    ) {
      submitAction({ type: "activateBuilding", buildingId: building.id });
      return;
    }

    if (piece?.side === viewerSide) {
      setSelection({ type: "piece", pieceId: piece.id });
      onNotice?.(null);
      return;
    }

    setSelection(null);
    setUnitModalPieceId(null);
  }

  function handleCardDragStart(card: Card) {
    setUnitContextMenu(null);
    setFocusedUnitPieceId(null);
    setSelection({ type: "card", cardId: card.id });
    setDraggedCardId(card.id);
    setUnitModalPieceId(null);
    onNotice?.(null);
  }

  function handleCardDragEnd() {
    setDraggedCardId(null);
  }

  function handleCardDrop(tile: HexTile, cardId: string) {
    if (!match || readOnly || match.phase === "matchOver") {
      return;
    }

    const card = handForSide(match, viewerSide).find((candidate) => candidate.id === cardId);
    if (!card) {
      onNotice?.("That card is no longer in your hand.");
      setDraggedCardId(null);
      return;
    }

    const target = cardTargetForTile(match, viewerSide, card, tile);
    if (target) {
      setPlayedCardId(card.id);
      submitAction({ type: "playCard", cardId: card.id, target });
    } else {
      onNotice?.("That card cannot target this hex.");
    }
    setDraggedCardId(null);
  }

  function openUnitContextMenu(unit: BoardPiece, x: number, y: number) {
    if (!match || contextMenuDisabled || match.phase === "matchOver") {
      return;
    }

    setUnitContextMenu({ pieceId: unit.id, x, y });
    setFocusedUnitPieceId(unit.id);
  }

  function handleActivateUnitItem(unit: BoardPiece, itemId: string) {
    setUnitContextMenu(null);
    const item = (unit.items ?? []).find((candidate) => candidate.id === itemId);
    const damageActive = item?.active?.type === "damageTarget" ? item.active : null;
    const target = damageActive && match
      ? piecesInMatch(match)
          .filter((piece) => !sameTeam(piece.side, unit.side))
          .filter((piece) => distance(unit.position, piece.position) <= damageActive.range)
          .sort((a, b) => distance(unit.position, a.position) - distance(unit.position, b.position))[0]
      : null;
    if (!readOnly) {
      submitAction({
        type: "activateItem",
        carrierId: unit.id,
        itemId,
        target: target ? { type: "piece", pieceId: target.id } : null,
      });
    }
  }

  function handleActivateUnitBuilding(buildingId: string) {
    setUnitContextMenu(null);
    if (!readOnly) {
      submitAction({ type: "activateBuilding", buildingId });
    }
  }

  function moveKeyboardCursor(commandId: Parameters<typeof moveBoardCursorCoord>[1]) {
    if (!isBoardCursorDirectionCommand(commandId) || !match || cursorDisabled || match.phase === "matchOver") {
      return false;
    }

    const radius = match.board.radius;
    const currentCoord = boardCursor.coord ?? initialBoardCursorCoord(match, viewerSide);
    const coord = moveBoardCursorCoord(currentCoord, commandId, radius);
    const piece = pieceAt(match, coord);
    setBoardCursor({ coord, visible: true });
    setFocusedUnitPieceId(piece?.id ?? null);
    setUnitContextMenu(null);
    onNotice?.(null);
    return true;
  }

  function confirmKeyboardCursor() {
    if (!match || readOnly || match.phase === "matchOver") {
      return false;
    }

    const coord = boardCursor.coord ?? initialBoardCursorCoord(match, viewerSide);
    const tile = tileAt(match, coord);
    if (!tile) {
      return false;
    }

    const piece = pieceAt(match, coord);
    const intent = boardCursorConfirmIntent({
      coord,
      selection: selection as BoardCursorSelection,
      focusedPiece: piece ? { id: piece.id, side: piece.side } : null,
      viewerSide,
    });

    setBoardCursor({ coord, visible: true });

    if (intent.type === "selectPiece") {
      setSelection({ type: "piece", pieceId: intent.pieceId });
      setFocusedUnitPieceId(piece?.id ?? null);
      setUnitContextMenu(null);
      setUnitModalPieceId(null);
      onNotice?.(null);
      return true;
    }

    if (intent.type === "targetHex") {
      handleTileClick(tile);
      return true;
    }

    return false;
  }

  function openFocusedUnitInfo() {
    const unit = contextMenuUnit ?? (selectedPiece?.pieceType === "unit" ? selectedPiece : null) ?? (focusedUnit?.pieceType === "unit" ? focusedUnit : null);
    if (!unit) {
      return false;
    }

    setUnitModalPieceId(unit.id);
    setUnitContextMenu(null);
    return true;
  }

  const cursorHotkeyHandlers = useMemo<Pick<
    HotkeyHandlers,
    | "cancel"
    | "cursorNorthwest"
    | "cursorNortheast"
    | "cursorEast"
    | "cursorWest"
    | "cursorSouthwest"
    | "cursorSoutheast"
    | "confirm"
    | "openCardInfo"
  >>(
    () => ({
      cancel: cancelTransientState,
      cursorNorthwest: () => moveKeyboardCursor("cursorNorthwest"),
      cursorNortheast: () => moveKeyboardCursor("cursorNortheast"),
      cursorEast: () => moveKeyboardCursor("cursorEast"),
      cursorWest: () => moveKeyboardCursor("cursorWest"),
      cursorSouthwest: () => moveKeyboardCursor("cursorSouthwest"),
      cursorSoutheast: () => moveKeyboardCursor("cursorSoutheast"),
      confirm: confirmKeyboardCursor,
      openCardInfo: openFocusedUnitInfo,
    }),
    [
      boardCursor,
      contextMenuUnit,
      draggedCardId,
      focusedUnit,
      match,
      playedCardId,
      cursorDisabled,
      readOnly,
      selectedPiece,
      selection,
      unitContextMenu,
      unitModalPieceId,
    ],
  );

  return {
    boardCursor,
    clearTransientState,
    contextMenuUnit,
    draggedCardId,
    focusedUnit,
    focusedUnitPieceId,
    handleActivateUnitBuilding,
    handleActivateUnitItem,
    handleCardDragEnd,
    handleCardDragStart,
    handleCardDrop,
    handleTileClick,
    modalUnit,
    openUnitContextMenu,
    cursorHotkeyHandlers,
    playedCardId,
    selectCard,
    selectPiece,
    selectedCard,
    selectedPiece,
    selection,
    setBoardCursor,
    setDraggedCardId,
    setFocusedUnitPieceId,
    setPlayedCardId,
    setSelection,
    setUnitContextMenu,
    setUnitModalPieceId,
    unitContextMenu,
    unitModalPieceId,
  };
}
