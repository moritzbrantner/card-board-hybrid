import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";
import { BOARD_HERO_APPEARANCE_RECIPES } from "./board3dModelManifest";
import { ProceduralMiniature } from "./Board3D/ProceduralMiniature";
import { baseHeroAppearanceId, type HeroAppearanceId } from "./heroAppearances";
import type { HeroType } from "./types";

type HeroPreview3DProps = {
  heroType: HeroType;
  label: string;
  appearanceId?: HeroAppearanceId | null;
};

export function HeroPreview3D({ heroType, label, appearanceId }: HeroPreview3DProps) {
  const recipe =
    BOARD_HERO_APPEARANCE_RECIPES[appearanceId ?? ""] ??
    BOARD_HERO_APPEARANCE_RECIPES[baseHeroAppearanceId(heroType)];

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
        <Suspense fallback={null}>
          <group rotation={[0, -0.38, 0]}>
            <ProceduralMiniature
              position={[0, 0.02, 0]}
              side="player"
              pieceType="hero"
              visualIdentity={{
                status: "resolved",
                heroType,
                name: label,
                portraitPath: `/hero-art/${heroType}.svg`,
                portraitAlt: `${label} portrait`,
                accentClass: heroType,
                fallbackLabel: label.slice(0, 3).toUpperCase(),
              }}
              recipe={recipe}
              selected={false}
              legalTarget={false}
              coord={{ q: 0, r: 0 }}
              readOnly
              disabled
              onClick={() => undefined}
              onContextMenu={() => undefined}
            />
          </group>
        </Suspense>
      </Canvas>
    </div>
  );
}
