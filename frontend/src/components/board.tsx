import {
  Footprints,
  Heart,
  LibraryBig,
  Shield,
  Sparkles,
  Sword,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import { Board3DRenderer, type Board3DTileInteraction } from "../Board3D";
import type { BoardAnimationCue, PieceAnimation } from "../boardAnimations";
import {
  boardRendererFallbackMessage,
  canCreateWebGLContext,
  isBoardRendererInteractive,
  selectBoardRenderer,
  type BoardRendererFallbackReason,
} from "../boardRenderer";
import { createMatchVisualCatalog, type CardVisualIdentity, type MatchVisualCatalog, type UnitVisualIdentity, type HeroVisualIdentity } from "../matchVisualIdentity";
import type { BoardPiece, BoardUnit, UnitContextMenu } from "../appTypes";
import type {
  BoardVisualMode,
  Card,
  HexCoord,
  HexTile,
  MatchParticipantState,
  MatchState,
  Side,
  StackItem,
} from "../types";
import type { BoardTutorialHighlight, TutorialHighlightTone } from "../tutorial/tutorialHighlights";
import { sameTutorialCoord } from "../tutorial/tutorialHighlights";
import { DetailStat } from "./common";
import {
  coordKey,
  droppedItemsAt,
  groupTilesByColumn,
  isLegalAttack,
  isLegalCardTarget,
  isLegalMove,
  isManaSourceAt,
  pieceAnimationFeedback,
  pieceAnimationStyle,
  pieceAt,
  pieceStatLabel,
  piecesForAnimation,
  piecesInMatch,
  sameCoord,
  tileTitle,
} from "../matchBoardHelpers";
import {
  itemActiveLabel,
  itemPassiveLabel,
  kindSummary,
  sideLabel,
  stackItemTitle,
  viewerSideShortLabel,
  heroTypeLabel,
} from "../labels";

const EMPTY_MATCH_VISUAL_CATALOG = createMatchVisualCatalog([]);

export function UnitContextMenuView({
  menu,
  unit,
  onClose,
  onOpenCardInfo,
  canActivateItems,
  onActivateItem,
}: {
  menu: Exclude<UnitContextMenu, null>;
  unit: BoardUnit;
  onClose: () => void;
  onOpenCardInfo: () => void;
  canActivateItems: boolean;
  onActivateItem: (itemId: string) => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    function handlePointerDown() {
      onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [onClose]);

  return (
    <div
      className="unit-context-menu"
      role="menu"
      aria-label={`${unit.name} actions`}
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button type="button" role="menuitem" onClick={onOpenCardInfo}>
        <LibraryBig size={15} />
        Card info
      </button>
      {unit.items
        .filter((item) => item.active)
        .map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={!canActivateItems || unit.apRemaining === 0 || item.activeUsedThisTurn}
            onClick={() => onActivateItem(item.id)}
          >
            <Sparkles size={15} />
            {item.name}
          </button>
        ))}
    </div>
  );
}

