import { describe, expect, it } from "vitest";
import {
  buildingDecorForTile,
  buildingEffectAccent,
  buildingVisualForTemplate,
} from "./buildingVisuals";
import type { Building } from "./types";

describe("building visuals", () => {
  it("maps known Building templates to stable visual identities", () => {
    expect(buildingVisualForTemplate("mana-well")).toMatchObject({
      kind: "manaWell",
      glyph: "M",
    });
    expect(buildingVisualForTemplate("stone-bastion")).toMatchObject({
      kind: "stoneBastion",
      glyph: "S",
    });
    expect(buildingVisualForTemplate("watchtower")).toMatchObject({
      kind: "watchtower",
      glyph: "W",
    });
    expect(buildingVisualForTemplate("war-foundry")).toMatchObject({
      kind: "warFoundry",
      glyph: "F",
    });
    expect(buildingVisualForTemplate("healing-font")).toMatchObject({
      kind: "healingFont",
      glyph: "H",
    });
  });

  it("falls back for unknown future Building templates", () => {
    expect(buildingVisualForTemplate("future-building")).toMatchObject({
      kind: "unknownBuilding",
      glyph: "B",
    });
  });

  it("derives effect accents from Building effects", () => {
    expect(buildingEffectAccent({ type: "turnStartMana", amount: 1 })).toBe("mana");
    expect(
      buildingEffectAccent({
        type: "auraStatBonus",
        range: 1,
        targets: "unitsOnly",
        attack: 0,
        armor: 1,
        maxAp: 0,
      }),
    ).toBe("armorAura");
    expect(
      buildingEffectAccent({
        type: "auraStatBonus",
        range: 1,
        targets: "unitsOnly",
        attack: 1,
        armor: 0,
        maxAp: 0,
      }),
    ).toBe("attackAura");
    expect(buildingEffectAccent({ type: "activatedDamageLine", range: 2, amount: 2 })).toBe("damage");
    expect(
      buildingEffectAccent({
        type: "activatedHeal",
        range: 2,
        amount: 3,
        targets: "unitsAndHeroes",
      }),
    ).toBe("healing");
  });

  it("combines template, effect, and occupation state for board decor", () => {
    const decor = buildingDecorForTile(building(), "player");

    expect(decor).toMatchObject({
      id: "building-1",
      visualKind: "watchtower",
      effectType: "activatedDamageLine",
      activatedThisTurn: false,
      occupiedSide: "player",
      accent: "damage",
    });
  });
});

function building(): Building {
  return {
    id: "building-1",
    templateId: "watchtower",
    name: "Watchtower",
    position: { q: 0, r: 0 },
    effect: { type: "activatedDamageLine", range: 2, amount: 2 },
    activatedThisTurn: false,
  };
}
