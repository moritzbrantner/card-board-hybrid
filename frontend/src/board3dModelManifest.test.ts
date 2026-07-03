import { describe, expect, it } from "vitest";
import { resolveBoardModel, type BoardModelManifest } from "./board3dModelManifest";
import type { Unit, Wizard } from "./types";

const manifest = {
  wizards: {
    runekeeper: { kind: "gltf", path: "/models/wizards/runekeeper.glb", scale: 0.8 },
  },
  units: {
    "ember-squire": { kind: "gltf", path: "/models/units/ember-squire.glb", scale: 0.7 },
  },
} satisfies BoardModelManifest;

describe("3D board model manifest", () => {
  it("resolves known Wizard and Unit model entries", () => {
    expect(resolveBoardModel(makeWizard("runekeeper"), manifest)).toEqual({
      status: "available",
      entry: manifest.wizards.runekeeper,
    });
    expect(resolveBoardModel(makeUnit("ember-squire"), manifest)).toEqual({
      status: "available",
      entry: manifest.units["ember-squire"],
    });
  });

  it("returns explicit fallback state for missing model assets", () => {
    expect(resolveBoardModel(makeWizard("pyromancer"), manifest)).toEqual({
      status: "fallback",
      reason: "missing-manifest",
    });
    expect(resolveBoardModel(makeUnit(undefined), manifest)).toEqual({
      status: "fallback",
      reason: "missing-manifest",
    });
  });
});

function makeWizard(wizardType: Wizard["wizardType"]): Wizard & { pieceType: "wizard"; name: string } {
  return {
    pieceType: "wizard",
    id: `wizard-${wizardType}`,
    side: "player",
    name: wizardType,
    wizardType,
    hp: 20,
    maxHp: 20,
    attack: 1,
    position: { q: 0, r: 0 },
    apRemaining: 2,
    maxAp: 2,
    hasAttacked: false,
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
    armor: 2,
    maxArmor: 2,
    position: { q: 1, r: 0 },
    apRemaining: 1,
    maxAp: 1,
    hasAttacked: false,
    items: [],
  };
}
