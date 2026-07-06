import { type ThreeEvent } from "@react-three/fiber";
import { BOARD_3D_TILE_ROTATION_Y, axialToBoardPosition } from "../boardRenderer";
import type { HexCoord, HexTile } from "../types";
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
