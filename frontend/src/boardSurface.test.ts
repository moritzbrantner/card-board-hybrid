import { describe, expect, it } from "vitest";
import type { Board3DTileInteraction } from "./Board3D";
import { buildBoardSurface } from "./boardSurface";
import {
  emberSquireCard,
  pendingAttackStack,
  pendingMoveStack,
  pendingSpellStack,
  sparkJoltCard,
  storyMatch,
  storyUnit,
} from "./components/board.fixtures";
import { coordKey } from "./matchBoardHelpers";
import type { Building, DroppedItem } from "./types";

describe("board surface", () => {
  it("marks selected card hex targets once for both renderers", () => {
    const match = storyMatch({ hand: [emberSquireCard] });
    const surface = buildBoardSurface({
      match,
      viewerSide: "player",
      selectedCard: emberSquireCard,
      selectedPiece: null,
      focusedCoord: null,
      hoveredCoord: null,
      isInteractive: true,
    });

    expect(surface.tileByKey.get("0:0")?.isLegal).toBe(true);
    expect(surface.tileByKey.get("1:1")?.isLegal).toBe(false);

    const interactionFor3d: Board3DTileInteraction = surface.tileByKey.get("0:0")!;
    expect(interactionFor3d.isLegal).toBe(true);
    expect(surface.columns.flatMap((column) => column.tiles).map((tile) => tile.key).sort()).toEqual(
      surface.tileInteractions.map((interaction) => coordKey(interaction.coord)).sort(),
    );
  });

  it("marks selected piece movement, attack, and selected states", () => {
    const match = storyMatch();
    const selectedPiece = {
      ...match.player.hero,
      pieceType: "hero" as const,
      name: "Runekeeper",
    };
    const surface = buildBoardSurface({
      match,
      viewerSide: "player",
      selectedCard: null,
      selectedPiece,
      focusedCoord: { q: 0, r: 0 },
      hoveredCoord: null,
      isInteractive: true,
    });

    expect(surface.tileByKey.get("0:1")?.isSelected).toBe(true);
    expect(surface.tileByKey.get("0:0")?.isLegal).toBe(true);
    expect(surface.tileByKey.get("1:1")?.isLegal).toBe(true);
    expect(surface.tileByKey.get("0:0")?.isFocused).toBe(true);
  });

  it("filters stack targeting indicators by active stack row", () => {
    const surface = buildBoardSurface({
      match: storyMatch({
        actionStack: [pendingAttackStack, pendingSpellStack, pendingMoveStack],
        prioritySide: "player",
      }),
      viewerSide: "player",
      selectedCard: null,
      selectedPiece: null,
      focusedCoord: null,
      hoveredCoord: null,
      isInteractive: true,
      activeStackItemId: "story-stack-2",
    });

    expect(surface.stackIndicators.length).toBeGreaterThan(1);
    expect(surface.targetingIndicators).toHaveLength(1);
    expect(surface.targetingIndicators[0]?.source).toMatchObject({
      type: "stack",
      stackItemId: "story-stack-2",
    });
  });

  it("applies tutorial highlights by coord and piece", () => {
    const surface = buildBoardSurface({
      match: storyMatch(),
      viewerSide: "player",
      selectedCard: null,
      selectedPiece: null,
      focusedCoord: null,
      hoveredCoord: null,
      isInteractive: true,
      tutorialHighlights: [
        { kind: "coord", coord: { q: 0, r: 1 }, tone: "primary" },
        { kind: "piece", pieceId: "opponent-hero", tone: "danger" },
      ],
    });

    expect(surface.tileByKey.get("0:1")?.tutorialHighlightTone).toBe("primary");
    expect(surface.tileByKey.get("1:1")?.tutorialHighlightTone).toBe("danger");
  });

  it("includes dropped items, mana sources, and buildings in tile affordances", () => {
    const match = storyMatch({
      hand: [sparkJoltCard],
      units: [storyUnit({ q: -1, r: 1 })],
    });
    const droppedItem = droppedItemAt({ q: 0, r: 0 });
    const building = buildingAt({ q: 0, r: 0 });
    match.board.droppedItems = [droppedItem];
    match.board.manaSources = [{ q: 0, r: 0 }];
    match.board.buildings = [building];

    const surface = buildBoardSurface({
      match,
      viewerSide: "player",
      selectedCard: null,
      selectedPiece: null,
      focusedCoord: null,
      hoveredCoord: null,
      isInteractive: true,
    });
    const tile = surface.tileByKey.get("0:0");

    expect(tile?.hasManaSource).toBe(true);
    expect(tile?.hasBuilding).toBe(true);
    expect(tile?.droppedItemCount).toBe(1);
    expect(tile?.title).toContain("1 dropped item");
    expect(tile?.title).toContain("building Watchtower");
  });
});

function droppedItemAt(position: { q: number; r: number }): DroppedItem {
  return {
    id: "drop-1",
    position,
    item: {
      id: "item-1",
      templateId: "ember-flask",
      name: "Ember Flask",
      passive: { type: "statBonus", attack: 1, armor: 0, maxAp: 0 },
      activeUsedThisTurn: false,
    },
  };
}

function buildingAt(position: { q: number; r: number }): Building {
  return {
    id: "building-1",
    templateId: "watchtower",
    name: "Watchtower",
    position,
    effect: { type: "turnStartMana", amount: 1 },
    activatedThisTurn: false,
  };
}
