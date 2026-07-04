import type { Unit, Hero, HeroType } from "./types";

type PieceWithIdentity =
  | (Hero & { pieceType: "hero"; name: string })
  | (Unit & { pieceType: "unit" });

export type BoardModelManifestEntry = {
  kind: "gltf";
  path: string;
  scale: number;
};

export type BoardModelManifest = {
  heroes: Partial<Record<HeroType, BoardModelManifestEntry>>;
  units: Record<string, BoardModelManifestEntry>;
};

export type ResolvedBoardModel =
  | {
      status: "available";
      entry: BoardModelManifestEntry;
    }
  | {
      status: "fallback";
      reason: "missing-manifest";
    };

export const BOARD_MODEL_MANIFEST = {
  heroes: {
    runekeeper: {
      kind: "gltf",
      path: "/models/heroes/runekeeper.glb",
      scale: 0.82,
    },
  },
  units: {
    "ember-squire": {
      kind: "gltf",
      path: "/models/units/ember-squire.glb",
      scale: 0.72,
    },
  },
} as const satisfies BoardModelManifest;

export function resolveBoardModel(
  piece: PieceWithIdentity,
  manifest: BoardModelManifest = BOARD_MODEL_MANIFEST,
): ResolvedBoardModel {
  const entry =
    piece.pieceType === "hero"
      ? manifest.heroes[piece.heroType]
      : piece.templateId
        ? manifest.units[piece.templateId]
        : undefined;

  if (entry) {
    return { status: "available", entry };
  }

  return { status: "fallback", reason: "missing-manifest" };
}
