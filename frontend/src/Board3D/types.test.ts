import { describe, expect, it } from "vitest";
import type {
  Board3DHero,
  Board3DPiece,
  Board3DTileInteraction,
  Board3DUnit,
} from "./types";

describe("Board3D types", () => {
  it("keeps hero and unit pieces behind the shared piece contract", () => {
    const hero: Board3DHero = {
      pieceType: "hero",
      id: "player-hero",
      side: "player",
      name: "Runekeeper",
      heroType: "runekeeper",
      hp: 8,
      maxHp: 8,
      attack: 2,
      attackRange: 1,
      position: { q: 0, r: 0 },
      apRemaining: 1,
      maxAp: 1,
      hasAttacked: false,
    };
    const unit: Board3DUnit = {
      pieceType: "unit",
      id: "unit-1",
      side: "opponent",
      name: "Ember Squire",
      templateId: "ember-squire",
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
    const pieces: Board3DPiece[] = [hero, unit];

    expect(pieces.map((piece) => piece.pieceType)).toEqual(["hero", "unit"]);
  });

  it("allows tile interactions to reference piece metadata and board affordances", () => {
    const interaction: Board3DTileInteraction = {
      coord: { q: 0, r: 1 },
      title: "q 0, r 1",
      disabled: false,
      isLegal: true,
      isSelected: true,
      isFocused: true,
      tutorialHighlightTone: "primary",
      hasManaSource: true,
      hasBuilding: false,
      hasPiece: true,
      pieceSide: "player",
      pieceType: "hero",
      pieceLabel: "Hero",
      pieceStatLabel: "2/8",
      droppedItemCount: 1,
    };

    expect(interaction).toMatchObject({
      coord: { q: 0, r: 1 },
      pieceType: "hero",
      isLegal: true,
    });
  });
});
