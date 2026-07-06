// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PieceMesh } from "./PieceMesh";
import type { BoardPieceVisualManifest } from "../board3dModelManifest";
import type { MatchVisualCatalog, UnitVisualIdentity } from "../matchVisualIdentity";

const frame = vi.hoisted(() => ({
  useFrame: vi.fn(),
}));

vi.mock("@react-three/fiber", () => ({
  useFrame: frame.useFrame,
}));

afterEach(() => cleanup());

describe("PieceMesh", () => {
  it("renders a procedural unit when the manifest has no model asset", () => {
    const { container } = render(
      <PieceMesh
        piece={{
          pieceType: "unit",
          id: "unit-1",
          side: "player",
          name: "Ember Squire",
          templateId: "ember-squire",
          attack: 2,
          attackRange: 1,
          armor: 2,
          maxArmor: 2,
          position: { q: 0, r: 1 },
          apRemaining: 1,
          maxAp: 1,
          hasAttacked: false,
          items: [],
        }}
        visualCatalog={visualCatalog}
        manifest={manifest}
        interaction={{
          coord: { q: 0, r: 1 },
          title: "tile",
          disabled: false,
          isLegal: true,
          isSelected: true,
          hasPiece: true,
        }}
        readOnly={false}
        disabled={false}
        onClick={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );

    expect(frame.useFrame).toHaveBeenCalled();
    expect(container.querySelectorAll("group").length).toBeGreaterThan(1);
    expect(container.querySelector("torusgeometry")).toBeInTheDocument();
  });
});

const manifest: BoardPieceVisualManifest = {
  heroes: {},
  units: {
    "ember-squire": {
      procedural: {
        family: "humanoid",
        scale: 1,
        palette: {
          primary: "#d1665a",
          secondary: "#4a241e",
          accent: "#ffd08a",
        },
        silhouette: {
          body: "medium",
          weapon: "sword",
          shield: "buckler",
          motion: "grounded",
        },
      },
    },
  },
};

const visualCatalog: MatchVisualCatalog = {
  card: vi.fn(),
  hero: vi.fn(),
  unit: vi.fn((): UnitVisualIdentity => ({
    status: "resolved",
    templateId: "ember-squire",
    name: "Ember Squire",
    rarity: "basic",
    portraitPath: null,
    portraitAlt: "Ember Squire portrait",
    fallbackLabel: "EMB",
    baseStats: null,
  })),
};
