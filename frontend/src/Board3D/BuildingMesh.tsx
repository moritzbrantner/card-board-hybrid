import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";
import type { BoardSurfaceBuildingDecor } from "../buildingVisuals";

export function BuildingMesh({ decor }: { decor: BoardSurfaceBuildingDecor }) {
  const groupRef = useRef<Group>(null);
  const palette = buildingPalette(decor);
  const exhausted = decor.activatedThisTurn;

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || browserPrefersReducedMotion()) {
      return;
    }

    const pulse = Math.sin(clock.elapsedTime * 1.4) * 0.018;
    group.position.y = 0.115 + pulse;
  });

  return (
    <group ref={groupRef} position={[0, 0.115, 0]} userData={{ building: decor.name }}>
      <mesh position={[0, 0.015, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.61, 0.025, 8, 36]} />
        <meshStandardMaterial
          color={decor.occupiedSide ? palette.occupied : palette.accent}
          emissive={palette.emissive}
          emissiveIntensity={exhausted ? 0.08 : 0.24}
          roughness={0.68}
          metalness={0.04}
        />
      </mesh>
      <mesh position={[0, 0.01, 0]}>
        <cylinderGeometry args={[0.5, 0.56, 0.06, 6]} />
        <meshStandardMaterial color={palette.base} roughness={0.84} metalness={0.04} />
      </mesh>
      <BuildingFigure decor={decor} palette={palette} />
      {exhausted ? (
        <mesh position={[0.34, 0.11, -0.28]} rotation={[0, 0, 0.65]}>
          <boxGeometry args={[0.28, 0.035, 0.035]} />
          <meshStandardMaterial color="#8d8270" roughness={0.8} />
        </mesh>
      ) : null}
    </group>
  );
}

type BuildingPalette = {
  base: string;
  accent: string;
  secondary: string;
  emissive: string;
  occupied: string;
};

