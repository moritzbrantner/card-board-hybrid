import { copyLimitForRarity, runeNamesForLoadout, skillNamesForWizard } from "../../deckHelpers";
import { kindSummary, wizardOptionByType } from "../../labels";
import type {
  CatalogCard,
  DeckLegality,
  DeckRules,
  ProgressionResponse,
  Rarity,
  WizardType,
} from "../../types";

export type ManaCostFilter = "all" | "5plus" | number;

export type DeckCatalogFilters = {
  query: string;
  kind: "all" | CatalogCard["kind"]["type"];
  rarity: "all" | Rarity;
  manaCost: ManaCostFilter;
};

export type CardCopyState = {
  count: number;
  copyLimit: number;
  copyLimitReached: boolean;
};

export type DeckCardRow = {
  card: CatalogCard;
  count: number;
  copyLimit: number;
  copyLimitReached: boolean;
  kindLabel: string;
  kindDetail: string;
};

export type CatalogFilterOptions = {
  manaCosts: ManaCostFilter[];
};

export type DeckDesignerStats = {
  statusLabel: "Legal deck" | "Draft deck";
  legal: boolean;
  totalCards: number;
  minCards: number;
  basicCards: number;
  advancedCards: number;
  rareCards: number;
  advancedTotalLimit: number | null;
  rareTotalLimit: number | null;
  messages: string[];
  wizardName: string;
  runeNames: string[];
  skillNames: string[];
};

export const defaultDeckCatalogFilters = {
  query: "",
  kind: "all",
  rarity: "all",
  manaCost: "all",
} satisfies DeckCatalogFilters;

export function selectedDeckCardRows(
  catalogCards: CatalogCard[],
  cardCounts: Record<string, number>,
  rules: DeckRules | null,
): DeckCardRow[] {
  return catalogCards
    .map((card) => {
      const copyState = cardCopyState(card, cardCounts, rules);
      if (copyState.count <= 0) {
        return null;
      }
      return {
        card,
        ...copyState,
        kindLabel: cardKindLabel(card),
        kindDetail: cardKindDetail(card),
      };
    })
    .filter((row): row is DeckCardRow => row !== null)
    .sort((left, right) => left.card.name.localeCompare(right.card.name));
}

export function catalogFilterOptions(catalogCards: CatalogCard[]): CatalogFilterOptions {
  const exactCosts = Array.from(
    new Set(catalogCards.map((card) => card.cost).filter((cost) => cost < 5)),
  ).sort((left, right) => left - right);
  const hasFivePlus = catalogCards.some((card) => card.cost >= 5);

  return {
    manaCosts: ["all", ...exactCosts, ...(hasFivePlus ? (["5plus"] as const) : [])],
  };
}

export function filterCatalogCards(
  catalogCards: CatalogCard[],
  filters: DeckCatalogFilters,
): CatalogCard[] {
  const normalizedQuery = filters.query.trim().toLocaleLowerCase();

  return catalogCards
    .filter((card) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        card.name.toLocaleLowerCase().includes(normalizedQuery) ||
        card.text.toLocaleLowerCase().includes(normalizedQuery);
      const matchesKind = filters.kind === "all" || card.kind.type === filters.kind;
      const matchesRarity = filters.rarity === "all" || card.rarity === filters.rarity;
      const matchesMana =
        filters.manaCost === "all" ||
        (filters.manaCost === "5plus" ? card.cost >= 5 : card.cost === filters.manaCost);

      return matchesQuery && matchesKind && matchesRarity && matchesMana;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function deckStats(
  previewLegality: DeckLegality | null,
  rules: DeckRules | null,
  selectedWizardType: WizardType,
  selectedRuneIds: string[],
  progression: ProgressionResponse | null,
): DeckDesignerStats {
  const wizard = wizardOptionByType(selectedWizardType);
  const runeNames = progression ? runeNamesForLoadout(progression, selectedRuneIds) : selectedRuneIds;
  const skillNames = progression ? skillNamesForWizard(progression, selectedWizardType) : [];

  return {
    statusLabel: previewLegality?.legal ? "Legal deck" : "Draft deck",
    legal: previewLegality?.legal ?? false,
    totalCards: previewLegality?.totalCards ?? 0,
    minCards: rules?.minCards ?? 30,
    basicCards: previewLegality?.basicCards ?? 0,
    advancedCards: previewLegality?.advancedCards ?? 0,
    rareCards: previewLegality?.rareCards ?? 0,
    advancedTotalLimit: rules?.advancedTotalLimit ?? null,
    rareTotalLimit: rules?.rareTotalLimit ?? null,
    messages: previewLegality?.messages ?? [],
    wizardName: wizard.name,
    runeNames,
    skillNames,
  };
}

export function cardCopyState(
  card: CatalogCard,
  cardCounts: Record<string, number>,
  rules: DeckRules | null,
): CardCopyState {
  const count = cardCounts[card.templateId] ?? 0;
  const copyLimit = copyLimitForRarity(card.rarity, rules);

  return {
    count,
    copyLimit,
    copyLimitReached: count >= copyLimit,
  };
}

export function selectedCatalogCard(
  catalogCards: CatalogCard[],
  selectedTemplateId: string | null,
): CatalogCard | null {
  if (!selectedTemplateId) {
    return null;
  }

  return catalogCards.find((card) => card.templateId === selectedTemplateId) ?? null;
}

export function cardKindLabel(card: CatalogCard) {
  switch (card.kind.type) {
    case "unit":
      return "Unit";
    case "spell":
      return "Spell";
    case "item":
      return "Item";
  }
}

export function cardKindDetail(card: CatalogCard) {
  return kindSummary(card);
}

export function manaCostFilterLabel(filter: ManaCostFilter) {
  if (filter === "all") {
    return "All mana";
  }
  if (filter === "5plus") {
    return "5+ mana";
  }
  return `${filter} mana`;
}
