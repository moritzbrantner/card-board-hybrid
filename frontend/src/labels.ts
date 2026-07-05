import { HERO_OPTIONS } from "./heroes";
import type {
  Card,
  BuildingEffect,
  CatalogCard,
  DeckChoice,
  MatchSummary,
  ProgressionResponse,
  ReplayEvent,
  Side,
  StackItem,
  HeroType,
} from "./types";

export function kindSummary(card: Card | CatalogCard) {
  if (card.kind.type === "unit") {
    return `${card.kind.attack}/${card.kind.armor} ap ${card.kind.maxAp}`;
  }

  if (card.kind.type === "item") {
    return `${itemPassiveLabel(card.kind.passive)} rng ${card.kind.range}`;
  }

  if (card.kind.type === "manaSource") {
    return "Build mana source";
  }

  if (card.kind.type === "building") {
    return buildingEffectLabel(card.kind.effect);
  }

  return `${spellEffectLabel(card)} rng ${card.kind.range} pri ${card.kind.priority}`;
}

export function spellEffectLabel(card: Card | CatalogCard) {
  if (card.kind.type !== "spell") {
    return card.kind.type;
  }

  switch (card.kind.effect.type) {
    case "heal":
      return `heal ${card.kind.effect.amount}`;
    case "buff":
      return `+${card.kind.effect.attack}/+${card.kind.effect.armor}`;
    case "statBuff":
      return `+${card.kind.effect.attack}/+${card.kind.effect.armor}/+${card.kind.effect.maxAp} ap`;
    case "damage":
      return `damage ${card.kind.effect.amount}`;
    case "draw":
      return `draw ${card.kind.effect.amount}`;
    case "areaDamage":
      return `area ${card.kind.effect.amount}`;
    case "lineDamage":
      return `line ${card.kind.effect.amount}`;
  }
}

export function buildingEffectLabel(effect: BuildingEffect) {
  switch (effect.type) {
    case "turnStartMana":
      return `+${effect.amount} mana occupied`;
    case "auraStatBonus":
      return `aura +${effect.attack}/+${effect.armor}/+${effect.maxAp} ap rng ${effect.range}`;
    case "activatedDamageLine":
      return `activate line ${effect.amount} rng ${effect.range}`;
    case "activatedHeal":
      return `activate heal ${effect.amount} rng ${effect.range}`;
    case "activatedStatBonus":
      return `activate +${effect.attack}/+${effect.armor}/+${effect.maxAp} ap`;
  }
}

export function itemPassiveLabel(passive: { type: "statBonus"; attack: number; armor: number; maxAp: number }) {
  const parts = [];
  if (passive.attack !== 0) {
    parts.push(`${passive.attack > 0 ? "+" : ""}${passive.attack} atk`);
  }
  if (passive.armor !== 0) {
    parts.push(`${passive.armor > 0 ? "+" : ""}${passive.armor} armor`);
  }
  if (passive.maxAp !== 0) {
    parts.push(`${passive.maxAp > 0 ? "+" : ""}${passive.maxAp} ap`);
  }
  return parts.length > 0 ? parts.join(", ") : "No passive";
}

export function itemActiveLabel(active: { type: "healCarrier"; amount: number }) {
  switch (active.type) {
    case "healCarrier":
      return `heal carrier ${active.amount}`;
  }
}

export function stackItemTitle(item: StackItem) {
  switch (item.action.type) {
    case "playUnit":
      return `${sideLabel(item.side)} summons ${item.action.card.name}`;
    case "castSpell":
      return `${sideLabel(item.side)} casts ${item.action.card.name}`;
    case "movePiece":
      return `${sideLabel(item.side)} moves ${item.action.pieceId}`;
    case "attack":
      return `${sideLabel(item.side)} attacks with ${item.action.attackerId}`;
    case "equipItem":
      return `${sideLabel(item.side)} equips ${item.action.card.name}`;
    case "buildManaSource":
      return `${sideLabel(item.side)} builds ${item.action.card.name}`;
    case "buildBuilding":
      return `${sideLabel(item.side)} builds ${item.action.card.name}`;
    case "activateItem":
      return `${sideLabel(item.side)} activates ${item.action.itemId}`;
    case "activateBuilding":
      return `${sideLabel(item.side)} activates ${item.action.buildingId}`;
  }
}

export function formatMatchStatus(match: MatchSummary) {
  if (match.phase === "matchOver") {
    return `${sideLabel(match.winner)} wins`;
  }

  return "Planning";
}

export function formatUnixTime(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value * 1000));
}

export function eventSideLabel(event: ReplayEvent) {
  if ("side" in event) {
    return sideLabel(event.side);
  }
  if (event.type === "matchEnded") {
    return sideLabel(event.winner);
  }

  return "Match";
}

export function eventTitle(event: ReplayEvent) {
  switch (event.type) {
    case "matchCreated":
      return "Match created";
    case "turnStarted":
      return "Turn started";
    case "turnEnded":
      return "Turn ended";
    case "roundStarted":
      return `Round ${event.round}`;
    case "cardDrawn":
      return event.card ? `${event.card.name} drawn` : "Hidden card drawn";
    case "cardPlayed":
      return `${event.card.name} played`;
    case "actionQueued":
      return "Action queued";
    case "unitSummoned":
      return `${event.name} summoned`;
    case "pieceMoved":
      return `${event.pieceId} moved`;
    case "pieceAttacked":
      return `${event.attackerId} attacked`;
    case "pieceHealed":
      return `${event.pieceId} healed`;
    case "pieceBuffed":
      return `${event.pieceId} buffed`;
    case "pieceDamaged":
      return `${event.pieceId} damaged`;
    case "unitDestroyed":
      return `${event.name} destroyed`;
    case "manaSourceBuilt":
      return "Mana source built";
    case "buildingBuilt":
      return `${event.name} built`;
    case "buildingActivated":
      return `${event.name} activated`;
    case "heroShielded":
      return `${event.heroId} shielded`;
    case "manaGained":
      return `${sideLabel(event.side)} gained mana`;
    case "itemEquipped":
      return `${event.name} equipped`;
    case "itemDropped":
      return `${event.name} dropped`;
    case "itemActivated":
      return `${event.name} activated`;
    case "matchEnded":
      return `${sideLabel(event.winner)} wins`;
  }
}

