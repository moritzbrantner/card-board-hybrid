import { describe, expect, it } from "vitest";
import { createBoardAnimationCue } from "./boardAnimations";
import type { MatchProgressionLoadout, MatchState } from "./types";

describe("createBoardAnimationCue", () => {
  it("uses accepted piece move events for interpolation endpoints", () => {
    const previous = matchWithUnit({ id: "unit-1", q: 0, r: 0, armor: 3 });
    const next = matchWithUnit({ id: "unit-1", q: 1, r: 0, armor: 3 });

    const cue = createBoardAnimationCue({
      previous,
      next,
      event: {
        type: "pieceMoved",
        side: "player",
        pieceId: "unit-1",
        from: { q: 0, r: 0 },
        to: { q: 1, r: 0 },
      },
      sequence: 1,
    });

    expect(cue?.pieces).toEqual([
      {
        pieceId: "unit-1",
        kind: "move",
        from: { q: 0, r: 0 },
        to: { q: 1, r: 0 },
      },
    ]);
  });

  it("keeps destroyed units as exiting snapshots", () => {
    const previous = matchWithUnit({ id: "unit-1", q: 0, r: 0, armor: 1 });
    const next = matchWithoutUnits();

    const cue = createBoardAnimationCue({
      previous,
      next,
      event: {
        type: "unitDestroyed",
        side: "opponent",
        unitId: "unit-1",
        name: "Test Unit",
      },
      sequence: 2,
    });

    expect(cue?.pieces).toEqual([{ pieceId: "unit-1", kind: "destroy" }]);
    expect(cue?.exitingPieces).toMatchObject([{ id: "unit-1", pieceType: "unit" }]);
  });

  it("derives summon and destroy from state diffs when no replay event is available", () => {
    const previous = matchWithUnit({ id: "unit-1", q: 0, r: 0, armor: 3 });
    const next = matchWithUnit({ id: "unit-2", q: 1, r: 0, armor: 4 });

    const cue = createBoardAnimationCue({
      previous,
      next,
      sequence: 3,
    });

    expect(cue?.pieces).toEqual([
      { pieceId: "unit-2", kind: "summon", to: { q: 1, r: 0 } },
      { pieceId: "unit-1", kind: "destroy" },
    ]);
  });

  it("creates readable combat feedback from accepted attack events", () => {
    const previous = matchWithUnit({ id: "unit-1", q: 0, r: 0, armor: 3 });
    const next = matchWithUnit({ id: "unit-1", q: 0, r: 0, armor: 1 });

    const cue = createBoardAnimationCue({
      previous,
      next,
      event: {
        type: "pieceAttacked",
        side: "player",
        attackerId: "player-hero",
        targetId: "unit-1",
        damageToTarget: 2,
        counterDamageToAttacker: 1,
      },
      sequence: 4,
    });

    expect(cue?.pieces).toEqual([
      { pieceId: "player-hero", kind: "attack" },
      { pieceId: "unit-1", kind: "damage", amount: 2 },
      { pieceId: "player-hero", kind: "damage", amount: 1 },
    ]);
  });

  it("suppresses cosmetic cues for reduced-motion users", () => {
    const previous = matchWithUnit({ id: "unit-1", q: 0, r: 0, armor: 3 });
    const next = matchWithUnit({ id: "unit-1", q: 1, r: 0, armor: 3 });

    expect(
      createBoardAnimationCue({
        previous,
        next,
        sequence: 5,
        reducedMotion: true,
      }),
    ).toBeNull();
  });
});

function matchWithUnit({
  id,
  q,
  r,
  armor,
}: {
  id: string;
  q: number;
  r: number;
  armor: number;
}): MatchState {
  return {
    ...matchWithoutUnits(),
    board: {
      radius: 3,
      tiles: [{ coord: { q, r } }],
      manaSources: [],
      units: [
        {
          id,
          side: "opponent",
          name: "Test Unit",
          attack: 2,
          attackRange: 1,
          armor,
          maxArmor: 4,
          position: { q, r },
          apRemaining: 1,
          maxAp: 1,
          hasAttacked: false,
          items: [],
        },
      ],
      droppedItems: [],
    },
  };
}

function matchWithoutUnits(): MatchState {
  return {
    mode: "solo",
    round: 1,
    phase: "planning",
    activeSide: "player",
    prioritySide: null,
    player: {
      side: "player",
      mana: 1,
      maxMana: 1,
      hero: {
        id: "player-hero",
        side: "player",
        heroType: "runekeeper",
        hp: 20,
        maxHp: 20,
        attack: 2,
        attackRange: 1,
        position: { q: 0, r: 2 },
        apRemaining: 1,
        maxAp: 1,
        hasAttacked: false,
      },
      hand: [],
      handCount: 0,
      deckCount: 0,
      discardCount: 0,
      progression: defaultProgression(),
    },
    opponent: {
      side: "opponent",
      mana: 1,
      maxMana: 1,
      hero: {
        id: "opponent-hero",
        side: "opponent",
        heroType: "pyromancer",
        hp: 20,
        maxHp: 20,
        attack: 2,
        attackRange: 1,
        position: { q: 0, r: -2 },
        apRemaining: 1,
        maxAp: 1,
        hasAttacked: false,
      },
      handCount: 0,
      deckCount: 0,
      discardCount: 0,
      progression: defaultProgression(),
    },
    board: {
      radius: 3,
      tiles: [],
      manaSources: [],
      units: [],
      droppedItems: [],
    },
    actionStack: [],
    log: [],
    winner: null,
  };
}

function defaultProgression(): MatchProgressionLoadout {
  return {
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
  };
}
