import type { Building, Side } from "./types";

export type BuildingVisualKind =
  | "manaWell"
  | "stoneBastion"
  | "watchtower"
  | "warFoundry"
  | "healingFont"
  | "unknownBuilding";

export type BuildingEffectAccent = "mana" | "armorAura" | "attackAura" | "damage" | "healing" | "support";

export type BuildingVisualDefinition = {
  kind: BuildingVisualKind;
  className: string;
  glyph: string;
  accent: BuildingEffectAccent;
};

export type BoardSurfaceBuildingDecor = {
  id: string;
  templateId: string;
  name: string;
  effectType: Building["effect"]["type"];
  activatedThisTurn: boolean;
  occupiedSide?: Side;
  visualKind: BuildingVisualKind;
  className: string;
  glyph: string;
  accent: BuildingEffectAccent;
};

const BUILDING_VISUAL_BY_TEMPLATE = {
  "mana-well": {
    kind: "manaWell",
    className: "building-visual-mana-well",
    glyph: "M",
    accent: "mana",
  },
  "stone-bastion": {
    kind: "stoneBastion",
    className: "building-visual-stone-bastion",
    glyph: "S",
    accent: "armorAura",
  },
  watchtower: {
    kind: "watchtower",
    className: "building-visual-watchtower",
    glyph: "W",
    accent: "damage",
  },
  "war-foundry": {
    kind: "warFoundry",
    className: "building-visual-war-foundry",
    glyph: "F",
    accent: "attackAura",
  },
  "healing-font": {
    kind: "healingFont",
    className: "building-visual-healing-font",
    glyph: "H",
    accent: "healing",
  },
} as const satisfies Record<string, BuildingVisualDefinition>;

const UNKNOWN_BUILDING_VISUAL: BuildingVisualDefinition = {
  kind: "unknownBuilding",
  className: "building-visual-unknown",
  glyph: "B",
  accent: "support",
};

export function buildingVisualForTemplate(templateId: string): BuildingVisualDefinition {
  return BUILDING_VISUAL_BY_TEMPLATE[templateId as keyof typeof BUILDING_VISUAL_BY_TEMPLATE] ?? UNKNOWN_BUILDING_VISUAL;
}

export function buildingEffectAccent(effect: Building["effect"]): BuildingEffectAccent {
  switch (effect.type) {
    case "turnStartMana":
      return "mana";
    case "auraStatBonus":
      if (effect.attack > 0) {
        return "attackAura";
      }
      if (effect.armor > 0) {
        return "armorAura";
      }
      return "support";
    case "activatedDamageLine":
      return "damage";
    case "activatedHeal":
      return "healing";
    case "activatedStatBonus":
      return "support";
  }
}

export function buildingDecorForTile(
  building: Building,
  occupiedSide?: Side,
): BoardSurfaceBuildingDecor {
  const visual = buildingVisualForTemplate(building.templateId);

  return {
    id: building.id,
    templateId: building.templateId,
    name: building.name,
    effectType: building.effect.type,
    activatedThisTurn: building.activatedThisTurn,
    occupiedSide,
    visualKind: visual.kind,
    className: visual.className,
    glyph: visual.glyph,
    accent: buildingEffectAccent(building.effect),
  };
}
