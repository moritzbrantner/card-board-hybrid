import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import {
  Component,
  type DragEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box3, Group, Object3D, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { axialToBoardPosition } from "./boardRenderer";
import {
  BOARD_MODEL_MANIFEST,
  resolveBoardModel,
  type BoardModelManifest,
} from "./board3dModelManifest";
import type { MatchVisualCatalog, UnitVisualIdentity, WizardVisualIdentity } from "./matchVisualIdentity";
import type { HexCoord, HexTile, Side, Unit, WizardType } from "./types";
import { BOARD_ANIMATION_DURATION_MS, type BoardAnimationCue, type PieceAnimation } from "./boardAnimations";

export type Board3DWizard = {
  pieceType: "wizard";
  id: string;
  side: Side;
  name: string;
  wizardType: WizardType;
  hp: number;
  maxHp: number;
  attack: number;
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
  armor: number;
  maxArmor: number;
  position: HexCoord;
  apRemaining: number;
  maxAp: number;
  hasAttacked: boolean;
  items: Unit["items"];
};

export type Board3DPiece = Board3DWizard | Board3DUnit;

export type Board3DTileInteraction = {
  coord: HexCoord;
  title: string;
  disabled: boolean;
  isLegal: boolean;
  isSelected: boolean;
  isFocused?: boolean;
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
  animation?: BoardAnimationCue | null;
  onTileClick?: (tile: HexTile) => void;
  onTileDrop?: (tile: HexTile, cardId: string) => void;
  onTileContextMenu?: (tile: HexTile, event: { clientX: number; clientY: number }) => void;
  onFatalRenderError: () => void;
  onAssetFailure?: (path: string) => void;
  manifest?: BoardModelManifest;
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
  animation,
  onTileClick,
  onTileDrop,
  onTileContextMenu,
  onFatalRenderError,
  onAssetFailure,
  manifest = BOARD_MODEL_MANIFEST,
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
        className="board-3d-shell"
        data-board-renderer="3d"
        data-board-read-only={readOnly ? "true" : "false"}
        data-board-disabled={disabled ? "true" : "false"}
      >
        <Canvas
          camera={{ position: [0, 7.6, 7.9], fov: 38, near: 0.1, far: 60 }}
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
          <group rotation={[0, Math.PI / 6, 0]}>
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
        </Canvas>
        <div className="board-3d-hit-layer" aria-label="3D board controls">
          {tileInteractions.map((interaction) => (
            <Board3DHitTarget
              key={coordKey(interaction.coord)}
              interaction={interaction}
              readOnly={readOnly}
              disabled={disabled}
              onClick={handleTileClick}
              onDrop={handleTileDrop}
              onContextMenu={handleTileContextMenu}
            />
          ))}
        </div>
      </div>
    </Board3DErrorBoundary>
  );
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
    : interaction?.isLegal
      ? "#6f6331"
      : interaction?.hasPiece
        ? "#34423d"
        : "#293733";
  const emissive = interaction?.isLegal ? "#3d3311" : "#000000";

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
      rotation={[0, Math.PI / 6, 0]}
      receiveShadow
      onClick={handlePointer}
      onContextMenu={handleContextMenu}
    >
      <cylinderGeometry args={[0.98, 0.98, 0.14, 6]} />
      <meshStandardMaterial
        color={color}
        emissive={emissive}
        emissiveIntensity={interaction?.isLegal ? 0.42 : 0}
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
  manifest: BoardModelManifest;
  onAssetFailure?: (path: string) => void;
  interaction?: Board3DTileInteraction;
  readOnly: boolean;
  disabled: boolean;
  onClick: (coord: HexCoord) => void;
  onContextMenu: (coord: HexCoord, event: { clientX: number; clientY: number }) => void;
}) {
  const [assetFailed, setAssetFailed] = useState(false);
  const resolved = resolveBoardModel(piece, manifest);
  const [x, y, z] = axialToBoardPosition(piece.position, 1);
  const visualIdentity =
    piece.pieceType === "wizard" ? visualCatalog.wizard(piece) : visualCatalog.unit(piece);
  const resolvedAssetPath = resolved.status === "available" ? resolved.entry.path : null;
  const handleAssetFailure = useCallback(() => {
    setAssetFailed(true);
    if (resolvedAssetPath) {
      onAssetFailure?.(resolvedAssetPath);
    }
  }, [onAssetFailure, resolvedAssetPath]);

  const innerPiece =
    resolved.status === "available" && !assetFailed ? (
      <LoadableModelPiece
        path={resolved.entry.path}
        scale={resolved.entry.scale}
        position={[0, 0, 0]}
        side={piece.side}
        coord={piece.position}
        readOnly={readOnly}
        disabled={disabled}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onAssetFailure={handleAssetFailure}
      />
    ) : (
      <FallbackPieceMarker
        position={[0, 0.04, 0]}
        side={piece.side}
        pieceType={piece.pieceType}
        visualIdentity={visualIdentity}
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
  path,
  scale,
  position,
  side,
  coord,
  readOnly,
  disabled,
  onClick,
  onContextMenu,
  onAssetFailure,
}: {
  path: string;
  scale: number;
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
    const loader = new GLTFLoader();

    loader.load(
      path,
      (gltf) => {
        if (cancelled) {
          return;
        }

        const clone = gltf.scene.clone(true);
        normalizeModel(clone, scale);
        setModel(clone);
      },
      undefined,
      () => {
        if (!cancelled) {
          onAssetFailure();
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [onAssetFailure, path, scale]);

  if (!model) {
    return null;
  }

  return (
    <primitive
      object={model}
      position={position}
      rotation={[0, side === "player" ? Math.PI : 0, 0]}
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

function FallbackPieceMarker({
  position,
  side,
  pieceType,
  visualIdentity,
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
  visualIdentity: UnitVisualIdentity | WizardVisualIdentity;
  selected: boolean;
  legalTarget: boolean;
  coord: HexCoord;
  readOnly: boolean;
  disabled: boolean;
  onClick: (coord: HexCoord) => void;
  onContextMenu: (coord: HexCoord, event: { clientX: number; clientY: number }) => void;
}) {
  const sideColor = side === "player" ? "#77b36f" : "#d1665a";
  const height = pieceType === "wizard" ? 0.72 : 0.52;
  const ringColor = selected ? "#fffaf0" : legalTarget ? "#d9b84f" : "#101312";

  return (
    <group
      position={position}
      userData={{ label: visualIdentity.name }}
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
        <torusGeometry args={[0.52, 0.035, 8, 28]} />
        <meshStandardMaterial color={ringColor} emissive={ringColor} emissiveIntensity={0.22} />
      </mesh>
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[0.36, 0.48, height, 8]} />
        <meshStandardMaterial color={sideColor} roughness={0.54} />
      </mesh>
      <mesh position={[0, height + 0.11, 0]}>
        <sphereGeometry args={[0.22, 16, 12]} />
        <meshStandardMaterial color="#fffaf0" roughness={0.45} />
      </mesh>
      <mesh position={[0, 1.04, 0]}>
        <boxGeometry args={[0.42, 0.12, 0.08]} />
        <meshStandardMaterial color="#101312" roughness={0.5} />
      </mesh>
    </group>
  );
}

function Board3DHitTarget({
  interaction,
  readOnly,
  disabled,
  onClick,
  onDrop,
  onContextMenu,
}: {
  interaction: Board3DTileInteraction;
  readOnly: boolean;
  disabled: boolean;
  onClick: (coord: HexCoord) => void;
  onDrop: (coord: HexCoord, cardId: string) => void;
  onContextMenu: (coord: HexCoord, event: { clientX: number; clientY: number }) => void;
}) {
  const [x, , z] = axialToBoardPosition(interaction.coord, 1);
  const left = 50 + x * 8.25;
  const top = 50 + z * 7.2;
  const className = [
    "board-3d-hit-target",
    interaction.hasPiece ? "occupied" : "",
    interaction.pieceSide ? `occupied-${interaction.pieceSide}` : "",
    interaction.isLegal ? "legal" : "",
    interaction.isSelected ? "selected-piece" : "",
    interaction.isFocused ? "keyboard-focused" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={className}
      style={{ left: `${left}%`, top: `${top}%` }}
      disabled={disabled && !readOnly}
      tabIndex={readOnly ? -1 : undefined}
      aria-label={interaction.title}
      title={interaction.title}
      data-board-3d-tile={coordKey(interaction.coord)}
      data-legal={interaction.isLegal ? "true" : "false"}
      onClick={() => onClick(interaction.coord)}
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
