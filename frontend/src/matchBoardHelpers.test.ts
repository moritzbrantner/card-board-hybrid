import { describe, expect, it } from "vitest";
import { isLegalAttack, pieceStatLabel } from "./matchBoardHelpers";
import type { BoardPiece } from "./appTypes";
import type { MatchState, Side } from "./types";

type BoardHero = Extract<BoardPiece, { pieceType: "hero" }>;

describe("match board helpers", () => {
  it("accepts range-2 attacks and rejects range-2 melee attacks", () => {
    const match = baseMatch();
    const target = unit("opponent-unit", "opponent", { q: 0, r: 1 }, 1);

    expect(isLegalAttack(match, "player", hero("archer", "player", { q: 0, r: 3 }, 2), target)).toBe(
      true,
    );
    expect(isLegalAttack(match, "player", hero("runekeeper", "player", { q: 0, r: 3 }, 1), target)).toBe(
      false,
    );
  });

  it("shows attack range in compact piece stats when range is greater than one", () => {
    expect(pieceStatLabel(hero("archer", "player", { q: 0, r: 3 }, 2))).toContain("R2");
    expect(pieceStatLabel(hero("runekeeper", "player", { q: 0, r: 3 }, 1))).not.toContain("R1");
  });
});

function baseMatch(): MatchState {
  return {
    mode: "solo",
    round: 1,
    phase: "planning",
    activeSide: "player",
    prioritySide: null,
    player: participant("player"),
    opponent: participant("opponent"),
    board: { radius: 3, tiles: [], units: [], droppedItems: [] },
    actionStack: [],
    log: [],
    winner: null,
  };
}

function participant(side: Side): MatchState["player"] {
  return {
    side,
    mana: 5,
    maxMana: 5,
    hero: hero(`${side}-hero`, side, { q: 0, r: side === "player" ? 3 : -3 }, 1),
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

function hero(
  id: string,
  side: Side,
  position: { q: number; r: number },
  attackRange: number,
): BoardHero {
  return {
    pieceType: "hero",
    id,
    side,
    name: id,
    heroType: "runekeeper",
    hp: 20,
    maxHp: 20,
    attack: 1,
    attackRange,
    position,
    apRemaining: 3,
    maxAp: 3,
    hasAttacked: false,
  };
}

function unit(
  id: string,
  side: Side,
  position: { q: number; r: number },
  attackRange: number,
): BoardPiece {
  return {
    pieceType: "unit",
    id,
    side,
    name: id,
    templateId: id,
    attack: 1,
    attackRange,
    armor: 2,
    maxArmor: 2,
    position,
    apRemaining: 2,
    maxAp: 2,
    hasAttacked: false,
    items: [],
  };
}
