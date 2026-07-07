import { type ThreeEvent } from "@react-three/fiber";
import type { ProceduralMiniatureRecipe } from "../board3dModelManifest";
import type { HeroVisualIdentity, UnitVisualIdentity } from "../matchVisualIdentity";
import type { HexCoord, Side } from "../types";
import type { Board3DPiece } from "./types";

export function ProceduralMiniature({
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
        {pieceType === "hero" ? <HeroAppearanceAdornments recipe={recipe} /> : null}
        <mesh position={[0, 0.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.34, 0.012, 8, 24]} />
          <meshStandardMaterial color={glow} emissive={glow} emissiveIntensity={0.2} />
        </mesh>
      </group>
    </group>
  );
}

function HeroAppearanceAdornments({ recipe }: { recipe: ProceduralMiniatureRecipe }) {
  const appearance = recipe.heroAppearance;
  if (!appearance) {
    return null;
  }

  const accent = recipe.palette.accent;
  const secondary = recipe.palette.secondary;
  const masteryScale = appearance.trim === "mastery" ? 1.18 : appearance.trim === "adept" ? 1.08 : 1;
  const emissiveIntensity = appearance.trim === "mastery" ? 0.42 : appearance.trim === "adept" ? 0.3 : 0.2;

  switch (appearance.motif) {
    case "runes":
      return (
        <group scale={[masteryScale, masteryScale, masteryScale]}>
          <mesh position={[0, 0.84, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.43, 0.012, 8, 32]} />
            <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={emissiveIntensity} />
          </mesh>
          {[0, 1, 2].map((index) => (
            <mesh key={index} position={[Math.cos(index * 2.1) * 0.33, 0.86, Math.sin(index * 2.1) * 0.33]}>
              <octahedronGeometry args={[0.055]} />
              <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.35} />
            </mesh>
          ))}
        </group>
      );
    case "flame":
      return (
        <group scale={[masteryScale, masteryScale, masteryScale]}>
          <mesh position={[0, 1.12, 0]} rotation={[0, 0, 0.08]}>
            <coneGeometry args={[0.18, 0.42, 7]} />
            <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={emissiveIntensity} />
          </mesh>
          <mesh position={[0.18, 0.88, 0.12]} rotation={[0.1, 0, -0.25]}>
            <coneGeometry args={[0.1, 0.28, 6]} />
            <meshStandardMaterial color={recipe.palette.primary} emissive={accent} emissiveIntensity={0.18} />
          </mesh>
        </group>
      );
    case "time":
      return (
        <group scale={[masteryScale, masteryScale, masteryScale]}>
          <mesh position={[0, 0.78, 0]} rotation={[Math.PI / 2, 0.3, 0]}>
            <torusGeometry args={[0.38, 0.011, 8, 36]} />
            <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={emissiveIntensity} />
          </mesh>
          <mesh position={[0, 0.78, 0]} rotation={[Math.PI / 2, -0.58, 0]}>
            <torusGeometry args={[0.27, 0.01, 8, 30]} />
            <meshStandardMaterial color={recipe.palette.primary} emissive={accent} emissiveIntensity={0.18} />
          </mesh>
        </group>
      );
    case "shield":
      return (
        <mesh position={[-0.42, 0.62, 0.02]} scale={[masteryScale, masteryScale, masteryScale]}>
          <boxGeometry args={[0.18, 0.56, 0.08]} />
          <meshStandardMaterial color={accent} roughness={0.5} metalness={0.14} />
        </mesh>
      );
    case "arcaneBlade":
      return (
        <group scale={[masteryScale, masteryScale, masteryScale]}>
          <mesh position={[0.42, 0.72, 0]} rotation={[0, 0, -0.66]}>
            <coneGeometry args={[0.07, 0.46, 4]} />
            <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={emissiveIntensity} />
          </mesh>
          <mesh position={[-0.28, 0.66, 0]}>
            <octahedronGeometry args={[0.09]} />
            <meshStandardMaterial color={recipe.palette.primary} emissive={accent} emissiveIntensity={0.22} />
          </mesh>
        </group>
      );
    case "axe":
      return (
        <group scale={[masteryScale, masteryScale, masteryScale]}>
          <mesh position={[0.47, 0.72, 0]} rotation={[0, 0, -0.72]}>
            <cylinderGeometry args={[0.026, 0.026, 0.72, 8]} />
            <meshStandardMaterial color={secondary} roughness={0.58} />
          </mesh>
          <mesh position={[0.66, 0.98, 0]} rotation={[0, 0, Math.PI / 2]}>
            <coneGeometry args={[0.18, 0.26, 5]} />
            <meshStandardMaterial color={accent} roughness={0.5} metalness={0.18} />
          </mesh>
        </group>
      );
    case "bow":
      return (
        <group position={[0.4, 0.7, 0]} scale={[masteryScale, masteryScale, masteryScale]}>
          <mesh rotation={[0, 0, -0.1]}>
            <torusGeometry args={[0.26, 0.014, 8, 26, Math.PI]} />
            <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.16} />
          </mesh>
          <mesh position={[0.03, 0, 0]}>
            <cylinderGeometry args={[0.01, 0.01, 0.58, 8]} />
            <meshStandardMaterial color={secondary} roughness={0.7} />
          </mesh>
        </group>
      );
    case "hammer":
      return (
        <group scale={[masteryScale, masteryScale, masteryScale]}>
          <mesh position={[0.42, 0.65, 0]} rotation={[0, 0, -0.46]}>
            <cylinderGeometry args={[0.024, 0.024, 0.68, 8]} />
            <meshStandardMaterial color={secondary} roughness={0.62} />
          </mesh>
          <mesh position={[0.56, 0.9, 0]}>
            <boxGeometry args={[0.32, 0.18, 0.18]} />
            <meshStandardMaterial color={accent} roughness={0.48} metalness={0.12} />
          </mesh>
        </group>
      );
  }
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
