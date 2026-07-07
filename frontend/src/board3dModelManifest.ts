import type { Unit, Hero, HeroType } from "./types";
import type { HeroVisualIdentity, UnitVisualIdentity } from "./matchVisualIdentity";
import type { HeroAppearanceId } from "./heroAppearances";

type PieceWithIdentity =
  | (Hero & { pieceType: "hero"; name: string })
  | (Unit & { pieceType: "unit" });

export type BoardModelAssetEntry = {
  kind: "gltf";
  path: string;
  scale: number;
  rotationY?: number;
  yOffset?: number;
};

export type ProceduralMiniatureFamily =
  | "humanoid"
  | "beast"
  | "construct"
  | "caster"
  | "fortress";

export type ProceduralMiniatureRecipe = {
  family: ProceduralMiniatureFamily;
  scale: number;
  palette: {
    primary: string;
    secondary: string;
    accent: string;
    glow?: string;
  };
  silhouette: {
    body: "light" | "medium" | "heavy" | "towering";
    weapon?: "sword" | "axe" | "spear" | "staff" | "bow" | "claws" | "hammer";
    shield?: "none" | "buckler" | "tower";
    motion?: "grounded" | "runner" | "leaping" | "floating";
  };
  heroAppearance?: HeroProceduralAppearanceRecipe;
};

export type HeroProceduralAppearanceRecipe = {
  id: HeroAppearanceId;
  heroType: HeroType;
  motif:
    | "runes"
    | "flame"
    | "time"
    | "shield"
    | "arcaneBlade"
    | "axe"
    | "bow"
    | "hammer";
  trim: "plain" | "adept" | "mastery";
};

export type BoardPieceVisualEntry = {
  modelAsset?: BoardModelAssetEntry;
  procedural: ProceduralMiniatureRecipe;
};

export type BoardPieceVisualManifest = {
  heroes: Partial<Record<HeroType, BoardPieceVisualEntry>>;
  units: Record<string, BoardPieceVisualEntry>;
};

export type ResolvedBoardPieceVisual =
  | {
      source: "model";
      modelAsset: BoardModelAssetEntry;
      procedural: ProceduralMiniatureRecipe;
    }
  | {
      source: "procedural";
      procedural: ProceduralMiniatureRecipe;
      reason: "missing-asset" | "unknown-template";
    };

const UNKNOWN_UNIT_PROCEDURAL: ProceduralMiniatureRecipe = {
  family: "humanoid",
  scale: 0.92,
  palette: {
    primary: "#6f7471",
    secondary: "#2b302e",
    accent: "#d9b84f",
  },
  silhouette: {
    body: "medium",
    weapon: "spear",
    shield: "none",
    motion: "grounded",
  },
};

