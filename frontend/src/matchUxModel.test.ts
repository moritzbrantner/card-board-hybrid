import { describe, expect, it } from "vitest";
import {
  actionPreviewForCard,
  actionRecapFromReplayEvent,
  actionRecapFromSnapshotDiff,
  actionTrayEntriesForSelection,
  cardAvailability,
  turnChecklistForMatch,
} from "./matchUxModel";
import {
  emberFlaskCard,
  emberSquireCard,
  pendingAttackStack,
  sparkJoltCard,
  storyMatch,
  storyUnit,
  thunderRailCard,
} from "./components/board.fixtures";
import type { Card, MatchState } from "./types";

describe("match UX model", () => {
  it("explains unavailable cards by priority", () => {
    const match = storyMatch({ hand: [expensiveCard()] });
    match.player.mana = 1;
    match.player.hero.apRemaining = 0;

    const availability = cardAvailability(match, "player", expensiveCard());

    expect(availability.playable).toBe(false);
    expect(availability.primaryReason?.code).toBe("insufficientMana");
    expect(availability.reasons.map((reason) => reason.code)).toContain("heroApEmpty");
  });

  it("explains wrong-turn and stack response restrictions", () => {
    const wrongTurn = storyMatch({ hand: [emberSquireCard] });
    wrongTurn.activeSide = "opponent";

    expect(cardAvailability(wrongTurn, "player", emberSquireCard).primaryReason?.code).toBe(
      "waitingForTurn",
    );

    const pending = storyMatch({ hand: [emberSquireCard], actionStack: [pendingAttackStack], prioritySide: "player" });
    expect(cardAvailability(pending, "player", emberSquireCard).primaryReason?.code).toBe(
      "notAResponse",
    );

    const lowPriority = storyMatch({
      hand: [thunderRailCard],
      actionStack: [{ ...pendingAttackStack, priority: 3 }],
      prioritySide: "player",
    });
    expect(cardAvailability(lowPriority, "player", thunderRailCard).primaryReason?.code).toBe(
      "priorityTooLow",
    );
  });

  it("explains cards with no legal targets", () => {
    const match = storyMatch({ hand: [sparkJoltCard], opponentHero: { q: 3, r: -3 } });
    match.board.units = [];

    expect(cardAvailability(match, "player", sparkJoltCard).primaryReason?.code).toBe(
      "noLegalTargets",
    );
  });

  it("creates intent previews for card kinds", () => {
    const unitPreview = actionPreviewForCard(storyMatch({ hand: [emberSquireCard] }), "player", emberSquireCard);
    expect(unitPreview.details).toContain("Adjacent empty hex");
    expect(unitPreview.body).toContain("Summons");

    const spellPreview = actionPreviewForCard(storyMatch({ hand: [sparkJoltCard] }), "player", sparkJoltCard);
    expect(spellPreview.tone).toBe("attack");
    expect(spellPreview.body).toContain("Deals 1 damage");

    const itemPreview = actionPreviewForCard(
      storyMatch({ hand: [emberFlaskCard], units: [storyUnit({ q: -1, r: 1 })] }),
      "player",
      emberFlaskCard,
    );
    expect(itemPreview.tone).toBe("support");
    expect(itemPreview.details).toContain("Friendly Unit within range 2");
  });

  it("lists action tray entries for selected pieces with items and buildings", () => {
    const unit = storyUnit({ q: 0, r: 0 }, {
      items: [
        {
          id: "item-1",
          templateId: "ember-flask",
          name: "Ember Flask",
          passive: { type: "statBonus", attack: 1, armor: 0, maxAp: 0 },
          active: { type: "healCarrier", amount: 2 },
          activeUsedThisTurn: false,
        },
      ],
    });
    const match = storyMatch({ units: [unit] });
    match.board.buildings = [
      {
        id: "building-1",
        templateId: "healing-font",
        name: "Healing Font",
        position: unit.position,
        effect: { type: "activatedHeal", range: 2, amount: 2, targets: "unitsAndHeroes" },
        activatedThisTurn: false,
      },
    ];

    const entries = actionTrayEntriesForSelection({
      match,
      viewerSide: "player",
      selection: { type: "piece", piece: { ...unit, pieceType: "unit" } },
    });

    expect(entries.map((entry) => entry.icon)).toEqual(
      expect.arrayContaining(["move", "attack", "info", "item", "building"]),
    );
    expect(entries.find((entry) => entry.icon === "item")?.enabled).toBe(true);
    expect(entries.find((entry) => entry.icon === "building")?.enabled).toBe(true);
  });

  it("creates compact turn checklist counts", () => {
    const match = storyMatch({
      hand: [emberSquireCard, sparkJoltCard],
      units: [storyUnit({ q: -1, r: 1 })],
    });

    const checklist = turnChecklistForMatch(match, "player", true);

    expect(checklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "hero-ap", value: "3/3" }),
        expect.objectContaining({ id: "playable-cards", value: "2" }),
        expect.objectContaining({ id: "units-able", value: "1" }),
      ]),
    );
  });

  it("creates recaps from replay events", () => {
    const recap = actionRecapFromReplayEvent(
      {
        type: "pieceAttacked",
        side: "opponent",
        attackerId: "opponent-hero",
        targetId: "player-hero",
        damageToTarget: 2,
        counterDamageToAttacker: 1,
      },
      "player",
    );

    expect(recap).toMatchObject({
      title: "Opponent attacked",
      tone: "attack",
    });
    expect(recap?.details.join(" ")).toContain("counter damage");
  });

  it("creates recaps from simple snapshot diffs", () => {
    const previous = storyMatch({ units: [storyUnit({ q: -1, r: 1 })] });
    const next: MatchState = {
      ...previous,
      board: {
        ...previous.board,
        units: [storyUnit({ q: 0, r: 0 })],
      },
    };

    const recap = actionRecapFromSnapshotDiff(previous, next, "player");

    expect(recap).toMatchObject({
      title: "You moved Rune Runner",
      tone: "neutral",
    });
  });
});

function expensiveCard(): Card {
  return {
    ...emberSquireCard,
    id: "expensive",
    cost: 9,
  };
}
