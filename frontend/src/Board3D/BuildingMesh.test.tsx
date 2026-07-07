// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardSurfaceBuildingDecor } from "../buildingVisuals";
import { BuildingMesh } from "./BuildingMesh";

vi.mock("@react-three/fiber", () => ({
  useFrame: vi.fn(),
}));

afterEach(() => cleanup());

describe("BuildingMesh", () => {
  it("renders procedural geometry for each known Building visual", () => {
    for (const visualKind of [
      "manaWell",
      "stoneBastion",
      "watchtower",
      "warFoundry",
      "healingFont",
      "unknownBuilding",
    ] as const) {
      const { container, unmount } = render(<BuildingMesh decor={decor({ visualKind })} />);

      expect(container.querySelector("group")).toBeInTheDocument();
      expect(container.querySelectorAll("mesh").length).toBeGreaterThan(0);

      unmount();
    }
  });
});

function decor(
  overrides: Partial<BoardSurfaceBuildingDecor> = {},
): BoardSurfaceBuildingDecor {
  return {
    id: "building-1",
    templateId: "watchtower",
    name: "Watchtower",
    effectType: "activatedDamageLine",
    activatedThisTurn: false,
    occupiedSide: "player",
    visualKind: "watchtower",
    className: "building-visual-watchtower",
    glyph: "W",
    accent: "damage",
    ...overrides,
  };
}