export const BOARD_PIECE_VISUAL_MANIFEST = {
  heroes: {
    runekeeper: {
      procedural: procedural("caster", 1.08, "#58b7a1", "#1e403a", "#d9b84f", {
        body: "medium",
        weapon: "staff",
        shield: "none",
        motion: "floating",
      }),
    },
    pyromancer: heroRecipe("#d1665a", "#4a1f1a", "#ffd08a"),
    chronomancer: heroRecipe("#7aa7d9", "#253a56", "#b6f0ff"),
    warden: heroRecipe("#77b36f", "#243d26", "#e8f5d6"),
    battlemage: heroRecipe("#b06ad9", "#39234f", "#f0d7ff"),
    barbarian: heroRecipe("#b75343", "#49261e", "#f2c66d"),
    archer: heroRecipe("#4f9a71", "#1f3a29", "#e9f4a3"),
    builder: heroRecipe("#c49b54", "#4b3820", "#e7eef4"),
  },
  units: {
    "ember-squire": proceduralEntry("humanoid", 0.9, "#d1665a", "#4a241e", "#ffd08a", {
      body: "medium",
      weapon: "sword",
      shield: "buckler",
      motion: "grounded",
    }),
    "swift-familiar": proceduralEntry("beast", 0.72, "#7aa7d9", "#25384a", "#b6f0ff", {
      body: "light",
      weapon: "claws",
      shield: "none",
      motion: "leaping",
    }),
    stoneguard: proceduralEntry("fortress", 1.02, "#7e8f82", "#29322d", "#e8f5d6", {
      body: "heavy",
      weapon: "hammer",
      shield: "tower",
      motion: "grounded",
    }),
    "rune-bruiser": proceduralEntry("humanoid", 0.98, "#9b6fca", "#332442", "#d9b84f", {
      body: "heavy",
      weapon: "axe",
      shield: "none",
      motion: "grounded",
    }),
    "blade-dancer": proceduralEntry("humanoid", 0.88, "#58b7a1", "#173c35", "#f7f3ea", {
      body: "light",
      weapon: "sword",
      shield: "none",
      motion: "runner",
    }),
    "shield-adept": proceduralEntry("humanoid", 0.96, "#77b36f", "#243d26", "#e8f5d6", {
      body: "heavy",
      weapon: "spear",
      shield: "tower",
      motion: "grounded",
    }),
    "rune-runner": proceduralEntry("humanoid", 0.82, "#4f9a71", "#1f3a29", "#d9b84f", {
      body: "light",
      weapon: "spear",
      shield: "none",
      motion: "runner",
    }),
    "ash-hound": proceduralEntry("beast", 0.86, "#b75343", "#2c211f", "#f2c66d", {
      body: "light",
      weapon: "claws",
      shield: "none",
      motion: "leaping",
    }),
    "ridge-berserker": proceduralEntry("humanoid", 0.94, "#b75343", "#3f211c", "#d9b84f", {
      body: "medium",
      weapon: "axe",
      shield: "none",
      motion: "grounded",
    }),
    pathfinder: proceduralEntry("humanoid", 0.82, "#5f9f77", "#1f3b2b", "#e9f4a3", {
      body: "light",
      weapon: "bow",
      shield: "none",
      motion: "runner",
    }),
    "field-mason": proceduralEntry("construct", 0.94, "#c49b54", "#4b3820", "#e7eef4", {
      body: "medium",
      weapon: "hammer",
      shield: "buckler",
      motion: "grounded",
    }),
    "prism-initiate": proceduralEntry("caster", 0.84, "#d8c8ff", "#33255a", "#b6f0ff", {
      body: "medium",
      weapon: "staff",
      shield: "none",
      motion: "floating",
    }),
    "glass-duelist": proceduralEntry("humanoid", 0.84, "#b6f0ff", "#1d3840", "#f7f3ea", {
      body: "light",
      weapon: "sword",
      shield: "none",
      motion: "runner",
    }),
    "flame-weaver": proceduralEntry("caster", 0.94, "#d1665a", "#4a1f1a", "#ffd08a", {
      body: "medium",
      weapon: "staff",
      shield: "none",
      motion: "floating",
    }),
    "iron-colossus": proceduralEntry("construct", 1.18, "#8d9694", "#2b302e", "#d9b84f", {
      body: "towering",
      weapon: "hammer",
      shield: "tower",
      motion: "grounded",
    }),
    "phoenix-adept": proceduralEntry("caster", 1, "#d1665a", "#4a1f1a", "#ffd08a", {
      body: "medium",
      weapon: "staff",
      shield: "none",
      motion: "floating",
    }, "#ff9f5a"),
    "vanguard-golem": proceduralEntry("construct", 1.08, "#7e8f82", "#29322d", "#d9b84f", {
      body: "heavy",
      weapon: "spear",
      shield: "tower",
      motion: "grounded",
    }),
  },
} as const satisfies BoardPieceVisualManifest;

export function resolveBoardPieceVisual(
  piece: PieceWithIdentity,
  visualIdentity: UnitVisualIdentity | HeroVisualIdentity,
  appearanceIdOrManifest?: HeroAppearanceId | BoardPieceVisualManifest | null,
  manifestOverride?: BoardPieceVisualManifest,
): ResolvedBoardPieceVisual {
  const appearanceId = typeof appearanceIdOrManifest === "string" ? appearanceIdOrManifest : null;
  const manifest =
    typeof appearanceIdOrManifest === "object" && appearanceIdOrManifest !== null
      ? appearanceIdOrManifest
      : manifestOverride ?? BOARD_PIECE_VISUAL_MANIFEST;
  const unitEntries = manifest.units as Record<string, BoardPieceVisualEntry>;
  const entry: BoardPieceVisualEntry | undefined = piece.pieceType === "hero"
    ? appearanceId
      ? resolveHeroVisualEntry(piece.heroType, appearanceId, manifest)
      : manifest.heroes[piece.heroType]
    : unitEntries[
        piece.templateId ?? ("templateId" in visualIdentity ? visualIdentity.templateId : null) ?? ""
      ];

  if (!entry) {
    return {
      source: "procedural",
      procedural: UNKNOWN_UNIT_PROCEDURAL,
      reason: "unknown-template",
    };
  }

  if (!entry.modelAsset) {
    return {
      source: "procedural",
      procedural: entry.procedural,
      reason: "missing-asset",
    };
  }

  return {
    source: "model",
    modelAsset: entry.modelAsset,
    procedural: entry.procedural,
  };
}

