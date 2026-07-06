import { describe, expect, it } from "vitest";
import {
  resolveBoardPieceVisual,
  type BoardPieceVisualManifest,
  type ProceduralMiniatureRecipe,
} from "./board3dModelManifest";
import type { HeroVisualIdentity, UnitVisualIdentity } from "./matchVisualIdentity";
import type { Unit, Hero } from "./types";

const manifest = {
  heroes: {
    runekeeper: {
      modelAsset: { kind: "gltf", path: "/models/heroes/runekeeper.glb", scale: 0.8 },
      procedural: recipe("caster"),
    },
  },
  units: {
    "ember-squire": {
      modelAsset: { kind: "gltf", path: "/models/units/ember-squire.glb", scale: 0.7 },
      procedural: recipe("humanoid"),
    },
    "ash-hound": {
      procedural: recipe("beast"),
    },
  },
} satisfies BoardPieceVisualManifest;

describe("3D board model manifest", () => {
  it("resolves configured Board model assets for known Heroes and Units", () => {
    expect(resolveBoardPieceVisual(makeHero("runekeeper"), heroVisual("runekeeper"), manifest)).toEqual({
      source: "model",
      modelAsset: manifest.heroes.runekeeper.modelAsset,
      procedural: manifest.heroes.runekeeper.procedural,
    });
    expect(resolveBoardPieceVisual(makeUnit("ember-squire"), unitVisual("ember-squire"), manifest)).toEqual({
      source: "model",
      modelAsset: manifest.units["ember-squire"].modelAsset,
      procedural: manifest.units["ember-squire"].procedural,
    });
  });

  it("uses procedural miniatures when a known piece has no configured Board model asset", () => {
    expect(resolveBoardPieceVisual(makeUnit("ash-hound"), unitVisual("ash-hound"), manifest)).toEqual({
      source: "procedural",
      procedural: manifest.units["ash-hound"].procedural,
      reason: "missing-asset",
    });
  });

  it("resolves legacy Units through the visual identity templateId", () => {
    expect(resolveBoardPieceVisual(makeUnit(undefined), unitVisual("ember-squire"), manifest)).toEqual({
      source: "model",
      modelAsset: manifest.units["ember-squire"].modelAsset,
      procedural: manifest.units["ember-squire"].procedural,
    });
  });

  it("returns an explicit unknown procedural state for unidentified Units", () => {
    const resolved = resolveBoardPieceVisual(makeUnit(undefined), unitVisual(null), manifest);

    expect(resolved).toMatchObject({
      source: "procedural",
      reason: "unknown-template",
    });
    expect(resolved.procedural.family).toBe("humanoid");
  });
});

function makeHero(heroType: Hero["heroType"]): Hero & { pieceType: "hero"; name: string } {
  return {
    pieceType: "hero",
    id: `hero-${heroType}`,
    side: "player",
    name: heroType,
    heroType,
    hp: 20,
    maxHp: 20,
    attack: 1,
    attackRange: 1,
    position: { q: 0, r: 0 },
    apRemaining: 2,
    maxAp: 2,
    hasAttacked: false,
  };
}

function unitVisual(templateId: string | null): UnitVisualIdentity {
  return {
    status: templateId ? "resolved" : "unknown",
    templateId,
    name: templateId ?? "Unknown Unit",
    rarity: templateId ? "basic" : "unknown",
    portraitPath: null,
    portraitAlt: "Unit portrait unavailable",
    fallbackLabel: "UNI",
    baseStats: null,
  };
}

function heroVisual(heroType: Hero["heroType"]): HeroVisualIdentity {
  return {
    status: "resolved",
    heroType,
    name: heroType,
    portraitPath: `/hero-art/${heroType}.svg`,
    portraitAlt: `${heroType} portrait`,
    accentClass: heroType,
    fallbackLabel: heroType.slice(0, 3).toUpperCase(),
  };
}

function recipe(family: ProceduralMiniatureRecipe["family"]): ProceduralMiniatureRecipe {
  return {
    family,
    scale: 1,
    palette: {
      primary: "#777777",
      secondary: "#333333",
      accent: "#d9b84f",
    },
    silhouette: {
      body: "medium",
      weapon: "sword",
      shield: "none",
      motion: "grounded",
    },
  };
}

function makeUnit(templateId: Unit["templateId"]): Unit & { pieceType: "unit" } {
  return {
    pieceType: "unit",
    id: "unit-1",
    side: "opponent",
    name: "Unit",
    templateId,
    attack: 2,
    attackRange: 1,
    armor: 2,
    maxArmor: 2,
    position: { q: 1, r: 0 },
    apRemaining: 1,
    maxAp: 1,
    hasAttacked: false,
    items: [],
  };
}