export function eventDetail(event: ReplayEvent) {
  switch (event.type) {
    case "matchCreated":
      return "The heroes enter the hex arena.";
    case "turnStarted":
      return `Round ${event.round} ${sideLabel(event.side).toLocaleLowerCase()} turn.`;
    case "turnEnded":
      return `Round ${event.round} ${sideLabel(event.side).toLocaleLowerCase()} turn ended.`;
    case "roundStarted":
      return `Round ${event.round} begins.`;
    case "cardDrawn":
      return event.card
        ? `${sideLabel(event.side)} drew ${event.card.name}.`
        : `${sideLabel(event.side)} drew a hidden card.`;
    case "cardPlayed":
      return `${sideLabel(event.side)} played ${event.card.name}.`;
    case "actionQueued":
      return `${stackItemTitle(event.item)} at priority ${event.item.priority}.`;
    case "unitSummoned":
      return `${sideLabel(event.side)} summoned ${event.name} at q ${event.position.q}, r ${event.position.r}.`;
    case "pieceMoved":
      return `${event.pieceId} moved from q ${event.from.q}, r ${event.from.r} to q ${event.to.q}, r ${event.to.r}.`;
    case "pieceAttacked":
      return `${event.attackerId} dealt ${event.damageToTarget}; counterdamage was ${event.counterDamageToAttacker}.`;
    case "pieceHealed":
      return `${event.pieceId} healed ${event.amount}.`;
    case "pieceBuffed":
      return `${event.pieceId} gained +${event.attackDelta}/+${event.armorDelta}.`;
    case "pieceDamaged":
      return `${event.pieceId} took ${event.amount} damage.`;
    case "unitDestroyed":
      return `${event.name} left the board.`;
    case "manaSourceBuilt":
      return `${sideLabel(event.side)} built a mana source at q ${event.coord.q}, r ${event.coord.r}.`;
    case "buildingBuilt":
      return `${sideLabel(event.side)} built ${event.name} at q ${event.coord.q}, r ${event.coord.r}.`;
    case "buildingActivated":
      return `${sideLabel(event.side)} activated ${event.name} with ${event.occupantId}.`;
    case "heroShielded":
      return `${event.heroId} gained ${event.amount} shield.`;
    case "manaGained":
      switch (event.source.type) {
        case "barbarianKill":
          return `${event.source.heroId} gained ${event.amount} mana from destroying ${event.source.unitId}.`;
      }
    case "itemEquipped":
      return `${sideLabel(event.side)} equipped ${event.name} to ${event.unitId}.`;
    case "itemDropped":
      return `${event.name} dropped at q ${event.position.q}, r ${event.position.r}.`;
    case "itemActivated":
      return `${sideLabel(event.side)} activated ${event.name} on ${event.unitId}.`;
    case "matchEnded":
      return `${sideLabel(event.winner)} won the match.`;
  }
}

export function heroOptionByType(heroType: HeroType) {
  return HERO_OPTIONS.find((hero) => hero.id === heroType) ?? HERO_OPTIONS[0];
}

export function isHeroType(value: string | null): value is HeroType {
  return HERO_OPTIONS.some((hero) => hero.id === value);
}

export function defaultRuneIdsForHero(progression: ProgressionResponse, heroType: HeroType) {
  return progression.loadouts.find((loadout) => loadout.heroType === heroType)?.runeIds ?? [];
}

export function parseRuneIds(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

export function parseDeckChoice(value: string | null): DeckChoice | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || !("source" in parsed)) {
      return null;
    }
    const source = parsed.source;
    if (source === "starter") {
      return { source: "starter" };
    }
    if (
      source === "system" &&
      "systemDeckId" in parsed &&
      typeof parsed.systemDeckId === "string"
    ) {
      return { source: "system", systemDeckId: parsed.systemDeckId };
    }
    if (source === "account" && "deckId" in parsed && typeof parsed.deckId === "number") {
      return { source: "account", deckId: parsed.deckId };
    }
    return null;
  } catch {
    return null;
  }
}

export function heroTypeLabel(heroType: HeroType) {
  return heroOptionByType(heroType).name;
}

export function heroTokenLabel(heroType: HeroType) {
  return heroOptionByType(heroType).token;
}

export function avatarSymbolLabel(symbol: string) {
  return symbol.slice(0, 1).toUpperCase();
}

export function sideLabel(side: Side | null) {
  if (side === "player") {
    return "You";
  }
  if (side === "opponent") {
    return "Opponent";
  }
  return "Nobody";
}

export function viewerSideLabel(side: Side, viewerSide: Side) {
  return side === viewerSide ? "your" : "the opponent's";
}

export function viewerSideShortLabel(side: Side, viewerSide: Side) {
  return side === viewerSide ? "YOU" : "OPP";
}
