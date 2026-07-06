import { Canvas } from "@react-three/fiber";
import {
  Component,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { BOARD_3D_CAMERA, BOARD_3D_GROUP_ROTATION_Y } from "../boardRenderer";
import { BOARD_PIECE_VISUAL_MANIFEST } from "../board3dModelManifest";
import type { HexCoord, HexTile } from "../types";
import { BoardCameraControls } from "./BoardCameraControls";
import { Board3DHitTarget, ProjectedHitTargetSync } from "./HitTargets";
import { PieceMesh } from "./PieceMesh";
import { TargetingIndicatorLayer } from "./TargetingIndicatorLayer";
import { HexTileMesh } from "./TileMesh";
import { coordKey } from "./geometry";
import type { Board3DRendererProps, BoardProjectedPosition } from "./types";

const CAMERA_DRAG_CLICK_THRESHOLD_PX = 6;

type Board3DErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
  onError: () => void;
};

type Board3DErrorBoundaryState = {
  failed: boolean;
};

class Board3DErrorBoundary extends Component<
  Board3DErrorBoundaryProps,
  Board3DErrorBoundaryState
> {
  state: Board3DErrorBoundaryState = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function Board3DRenderer({
  tiles,
  pieces,
  visualCatalog,
  readOnly,
  disabled,
  tileInteractions,
  targetingIndicators,
  animation,
  onTileClick,
  onTileDrop,
  onTileContextMenu,
  onTileHoverChange,
  onFatalRenderError,
  onAssetFailure,
  manifest = BOARD_PIECE_VISUAL_MANIFEST,
}: Board3DRendererProps) {
  const tileInteractionByKey = useMemo(
    () => new Map(tileInteractions.map((interaction) => [coordKey(interaction.coord), interaction])),
    [tileInteractions],
  );
  const tileByKey = useMemo(
    () => new Map(tiles.map((tile) => [coordKey(tile.coord), tile])),
    [tiles],
  );
  const animationByPieceId = useMemo(
    () => new Map((animation?.pieces ?? []).map((pieceAnimation) => [pieceAnimation.pieceId, pieceAnimation])),
    [animation],
  );
  const [projectedHitTargets, setProjectedHitTargets] = useState<Map<string, BoardProjectedPosition>>(
    () => new Map(),
  );
  const [cameraControlElement, setCameraControlElement] = useState<HTMLDivElement | null>(null);
  const cameraPointerRef = useRef<{
    id: number;
    x: number;
    y: number;
    dragged: boolean;
  } | null>(null);

  const handleCameraPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    cameraPointerRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      dragged: false,
    };
  }, []);

  const handleCameraPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = cameraPointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) {
      return;
    }

    const moved = Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y);
    if (moved > CAMERA_DRAG_CLICK_THRESHOLD_PX) {
      pointer.dragged = true;
    }
  }, []);

  const handleCameraPointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = cameraPointerRef.current;
    if (pointer?.id === event.pointerId && !pointer.dragged) {
      cameraPointerRef.current = null;
    }
  }, []);

  const handleCameraClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!cameraPointerRef.current?.dragged) {
      return;
    }

    cameraPointerRef.current = null;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  function handleTileClick(coord: HexCoord) {
    if (readOnly || disabled) {
      return;
    }

    const tile = tileByKey.get(coordKey(coord));
    if (tile) {
      onTileClick?.(tile);
    }
  }

  function handleTileDrop(coord: HexCoord, cardId: string) {
    if (readOnly || disabled) {
      return;
    }

    const tile = tileByKey.get(coordKey(coord));
    if (tile) {
      onTileDrop?.(tile, cardId);
    }
  }

  function handleTileContextMenu(coord: HexCoord, event: { clientX: number; clientY: number }) {
    if (readOnly || disabled) {
      return;
    }

    const tile = tileByKey.get(coordKey(coord));
    if (tile) {
      onTileContextMenu?.(tile, event);
    }
  }

  return (
    <Board3DErrorBoundary
      fallback={<div className="board-3d-fallback" role="status">3D board unavailable.</div>}
      onError={onFatalRenderError}
    >
      <div
        ref={setCameraControlElement}
        className="board-3d-shell"
        data-board-renderer="3d"
        data-board-read-only={readOnly ? "true" : "false"}
        data-board-disabled={disabled ? "true" : "false"}
        onPointerDownCapture={handleCameraPointerDown}
        onPointerMoveCapture={handleCameraPointerMove}
        onPointerUpCapture={handleCameraPointerEnd}
        onPointerCancelCapture={handleCameraPointerEnd}
        onClickCapture={handleCameraClickCapture}
      >
        <Canvas
          camera={BOARD_3D_CAMERA}
          dpr={[1, 1.8]}
          fallback={<div className="board-3d-fallback" role="status">3D board unavailable.</div>}
          gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
          onCreated={({ gl, camera }) => {
            camera.lookAt(0, 0, 0);
            gl.domElement.dataset.boardCanvas = "3d";
          }}
        >
          <color attach="background" args={["#101312"]} />
          <ambientLight intensity={0.85} />
          <directionalLight position={[2.5, 7, 3.5]} intensity={1.9} />
          <group rotation={[0, BOARD_3D_GROUP_ROTATION_Y, 0]}>
            {tiles.map((tile: HexTile) => {
              const interaction = tileInteractionByKey.get(coordKey(tile.coord));

              return (
                <HexTileMesh
                  key={coordKey(tile.coord)}
                  coord={tile.coord}
                  interaction={interaction}
                  readOnly={readOnly}
                  disabled={disabled}
                  onClick={handleTileClick}
                  onContextMenu={handleTileContextMenu}
                />
              );
            })}
            {pieces.map((piece) => (
              <PieceMesh
                key={piece.id}
                piece={piece}
                animation={animationByPieceId.get(piece.id)}
                visualCatalog={visualCatalog}
                manifest={manifest}
                onAssetFailure={onAssetFailure}
                interaction={tileInteractionByKey.get(coordKey(piece.position))}
                readOnly={readOnly}
                disabled={disabled}
                onClick={handleTileClick}
                onContextMenu={handleTileContextMenu}
              />
            ))}
          </group>
          <BoardCameraControls controlElement={cameraControlElement} />
          <ProjectedHitTargetSync
            tileInteractions={tileInteractions}
            onPositionsChange={setProjectedHitTargets}
          />
        </Canvas>
        <div className="board-3d-hit-layer" aria-label="3D board controls">
          <TargetingIndicatorLayer
            indicators={targetingIndicators}
            positionsByCoordKey={projectedHitTargets}
          />
          {tileInteractions.map((interaction) => (
            <Board3DHitTarget
              key={coordKey(interaction.coord)}
              interaction={interaction}
              projectedPosition={projectedHitTargets.get(coordKey(interaction.coord))}
              readOnly={readOnly}
              disabled={disabled}
              onClick={handleTileClick}
              onDrop={handleTileDrop}
              onContextMenu={handleTileContextMenu}
              onHoverChange={onTileHoverChange}
            />
          ))}
        </div>
      </div>
    </Board3DErrorBoundary>
  );
}

export { TargetingIndicatorLayer } from "./TargetingIndicatorLayer";
export type {
  Board3DHero,
  Board3DPiece,
  Board3DRendererProps,
  Board3DTileInteraction,
  Board3DUnit,
  BoardProjectedPosition,
} from "./types";
