import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Group, Object3D, Vector3 } from "three";
import {
  resolveBoardPieceVisual,
  type BoardModelAssetEntry,
  type BoardPieceVisualManifest,
} from "../board3dModelManifest";
import { BOARD_ANIMATION_DURATION_MS, type PieceAnimation } from "../boardAnimations";
import { axialToBoardPosition } from "../boardRenderer";
import type { MatchVisualCatalog } from "../matchVisualIdentity";
import type { HexCoord, Side } from "../types";
import { loadGltfScene, normalizeModel } from "./ModelLoader";
import { ProceduralMiniature } from "./ProceduralMiniature";
import type { Board3DPiece, Board3DTileInteraction } from "./types";

export function PieceMesh({
  piece,
  animation,
  visualCatalog,
  manifest,
  onAssetFailure,
  interaction,
  appearanceId,
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
  appearanceId?: string | null;
  readOnly: boolean;
  disabled: boolean;
  onClick: (coord: HexCoord) => void;
  onContextMenu: (coord: HexCoord, event: { clientX: number; clientY: number }) => void;
}) {
  const [assetFailed, setAssetFailed] = useState(false);
  const [x, y, z] = axialToBoardPosition(piece.position, 1);
  const visualIdentity =
    piece.pieceType === "hero" ? visualCatalog.hero(piece) : visualCatalog.unit(piece);
  const resolved = resolveBoardPieceVisual(piece, visualIdentity, appearanceId, manifest);
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
    groupRef.current?.position?.copy(animation?.kind === "move" ? from : target);
    groupRef.current?.scale?.setScalar(animation?.kind === "summon" ? 0.35 : 1);
  }, [animation, from, target]);

  useFrame(() => {
    const group = groupRef.current;
    if (!group || !group.position || !group.scale) {
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
    } else if (piece.pieceType === "hero" && !browserPrefersReducedMotion()) {
      const idle = elapsed / 1000;
      group.position.y = target.y + Math.sin(idle * 1.9) * 0.035;
      group.rotation.y = Math.sin(idle * 1.2) * 0.035;
      group.scale.setScalar(1 + Math.sin(idle * 1.7) * 0.018);
    } else {
      group.rotation.y = 0;
      group.scale.setScalar(1);
    }
  });

  return (
    <group ref={groupRef} userData={{ animation: animation?.kind ?? "idle" }}>
      {children}
    </group>
  );
}

function browserPrefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