function BuildingFigure({
  decor,
  palette,
}: {
  decor: BoardSurfaceBuildingDecor;
  palette: BuildingPalette;
}) {
  switch (decor.visualKind) {
    case "manaWell":
      return (
        <group>
          <mesh position={[0, 0.11, 0]}>
            <cylinderGeometry args={[0.28, 0.34, 0.16, 18]} />
            <meshStandardMaterial color={palette.secondary} roughness={0.72} />
          </mesh>
          <mesh position={[0, 0.205, 0]}>
            <cylinderGeometry args={[0.2, 0.2, 0.018, 18]} />
            <meshStandardMaterial color={palette.accent} emissive={palette.emissive} emissiveIntensity={0.36} />
          </mesh>
          {[0, 1, 2].map((index) => (
            <mesh
              key={index}
              position={[
                Math.cos(index * 2.1) * 0.34,
                0.16,
                Math.sin(index * 2.1) * 0.34,
              ]}
            >
              <boxGeometry args={[0.09, 0.08, 0.09]} />
              <meshStandardMaterial color={palette.base} roughness={0.86} />
            </mesh>
          ))}
        </group>
      );
    case "stoneBastion":
      return (
        <group>
          <mesh position={[0, 0.15, 0]}>
            <cylinderGeometry args={[0.28, 0.36, 0.24, 6]} />
            <meshStandardMaterial color={palette.secondary} roughness={0.86} metalness={0.02} />
          </mesh>
          {[0, 1, 2].map((index) => (
            <mesh key={index} position={[(index - 1) * 0.16, 0.31, -0.16]}>
              <boxGeometry args={[0.1, 0.1, 0.12]} />
              <meshStandardMaterial color={palette.base} roughness={0.84} />
            </mesh>
          ))}
          <mesh position={[0, 0.2, 0.26]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.1, 6]} />
            <meshStandardMaterial color={palette.accent} emissive={palette.emissive} emissiveIntensity={0.18} />
          </mesh>
        </group>
      );
    case "watchtower":
      return (
        <group>
          <mesh position={[0, 0.24, 0]}>
            <cylinderGeometry args={[0.13, 0.2, 0.42, 6]} />
            <meshStandardMaterial color={palette.secondary} roughness={0.72} />
          </mesh>
          <mesh position={[0, 0.49, 0]}>
            <coneGeometry args={[0.23, 0.2, 6]} />
            <meshStandardMaterial color={palette.accent} roughness={0.58} metalness={0.08} />
          </mesh>
          <mesh position={[0, 0.29, 0.19]}>
            <boxGeometry args={[0.1, 0.12, 0.018]} />
            <meshStandardMaterial color="#181412" emissive={palette.emissive} emissiveIntensity={0.2} />
          </mesh>
        </group>
      );
    case "warFoundry":
      return (
        <group>
          <mesh position={[0, 0.13, 0]} rotation={[0, 0, 0.78]}>
            <boxGeometry args={[0.42, 0.16, 0.32]} />
            <meshStandardMaterial color={palette.secondary} roughness={0.62} metalness={0.16} />
          </mesh>
          <mesh position={[0.22, 0.24, 0.05]}>
            <cylinderGeometry args={[0.08, 0.13, 0.22, 8]} />
            <meshStandardMaterial color={palette.accent} emissive={palette.emissive} emissiveIntensity={0.28} />
          </mesh>
          <mesh position={[-0.18, 0.22, -0.06]} rotation={[0, 0, -0.45]}>
            <boxGeometry args={[0.1, 0.28, 0.08]} />
            <meshStandardMaterial color={palette.base} roughness={0.7} />
          </mesh>
        </group>
      );
    case "healingFont":
      return (
        <group>
          <mesh position={[0, 0.13, 0]}>
            <cylinderGeometry args={[0.3, 0.36, 0.18, 12]} />
            <meshStandardMaterial color={palette.secondary} roughness={0.74} />
          </mesh>
          <mesh position={[0, 0.235, 0]}>
            <torusGeometry args={[0.18, 0.025, 8, 24]} />
            <meshStandardMaterial color={palette.accent} emissive={palette.emissive} emissiveIntensity={0.24} />
          </mesh>
          <mesh position={[0, 0.34, 0]} rotation={[0, 0, Math.PI / 4]}>
            <octahedronGeometry args={[0.08]} />
            <meshStandardMaterial color={palette.accent} emissive={palette.emissive} emissiveIntensity={0.34} />
          </mesh>
        </group>
      );
    case "unknownBuilding":
      return (
        <mesh position={[0, 0.18, 0]}>
          <cylinderGeometry args={[0.24, 0.3, 0.24, 6]} />
          <meshStandardMaterial color={palette.secondary} roughness={0.78} />
        </mesh>
      );
  }
}

function buildingPalette(decor: BoardSurfaceBuildingDecor): BuildingPalette {
  const occupied = decor.occupiedSide === "opponent" ? "#d1665a" : "#77b36f";

  switch (decor.accent) {
    case "mana":
      return {
        base: "#2d342f",
        secondary: "#66582a",
        accent: "#d9b84f",
        emissive: "#9d7622",
        occupied,
      };
    case "armorAura":
      return {
        base: "#303a38",
        secondary: "#59615c",
        accent: "#7aa7d9",
        emissive: "#284963",
        occupied,
      };
    case "attackAura":
      return {
        base: "#342d28",
        secondary: "#6a4b33",
        accent: "#d1665a",
        emissive: "#7a2c22",
        occupied,
      };
    case "damage":
      return {
        base: "#322c2a",
        secondary: "#5f4b3d",
        accent: "#d9b84f",
        emissive: "#8d3a24",
        occupied,
      };
    case "healing":
      return {
        base: "#293733",
        secondary: "#3f665b",
        accent: "#58b7a1",
        emissive: "#227b6e",
        occupied,
      };
    case "support":
      return {
        base: "#303633",
        secondary: "#4c5a55",
        accent: "#f5ecd2",
        emissive: "#4a3d12",
        occupied,
      };
  }
}

function browserPrefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return (
    document.documentElement.dataset.motion === "reduced" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
