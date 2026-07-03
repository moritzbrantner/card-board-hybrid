import type { Unit, Wizard, WizardType } from "./types";

type PieceWithIdentity =
  | (Wizard & { pieceType: "wizard"; name: string })
  | (Unit & { pieceType: "unit" });

export type BoardModelManifestEntry = {
  kind: "gltf";
  path: string;
  scale: number;
};

export type BoardModelManifest = {
  wizards: Partial<Record<WizardType, BoardModelManifestEntry>>;
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
  wizards: {
    runekeeper: {
      kind: "gltf",
      path: "/models/wizards/runekeeper.glb",
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
    piece.pieceType === "wizard"
      ? manifest.wizards[piece.wizardType]
      : piece.templateId
        ? manifest.units[piece.templateId]
        : undefined;

  if (entry) {
    return { status: "available", entry };
  }

  return { status: "fallback", reason: "missing-manifest" };
}