export const BOARD_HERO_APPEARANCE_RECIPES: Record<string, ProceduralMiniatureRecipe> = {
  "runekeeper-base": heroAppearance("runekeeper", "runekeeper-base", "runes", "plain", "#58b7a1", "#1e403a", "#d9b84f"),
  "runekeeper-jade-archivist": heroAppearance("runekeeper", "runekeeper-jade-archivist", "runes", "adept", "#66c7a9", "#183f39", "#b8e986"),
  "runekeeper-golden-sigilist": heroAppearance("runekeeper", "runekeeper-golden-sigilist", "runes", "mastery", "#70cdb2", "#263928", "#f3c969"),
  "pyromancer-base": heroAppearance("pyromancer", "pyromancer-base", "flame", "plain", "#d1665a", "#4a1f1a", "#ffd08a"),
  "pyromancer-ember-mantle": heroAppearance("pyromancer", "pyromancer-ember-mantle", "flame", "adept", "#e2774f", "#552116", "#ffb35c"),
  "pyromancer-inferno-crown": heroAppearance("pyromancer", "pyromancer-inferno-crown", "flame", "mastery", "#f05d3f", "#46130f", "#ffe08a"),
  "chronomancer-base": heroAppearance("chronomancer", "chronomancer-base", "time", "plain", "#7aa7d9", "#253a56", "#b6f0ff"),
  "chronomancer-glass-hour": heroAppearance("chronomancer", "chronomancer-glass-hour", "time", "adept", "#a9c8f0", "#263a63", "#d7fbff"),
  "chronomancer-starclock": heroAppearance("chronomancer", "chronomancer-starclock", "time", "mastery", "#8fb9f2", "#1f2f59", "#f6f0a4"),
  "warden-base": heroAppearance("warden", "warden-base", "shield", "plain", "#77b36f", "#243d26", "#e8f5d6"),
  "warden-mossguard": heroAppearance("warden", "warden-mossguard", "shield", "adept", "#6fa66a", "#28442c", "#b8d98a"),
  "warden-ironroot": heroAppearance("warden", "warden-ironroot", "shield", "mastery", "#82916f", "#25352b", "#d7c27a"),
  "battlemage-base": heroAppearance("battlemage", "battlemage-base", "arcaneBlade", "plain", "#b06ad9", "#39234f", "#f0d7ff"),
  "battlemage-arc-duelist": heroAppearance("battlemage", "battlemage-arc-duelist", "arcaneBlade", "adept", "#c07bea", "#31204a", "#dff7ff"),
  "battlemage-stormplate": heroAppearance("battlemage", "battlemage-stormplate", "arcaneBlade", "mastery", "#8c83d9", "#24324f", "#c7f2ff"),
  "barbarian-base": heroAppearance("barbarian", "barbarian-base", "axe", "plain", "#b75343", "#49261e", "#f2c66d"),
  "barbarian-warpaint": heroAppearance("barbarian", "barbarian-warpaint", "axe", "adept", "#c95e4f", "#4d211f", "#f0e0c2"),
  "barbarian-ironhide-ravager": heroAppearance("barbarian", "barbarian-ironhide-ravager", "axe", "mastery", "#a84e42", "#2f2f31", "#d6b064"),
  "archer-base": heroAppearance("archer", "archer-base", "bow", "plain", "#4f9a71", "#1f3a29", "#e9f4a3"),
  "archer-trail-scout": heroAppearance("archer", "archer-trail-scout", "bow", "adept", "#5aa47d", "#223b2b", "#cfe89b"),
  "archer-moonshot": heroAppearance("archer", "archer-moonshot", "bow", "mastery", "#5f9f98", "#1e3540", "#dfeeff"),
  "builder-base": heroAppearance("builder", "builder-base", "hammer", "plain", "#c49b54", "#4b3820", "#e7eef4"),
  "builder-field-engineer": heroAppearance("builder", "builder-field-engineer", "hammer", "adept", "#c7a76a", "#4c3b24", "#b9d6e8"),
  "builder-runeforge": heroAppearance("builder", "builder-runeforge", "hammer", "mastery", "#c49b54", "#2f3b3f", "#9ee8d4"),
};

