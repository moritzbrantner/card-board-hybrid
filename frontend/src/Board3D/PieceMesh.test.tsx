// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { Object3D } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PieceMesh } from "./PieceMesh";
import type { BoardPieceVisualManifest } from "../board3dModelManifest";
import type { HeroVisualIdentity, MatchVisualCatalog, UnitVisualIdentity } from "../matchVisualIdentity";

const frame = vi.hoisted(() => ({
  useFrame: vi.fn(),
}));

const loader = vi.hoisted(() => ({
  loadGltfScene: vi.fn(),
  normalizeModel: vi.fn(),
}));

vi.mock("@react-three/fiber", () => ({
  useFrame: frame.useFrame,
}));

vi.mock("./ModelLoader", () => loader);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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

  it("loads a configured model asset for a model-backed hero", async () => {
    loader.loadGltfScene.mockResolvedValue(new Object3D());

    const { container } = render(
      <PieceMesh
        piece={makeHero("runekeeper")}
        appearanceId="runekeeper-base"
        visualCatalog={visualCatalog}
        manifest={manifest}
        readOnly={false}
        disabled={false}
        onClick={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(loader.loadGltfScene).toHaveBeenCalledWith("/models/heroes/runekeeper.glb");
    });
    await waitFor(() => {
      expect(container.querySelector("primitive")).toBeInTheDocument();
    });
    expect(loader.normalizeModel).toHaveBeenCalledWith(expect.any(Object3D), 1.05);
  });

  it("falls back to a procedural hero when a configured model asset fails", async () => {
    const onAssetFailure = vi.fn();
    loader.loadGltfScene.mockRejectedValue(new Error("asset missing"));

    const { container } = render(
      <PieceMesh
        piece={makeHero("runekeeper")}
        appearanceId="runekeeper-base"
        visualCatalog={visualCatalog}
        manifest={manifest}
        onAssetFailure={onAssetFailure}
        interaction={{
          coord: { q: 0, r: 0 },
          title: "tile",
          disabled: false,
          isLegal: false,
          isSelected: false,
          hasPiece: true,
        }}
        readOnly={false}
        disabled={false}
        onClick={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(onAssetFailure).toHaveBeenCalledWith("/models/heroes/runekeeper.glb");
    });
    await waitFor(() => {
      expect(container.querySelector("torusgeometry")).toBeInTheDocument();
    });
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
  hero: vi.fn((): HeroVisualIdentity => ({
    status: "resolved",
    heroType: "runekeeper",
    name: "Runekeeper",
    portraitPath: "/hero-art/runekeeper.svg",
    portraitAlt: "Runekeeper portrait",
    accentClass: "runekeeper",
    fallbackLabel: "RUN",
  })),
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

function makeHero(heroType: "runekeeper") {
  return {
    pieceType: "hero" as const,
    id: `hero-${heroType}`,
    side: "player" as const,
    name: "Runekeeper",
    heroType,
    hp: 20,
    maxHp: 20,
    attack: 1,
    attackRange: 1,
    position: { q: 0, r: 0 },
    apRemaining: 3,
    maxAp: 3,
    hasAttacked: false,
  };
}
