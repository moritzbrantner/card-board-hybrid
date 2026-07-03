import type {
  DeckCardCount,
  DeckChoice,
  DeckRecipeSummary,
  DeckRules,
  ProgressionResponse,
  Rarity,
  SkillNodeDefinition,
  SoloAiOpponentSelection,
  SystemDeckRecipe,
  WizardType,
} from "./types";

export function countsFromCards(cards: DeckCardCount[]) {
  return Object.fromEntries(cards.map((card) => [card.templateId, card.count]));
}

export function cardsFromCounts(counts: Record<string, number>): DeckCardCount[] {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([templateId, count]) => ({ templateId, count }));
}

export function copyLimitForRarity(rarity: Rarity, rules: DeckRules | null) {
  switch (rarity) {
    case "basic":
      return rules?.basicCopyLimit ?? 5;
    case "advanced":
      return rules?.advancedCopyLimit ?? 4;
    case "rare":
      return rules?.rareCopyLimit ?? 3;
  }
}

export function rarityLabel(rarity: Rarity) {
  switch (rarity) {
    case "basic":
      return "Basic";
    case "advanced":
      return "Advanced";
    case "rare":
      return "Rare";
  }
}

export function aiSelectionFromValue(
  value: string,
  accountWizardType: WizardType,
): SoloAiOpponentSelection | null {
  if (value.startsWith("system:")) {
    return { source: "system", systemDeckId: value.slice("system:".length) };
  }
  if (value.startsWith("account:")) {
    const deckId = Number(value.slice("account:".length));
    return Number.isFinite(deckId)
      ? { source: "account", deckId, wizardType: accountWizardType }
      : null;
  }
  return null;
}

export function deckChoiceFromValue(value: string): DeckChoice {
  if (value.startsWith("system:")) {
    return { source: "system", systemDeckId: value.slice("system:".length) };
  }
  if (value !== "starter") {
    const deckId = Number(value);
    if (Number.isFinite(deckId)) {
      return { source: "account", deckId };
    }
  }
  return { source: "starter" };
}

export function deckChoiceValue(choice: DeckChoice | null) {
  if (!choice) {
    return "starter";
  }
  switch (choice.source) {
    case "starter":
      return "starter";
    case "system":
      return `system:${choice.systemDeckId}`;
    case "account":
      return String(choice.deckId);
  }
}


export type HomeLoadout =
  | {
      kind: "system";
      id: string;
      name: string;
      wizardType: WizardType;
      cardCount: number;
      legal: boolean;
      runeIds: string[];
      deckChoice: DeckChoice;
      deck?: never;
    }
  | {
      kind: "account";
      id: string;
      name: string;
      wizardType: WizardType;
      cardCount: number;
      legal: boolean;
      runeIds: string[];
      deckChoice: DeckChoice;
      deck: DeckRecipeSummary;
    };


export function systemDeckToLoadout(deck: SystemDeckRecipe): HomeLoadout {
  return {
    kind: "system",
    id: `system:${deck.id}`,
    name: deck.name,
    wizardType: deck.wizardType,
    cardCount: deck.legality.totalCards,
    legal: deck.legality.legal,
    runeIds: [],
    deckChoice: { source: "system", systemDeckId: deck.id },
  };
}

export function accountDeckToLoadout(deck: DeckRecipeSummary): HomeLoadout {
  return {
    kind: "account",
    id: `account:${deck.id}`,
    name: deck.name,
    wizardType: deck.wizardType,
    cardCount: deck.legality.totalCards,
    legal: deck.legality.legal,
    runeIds: deck.runeIds,
    deckChoice: { source: "account", deckId: deck.id },
    deck,
  };
}

export function runeNamesForLoadout(progression: ProgressionResponse | null, runeIds: string[]) {
  if (!progression) {
    return runeIds;
  }
  return runeIds.map((runeId) => progression.runes.find((rune) => rune.id === runeId)?.name ?? runeId);
}

export function skillNamesForWizard(progression: ProgressionResponse | null, wizardType: WizardType) {
  if (!progression) {
    return [];
  }
  const wizard = progression.wizards.find((candidate) => candidate.wizardType === wizardType);
  const tree = progression.skillTrees.find((candidate) => candidate.wizardType === wizardType);
  if (!tree) {
    return [];
  }
  const activeSkillIds = new Set([
    ...tree.nodes.filter((node) => node.root).map((node) => node.id),
    ...(wizard?.unlockedSkillIds ?? []),
  ]);
  return tree.nodes
    .filter((node: SkillNodeDefinition) => activeSkillIds.has(node.id))
    .map((node) => node.name);
}
