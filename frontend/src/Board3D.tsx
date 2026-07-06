import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  Component,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box3, Group, Object3D, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  BOARD_3D_CAMERA,
  BOARD_3D_GROUP_ROTATION_Y,
  BOARD_3D_TILE_ROTATION_Y,
  axialToBoardPosition,
  projectBoardPositionToViewport,
  type ProjectedBoardPosition,
} from "./boardRenderer";
import {
  BOARD_PIECE_VISUAL_MANIFEST,
  resolveBoardPieceVisual,
  type BoardModelAssetEntry,
  type BoardPieceVisualManifest,
  type ProceduralMiniatureRecipe,
} from "./board3dModelManifest";
import type { MatchVisualCatalog, UnitVisualIdentity, HeroVisualIdentity } from "./matchVisualIdentity";
import type { HexCoord, HexTile, Side, Unit, HeroType } from "./types";
import { BOARD_ANIMATION_DURATION_MS, type BoardAnimationCue, type PieceAnimation } from "./boardAnimations";
import type { TutorialHighlightTone } from "./tutorial/tutorialHighlights";
import type { TargetingIndicator } from "./targetingIndicators";

const BOARD_CAMERA_MIN_DISTANCE = 5.8;
const BOARD_CAMERA_MAX_DISTANCE = 14.5;
const BOARD_CAMERA_MIN_POLAR_ANGLE = Math.PI * 0.22;
const BOARD_CAMERA_MAX_POLAR_ANGLE = Math.PI * 0.43;
const CAMERA_DRAG_CLICK_THRESHOLD_PX = 6;
const gltfSceneCache = new Map<string, Promise<Object3D>>();

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

