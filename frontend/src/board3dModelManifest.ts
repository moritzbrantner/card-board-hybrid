import type { Unit, Hero, HeroType } from "./types";
import type { HeroVisualIdentity, UnitVisualIdentity } from "./matchVisualIdentity";

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
      modelAsset: {
        kind: "gltf",
        path: "/models/heroes/runekeeper.glb",
        scale: 0.82,
      },
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
  manifest: BoardPieceVisualManifest = BOARD_PIECE_VISUAL_MANIFEST,
): ResolvedBoardPieceVisual {
  const entry =
    piece.pieceType === "hero"
      ? manifest.heroes[piece.heroType]
      : manifest.units[
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
