import type { BoardAnimationCue, PieceAnimation } from "./boardAnimations";
import type { BoardPiece } from "./appTypes";
import type { BoardTutorialHighlight, TutorialHighlightTone } from "./tutorial/tutorialHighlights";
import { sameTutorialCoord } from "./tutorial/tutorialHighlights";
import type {
  Building,
  Card,
  HexCoord,
  HexTile,
  MatchState,
  Side,
} from "./types";
import {
  buildingAt,
  coordKey,
  droppedItemsAt,
  groupTilesByColumn,
  isLegalAttack,
  isLegalCardTarget,
  isLegalMove,
  isManaSourceAt,
  pieceAt,
  pieceStatLabel,
  piecesForAnimation,
  piecesInMatch,
  sameCoord,
  tileTitle,
} from "./matchBoardHelpers";
import { viewerSideShortLabel } from "./labels";
import type { TargetingIndicator } from "./targetingIndicators";
import {
  selectedTargetingIndicators,
  stackTargetingIndicators,
} from "./targetingIndicators";

export type BoardSurfaceTileInteraction = {
  coord: HexCoord;
  title: string;
  disabled: boolean;
  isLegal: boolean;
  isSelected: boolean;
  isFocused?: boolean;
  tutorialHighlightTone?: TutorialHighlightTone;
  hasManaSource?: boolean;
  hasBuilding?: boolean;
  hasPiece: boolean;
  pieceSide?: Side;
  pieceType?: BoardPiece["pieceType"];
  pieceLabel?: string;
  pieceStatLabel?: string;
  droppedItemCount?: number;
};

export type BoardSurfaceTile = BoardSurfaceTileInteraction & {
  key: string;
  tile: HexTile;
  piece: BoardPiece | null;
  displayPiece: BoardPiece | null;
  droppedItems: NonNullable<MatchState["board"]["droppedItems"]>;
  building: Building | null;
  occupantClass: string;
};

export type BoardSurfaceColumn = {
  q: number;
  tiles: BoardSurfaceTile[];
};

export type BoardSurface = {
  tiles: HexTile[];
  columns: BoardSurfaceColumn[];
  pieces: BoardPiece[];
  animationByPieceId: Map<string, PieceAnimation>;
  tileByKey: Map<string, BoardSurfaceTile>;
  tileInteractions: BoardSurfaceTileInteraction[];
  selectedIndicators: TargetingIndicator[];
  stackIndicators: TargetingIndicator[];
  targetingIndicators: TargetingIndicator[];
};

export type BoardSurfaceOptions = {
  match: MatchState;
  viewerSide: Side;
  selectedCard: Card | null;
  selectedPiece: BoardPiece | null;
  focusedCoord: HexCoord | null;
  hoveredCoord: HexCoord | null;
  isInteractive: boolean;
  tutorialHighlights?: BoardTutorialHighlight[];
  animation?: BoardAnimationCue | null;
  activeStackItemId?: string | null;
};

export function buildBoardSurface({
  match,
  viewerSide,
  selectedCard,
  selectedPiece,
  focusedCoord,
  hoveredCoord,
  isInteractive,
  tutorialHighlights = [],
  animation = null,
  activeStackItemId = null,
}: BoardSurfaceOptions): BoardSurface {
  const pieces = piecesForAnimation(piecesInMatch(match), animation);
  const displayPieceByCoord = new Map(pieces.map((piece) => [coordKey(piece.position), piece]));
  const animationByPieceId = new Map(
    (animation?.pieces ?? []).map((pieceAnimation) => [
      pieceAnimation.pieceId,
      pieceAnimation,
    ]),
  );
  const selectedIndicators = selectedTargetingIndicators({
    match,
    viewerSide,
    selectedCard,
    selectedPiece,
    focusedCoord,
    hoveredCoord,
  });
  const stackIndicators = stackTargetingIndicators(match);
  const targetingIndicators = activeStackItemId
    ? stackIndicators.filter(
        (indicator) =>
          indicator.source.type === "stack" &&
          indicator.source.stackItemId === activeStackItemId,
      )
    : [...stackIndicators, ...selectedIndicators];

  const surfaceTiles = match.board.tiles.map((tile): BoardSurfaceTile => {
    const key = coordKey(tile.coord);
    const piece = pieceAt(match, tile.coord);
    const displayPiece = displayPieceByCoord.get(key) ?? piece;
    const droppedItems = droppedItemsAt(match, tile.coord);
    const hasManaSource = isManaSourceAt(match, tile.coord);
    const building = buildingAt(match, tile.coord);
    const hasBuilding = !!building;
    const isLegal =
      isInteractive &&
      ((selectedCard && isLegalCardTarget(match, viewerSide, selectedCard, tile.coord, piece)) ||
        (selectedPiece &&
          ((!piece && isLegalMove(match, viewerSide, selectedPiece, tile.coord)) ||
            (piece && isLegalAttack(match, viewerSide, selectedPiece, piece)))));
    const isSelected = Boolean(piece && selectedPiece && piece.id === selectedPiece.id);
    const isFocused = focusedCoord ? sameCoord(tile.coord, focusedCoord) : false;
    const tutorialHighlightTone = tutorialHighlightForTile(
      tile.coord,
      piece?.id ?? null,
      tutorialHighlights,
    );
    const occupantClass = displayPiece ? `occupied occupied-${displayPiece.side}` : "";
    const baseTitle = tileTitle(tile, piece, viewerSide, droppedItems.length, hasManaSource);
    const title = building ? `${baseTitle}, building ${building.name}` : baseTitle;

    return {
      key,
      tile,
      coord: tile.coord,
      title,
      disabled: !isInteractive,
      isLegal: Boolean(isLegal),
      isSelected,
      isFocused,
      tutorialHighlightTone,
      hasManaSource,
      hasBuilding,
      hasPiece: Boolean(displayPiece),
      pieceSide: displayPiece?.side,
      pieceType: displayPiece?.pieceType,
      pieceLabel: displayPiece ? viewerSideShortLabel(displayPiece.side, viewerSide) : undefined,
      pieceStatLabel: displayPiece ? pieceStatLabel(displayPiece) : undefined,
      droppedItemCount: droppedItems.length || undefined,
      piece,
      displayPiece,
      droppedItems,
      building,
      occupantClass,
    };
  });
  const tileByKey = new Map(surfaceTiles.map((tile) => [tile.key, tile]));
  const columns = groupTilesByColumn(match.board.tiles).map((column) => ({
    q: column.q,
    tiles: column.tiles.map((tile) => tileByKey.get(coordKey(tile.coord))!),
  }));

  return {
    tiles: match.board.tiles,
    columns,
    pieces,
    animationByPieceId,
    tileByKey,
    tileInteractions: surfaceTiles,
    selectedIndicators,
    stackIndicators,
    targetingIndicators,
  };
}

function tutorialHighlightForTile(
  coord: HexCoord,
  pieceId: string | null,
  highlights: BoardTutorialHighlight[],
): TutorialHighlightTone | undefined {
  return highlights.find((highlight) => {
    if (highlight.kind === "coord") {
      return sameTutorialCoord(highlight.coord, coord);
    }

    return pieceId !== null && highlight.pieceId === pieceId;
  })?.tone;
}
