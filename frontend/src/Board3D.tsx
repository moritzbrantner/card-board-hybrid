import { Canvas } from "@react-three/fiber";
import { Component, type ReactNode, useEffect, useState } from "react";
import { Box3, Object3D, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { axialToBoardPosition } from "./boardRenderer";
import {
  BOARD_MODEL_MANIFEST,
  resolveBoardModel,
  type BoardModelManifest,
} from "./board3dModelManifest";
import type { MatchVisualCatalog, UnitVisualIdentity, WizardVisualIdentity } from "./matchVisualIdentity";
import type { HexCoord, HexTile, Side, WizardType } from "./types";

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
};

export type Board3DPiece = Board3DWizard | Board3DUnit;

type Board3DProps = {
  tiles: HexTile[];
  pieces: Board3DPiece[];
  visualCatalog: MatchVisualCatalog;
  readOnly: boolean;
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
  onFatalRenderError,
  onAssetFailure,
  manifest = BOARD_MODEL_MANIFEST,
}: Board3DProps) {
  return (
    <Board3DErrorBoundary
      fallback={<div className="board-3d-fallback" role="status">3D board unavailable.</div>}
      onError={onFatalRenderError}
    >
      <div
        className="board-3d-shell"
        data-board-renderer="3d"
        data-board-read-only={readOnly ? "true" : "false"}
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
            {tiles.map((tile) => (
              <HexTileMesh key={`${tile.coord.q}:${tile.coord.r}`} coord={tile.coord} />
            ))}
            {pieces.map((piece) => (
              <PieceMesh
                key={piece.id}
                piece={piece}
                visualCatalog={visualCatalog}
                manifest={manifest}
                onAssetFailure={onAssetFailure}
              />
            ))}
          </group>
        </Canvas>
      </div>
    </Board3DErrorBoundary>
  );
}

function HexTileMesh({ coord }: { coord: HexTile["coord"] }) {
  const [x, y, z] = axialToBoardPosition(coord, 1);

  return (
    <mesh position={[x, y, z]} rotation={[0, Math.PI / 6, 0]} receiveShadow>
      <cylinderGeometry args={[0.98, 0.98, 0.14, 6]} />
      <meshStandardMaterial color="#293733" roughness={0.78} metalness={0.08} />
    </mesh>
  );
}

function PieceMesh({
  piece,
  visualCatalog,
  manifest,
  onAssetFailure,
}: {
  piece: Board3DPiece;
  visualCatalog: MatchVisualCatalog;
  manifest: BoardModelManifest;
  onAssetFailure?: (path: string) => void;
}) {
  const [assetFailed, setAssetFailed] = useState(false);
  const resolved = resolveBoardModel(piece, manifest);
  const [x, y, z] = axialToBoardPosition(piece.position, 1);
  const visualIdentity =
    piece.pieceType === "wizard" ? visualCatalog.wizard(piece) : visualCatalog.unit(piece);

  if (resolved.status === "available" && !assetFailed) {
    return (
      <LoadableModelPiece
        path={resolved.entry.path}
        scale={resolved.entry.scale}
        position={[x, y + 0.16, z]}
        side={piece.side}
        onAssetFailure={() => {
          setAssetFailed(true);
          onAssetFailure?.(resolved.entry.path);
        }}
      />
    );
  }

  return (
      <FallbackPieceMarker
        position={[x, y + 0.2, z]}
        side={piece.side}
        pieceType={piece.pieceType}
        visualIdentity={visualIdentity}
      />
  );
}

function LoadableModelPiece({
  path,
  scale,
  position,
  side,
  onAssetFailure,
}: {
  path: string;
  scale: number;
  position: [number, number, number];
  side: Side;
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
    />
  );
}

function FallbackPieceMarker({
  position,
  side,
  pieceType,
  visualIdentity,
}: {
  position: [number, number, number];
  side: Side;
  pieceType: Board3DPiece["pieceType"];
  visualIdentity: UnitVisualIdentity | WizardVisualIdentity;
}) {
  const sideColor = side === "player" ? "#77b36f" : "#d1665a";
  const height = pieceType === "wizard" ? 0.72 : 0.52;

  return (
    <group position={position} userData={{ label: visualIdentity.name }}>
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