export const BOARD_HERO_APPEARANCE_MODEL_ASSETS: Partial<Record<HeroAppearanceId, BoardModelAssetEntry>> = {
  "runekeeper-base": {
    kind: "gltf",
    path: "/models/heroes/runekeeper.glb",
    scale: 1.05,
  },
  "pyromancer-base": {
    kind: "gltf",
    path: "/models/heroes/pyromancer.glb",
    scale: 1.05,
  },
  "warden-base": {
    kind: "gltf",
    path: "/models/heroes/warden.glb",
    scale: 1.08,
  },
};

function resolveHeroVisualEntry(
  heroType: HeroType,
  appearanceId: HeroAppearanceId | null | undefined,
  manifest: BoardPieceVisualManifest,
): BoardPieceVisualEntry | undefined {
  const requested = appearanceId ? BOARD_HERO_APPEARANCE_RECIPES[appearanceId] : null;
  if (requested?.heroAppearance?.heroType === heroType) {
    return {
      modelAsset: BOARD_HERO_APPEARANCE_MODEL_ASSETS[appearanceId ?? ""],
      procedural: requested,
    };
  }

  const baseAppearanceId = `${heroType}-base`;
  const base = BOARD_HERO_APPEARANCE_RECIPES[baseAppearanceId];
  if (base) {
    return {
      modelAsset: BOARD_HERO_APPEARANCE_MODEL_ASSETS[baseAppearanceId],
      procedural: base,
    };
  }

  return manifest.heroes[heroType];
}

function heroRecipe(primary: string, secondary: string, accent: string): BoardPieceVisualEntry {
  return {
    procedural: procedural("caster", 1.08, primary, secondary, accent, {
      body: "medium",
      weapon: "staff",
      shield: "none",
      motion: "floating",
    }),
  };
}

function proceduralEntry(
  family: ProceduralMiniatureFamily,
  scale: number,
  primary: string,
  secondary: string,
  accent: string,
  silhouette: ProceduralMiniatureRecipe["silhouette"],
  glow?: string,
): BoardPieceVisualEntry {
  return {
    procedural: procedural(family, scale, primary, secondary, accent, silhouette, glow),
  };
}

function procedural(
  family: ProceduralMiniatureFamily,
  scale: number,
  primary: string,
  secondary: string,
  accent: string,
  silhouette: ProceduralMiniatureRecipe["silhouette"],
  glow?: string,
): ProceduralMiniatureRecipe {
  return {
    family,
    scale,
    palette: {
      primary,
      secondary,
      accent,
      glow,
    },
    silhouette,
  };
}

function heroAppearance(
  heroType: HeroType,
  id: HeroAppearanceId,
  motif: HeroProceduralAppearanceRecipe["motif"],
  trim: HeroProceduralAppearanceRecipe["trim"],
  primary: string,
  secondary: string,
  accent: string,
): ProceduralMiniatureRecipe {
  const silhouette = heroSilhouette(heroType);
  return {
    family: heroType === "warden" ? "fortress" : heroType === "builder" ? "construct" : "caster",
    scale: heroType === "barbarian" || heroType === "warden" ? 1.12 : 1.08,
    palette: {
      primary,
      secondary,
      accent,
      glow: accent,
    },
    silhouette,
    heroAppearance: {
      id,
      heroType,
      motif,
      trim,
    },
  };
}

function heroSilhouette(heroType: HeroType): ProceduralMiniatureRecipe["silhouette"] {
  switch (heroType) {
    case "warden":
      return { body: "heavy", weapon: "spear", shield: "tower", motion: "grounded" };
    case "battlemage":
      return { body: "heavy", weapon: "sword", shield: "buckler", motion: "grounded" };
    case "barbarian":
      return { body: "heavy", weapon: "axe", shield: "none", motion: "grounded" };
    case "archer":
      return { body: "light", weapon: "bow", shield: "none", motion: "runner" };
    case "builder":
      return { body: "heavy", weapon: "hammer", shield: "buckler", motion: "grounded" };
    case "runekeeper":
    case "pyromancer":
    case "chronomancer":
      return { body: "medium", weapon: "staff", shield: "none", motion: "floating" };
  }
}
