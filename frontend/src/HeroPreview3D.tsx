import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useState } from "react";
import { Box3, Object3D, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BOARD_PIECE_VISUAL_MANIFEST, type BoardPieceVisualManifest } from "./board3dModelManifest";
import type { HeroType } from "./types";

type HeroPreview3DProps = {
  heroType: HeroType;
  label: string;
};

const HERO_COLORS: Record<HeroType, { body: string; accent: string }> = {
  runekeeper: { body: "#58b7a1", accent: "#d9b84f" },
  pyromancer: { body: "#d1665a", accent: "#ffd08a" },
  chronomancer: { body: "#7aa7d9", accent: "#b6f0ff" },
  warden: { body: "#77b36f", accent: "#e8f5d6" },
  battlemage: { body: "#b06ad9", accent: "#f0d7ff" },
  barbarian: { body: "#b75343", accent: "#f2c66d" },
  archer: { body: "#4f9a71", accent: "#e9f4a3" },
  builder: { body: "#c49b54", accent: "#e7eef4" },
};

export function HeroPreview3D({ heroType, label }: HeroPreview3DProps) {
  return (
    <div className="hero-preview-3d" aria-label={`${label} 3D preview`}>
      <Canvas
        camera={{ position: [0, 1.35, 3.35], fov: 34, near: 0.1, far: 20 }}
        dpr={[1, 1.6]}
        gl={{ antialias: true, alpha: true }}
        onCreated={({ camera }) => camera.lookAt(0, 0.65, 0)}
      >
        <ambientLight intensity={0.9} />
        <directionalLight position={[2, 4, 3]} intensity={1.8} />
        <pointLight position={[-2, 2.2, 2.2]} intensity={0.8} />
        <Suspense fallback={<ProceduralHero heroType={heroType} />}>
          <HeroModelOrFallback heroType={heroType} />
        </Suspense>
      </Canvas>
    </div>
  );
}

function HeroModelOrFallback({ heroType }: { heroType: HeroType }) {
  const manifest: BoardPieceVisualManifest = BOARD_PIECE_VISUAL_MANIFEST;
  const entry = manifest.heroes[heroType]?.modelAsset;
  const [model, setModel] = useState<Object3D | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setModel(null);
    setFailed(false);
    if (!entry) {
      setFailed(true);
      return;
    }

    let cancelled = false;
    const loader = new GLTFLoader();
    loader.load(
      entry.path,
      (gltf) => {
        if (cancelled) {
          return;
        }
        const scene = gltf.scene.clone(true);
        normalizeModel(scene, entry.scale);
        setModel(scene);
      },
      undefined,
      () => {
        if (!cancelled) {
          setFailed(true);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [entry, heroType]);

  if (failed || !model) {
    return <ProceduralHero heroType={heroType} />;
  }

  return <primitive object={model} rotation={[0, -0.42, 0]} />;
}

function ProceduralHero({ heroType }: { heroType: HeroType }) {
  const colors = HERO_COLORS[heroType];
  const staffTilt = heroType === "chronomancer" ? -0.3 : 0.16;

  return (
    <group rotation={[0, -0.38, 0]}>
      <mesh position={[0, 0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.46, 0.035, 12, 42]} />
        <meshStandardMaterial color={colors.accent} emissive={colors.accent} emissiveIntensity={0.18} />
      </mesh>
      <mesh position={[0, 0.42, 0]}>
        <coneGeometry args={[0.34, 0.78, 6]} />
        <meshStandardMaterial color={colors.body} roughness={0.52} />
      </mesh>
      <mesh position={[0, 0.92, 0]}>
        <sphereGeometry args={[0.18, 22, 18]} />
        <meshStandardMaterial color="#fffaf0" roughness={0.42} />
      </mesh>
      <mesh position={[0, 1.16, 0]} rotation={[0, 0, 0.08]}>
        <coneGeometry args={[0.22, 0.28, 6]} />
        <meshStandardMaterial color="#101312" roughness={0.48} />
      </mesh>
      <group position={[0.36, 0.54, 0]} rotation={[0, 0, staffTilt]}>
        <mesh position={[0, 0.12, 0]}>
          <cylinderGeometry args={[0.025, 0.025, 0.92, 10]} />
          <meshStandardMaterial color="#6f5837" roughness={0.65} />
        </mesh>
        <mesh position={[0, 0.62, 0]}>
          <octahedronGeometry args={[0.1]} />
          <meshStandardMaterial color={colors.accent} emissive={colors.accent} emissiveIntensity={0.35} />
        </mesh>
      </group>
    </group>
  );
}

function normalizeModel(model: Object3D, scale: number) {
  const box = new Box3().setFromObject(model);
  const size = new Vector3();
  const center = new Vector3();
  box.getSize(size);
  box.getCenter(center);
  const largestAxis = Math.max(size.x, size.y, size.z) || 1;
  model.position.sub(center);
  model.scale.setScalar(scale / largestAxis);
}
