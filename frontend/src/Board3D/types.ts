import type { ProjectedBoardPosition } from "../boardRenderer";
import type { MatchVisualCatalog } from "../matchVisualIdentity";
import type { TargetingIndicator } from "../targetingIndicators";
import type { TutorialHighlightTone } from "../tutorial/tutorialHighlights";
import type { HexCoord, HexTile, HeroType, Side, Unit } from "../types";
import type { BoardAnimationCue } from "../boardAnimations";
import type { BoardPieceVisualManifest } from "../board3dModelManifest";

export type Board3DHero = {
  pieceType: "hero";
  id: string;
  side: Side;
  name: string;
  heroType: HeroType;
  hp: number;
  maxHp: number;
  attack: number;
  attackRange: number;
  position: HexCoord;
  apRemaining: number;
  maxAp: number;
  hasAttacked: boolean;
};

export type Board3DUnit = {
  pieceType: "unit";
  id: string;
  side: Side;
  name: string;
  templateId?: string;
  attack: number;
  attackRange: number;
  armor: number;
  maxArmor: number;
  position: HexCoord;
  apRemaining: number;
  maxAp: number;
  hasAttacked: boolean;
  items: Unit["items"];
};

export type Board3DPiece = Board3DHero | Board3DUnit;

export type Board3DTileInteraction = {
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
  pieceType?: Board3DPiece["pieceType"];
  pieceLabel?: string;
  pieceStatLabel?: string;
  droppedItemCount?: number;
};

export type BoardProjectedPosition = ProjectedBoardPosition;

export type Board3DRendererProps = {
  tiles: HexTile[];
  pieces: Board3DPiece[];
  visualCatalog: MatchVisualCatalog;
  readOnly: boolean;
  disabled: boolean;
  tileInteractions: Board3DTileInteraction[];
  targetingIndicators: TargetingIndicator[];
  animation?: BoardAnimationCue | null;
  onTileClick?: (tile: HexTile) => void;
  onTileDrop?: (tile: HexTile, cardId: string) => void;
  onTileContextMenu?: (tile: HexTile, event: { clientX: number; clientY: number }) => void;
  onTileHoverChange?: (coord: HexCoord | null) => void;
  onFatalRenderError: () => void;
  onAssetFailure?: (path: string) => void;
  manifest?: BoardPieceVisualManifest;
};
