import { describe, expect, it } from "vitest";
import {
  cardCopyState,
  catalogFilterOptions,
  filterCatalogCards,
  selectedCatalogCard,
  selectedDeckCardRows,
  type DeckCatalogFilters,
} from "./deckDesignerModel";
import type { CatalogCard, DeckRules } from "../../types";

const rules: DeckRules = {
  maxDecksPerAccount: 12,
  minCards: 30,
  basicCopyLimit: 4,
  advancedCopyLimit: 3,
  rareCopyLimit: 1,
  advancedTotalLimit: 12,
  rareTotalLimit: 6,
};

describe("deck designer model", () => {
  it("builds Deck recipe rows only for picked Cards", () => {
    const rows = selectedDeckCardRows(
      cards,
      {
        "ember-squire": 2,
        "starfire-bolt": 0,
        "missing-card": 4,
      },
      rules,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      count: 2,
      copyLimit: 4,
      copyLimitReached: false,
      kindLabel: "Unit",
      kindDetail: "1/2 ap 2",
    });
    expect(rows[0].card.name).toBe("Ember Squire");
  });

  it("filters the catalog by search, kind, rarity, and mana", () => {
    const filters: DeckCatalogFilters = {
      query: "damage",
      kind: "spell",
      rarity: "rare",
      manaCost: "5plus",
    };

    expect(filterCatalogCards(cards, filters).map((card) => card.templateId)).toEqual([
      "meteor-bloom",
    ]);
  });

  it("reports mana filter options from available catalog costs", () => {
    expect(catalogFilterOptions(cards).manaCosts).toEqual(["all", 1, 2, "5plus"]);
  });

  it("uses rarity-specific copy limits", () => {
    expect(cardCopyState(cards[0], { "ember-squire": 4 }, rules)).toEqual({
      count: 4,
      copyLimit: 4,
      copyLimitReached: true,
    });
    expect(cardCopyState(cards[1], { "starfire-bolt": 2 }, rules)).toEqual({
      count: 2,
      copyLimit: 3,
      copyLimitReached: false,
    });
    expect(cardCopyState(cards[2], { "meteor-bloom": 1 }, rules)).toEqual({
      count: 1,
      copyLimit: 1,
      copyLimitReached: true,
    });
  });

  it("resolves selected Card details only when the template still exists", () => {
    expect(selectedCatalogCard(cards, "ember-squire")?.name).toBe("Ember Squire");
    expect(selectedCatalogCard(cards, "missing-card")).toBeNull();
    expect(selectedCatalogCard(cards, null)).toBeNull();
  });
});

const cards: CatalogCard[] = [
  {
    id: "ember-squire-catalog",
    templateId: "ember-squire",
    name: "Ember Squire",
    rarity: "basic",
    cost: 1,
    text: "Summon a steady unit.",
    kind: { type: "unit", attack: 1, armor: 2, maxAp: 2 },
    copyCount: 4,
    artKey: "ember-squire",
    artPath: "/card-art/ember-squire.svg",
  },
  {
    id: "starfire-bolt-catalog",
    templateId: "starfire-bolt",
    name: "Starfire Bolt",
    rarity: "advanced",
    cost: 2,
    text: "Deal damage to a unit.",
    kind: { type: "spell", range: 3, priority: 2, effect: { type: "damage", amount: 2 } },
    copyCount: 3,
    artKey: "starfire-bolt",
    artPath: "/card-art/starfire-bolt.svg",
  },
  {
    id: "meteor-bloom-catalog",
    templateId: "meteor-bloom",
    name: "Meteor Bloom",
    rarity: "rare",
    cost: 5,
    text: "Area damage around a Hex.",
    kind: {
      type: "spell",
      range: 4,
      priority: 1,
      effect: { type: "areaDamage", amount: 3, radius: 1 },
    },
    copyCount: 1,
    artKey: "meteor-bloom",
    artPath: "/card-art/meteor-bloom.svg",
  },
];