export function UnitCardModal({
  unit,
  unitVisualIdentity,
  onClose,
}: {
  unit: BoardUnit;
  unitVisualIdentity: UnitVisualIdentity;
  onClose: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className={`unit-modal ${unitVisualIdentity.rarity === "unknown" ? "basic unknown" : unitVisualIdentity.rarity}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unit-modal-title"
      >
        <button className="icon-button modal-close" type="button" onClick={onClose} title="Close">
          <X size={18} />
        </button>
        {unitVisualIdentity.portraitPath ? (
          <img src={unitVisualIdentity.portraitPath} alt={unitVisualIdentity.portraitAlt} />
        ) : (
          <div className="unit-modal-art-placeholder" aria-hidden="true">
            <span>{unitVisualIdentity.fallbackLabel}</span>
          </div>
        )}
        <div className="unit-modal-body">
          <div>
            <p className="eyebrow">
              {unit.side === "player" ? "Your" : "Opponent"} unit
              {unitVisualIdentity.rarity === "unknown" ? " · Card unknown" : ` · ${unitVisualIdentity.rarity}`}
            </p>
            <h2 id="unit-modal-title">{unitVisualIdentity.name}</h2>
          </div>

          <div className="detail-stat-row">
            {unitVisualIdentity.baseStats ? (
              <>
                <DetailStat label="Cost" value={unitVisualIdentity.baseStats.cost} />
                <DetailStat label="Base Attack" value={unitVisualIdentity.baseStats.attack} />
                <DetailStat label="Base Armor" value={unitVisualIdentity.baseStats.armor} />
                <DetailStat label="Base AP" value={unitVisualIdentity.baseStats.maxAp} />
              </>
            ) : (
              <DetailStat label="Card" value="Unknown" />
            )}
          </div>

          <div className="detail-stat-row live-stat-row">
            <DetailStat label="Attack" value={unit.attack} />
            {unit.attackRange > 1 ? <DetailStat label="Range" value={unit.attackRange} /> : null}
            <DetailStat label="Armor" value={`${unit.armor}/${unit.maxArmor}`} />
            <DetailStat label="AP" value={`${unit.apRemaining}/${unit.maxAp}`} />
            <DetailStat label="Attacked" value={unit.hasAttacked ? "Yes" : "No"} />
            <DetailStat label="Items" value={unit.items.length} />
          </div>

          {unit.items.length > 0 ? (
            <div className="unit-item-list" aria-label="Carried items">
              {unit.items.map((item) => (
                <p key={item.id}>
                  <strong>{item.name}</strong>
                  <span>{itemPassiveLabel(item.passive)}</span>
                  {item.active ? <span>{itemActiveLabel(item.active)}</span> : null}
                </p>
              ))}
            </div>
          ) : null}

          <p className="detail-rules">
            {unitVisualIdentity.baseStats?.text ??
              "This unit came from an older match without saved card metadata."}
          </p>
        </div>
      </section>
    </div>
  );
}

export function PileDisplay({
  icon,
  label,
  count,
  status,
}: {
  icon: ReactNode;
  label: string;
  count: number;
  status: string;
}) {
  return (
    <div className="pile-display">
      <span className="pile-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="pile-label">{label}</span>
      <strong>{count}</strong>
      <span className="pile-status">{status}</span>
    </div>
  );
}

export function StackDisplay({
  stack,
  prioritySide,
}: {
  stack: StackItem[];
  prioritySide: Side | null;
}) {
  if (stack.length === 0) {
    return null;
  }

  return (
    <section className="stack-panel" aria-label="Pending stack">
      <div className="stack-panel-header">
        <span>Stack</span>
        <strong>{sideLabel(prioritySide)} priority</strong>
      </div>
      <ol>
        {[...stack].reverse().map((item) => (
          <li key={item.id}>
            <span>{stackItemTitle(item)}</span>
            <strong>Priority {item.priority}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}


export function PlayerBadge({ player }: { player: MatchParticipantState }) {
  return (
    <div className={`player-badge ${player.side}`}>
      <strong>{sideLabel(player.side)}</strong>
      <span className="hero-type-pill">
        <WandSparkles size={16} />
        {heroTypeLabel(player.hero.heroType)}
      </span>
      <span>
        <Heart size={16} />
        {player.hero.hp}/{player.hero.maxHp}
      </span>
      <span>
        <Zap size={16} />
        {player.hero.apRemaining}/{player.hero.maxAp}
      </span>
      <span>
        <Sparkles size={16} />
        {player.mana}/{player.maxMana}
      </span>
    </div>
  );
}

export function OpponentHandDisplay({ count }: { count: number }) {
  const visibleBacks = Math.min(count, 7);

  return (
    <div className="opponent-hand-display" aria-label={`Enemy hand, ${count} cards`}>
      <span className="opponent-hand-label">Enemy hand</span>
      <div className="opponent-card-backs" aria-hidden="true">
        {Array.from({ length: visibleBacks }, (_, index) => (
          <span className="opponent-card-back" key={index} />
        ))}
      </div>
      <strong>{count}</strong>
    </div>
  );
}

export function Board({
  match,
  animation,
  boardVisualMode,
  viewerSide,
  visualCatalog = EMPTY_MATCH_VISUAL_CATALOG,
  selectedCard,
  selectedPiece,
  focusedCoord,
  disabled,
  readOnly = false,
  onTileClick,
  onTileDrop,
  onUnitContextMenu,
  onFocusedUnitChange,
  tutorialHighlights = [],
}: {
  match: MatchState;
  animation?: BoardAnimationCue | null;
  boardVisualMode: BoardVisualMode;
  viewerSide: Side;
  visualCatalog?: MatchVisualCatalog;
  selectedCard: Card | null;
  selectedPiece: BoardPiece | null;
  focusedCoord?: HexCoord | null;
  disabled: boolean;
  readOnly?: boolean;
  onTileClick?: (tile: HexTile) => void;
  onTileDrop?: (tile: HexTile, cardId: string) => void;
  onUnitContextMenu?: (unit: BoardUnit, position: { x: number; y: number }) => void;
  onFocusedUnitChange?: (pieceId: string | null) => void;
  tutorialHighlights?: BoardTutorialHighlight[];
}) {
  const [webglFailed, setWebglFailed] = useState(
    () => boardVisualMode === "3d" && !canCreateWebGLContext(),
  );
  const [rendererFallbackReason, setRendererFallbackReason] =
    useState<BoardRendererFallbackReason | null>(() =>
      boardVisualMode === "3d" && !canCreateWebGLContext() ? "webgl-unavailable" : null,
    );
  const [assetFailureCount, setAssetFailureCount] = useState(0);
  const renderer = selectBoardRenderer({
    requestedMode: boardVisualMode,
    webglFailed,
    readOnly,
  });
  const isInteractive = isBoardRendererInteractive({ renderer, readOnly, disabled });
  const columns = groupTilesByColumn(match.board.tiles);
  const [visibleAnimation, setVisibleAnimation] = useState<BoardAnimationCue | null>(animation ?? null);
  const pieces = piecesForAnimation(piecesInMatch(match), visibleAnimation);
  const displayPieceByCoord = useMemo(
    () => new Map(pieces.map((piece) => [coordKey(piece.position), piece])),
    [pieces],
  );
  const animationByPieceId = useMemo(
    () => new Map((visibleAnimation?.pieces ?? []).map((pieceAnimation) => [pieceAnimation.pieceId, pieceAnimation])),
    [visibleAnimation],
  );
  const tileInteractions = match.board.tiles.map((tile): Board3DTileInteraction => {
    const piece = pieceAt(match, tile.coord);
    const hasManaSource = isManaSourceAt(match, tile.coord);
    const isLegal =
      isInteractive &&
      ((selectedCard && isLegalCardTarget(match, viewerSide, selectedCard, tile.coord, piece)) ||
        (selectedPiece &&
          ((!piece && isLegalMove(match, viewerSide, selectedPiece, tile.coord)) ||
            (piece && isLegalAttack(match, viewerSide, selectedPiece, piece)))));
    const isSelected = piece?.id === selectedPiece?.id;
    const isFocused = focusedCoord ? sameCoord(tile.coord, focusedCoord) : false;
    const tutorialHighlightTone = tutorialHighlightForTile(tile.coord, piece?.id ?? null, tutorialHighlights);

    return {
      coord: tile.coord,
      title: tileTitle(tile, piece, viewerSide, 0, hasManaSource),
      disabled: !isInteractive,
      isLegal: Boolean(isLegal),
      isSelected,
      isFocused,
      tutorialHighlightTone,
      hasManaSource,
      hasPiece: Boolean(piece),
      pieceSide: piece?.side,
      pieceType: piece?.pieceType,
      pieceLabel: piece ? viewerSideShortLabel(piece.side, viewerSide) : undefined,
      pieceStatLabel: piece ? pieceStatLabel(piece) : undefined,
    };
  });

  useEffect(() => {
    if (boardVisualMode === "2d") {
      setWebglFailed(false);
      setRendererFallbackReason(null);
      setAssetFailureCount(0);
      return;
    }

    if (!canCreateWebGLContext()) {
      setWebglFailed(true);
      setRendererFallbackReason("webgl-unavailable");
      return;
    }

    setWebglFailed(false);
    setRendererFallbackReason(null);
  }, [boardVisualMode]);

  useEffect(() => {
    setVisibleAnimation(animation ?? null);
    if (!animation) {
      return;
    }

    const timeoutId = window.setTimeout(
      () => setVisibleAnimation((current) => (current?.sequence === animation.sequence ? null : current)),
      animation.durationMs,
    );

    return () => window.clearTimeout(timeoutId);
  }, [animation]);

  if (renderer === "3d") {
    return (
      <section
        className={`board board-visual-mode-${boardVisualMode} ${readOnly ? "read-only" : ""}`}
        data-board-visual-mode={boardVisualMode}
        data-board-renderer="3d"
        data-board-asset-failures={assetFailureCount}
        aria-label="Hex board"
      >
        {assetFailureCount > 0 ? (
          <div className="board-renderer-notice" role="status">
            Some 3D models are unavailable, so procedural miniatures are shown.
          </div>
        ) : null}
        <Board3DRenderer
          tiles={match.board.tiles}
          pieces={pieces}
          animation={visibleAnimation}
          visualCatalog={visualCatalog}
          readOnly={readOnly}
          disabled={disabled}
          tileInteractions={tileInteractions}
          onTileClick={onTileClick}
          onTileDrop={onTileDrop}
          onTileContextMenu={(tile, event) => {
            const piece = pieceAt(match, tile.coord);
            if (piece?.pieceType !== "unit" || !onUnitContextMenu) {
              return;
            }

            onUnitContextMenu(piece, { x: event.clientX, y: event.clientY });
          }}
          onFatalRenderError={() => {
            setWebglFailed(true);
            setRendererFallbackReason("render-failed");
          }}
          onAssetFailure={() => setAssetFailureCount((count) => count + 1)}
        />
      </section>
    );
  }

  return (
    <section
      className={`board board-visual-mode-${boardVisualMode} ${readOnly ? "read-only" : ""}`}
      data-board-visual-mode={boardVisualMode}
      data-board-renderer="2d"
      aria-label="Hex board"
    >
      {rendererFallbackReason ? (
        <div className="board-renderer-notice" role="status">
          {boardRendererFallbackMessage(rendererFallbackReason)}
        </div>
      ) : null}
      <div className="hex-board">
        {columns.map((column) => (
          <div className="hex-column" key={column.q}>
            {column.tiles.map((tile) => {
              const piece = pieceAt(match, tile.coord);
              const displayPiece = displayPieceByCoord.get(coordKey(tile.coord)) ?? piece;
              const droppedItems = droppedItemsAt(match, tile.coord);
              const hasManaSource = isManaSourceAt(match, tile.coord);
              const interaction = tileInteractions.find(
                (candidate) => coordKey(candidate.coord) === coordKey(tile.coord),
              );
              const isLegal = interaction?.isLegal ?? false;
              const isSelected = piece?.id === selectedPiece?.id;
              const isFocused = focusedCoord ? sameCoord(tile.coord, focusedCoord) : false;
              const tutorialHighlightTone = tutorialHighlightForTile(tile.coord, piece?.id ?? null, tutorialHighlights);
              const occupantClass = displayPiece ? `occupied occupied-${displayPiece.side}` : "";
              const title = tileTitle(tile, piece, viewerSide, droppedItems.length, hasManaSource);

              return (
                <button
                  key={coordKey(tile.coord)}
                  className={`hex-tile ${hasManaSource ? "mana-source" : ""} ${occupantClass} ${isLegal ? "legal" : ""} ${isSelected ? "selected-piece" : ""} ${isFocused ? "keyboard-focused" : ""} ${tutorialHighlightTone ? `tutorial-highlight tutorial-highlight-${tutorialHighlightTone}` : ""}`}
                  type="button"
                  disabled={disabled && !readOnly}
                  tabIndex={readOnly ? -1 : undefined}
                  onFocus={() => onFocusedUnitChange?.(piece?.pieceType === "unit" ? piece.id : null)}
                  onClick={() => onTileClick?.(tile)}
                  onDragOver={(event: ReactDragEvent<HTMLButtonElement>) => {
                    if (readOnly || disabled || !selectedCard || !isLegal) {
                      return;
                    }

                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event: ReactDragEvent<HTMLButtonElement>) => {
                    if (readOnly || disabled || !onTileDrop) {
                      return;
                    }

                    event.preventDefault();
                    const cardId = event.dataTransfer.getData("text/plain");
                    if (cardId) {
                      onTileDrop(tile, cardId);
                    }
                  }}
                  onContextMenu={(event: ReactMouseEvent<HTMLButtonElement>) => {
                    if (readOnly || piece?.pieceType !== "unit" || !onUnitContextMenu) {
                      return;
                    }

                    event.preventDefault();
                    onUnitContextMenu(piece, { x: event.clientX, y: event.clientY });
                  }}
                  title={title}
                  aria-label={title}
                >
                  {hasManaSource ? (
                    <span className="mana-source-marker" aria-hidden="true">
                      M
                    </span>
                  ) : null}
                  {displayPiece ? (
                    <>
                      <span
                        className={`hex-occupant-marker ${displayPiece.side}`}
                        aria-hidden="true"
                      >
                        {viewerSideShortLabel(displayPiece.side, viewerSide)}
                      </span>
                      <PieceToken
                        key={`${displayPiece.id}-${visibleAnimation?.sequence ?? 0}`}
                        piece={displayPiece}
                        animation={animationByPieceId.get(displayPiece.id)}
                        viewerSide={viewerSide}
                        visualCatalog={visualCatalog}
                      />
                    </>
                  ) : null}
                  {droppedItems.length > 0 ? (
                    <span className="dropped-item-count" aria-hidden="true">
                      {droppedItems.length}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

export function PieceToken({
  piece,
  animation,
  viewerSide,
  visualCatalog,
}: {
  piece: BoardPiece;
  animation?: PieceAnimation;
  viewerSide: Side;
  visualCatalog: MatchVisualCatalog;
}) {
  let visualIdentity: UnitVisualIdentity | HeroVisualIdentity;
  let accentClass: string;
  if (piece.pieceType === "hero") {
    const heroVisualIdentity = visualCatalog.hero(piece);
    visualIdentity = heroVisualIdentity;
    accentClass = heroVisualIdentity.accentClass;
  } else {
    const unitVisualIdentity = visualCatalog.unit(piece);
    visualIdentity = unitVisualIdentity;
    accentClass = unitVisualIdentity.rarity;
  }
  const unknownClass = visualIdentity.status === "unknown" ? "unknown" : "";
  const animationClass = animation ? `piece-anim-${animation.kind}` : "";
  const feedbackLabel = pieceAnimationFeedback(animation);

  return (
    <span
      className={`piece-token portrait ${piece.side} ${piece.pieceType} ${accentClass} ${unknownClass} ${animationClass}`}
      style={pieceAnimationStyle(animation)}
      title={visualIdentity.name}
    >
      <span className={`piece-side-badge ${piece.side}`}>
        {viewerSideShortLabel(piece.side, viewerSide)}
      </span>
      <span className="piece-token-portrait" aria-hidden="true">
        {visualIdentity.portraitPath ? (
          <img src={visualIdentity.portraitPath} alt="" />
        ) : (
          <span>{visualIdentity.fallbackLabel}</span>
        )}
      </span>
      <strong>{visualIdentity.fallbackLabel}</strong>
      <span className="piece-token-stat-row">
        <span>
          <Sword size={11} />
          {piece.attack}
        </span>
      {piece.pieceType === "hero" ? (
        <span>
          <Heart size={11} />
          {piece.hp}
        </span>
      ) : (
        <span>
          <Shield size={11} />
          {piece.armor}
        </span>
      )}
      <span>
        <Footprints size={11} />
        {piece.apRemaining}
      </span>
      {piece.pieceType === "unit" && piece.items.length > 0 ? (
        <span>
          <Sparkles size={11} />
          {piece.items.length}
        </span>
      ) : null}
      </span>
      {feedbackLabel ? <span className="piece-feedback">{feedbackLabel}</span> : null}
    </span>
  );
}

export function CardButton({
  card,
  visualIdentity,
  selected,
  dragging = false,
  played = false,
  style,
  disabled,
  onClick,
  onDragStart,
  onDragEnd,
  tutorialTargetId,
  tutorialHighlighted = false,
}: {
  card: Card;
  visualIdentity: CardVisualIdentity;
  selected: boolean;
  dragging?: boolean;
  played?: boolean;
  style?: CSSProperties;
  disabled: boolean;
  onClick: () => void;
  onDragStart?: (event: ReactDragEvent<HTMLButtonElement>) => void;
  onDragEnd?: () => void;
  tutorialTargetId?: string;
  tutorialHighlighted?: boolean;
}) {
  return (
    <button
      className={`card-button ${selected ? "selected" : ""} ${dragging ? "dragging" : ""} ${played ? "played" : ""} ${tutorialHighlighted ? "tutorial-highlight tutorial-highlight-primary" : ""} ${card.rarity}`}
      type="button"
      disabled={disabled}
      draggable={!disabled}
      style={style}
      data-tutorial-target={tutorialTargetId}
      onClick={onClick}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {visualIdentity.artPath ? (
        <img className="card-button-art" src={visualIdentity.artPath} alt={visualIdentity.artAlt} />
      ) : null}
      <span className="card-cost">{card.cost}</span>
      <strong>{card.name}</strong>
      <span className="card-stats">
        <WandSparkles size={13} />
        {card.rarity} · {kindSummary(card)}
      </span>
      <span className="card-text">{card.text}</span>
    </button>
  );
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