type Board3DProps = {
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
}: Board3DProps) {
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
  const [projectedHitTargets, setProjectedHitTargets] = useState<Map<string, ProjectedBoardPosition>>(
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
            {tiles.map((tile) => {
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

export type BoardProjectedPosition = ProjectedBoardPosition;

export type TargetingIndicatorLayerProps = {
  indicators: TargetingIndicator[];
  positionsByCoordKey: Map<string, BoardProjectedPosition>;
};

export function TargetingIndicatorLayer({
  indicators,
  positionsByCoordKey,
}: TargetingIndicatorLayerProps) {
  const visibleIndicators = indicators
    .map((indicator) => ({
      indicator,
      sourcePosition: positionsByCoordKey.get(coordKey(indicator.sourceCoord)),
      targetPosition: positionsByCoordKey.get(coordKey(indicator.primaryTargetCoord)),
      footprintPositions: indicator.secondaryFootprintCoords
        .map((coord) => positionsByCoordKey.get(coordKey(coord)))
        .filter((position): position is BoardProjectedPosition => Boolean(position?.visible)),
    }))
    .filter(hasVisibleTargetingEndpoints);

  if (visibleIndicators.length === 0) {
    return null;
  }

  return (
    <div className="targeting-indicator-layer" aria-hidden="true">
      <svg className="targeting-indicator-svg">
        <defs>
          {visibleIndicators.map(({ indicator }, index) => (
            <marker
              id={`targeting-arrow-${index}`}
              key={indicator.id}
              markerWidth="12"
              markerHeight="12"
              refX="10"
              refY="6"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path
                className={`targeting-indicator-arrowhead targeting-indicator-${indicator.tone}`}
                d="M 0 0 L 12 6 L 0 12 z"
              />
            </marker>
          ))}
        </defs>
        {visibleIndicators.map(({ indicator, sourcePosition, targetPosition }, index) => (
          <g
            key={indicator.id}
            className={`targeting-indicator targeting-indicator-${indicator.tone}`}
            data-targeting-indicator={indicator.id}
            data-targeting-action={indicator.actionType}
            data-targeting-tone={indicator.tone}
            data-stack-item-id={indicator.source.type === "stack" ? indicator.source.stackItemId : undefined}
          >
            <line
              className="targeting-indicator-line"
              x1={sourcePosition.x}
              y1={sourcePosition.y}
              x2={targetPosition.x}
              y2={targetPosition.y}
              markerEnd={`url(#targeting-arrow-${index})`}
            />
          </g>
        ))}
      </svg>
      {visibleIndicators.map(({ indicator, sourcePosition, targetPosition, footprintPositions }) => (
        <div key={`${indicator.id}-markers`}>
          <span
            className={`targeting-indicator-source targeting-indicator-marker targeting-indicator-${indicator.tone}`}
            style={{ left: `${sourcePosition.x}px`, top: `${sourcePosition.y}px` }}
          />
          <span
            className={`targeting-indicator-primary targeting-indicator-marker targeting-indicator-${indicator.tone}`}
            style={{ left: `${targetPosition.x}px`, top: `${targetPosition.y}px` }}
            data-targeting-primary={indicator.id}
          />
          {footprintPositions.map((position, index) => (
            <span
              key={`${indicator.id}-footprint-${index}`}
              className={`targeting-indicator-footprint targeting-indicator-marker targeting-indicator-${indicator.tone}`}
              style={{ left: `${position.x}px`, top: `${position.y}px` }}
              data-targeting-footprint={indicator.id}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function hasVisibleTargetingEndpoints(entry: {
  indicator: TargetingIndicator;
  sourcePosition?: BoardProjectedPosition;
  targetPosition?: BoardProjectedPosition;
  footprintPositions: BoardProjectedPosition[];
}): entry is {
  indicator: TargetingIndicator;
  sourcePosition: BoardProjectedPosition;
  targetPosition: BoardProjectedPosition;
  footprintPositions: BoardProjectedPosition[];
} {
  return Boolean(entry.sourcePosition?.visible && entry.targetPosition?.visible);
}

function ProjectedHitTargetSync({
  tileInteractions,
  onPositionsChange,
}: {
  tileInteractions: Board3DTileInteraction[];
  onPositionsChange: (positions: Map<string, ProjectedBoardPosition>) => void;
}) {
  const { camera, size } = useThree();
  const previousPositionsRef = useRef<Map<string, ProjectedBoardPosition>>(new Map());

  useFrame(() => {
    camera.updateMatrixWorld();
    const nextPositions = new Map<string, ProjectedBoardPosition>();

    for (const interaction of tileInteractions) {
      nextPositions.set(
        coordKey(interaction.coord),
        projectBoardPositionToViewport(interaction.coord, camera, size),
      );
    }

    if (!projectedPositionsEqual(previousPositionsRef.current, nextPositions)) {
      previousPositionsRef.current = nextPositions;
      onPositionsChange(nextPositions);
    }
  });

  return null;
}

function BoardCameraControls({ controlElement }: { controlElement: HTMLElement | null }) {
  const { camera, gl } = useThree();
  const orbitRef = useRef(cameraOrbitFromPosition(camera.position));

  useEffect(() => {
    const element = controlElement ?? gl.domElement;
    let dragStart: {
      x: number;
      y: number;
      azimuth: number;
      polar: number;
    } | null = null;

    function applyOrbit() {
      const orbit = orbitRef.current;
      const horizontalDistance = Math.sin(orbit.polar) * orbit.distance;
      camera.position.set(
        Math.sin(orbit.azimuth) * horizontalDistance,
        Math.cos(orbit.polar) * orbit.distance,
        Math.cos(orbit.azimuth) * horizontalDistance,
      );
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
    }

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      const orbit = orbitRef.current;
      orbit.distance = clamp(
        orbit.distance * Math.exp(event.deltaY * 0.001),
        BOARD_CAMERA_MIN_DISTANCE,
        BOARD_CAMERA_MAX_DISTANCE,
      );
      applyOrbit();
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.button !== 0) {
        return;
      }

      dragStart = {
        x: event.clientX,
        y: event.clientY,
        azimuth: orbitRef.current.azimuth,
        polar: orbitRef.current.polar,
      };
    }

    function handlePointerMove(event: PointerEvent) {
      if (!dragStart) {
        return;
      }

      const orbit = orbitRef.current;
      orbit.azimuth = dragStart.azimuth - (event.clientX - dragStart.x) * 0.006;
      orbit.polar = clamp(
        dragStart.polar + (event.clientY - dragStart.y) * 0.004,
        BOARD_CAMERA_MIN_POLAR_ANGLE,
        BOARD_CAMERA_MAX_POLAR_ANGLE,
      );
      applyOrbit();
    }

    function handlePointerEnd() {
      dragStart = null;
    }

    applyOrbit();
    element.addEventListener("wheel", handleWheel, { passive: false });
    element.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);

    return () => {
      element.removeEventListener("wheel", handleWheel);
      element.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [camera, controlElement, gl.domElement]);

  useFrame(() => {
    camera.updateMatrixWorld();
    gl.domElement.dataset.boardCameraDistance = camera.position.length().toFixed(3);
    gl.domElement.dataset.boardCameraX = camera.position.x.toFixed(3);
    gl.domElement.dataset.boardCameraY = camera.position.y.toFixed(3);
    gl.domElement.dataset.boardCameraZ = camera.position.z.toFixed(3);
  }, -1);

  return null;
}

function cameraOrbitFromPosition(position: Vector3) {
  const distance = clamp(position.length(), BOARD_CAMERA_MIN_DISTANCE, BOARD_CAMERA_MAX_DISTANCE);
  const polar = clamp(
    Math.acos(clamp(position.y / distance, -1, 1)),
    BOARD_CAMERA_MIN_POLAR_ANGLE,
    BOARD_CAMERA_MAX_POLAR_ANGLE,
  );

  return {
    distance,
    polar,
    azimuth: Math.atan2(position.x, position.z),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function projectedPositionsEqual(
  left: Map<string, ProjectedBoardPosition>,
  right: Map<string, ProjectedBoardPosition>,
) {
  if (left.size !== right.size) {
    return false;
  }

  for (const [key, nextPosition] of right) {
    const currentPosition = left.get(key);
    if (
      !currentPosition ||
      currentPosition.visible !== nextPosition.visible ||
      Math.abs(currentPosition.x - nextPosition.x) > 0.25 ||
      Math.abs(currentPosition.y - nextPosition.y) > 0.25
    ) {
      return false;
    }
  }

  return true;
}

function HexTileMesh({
  coord,
  interaction,
  readOnly,
  disabled,
  onClick,
  onContextMenu,
}: {
  coord: HexTile["coord"];
  interaction?: Board3DTileInteraction;
  readOnly: boolean;
  disabled: boolean;
  onClick: (coord: HexCoord) => void;
  onContextMenu: (coord: HexCoord, event: { clientX: number; clientY: number }) => void;
}) {
  const [x, y, z] = axialToBoardPosition(coord, 1);
  const color = interaction?.isSelected
    ? "#f5ecd2"
    : interaction?.tutorialHighlightTone === "danger"
      ? "#6b2f2f"
      : interaction?.tutorialHighlightTone
        ? "#66582a"
    : interaction?.isLegal
      ? "#6f6331"
      : interaction?.hasPiece
        ? "#34423d"
        : interaction?.hasManaSource
          ? "#403b25"
          : "#293733";
  const emissive = interaction?.tutorialHighlightTone
    ? interaction.tutorialHighlightTone === "danger"
      ? "#4f1515"
      : "#4a3d12"
    : interaction?.isLegal
      ? "#3d3311"
      : "#000000";
  const emissiveIntensity = interaction?.tutorialHighlightTone ? 0.62 : interaction?.isLegal ? 0.42 : 0;

  function handlePointer(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    onClick(coord);
  }

  function handleContextMenu(event: ThreeEvent<MouseEvent>) {
    if (readOnly || disabled) {
      return;
    }

    event.stopPropagation();
    onContextMenu(coord, {
      clientX: event.nativeEvent.clientX,
      clientY: event.nativeEvent.clientY,
    });
  }

  return (
    <mesh
      position={[x, y, z]}
      rotation={[0, BOARD_3D_TILE_ROTATION_Y, 0]}
      receiveShadow
      onClick={handlePointer}
      onContextMenu={handleContextMenu}
    >
      <cylinderGeometry args={[0.98, 0.98, 0.14, 6]} />
      <meshStandardMaterial
        color={color}
        emissive={emissive}
        emissiveIntensity={emissiveIntensity}
        roughness={0.78}
        metalness={0.08}
      />
    </mesh>
  );
}

function PieceMesh({
  piece,
  animation,
  visualCatalog,
  manifest,
  onAssetFailure,
  interaction,
  readOnly,
  disabled,
  onClick,
  onContextMenu,
}: {
  piece: Board3DPiece;
  animation?: PieceAnimation;
  visualCatalog: MatchVisualCatalog;
  manifest: BoardPieceVisualManifest;
  onAssetFailure?: (path: string) => void;
  interaction?: Board3DTileInteraction;
  readOnly: boolean;
  disabled: boolean;
  onClick: (coord: HexCoord) => void;
  onContextMenu: (coord: HexCoord, event: { clientX: number; clientY: number }) => void;
}) {
  const [assetFailed, setAssetFailed] = useState(false);
  const [x, y, z] = axialToBoardPosition(piece.position, 1);
  const visualIdentity =
    piece.pieceType === "hero" ? visualCatalog.hero(piece) : visualCatalog.unit(piece);
  const resolved = resolveBoardPieceVisual(piece, visualIdentity, manifest);
  const resolvedAssetPath = resolved.source === "model" ? resolved.modelAsset.path : null;
  const handleAssetFailure = useCallback(() => {
    setAssetFailed(true);
    if (resolvedAssetPath) {
      onAssetFailure?.(resolvedAssetPath);
    }
  }, [onAssetFailure, resolvedAssetPath]);

  useEffect(() => {
    setAssetFailed(false);
  }, [resolvedAssetPath]);

  const innerPiece =
    resolved.source === "model" && !assetFailed ? (
      <LoadableModelPiece
        modelAsset={resolved.modelAsset}
        position={[0, resolved.modelAsset.yOffset ?? 0, 0]}
        side={piece.side}
        coord={piece.position}
        readOnly={readOnly}
        disabled={disabled}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onAssetFailure={handleAssetFailure}
      />
    ) : (
      <ProceduralMiniature
        position={[0, 0.04, 0]}
        side={piece.side}
        pieceType={piece.pieceType}
        visualIdentity={visualIdentity}
        recipe={resolved.procedural}
        selected={interaction?.isSelected ?? false}
        legalTarget={interaction?.isLegal ?? false}
        coord={piece.position}
        readOnly={readOnly}
        disabled={disabled}
        onClick={onClick}
        onContextMenu={onContextMenu}
      />
  );

  return (
    <AnimatedPieceGroup
      position={[x, y + 0.16, z]}
      piece={piece}
      animation={animation}
    >
      {innerPiece}
    </AnimatedPieceGroup>
  );
}

function AnimatedPieceGroup({
  position,
  piece,
  animation,
  children,
}: {
  position: [number, number, number];
  piece: Board3DPiece;
  animation?: PieceAnimation;
  children: ReactNode;
}) {
  const groupRef = useRef<Group>(null);
  const startedAtRef = useRef(0);
  const target = useMemo(() => new Vector3(...position), [position]);
  const from = useMemo(() => {
    if (animation?.kind !== "move" || !animation.from) {
      return target.clone();
    }

    const [fromX, fromY, fromZ] = axialToBoardPosition(animation.from, 1);
    return new Vector3(fromX, fromY + 0.16, fromZ);
  }, [animation, target]);

  useEffect(() => {
    startedAtRef.current = performance.now();
    groupRef.current?.position.copy(animation?.kind === "move" ? from : target);
    groupRef.current?.scale.setScalar(animation?.kind === "summon" ? 0.35 : 1);
  }, [animation, from, target]);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) {
      return;
    }

    const elapsed = performance.now() - startedAtRef.current;
    const progress = Math.min(elapsed / BOARD_ANIMATION_DURATION_MS, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    group.position.copy(from.clone().lerp(target, eased));

    if (animation?.kind === "summon") {
      group.scale.setScalar(0.35 + eased * 0.65);
    } else if (animation?.kind === "destroy") {
      group.scale.setScalar(Math.max(0.12, 1 - eased * 0.85));
      group.position.y = target.y + eased * 0.34;
    } else if (animation?.kind === "attack") {
      const lunge = Math.sin(progress * Math.PI) * (piece.side === "player" ? -0.22 : 0.22);
      group.position.z = target.z + lunge;
      group.scale.setScalar(1 + Math.sin(progress * Math.PI) * 0.08);
    } else if (animation?.kind === "damage") {
      group.position.x = target.x + Math.sin(progress * Math.PI * 6) * 0.035;
      group.scale.setScalar(1 - Math.sin(progress * Math.PI) * 0.06);
    } else if (animation?.kind === "heal" || animation?.kind === "buff") {
      group.position.y = target.y + Math.sin(progress * Math.PI) * 0.16;
      group.scale.setScalar(1 + Math.sin(progress * Math.PI) * 0.07);
    } else {
      group.scale.setScalar(1);
    }
  });

  return (
    <group ref={groupRef} userData={{ animation: animation?.kind ?? "idle" }}>
      {children}
    </group>
  );
}

function LoadableModelPiece({
  modelAsset,
  position,
  side,
  coord,
  readOnly,
  disabled,
  onClick,
  onContextMenu,
  onAssetFailure,
}: {
  modelAsset: BoardModelAssetEntry;
  position: [number, number, number];
  side: Side;
  coord: HexCoord;
  readOnly: boolean;
  disabled: boolean;
  onClick: (coord: HexCoord) => void;
  onContextMenu: (coord: HexCoord, event: { clientX: number; clientY: number }) => void;
  onAssetFailure: () => void;
}) {
  const [model, setModel] = useState<Object3D | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadGltfScene(modelAsset.path)
      .then((scene) => {
        if (cancelled) {
          return;
        }

        const clone = scene.clone(true);
        normalizeModel(clone, modelAsset.scale);
        setModel(clone);
      })
      .catch(() => {
        if (!cancelled) {
          onAssetFailure();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [modelAsset.path, modelAsset.scale, onAssetFailure]);

  if (!model) {
    return null;
  }

  return (
    <primitive
      object={model}
      position={position}
      rotation={[0, (modelAsset.rotationY ?? 0) + (side === "player" ? Math.PI : 0), 0]}
      onClick={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        onClick(coord);
      }}
      onContextMenu={(event: ThreeEvent<MouseEvent>) => {
        if (readOnly || disabled) {
          return;
        }

        event.stopPropagation();
        onContextMenu(coord, {
          clientX: event.nativeEvent.clientX,
          clientY: event.nativeEvent.clientY,
        });
      }}
    />
  );
}

function loadGltfScene(path: string) {
  const cached = gltfSceneCache.get(path);
  if (cached) {
    return cached;
  }

  const loader = new GLTFLoader();
  const promise = new Promise<Object3D>((resolve, reject) => {
    loader.load(
      path,
      (gltf) => resolve(gltf.scene),
      undefined,
      (error) => reject(error),
    );
  });
  gltfSceneCache.set(path, promise);
  return promise;
}

function ProceduralMiniature({
  position,
  side,
  pieceType,
  visualIdentity,
  recipe,
  selected,
  legalTarget,
  coord,
  readOnly,
  disabled,
  onClick,
  onContextMenu,
}: {
  position: [number, number, number];
  side: Side;
  pieceType: Board3DPiece["pieceType"];
  visualIdentity: UnitVisualIdentity | HeroVisualIdentity;
  recipe: ProceduralMiniatureRecipe;
  selected: boolean;
  legalTarget: boolean;
  coord: HexCoord;
  readOnly: boolean;
  disabled: boolean;
  onClick: (coord: HexCoord) => void;
  onContextMenu: (coord: HexCoord, event: { clientX: number; clientY: number }) => void;
}) {
  const sideColor = side === "player" ? "#77b36f" : "#d1665a";
  const baseRadius = pieceType === "hero" ? 0.56 : 0.48;
  const ringColor = selected ? "#fffaf0" : legalTarget ? "#d9b84f" : "#101312";
  const glow = recipe.palette.glow ?? recipe.palette.accent;

  return (
    <group
      position={position}
      userData={{ label: visualIdentity.name }}
      scale={[recipe.scale, recipe.scale, recipe.scale]}
      onClick={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        onClick(coord);
      }}
      onContextMenu={(event: ThreeEvent<MouseEvent>) => {
        if (readOnly || disabled) {
          return;
        }

        event.stopPropagation();
        onContextMenu(coord, {
          clientX: event.nativeEvent.clientX,
          clientY: event.nativeEvent.clientY,
        });
      }}
    >
      <mesh position={[0, 0.03, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[baseRadius, 0.035, 8, 32]} />
        <meshStandardMaterial color={ringColor} emissive={ringColor} emissiveIntensity={0.22} />
      </mesh>
      <mesh position={[0, 0.045, 0]}>
        <cylinderGeometry args={[baseRadius * 0.78, baseRadius * 0.86, 0.08, 18]} />
        <meshStandardMaterial color={sideColor} roughness={0.62} metalness={0.04} />
      </mesh>
      <group position={[0, motionYOffset(recipe), 0]} rotation={[0, side === "player" ? Math.PI : 0, 0]}>
        <MiniatureBody recipe={recipe} pieceType={pieceType} />
        <MiniatureWeapon recipe={recipe} />
        <MiniatureShield recipe={recipe} />
        <mesh position={[0, 0.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.34, 0.012, 8, 24]} />
          <meshStandardMaterial color={glow} emissive={glow} emissiveIntensity={0.2} />
        </mesh>
      </group>
    </group>
  );
}

function MiniatureBody({
  recipe,
  pieceType,
}: {
  recipe: ProceduralMiniatureRecipe;
  pieceType: Board3DPiece["pieceType"];
}) {
  const bodyHeight = bodyHeightFor(recipe.silhouette.body, pieceType);
  const bodyRadius = bodyRadiusFor(recipe.silhouette.body, pieceType);
  const primary = recipe.palette.primary;
  const secondary = recipe.palette.secondary;
  const accent = recipe.palette.accent;

  switch (recipe.family) {
    case "beast":
      return (
        <group rotation={[0, 0, recipe.silhouette.motion === "leaping" ? -0.18 : 0]}>
          <mesh position={[0, 0.34, 0]} scale={[1.32, 0.62, 0.74]}>
            <sphereGeometry args={[0.34, 18, 12]} />
            <meshStandardMaterial color={primary} roughness={0.56} />
          </mesh>
          <mesh position={[0.34, 0.42, 0]} scale={[0.82, 0.62, 0.62]}>
            <sphereGeometry args={[0.21, 16, 10]} />
            <meshStandardMaterial color={primary} roughness={0.5} />
          </mesh>
          {[-0.2, 0.18].map((z) => (
            <mesh key={z} position={[-0.16, 0.16, z]} rotation={[0.34, 0, 0.18]}>
              <cylinderGeometry args={[0.035, 0.045, 0.34, 8]} />
              <meshStandardMaterial color={secondary} roughness={0.66} />
            </mesh>
          ))}
          <mesh position={[0.49, 0.46, 0]}>
            <coneGeometry args={[0.09, 0.18, 4]} />
            <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.18} />
          </mesh>
        </group>
      );
    case "construct":
      return (
        <group>
          <mesh position={[0, bodyHeight / 2 + 0.1, 0]}>
            <boxGeometry args={[bodyRadius * 1.36, bodyHeight, bodyRadius * 1.12]} />
            <meshStandardMaterial color={primary} roughness={0.72} metalness={0.12} />
          </mesh>
          <mesh position={[0, bodyHeight + 0.25, 0]}>
            <boxGeometry args={[bodyRadius * 0.78, 0.24, bodyRadius * 0.68]} />
            <meshStandardMaterial color={secondary} roughness={0.6} metalness={0.08} />
          </mesh>
          <mesh position={[0, bodyHeight + 0.39, 0]}>
            <octahedronGeometry args={[0.12]} />
            <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.28} />
          </mesh>
        </group>
      );
    case "caster":
      return (
        <group>
          <mesh position={[0, bodyHeight / 2 + 0.12, 0]}>
            <coneGeometry args={[bodyRadius, bodyHeight, 7]} />
            <meshStandardMaterial color={primary} roughness={0.5} />
          </mesh>
          <mesh position={[0, bodyHeight + 0.22, 0]}>
            <sphereGeometry args={[bodyRadius * 0.42, 18, 14]} />
            <meshStandardMaterial color="#fffaf0" roughness={0.42} />
          </mesh>
          <mesh position={[0, bodyHeight + 0.43, 0]} rotation={[0, 0, 0.12]}>
            <coneGeometry args={[bodyRadius * 0.5, 0.28, 7]} />
            <meshStandardMaterial color={secondary} roughness={0.52} />
          </mesh>
          <mesh position={[0, 0.3, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[bodyRadius * 0.75, 0.018, 8, 28]} />
            <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.24} />
          </mesh>
        </group>
      );
    case "fortress":
      return (
        <group>
          <mesh position={[0, bodyHeight / 2 + 0.09, 0]}>
            <cylinderGeometry args={[bodyRadius * 0.78, bodyRadius, bodyHeight, 6]} />
            <meshStandardMaterial color={primary} roughness={0.78} metalness={0.08} />
          </mesh>
          <mesh position={[0, bodyHeight + 0.21, 0]}>
            <boxGeometry args={[bodyRadius * 1.05, 0.22, bodyRadius * 0.82]} />
            <meshStandardMaterial color={secondary} roughness={0.64} />
          </mesh>
          <mesh position={[0, bodyHeight + 0.38, 0]}>
            <cylinderGeometry args={[0.1, 0.13, 0.18, 6]} />
            <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.18} />
          </mesh>
        </group>
      );
    case "humanoid":
      return (
        <group rotation={[0, 0, recipe.silhouette.motion === "runner" ? -0.08 : 0]}>
          <mesh position={[0, bodyHeight / 2 + 0.08, 0]}>
            <cylinderGeometry args={[bodyRadius * 0.76, bodyRadius, bodyHeight, 8]} />
            <meshStandardMaterial color={primary} roughness={0.54} />
          </mesh>
          <mesh position={[0, bodyHeight + 0.22, 0]}>
            <sphereGeometry args={[bodyRadius * 0.42, 18, 14]} />
            <meshStandardMaterial color="#fffaf0" roughness={0.42} />
          </mesh>
          <mesh position={[0, bodyHeight + 0.42, 0]} rotation={[0, 0, 0.08]}>
            <coneGeometry args={[bodyRadius * 0.48, 0.22, 7]} />
            <meshStandardMaterial color={secondary} roughness={0.52} />
          </mesh>
          <mesh position={[0, bodyHeight * 0.72, -bodyRadius * 0.78]}>
            <boxGeometry args={[bodyRadius * 1.24, 0.08, 0.08]} />
            <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.12} />
          </mesh>
        </group>
      );
  }
}

function MiniatureWeapon({ recipe }: { recipe: ProceduralMiniatureRecipe }) {
  const weapon = recipe.silhouette.weapon;
  if (!weapon || weapon === "claws") {
    return null;
  }

  const accent = recipe.palette.accent;
  const handle = recipe.palette.secondary;

  if (weapon === "bow") {
    return (
      <group position={[0.36, 0.55, 0]} rotation={[0, 0, -0.24]}>
        <mesh>
          <torusGeometry args={[0.18, 0.015, 8, 20, Math.PI]} />
          <meshStandardMaterial color={accent} roughness={0.5} />
        </mesh>
        <mesh position={[0.02, 0, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 0.42, 8]} />
          <meshStandardMaterial color={handle} roughness={0.64} />
        </mesh>
      </group>
    );
  }

  return (
    <group position={[0.38, 0.56, 0]} rotation={[0, 0, weapon === "spear" || weapon === "staff" ? -0.18 : -0.58]}>
      <mesh position={[0, 0.08, 0]}>
        <cylinderGeometry args={[0.018, 0.018, weapon === "spear" || weapon === "staff" ? 0.86 : 0.54, 8]} />
        <meshStandardMaterial color={handle} roughness={0.6} />
      </mesh>
      {weapon === "staff" ? (
        <mesh position={[0, 0.54, 0]}>
          <octahedronGeometry args={[0.1]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.32} />
        </mesh>
      ) : weapon === "hammer" ? (
        <mesh position={[0, 0.38, 0]}>
          <boxGeometry args={[0.28, 0.14, 0.16]} />
          <meshStandardMaterial color={accent} roughness={0.48} metalness={0.16} />
        </mesh>
      ) : weapon === "axe" ? (
        <mesh position={[0, 0.38, 0]} rotation={[0, 0, Math.PI / 2]}>
          <coneGeometry args={[0.14, 0.2, 5]} />
          <meshStandardMaterial color={accent} roughness={0.48} metalness={0.14} />
        </mesh>
      ) : (
        <mesh position={[0, 0.47, 0]}>
          <coneGeometry args={[0.07, 0.18, 4]} />
          <meshStandardMaterial color={accent} roughness={0.48} metalness={0.14} />
        </mesh>
      )}
    </group>
  );
}

function MiniatureShield({ recipe }: { recipe: ProceduralMiniatureRecipe }) {
  const shield = recipe.silhouette.shield;
  if (!shield || shield === "none") {
    return null;
  }

  const width = shield === "tower" ? 0.28 : 0.22;
  const height = shield === "tower" ? 0.48 : 0.3;

  return (
    <mesh position={[-0.34, 0.54, 0.08]} rotation={[0, 0.24, 0]}>
      <boxGeometry args={[width, height, 0.055]} />
      <meshStandardMaterial color={recipe.palette.secondary} roughness={0.58} metalness={0.12} />
    </mesh>
  );
}

function motionYOffset(recipe: ProceduralMiniatureRecipe) {
  switch (recipe.silhouette.motion) {
    case "floating":
      return 0.1;
    case "leaping":
      return 0.08;
    default:
      return 0;
  }
}

function bodyHeightFor(body: ProceduralMiniatureRecipe["silhouette"]["body"], pieceType: Board3DPiece["pieceType"]) {
  if (pieceType === "hero") {
    return 0.78;
  }

  switch (body) {
    case "light":
      return 0.46;
    case "heavy":
      return 0.66;
    case "towering":
      return 0.82;
    case "medium":
      return 0.56;
  }
}

function bodyRadiusFor(body: ProceduralMiniatureRecipe["silhouette"]["body"], pieceType: Board3DPiece["pieceType"]) {
  if (pieceType === "hero") {
    return 0.36;
  }

  switch (body) {
    case "light":
      return 0.27;
    case "heavy":
      return 0.38;
    case "towering":
      return 0.43;
    case "medium":
      return 0.32;
  }
}

function Board3DHitTarget({
  interaction,
  projectedPosition,
  readOnly,
  disabled,
  onClick,
  onDrop,
  onContextMenu,
  onHoverChange,
}: {
  interaction: Board3DTileInteraction;
  projectedPosition?: ProjectedBoardPosition;
  readOnly: boolean;
  disabled: boolean;
  onClick: (coord: HexCoord) => void;
  onDrop: (coord: HexCoord, cardId: string) => void;
  onContextMenu: (coord: HexCoord, event: { clientX: number; clientY: number }) => void;
  onHoverChange?: (coord: HexCoord | null) => void;
}) {
  const className = [
    "board-3d-hit-target",
    interaction.hasManaSource ? "mana-source" : "",
    interaction.hasBuilding ? "building" : "",
    interaction.hasPiece ? "occupied" : "",
    interaction.pieceSide ? `occupied-${interaction.pieceSide}` : "",
    interaction.isLegal ? "legal" : "",
    interaction.isSelected ? "selected-piece" : "",
    interaction.isFocused ? "keyboard-focused" : "",
    interaction.tutorialHighlightTone ? "tutorial-highlight" : "",
    interaction.tutorialHighlightTone ? `tutorial-highlight-${interaction.tutorialHighlightTone}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={className}
      style={{
        left: projectedPosition ? `${projectedPosition.x}px` : "50%",
        top: projectedPosition ? `${projectedPosition.y}px` : "50%",
        visibility: projectedPosition?.visible ? "visible" : "hidden",
      }}
      disabled={disabled && !readOnly}
      tabIndex={readOnly ? -1 : undefined}
      aria-label={interaction.title}
      title={interaction.title}
      data-board-3d-tile={coordKey(interaction.coord)}
      data-legal={interaction.isLegal ? "true" : "false"}
      onClick={() => onClick(interaction.coord)}
      onPointerEnter={() => onHoverChange?.(interaction.coord)}
      onPointerLeave={() => onHoverChange?.(null)}
      onFocus={() => onHoverChange?.(interaction.coord)}
      onBlur={() => onHoverChange?.(null)}
      onDragOver={(event: DragEvent<HTMLButtonElement>) => {
        if (readOnly || disabled || !interaction.isLegal) {
          return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event: DragEvent<HTMLButtonElement>) => {
        if (readOnly || disabled) {
          return;
        }

        event.preventDefault();
        const cardId = event.dataTransfer.getData("text/plain");
        if (cardId) {
          onDrop(interaction.coord, cardId);
        }
      }}
      onContextMenu={(event) => {
        if (readOnly || disabled) {
          return;
        }

        event.preventDefault();
        onContextMenu(interaction.coord, {
          clientX: event.clientX,
          clientY: event.clientY,
        });
      }}
    >
      {interaction.hasManaSource ? <span aria-hidden="true">M</span> : null}
      {interaction.hasBuilding && !interaction.hasManaSource ? <span aria-hidden="true">B</span> : null}
      {interaction.pieceLabel ? <span>{interaction.pieceLabel}</span> : null}
      {interaction.pieceStatLabel ? <strong>{interaction.pieceStatLabel}</strong> : null}
      {interaction.droppedItemCount ? (
        <em aria-label={`${interaction.droppedItemCount} dropped items`}>
          {interaction.droppedItemCount}
        </em>
      ) : null}
    </button>
  );
}

function coordKey(coord: HexCoord) {
  return `${coord.q}:${coord.r}`;
}

function normalizeModel(object: Object3D, scale: number) {
  const box = new Box3().setFromObject(object);
  const size = box.getSize(new Vector3());
  const maxAxis = Math.max(size.x, size.y, size.z);

  if (Number.isFinite(maxAxis) && maxAxis > 0) {
    object.scale.setScalar(scale / maxAxis);
  }

  const center = box.getCenter(new Vector3());
  object.position.sub(center);
}
