import { type ThreeEvent } from "@react-three/fiber";
import { BOARD_3D_TILE_ROTATION_Y, axialToBoardPosition } from "../boardRenderer";
import type { HexCoord, HexTile } from "../types";
import { BuildingMesh } from "./BuildingMesh";
import type { Board3DTileInteraction } from "./types";

export function HexTileMesh({
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
  const ring = Math.max(Math.abs(coord.q), Math.abs(coord.r), Math.abs(-coord.q - coord.r));
  const isSigilAxis = coord.q === 0 || coord.r === 0 || coord.q + coord.r === 0;
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
    <group
      position={[x, y, z]}
      rotation={[0, BOARD_3D_TILE_ROTATION_Y, 0]}
      onClick={handlePointer}
      onContextMenu={handleContextMenu}
    >
      <mesh receiveShadow>
        <cylinderGeometry args={[0.98, 0.98, 0.14, 6]} />
        <meshStandardMaterial
          color={color}
          emissive={emissive}
          emissiveIntensity={emissiveIntensity}
          roughness={0.78}
          metalness={0.08}
        />
      </mesh>
      <mesh position={[0, 0.077, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[ring === 3 ? 0.83 : 0.74, 0.012, 6, 36]} />
        <meshStandardMaterial
          color={isSigilAxis ? "#8b7a3b" : "#4b5a53"}
          emissive={isSigilAxis ? "#4a3d12" : "#000000"}
          emissiveIntensity={isSigilAxis ? 0.12 : 0}
          roughness={0.82}
        />
      </mesh>
      {isSigilAxis ? (
        <mesh position={[0, 0.091, 0]} rotation={[0, Math.PI / 6, 0]}>
          <boxGeometry args={[0.46, 0.018, 0.045]} />
          <meshStandardMaterial color="#77683a" emissive="#3d3311" emissiveIntensity={0.1} roughness={0.78} />
        </mesh>
      ) : null}
      {ring === 0 ? (
        <mesh position={[0, 0.096, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.24, 0.01, 6, 24]} />
          <meshStandardMaterial color="#d9b84f" emissive="#4a3d12" emissiveIntensity={0.16} roughness={0.66} />
        </mesh>
      ) : null}
      {interaction?.buildingDecor ? <BuildingMesh decor={interaction.buildingDecor} /> : null}
    </group>
  );
}
