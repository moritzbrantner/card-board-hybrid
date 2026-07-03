import { describe, expect, it } from "vitest";
import { createMatchVisualCatalog } from "./matchVisualIdentity";
import type {
  Card,
  CardSummary,
  CatalogCard,
  Unit,
  Wizard,
  WizardType,
} from "./types";

const emberSquire = {
  id: "ember-squire",
  templateId: "ember-squire",
  name: "Ember Squire",
  rarity: "basic",
  cost: 1,
  text: "1 attack / 2 armor / 2 AP.",
  kind: {
    type: "unit",
    attack: 1,
    armor: 2,
    maxAp: 2,
  },
  copyCount: 5,
  artKey: "ember-squire",
  artPath: "/card-art/ember-squire.svg",
} satisfies CatalogCard;

const sparkJolt = {
  id: "spark-jolt",
  templateId: "spark-jolt",
  name: "Spark Jolt",
  rarity: "basic",
  cost: 1,
  text: "Priority 3. Range 2. Deal 1 damage to an enemy unit or wizard.",
  kind: {
    type: "spell",
    range: 2,
    priority: 3,
    effect: {
      type: "damage",
      amount: 1,
    },
  },
  copyCount: 5,
  artKey: "spark-jolt",
  artPath: "/card-art/spark-jolt.svg",
} satisfies CatalogCard;

const catalog = createMatchVisualCatalog([emberSquire, sparkJolt]);

describe("createMatchVisualCatalog", () => {
  it("resolves a hand Card by templateId", () => {
    const card = {
      ...emberSquire,
      id: "player-1-ember-squire",
    } satisfies Card;

    expect(catalog.card(card)).toMatchObject({
      status: "resolved",
      templateId: "ember-squire",
      name: "Ember Squire",
      artPath: "/card-art/ember-squire.svg",
      accentClass: "basic",
    });
  });

  it("resolves a CatalogCard directly by templateId", () => {
    expect(catalog.card(emberSquire)).toMatchObject({
      status: "resolved",
      templateId: "ember-squire",
      artPath: "/card-art/ember-squire.svg",
    });
  });

  it("resolves a CardSummary by templateId", () => {
    const summary = {
      templateId: "spark-jolt",
      name: "Spark Jolt",
      rarity: "basic",
      cost: 1,
      kind: sparkJolt.kind,
    } satisfies CardSummary;

    const visual = catalog.card(summary);

    expect(visual).toMatchObject({
      status: "resolved",
      templateId: "spark-jolt",
      artPath: "/card-art/spark-jolt.svg",
      text: sparkJolt.text,
    });
    expect(visual.kind).toEqual(sparkJolt.kind);
  });

  it("resolves a Unit by templateId", () => {
    const unit = makeUnit({ templateId: "ember-squire", name: "Renamed Squire" });

    expect(catalog.unit(unit)).toMatchObject({
      status: "resolved",
      templateId: "ember-squire",
      name: "Ember Squire",
      portraitPath: "/card-art/ember-squire.svg",
      rarity: "basic",
      baseStats: {
        cost: 1,
        attack: 1,
        armor: 2,
        maxAp: 2,
        text: emberSquire.text,
      },
    });
  });

  it("resolves a legacy Unit by exact name when templateId is missing", () => {
    const unit = makeUnit({ templateId: undefined, name: "Ember Squire" });

    expect(catalog.unit(unit)).toMatchObject({
      status: "legacyNameFallback",
      templateId: "ember-squire",
      name: "Ember Squire",
      portraitPath: "/card-art/ember-squire.svg",
    });
  });

  it("returns an unknown Unit visual for missing templateId and unmatched name", () => {
    const unit = makeUnit({ templateId: undefined, name: "Forgotten Guardian" });

    expect(catalog.unit(unit)).toMatchObject({
      status: "unknown",
      templateId: null,
      name: "Forgotten Guardian",
      rarity: "unknown",
      portraitPath: null,
      fallbackLabel: "FOR",
      baseStats: null,
    });
  });

  it("keeps the unknown Unit fallback label stable and short", () => {
    const unit = makeUnit({ templateId: undefined, name: "  Ash Hound  " });

    expect(createMatchVisualCatalog([]).unit(unit).fallbackLabel).toBe("ASH");
  });

  it("resolves every WizardType to a portrait path without catalog cards", () => {
    const emptyCatalog = createMatchVisualCatalog([]);
    const wizardTypes = [
      "runekeeper",
      "pyromancer",
      "chronomancer",
      "warden",
      "battlemage",
    ] satisfies WizardType[];

    for (const wizardType of wizardTypes) {
      expect(emptyCatalog.wizard(makeWizard(wizardType))).toMatchObject({
        status: "resolved",
        wizardType,
        portraitPath: `/wizard-art/${wizardType}.svg`,
      });
    }
  });

  it("does not use fuzzy matching for names", () => {
    const unit = makeUnit({ templateId: undefined, name: "ember squire" });

    expect(catalog.unit(unit).status).toBe("unknown");
  });
});

function makeUnit(overrides: { templateId?: string; name: string }): Unit {
  return {
    id: "unit-1",
    side: "player",
    name: overrides.name,
    templateId: overrides.templateId,
    attack: 1,
    armor: 2,
    maxArmor: 2,
    position: { q: 0, r: 0 },
    apRemaining: 1,
    maxAp: 2,
    hasAttacked: false,
    items: [],
  };
}

function makeWizard(wizardType: WizardType): Wizard {
  return {
    id: "wizard-player",
    side: "player",
    wizardType,
    hp: 20,
    maxHp: 20,
    attack: 1,
    position: { q: 0, r: 0 },
    apRemaining: 3,
    maxAp: 3,
    hasAttacked: false,
  };
}
