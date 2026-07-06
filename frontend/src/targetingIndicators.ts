import type { BoardPiece } from "./appTypes";
import type { Card, HexCoord, MatchState, Side, StackItem } from "./types";
import {
  distance,
  isLegalAttack,
  isLegalCardTarget,
  lineDirection,
  participantBySide,
  pieceById,
  piecesInMatch,
  sameCoord,
} from "./matchBoardHelpers";
import { stackItemTitle } from "./labels";

export type TargetingIndicatorSource =
  | { type: "selection" }
  | { type: "stack"; stackItemId: string; priority: number };

export type TargetingIndicatorTone = "attack" | "damageSpell" | "supportSpell";

export type TargetingIndicator = {
  id: string;
  source: TargetingIndicatorSource;
  actionType: "attack" | "spell";
  tone: TargetingIndicatorTone;
  label: string;
  sourcePieceId: string;
  sourceCoord: HexCoord;
  primaryTargetPieceId: string;
  primaryTargetCoord: HexCoord;
  secondaryFootprintCoords: HexCoord[];
};

type SpellCardLike = {
  name: string;
  kind: Extract<Card["kind"], { type: "spell" }>;
};

export function selectedTargetingIndicators({
  match,
  viewerSide,
  selectedCard,
  selectedPiece,
  focusedCoord,
  hoveredCoord,
}: {
  match: MatchState;
  viewerSide: Side;
  selectedCard: Card | null;
  selectedPiece: BoardPiece | null;
  focusedCoord: HexCoord | null;
  hoveredCoord: HexCoord | null;
}): TargetingIndicator[] {
  if (selectedPiece) {
    return piecesInMatch(match)
      .filter((piece) => isLegalAttack(match, viewerSide, selectedPiece, piece))
      .map((target) => attackIndicator({
        id: `selection-attack-${selectedPiece.id}-${target.id}`,
        source: { type: "selection" },
        label: `Attack ${target.id}`,
        attacker: selectedPiece,
        target,
      }));
  }

  if (selectedCard?.kind.type !== "spell") {
    return [];
  }

  const caster = participantBySide(match, viewerSide).hero;
  const selectedSpell: SpellCardLike = {
    name: selectedCard.name,
    kind: selectedCard.kind,
  };
  const focusedOrHoveredCoord = hoveredCoord ?? focusedCoord;

  return piecesInMatch(match)
    .filter((target) => isLegalCardTarget(match, viewerSide, selectedCard, target.position, target))
    .map((target) => {
      const shouldShowFootprint =
        focusedOrHoveredCoord !== null && sameCoord(focusedOrHoveredCoord, target.position);

      return spellIndicator({
        id: `selection-spell-${selectedCard.id}-${target.id}`,
        source: { type: "selection" },
        label: `Cast ${selectedCard.name} on ${target.id}`,
        spell: selectedSpell,
        casterId: caster.id,
        casterCoord: caster.position,
        target,
        match,
        includeFootprint: shouldShowFootprint,
      });
    });
}

export function stackTargetingIndicators(match: MatchState): TargetingIndicator[] {
  return match.actionStack.flatMap((item) => stackItemTargetingIndicators(match, item));
}

function stackItemTargetingIndicators(match: MatchState, item: StackItem): TargetingIndicator[] {
  if (item.action.type === "attack") {
    const attacker = pieceById(match, item.action.attackerId);
    const target = pieceById(match, item.action.targetId);
    if (!attacker || !target) {
      return [];
    }

    return [
      attackIndicator({
        id: `stack-${item.id}-attack`,
        source: { type: "stack", stackItemId: item.id, priority: item.priority },
        label: stackItemTitle(item),
        attacker,
        target,
      }),
    ];
  }

  if (item.action.type === "castSpell") {
    const cardKind = item.action.card.kind;
    if (cardKind?.type !== "spell") {
      return [];
    }

    const caster = participantBySide(match, item.side).hero;
    const spell: SpellCardLike = {
      name: item.action.card.name,
      kind: cardKind,
    };
    const target = pieceById(match, item.action.targetId);
    if (!target) {
      return [];
    }

    return [
      spellIndicator({
        id: `stack-${item.id}-spell`,
        source: { type: "stack", stackItemId: item.id, priority: item.priority },
        label: stackItemTitle(item),
        spell,
        casterId: caster.id,
        casterCoord: caster.position,
        target,
        match,
        includeFootprint: true,
      }),
    ];
  }

  return [];
}

function attackIndicator({
  id,
  source,
  label,
  attacker,
  target,
}: {
  id: string;
  source: TargetingIndicatorSource;
  label: string;
  attacker: BoardPiece;
  target: BoardPiece;
}): TargetingIndicator {
  return {
    id,
    source,
    actionType: "attack",
    tone: "attack",
    label,
    sourcePieceId: attacker.id,
    sourceCoord: attacker.position,
    primaryTargetPieceId: target.id,
    primaryTargetCoord: target.position,
    secondaryFootprintCoords: [],
  };
}

function spellIndicator({
  id,
  source,
  label,
  spell,
  casterId,
  casterCoord,
  target,
  match,
  includeFootprint,
}: {
  id: string;
  source: TargetingIndicatorSource;
  label: string;
  spell: SpellCardLike;
  casterId: string;
  casterCoord: HexCoord;
  target: BoardPiece;
  match: MatchState;
  includeFootprint: boolean;
}): TargetingIndicator {
  return {
    id,
    source,
    actionType: "spell",
    tone: spellTone(spell),
    label,
    sourcePieceId: casterId,
    sourceCoord: casterCoord,
    primaryTargetPieceId: target.id,
    primaryTargetCoord: target.position,
    secondaryFootprintCoords: includeFootprint
      ? spellFootprint(match, spell, casterCoord, target.position)
      : [],
  };
}

function spellTone(spell: SpellCardLike): TargetingIndicatorTone {
  switch (spell.kind.effect.type) {
    case "damage":
    case "areaDamage":
    case "lineDamage":
      return "damageSpell";
    case "heal":
    case "buff":
    case "statBuff":
    case "draw":
      return "supportSpell";
  }
}

function spellFootprint(
  match: MatchState,
  spell: SpellCardLike,
  casterCoord: HexCoord,
  targetCoord: HexCoord,
): HexCoord[] {
  const effect = spell.kind.effect;
  switch (effect.type) {
    case "areaDamage":
      return match.board.tiles
        .map((tile) => tile.coord)
        .filter((coord) => !sameCoord(coord, targetCoord))
        .filter((coord) => distance(coord, targetCoord) <= effect.radius);
    case "lineDamage": {
      const direction = lineDirection(casterCoord, targetCoord);
      if (!direction) {
        return [];
      }

      return match.board.tiles
        .map((tile) => tile.coord)
        .filter((coord) => !sameCoord(coord, casterCoord) && !sameCoord(coord, targetCoord))
        .filter((coord) => distance(casterCoord, coord) <= spell.kind.range)
        .filter((coord) => lineDirection(casterCoord, coord)?.q === direction.q)
        .filter((coord) => lineDirection(casterCoord, coord)?.r === direction.r);
    }
    default:
      return [];
  }
}
