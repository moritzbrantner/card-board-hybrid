import { useMemo, useState } from "react";

import type { BoardUnit, Selection, UnitContextMenu } from "../../appTypes";
import {
  hideBoardCursor,
  initialBoardCursorCoord,
  type BoardCursorState,
} from "../../boardCursor";
import {
  buildingAt,
  buildingEffectIsActivated,
  cardTargetForTile,
  handForSide,
  isLegalAttack,
  isLegalMove,
  pieceAt,
  pieceById,
} from "../../matchBoardHelpers";
import type {
  Card,
  HexTile,
  MatchActionRequest,
  MatchState,
  Side,
} from "../../types";

type MatchBoardControllerOptions = {
  match: MatchState | null;
  viewerSide: Side;
  submitAction: (action: MatchActionRequest) => void;
  readOnly?: boolean;
};

export function useMatchBoardController({
  match,
  viewerSide,
  submitAction,
  readOnly = false,
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

  const modalUnit = useMemo(() => {
    if (!match || unitModalPieceId === null) {
      return null;
    }

    const piece = pieceById(match, unitModalPieceId);
    return piece?.pieceType === "unit" ? piece : null;
  }, [match, unitModalPieceId]);

  const contextMenuUnit = useMemo(() => {
    if (!match || unitContextMenu === null) {
      return null;
    }

    const piece = pieceById(match, unitContextMenu.pieceId);
    return piece?.pieceType === "unit" ? piece : null;
  }, [match, unitContextMenu]);

  const focusedUnit = useMemo(() => {
    if (!match || focusedUnitPieceId === null) {
      return null;
    }

    const piece = pieceById(match, focusedUnitPieceId);
    return piece?.pieceType === "unit" ? piece : null;
  }, [match, focusedUnitPieceId]);

  function clearTransientState() {
    setSelection(null);
    setFocusedUnitPieceId(null);
    setDraggedCardId(null);
    setPlayedCardId(null);
    setUnitModalPieceId(null);
    setUnitContextMenu(null);
  }

  function selectCard(card: Card) {
    setSelection({ type: "card", cardId: card.id });
    setBoardCursor((current) => hideBoardCursor(current));
  }

  function selectPiece(pieceId: string) {
    setSelection({ type: "piece", pieceId });
    setBoardCursor((current) => hideBoardCursor(current));
  }

  function handleTileClick(tile: HexTile) {
    if (!match || readOnly || match.phase === "matchOver") {
      return;
    }

    const piece = pieceAt(match, tile.coord);
    const building = buildingAt(match, tile.coord);

    if (selectedCard) {
      const target = cardTargetForTile(match, viewerSide, selectedCard, tile);
      if (target) {
        setPlayedCardId(selectedCard.id);
        submitAction({ type: "playCard", cardId: selectedCard.id, target });
        setSelection(null);
      }
      return;
    }

    if (selectedPiece) {
      if (!piece && isLegalMove(match, viewerSide, selectedPiece, tile.coord)) {
        submitAction({ type: "movePiece", pieceId: selectedPiece.id, to: tile.coord });
        setSelection(null);
        return;
      }

      if (piece && isLegalAttack(match, viewerSide, selectedPiece, piece)) {
        submitAction({ type: "attack", attackerId: selectedPiece.id, targetId: piece.id });
        setSelection(null);
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
      setSelection(null);
      return;
    }

    if (piece?.side === viewerSide) {
      selectPiece(piece.id);
      if (piece.pieceType === "unit") {
        setFocusedUnitPieceId(piece.id);
      }
      return;
    }

    setSelection(null);
    setUnitModalPieceId(null);
  }

  function handleCardDragStart(cardId: string) {
    setDraggedCardId(cardId);
  }

  function handleCardDragEnd() {
    setDraggedCardId(null);
  }

  function handleCardDrop(card: Card, tile: HexTile) {
    if (!match || readOnly) {
      return;
    }

    const target = cardTargetForTile(match, viewerSide, card, tile);
    if (target) {
      setPlayedCardId(card.id);
      submitAction({ type: "playCard", cardId: card.id, target });
      setSelection(null);
    }
    setDraggedCardId(null);
  }

  function openUnitContextMenu(unit: BoardUnit, x: number, y: number) {
    setUnitContextMenu({ pieceId: unit.id, x, y });
  }

  function handleActivateUnitItem(unit: BoardUnit, itemId: string) {
    if (!readOnly) {
      submitAction({ type: "activateItem", unitId: unit.id, itemId });
    }
  }

  function handleActivateUnitBuilding(buildingId: string) {
    if (!readOnly) {
      submitAction({ type: "activateBuilding", buildingId });
    }
  }

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
