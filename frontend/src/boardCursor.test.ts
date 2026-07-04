import { describe, expect, it } from "vitest";
import {
  BOARD_CURSOR_DIRECTIONS,
  boardCursorConfirmIntent,
  initialBoardCursorCoord,
  hideBoardCursor,
  isCoordInHexRadius,
  moveBoardCursorCoord,
  type BoardCursorDirectionCommand,
} from "./boardCursor";
import type { MatchPlayerState, MatchState, Side, HeroType } from "./types";

describe("board cursor", () => {
  it("maps the six default cursor commands to radius-3 Hex movement", () => {
    const expected: Record<BoardCursorDirectionCommand, { q: number; r: number }> = {
      cursorNorthwest: { q: 0, r: -1 },
      cursorNortheast: { q: 1, r: -1 },
      cursorEast: { q: 1, r: 0 },
      cursorWest: { q: -1, r: 0 },
      cursorSouthwest: { q: -1, r: 1 },
      cursorSoutheast: { q: 0, r: 1 },
    };

    expect(BOARD_CURSOR_DIRECTIONS).toEqual(expected);
    for (const command of Object.keys(expected) as BoardCursorDirectionCommand[]) {
      expect(moveBoardCursorCoord({ q: 0, r: 0 }, command, 3)).toEqual(expected[command]);
    }
  });

  it("keeps the cursor inside the radius-3 arena", () => {
    expect(isCoordInHexRadius({ q: 3, r: 0 }, 3)).toBe(true);
    expect(isCoordInHexRadius({ q: 4, r: 0 }, 3)).toBe(false);
    expect(moveBoardCursorCoord({ q: 3, r: 0 }, "cursorEast", 3)).toEqual({ q: 3, r: 0 });
    expect(moveBoardCursorCoord({ q: 3, r: -1 }, "cursorNortheast", 3)).toEqual({
      q: 3,
      r: -1,
    });
  });

  it("initializes to the viewer Hero position", () => {
    const match = matchWithHeroPositions({ player: { q: 0, r: 3 }, opponent: { q: 0, r: -3 } });

    expect(initialBoardCursorCoord(match, "player")).toEqual({ q: 0, r: 3 });
    expect(initialBoardCursorCoord(match, "opponent")).toEqual({ q: 0, r: -3 });
  });

  it("decides confirm through selection state without changing legality rules", () => {
    expect(
      boardCursorConfirmIntent({
        coord: { q: 0, r: 2 },
        selection: null,
        focusedPiece: { id: "player-hero", side: "player" },
        viewerSide: "player",
      }),
    ).toEqual({ type: "selectPiece", pieceId: "player-hero" });

    expect(
      boardCursorConfirmIntent({
        coord: { q: 0, r: 2 },
        selection: { type: "piece", pieceId: "player-hero" },
        focusedPiece: null,
        viewerSide: "player",
      }),
    ).toEqual({ type: "targetHex", coord: { q: 0, r: 2 } });

    expect(
      boardCursorConfirmIntent({
        coord: { q: 0, r: -3 },
        selection: null,
        focusedPiece: { id: "opponent-hero", side: "opponent" },
        viewerSide: "player",
      }),
    ).toEqual({ type: "none" });
  });

  it("clears visible keyboard selection state without moving the cursor", () => {
    expect(hideBoardCursor({ coord: { q: 0, r: 2 }, visible: true })).toEqual({
      coord: { q: 0, r: 2 },
      visible: false,
    });
  });
});

function matchWithHeroPositions(positions: Record<Side, { q: number; r: number }>): MatchState {
  return {
    mode: "solo",
    round: 1,
    phase: "planning",
    activeSide: "player",
    prioritySide: null,
    player: participant("player", positions.player),
    opponent: participant("opponent", positions.opponent),
    board: { radius: 3, tiles: [], units: [], droppedItems: [] },
    actionStack: [],
    log: [],
    winner: null,
  };
}

function participant(side: Side, position: { q: number; r: number }): MatchPlayerState {
  const heroType: HeroType = side === "player" ? "runekeeper" : "pyromancer";

  return {
    side,
    mana: 5,
    maxMana: 5,
    hero: {
      id: `${side}-hero`,
      side,
      heroType,
      hp: 20,
      maxHp: 20,
      attack: 1,
      position,
      apRemaining: 3,
      maxAp: 3,
      hasAttacked: false,
    },
    hand: [],
    handCount: 0,
    deckCount: 40,
    discardCount: 0,
    progression: {
      runeIds: [],
      skillIds: [],
      effects: {
        maxHpDelta: 0,
        attackDelta: 0,
        maxApDelta: 0,
        manaDelta: 0,
        openingHandDelta: 0,
        summonedUnitArmorDelta: 0,
        firstSummonedUnitArmorDelta: 0,
        spellDamageDelta: 0,
      },
    },
  };
}
