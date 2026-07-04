import type { HexCoord, MatchState, ReplayEvent, Side, Unit, Hero } from "./types";

export const BOARD_ANIMATION_DURATION_MS = 520;

export type AnimatedPieceSnapshot =
  | (Hero & { pieceType: "hero"; name: string })
  | (Unit & { pieceType: "unit"; hp?: never; maxHp?: never });

export type PieceAnimationKind =
  | "move"
  | "summon"
  | "destroy"
  | "attack"
  | "damage"
  | "heal"
  | "buff";

export type PieceAnimation = {
  pieceId: string;
  kind: PieceAnimationKind;
  from?: HexCoord;
  to?: HexCoord;
  amount?: number;
  attackDelta?: number;
  armorDelta?: number;
};

export type BoardAnimationCue = {
  sequence: number;
  durationMs: number;
  pieces: PieceAnimation[];
  exitingPieces: AnimatedPieceSnapshot[];
};

export type BoardAnimationInput = {
  previous: MatchState | null;
  next: MatchState;
  event?: ReplayEvent | null;
  sequence: number;
  reducedMotion?: boolean;
};

export function createBoardAnimationCue({
  previous,
  next,
  event,
  sequence,
  reducedMotion = false,
}: BoardAnimationInput): BoardAnimationCue | null {
  if (reducedMotion || !previous) {
    return null;
  }

  const previousPieces = new Map(piecesInState(previous).map((piece) => [piece.id, piece]));
  const nextPieces = new Map(piecesInState(next).map((piece) => [piece.id, piece]));
  const pieces = event
    ? animationsFromEvent(event, previousPieces, nextPieces)
    : animationsFromDiff(previousPieces, nextPieces);
  const exitingPieces = pieces
    .filter((animation) => animation.kind === "destroy")
    .map((animation) => previousPieces.get(animation.pieceId))
    .filter((piece): piece is AnimatedPieceSnapshot => Boolean(piece));

  return pieces.length > 0
    ? {
        sequence,
        durationMs: BOARD_ANIMATION_DURATION_MS,
        pieces,
        exitingPieces,
      }
    : null;
}

export function piecesInState(match: MatchState): AnimatedPieceSnapshot[] {
  return [
    {
      ...match.player.hero,
      pieceType: "hero",
      name: `${sideLabel(match.player.side)} Hero`,
    },
    {
      ...match.opponent.hero,
      pieceType: "hero",
      name: `${sideLabel(match.opponent.side)} Hero`,
    },
    ...match.board.units.map((unit) => ({ ...unit, pieceType: "unit" as const })),
  ];
}

function animationsFromEvent(
  event: ReplayEvent,
  previousPieces: Map<string, AnimatedPieceSnapshot>,
  nextPieces: Map<string, AnimatedPieceSnapshot>,
): PieceAnimation[] {
  switch (event.type) {
    case "unitSummoned":
      return [{ pieceId: event.unitId, kind: "summon", to: event.position }];
    case "pieceMoved":
      return [{ pieceId: event.pieceId, kind: "move", from: event.from, to: event.to }];
    case "pieceAttacked": {
      const animations: PieceAnimation[] = [{ pieceId: event.attackerId, kind: "attack" }];
      if (event.damageToTarget > 0) {
        animations.push({
          pieceId: event.targetId,
          kind: "damage",
          amount: event.damageToTarget,
        });
      }
      if (event.counterDamageToAttacker > 0) {
        animations.push({
          pieceId: event.attackerId,
          kind: "damage",
          amount: event.counterDamageToAttacker,
        });
      }
      return animations;
    }
    case "pieceHealed":
      return [{ pieceId: event.pieceId, kind: "heal", amount: event.amount }];
    case "pieceBuffed":
      return [
        {
          pieceId: event.pieceId,
          kind: "buff",
          attackDelta: event.attackDelta,
          armorDelta: event.armorDelta,
        },
      ];
    case "pieceDamaged":
      return [{ pieceId: event.pieceId, kind: "damage", amount: event.amount }];
    case "unitDestroyed": {
      const destroyed = previousPieces.get(event.unitId);
      return destroyed ? [{ pieceId: event.unitId, kind: "destroy" }] : [];
    }
    default:
      return animationsFromDiff(previousPieces, nextPieces);
  }
}

function animationsFromDiff(
  previousPieces: Map<string, AnimatedPieceSnapshot>,
  nextPieces: Map<string, AnimatedPieceSnapshot>,
) {
  const animations: PieceAnimation[] = [];

  for (const [pieceId, nextPiece] of nextPieces) {
    const previousPiece = previousPieces.get(pieceId);
    if (!previousPiece) {
      animations.push({ pieceId, kind: "summon", to: nextPiece.position });
      continue;
    }

    if (!sameCoord(previousPiece.position, nextPiece.position)) {
      animations.push({
        pieceId,
        kind: "move",
        from: previousPiece.position,
        to: nextPiece.position,
      });
    }

    const statAnimation = statChangeAnimation(previousPiece, nextPiece);
    if (statAnimation) {
      animations.push({ pieceId, ...statAnimation });
    }
  }

  for (const [pieceId] of previousPieces) {
    if (!nextPieces.has(pieceId)) {
      animations.push({ pieceId, kind: "destroy" });
    }
  }

  return animations;
}

function statChangeAnimation(
  previousPiece: AnimatedPieceSnapshot,
  nextPiece: AnimatedPieceSnapshot,
): Omit<PieceAnimation, "pieceId"> | null {
  if (previousPiece.attack !== nextPiece.attack) {
    return {
      kind: "buff",
      attackDelta: nextPiece.attack - previousPiece.attack,
      armorDelta:
        previousPiece.pieceType === "unit" && nextPiece.pieceType === "unit"
          ? nextPiece.armor - previousPiece.armor
          : 0,
    };
  }

  if (previousPiece.pieceType === "hero" && nextPiece.pieceType === "hero") {
    if (nextPiece.hp > previousPiece.hp) {
      return { kind: "heal", amount: nextPiece.hp - previousPiece.hp };
    }
    if (nextPiece.hp < previousPiece.hp) {
      return { kind: "damage", amount: previousPiece.hp - nextPiece.hp };
    }
  }

  if (previousPiece.pieceType === "unit" && nextPiece.pieceType === "unit") {
    if (nextPiece.armor > previousPiece.armor) {
      return {
        kind: "buff",
        armorDelta: nextPiece.armor - previousPiece.armor,
        attackDelta: 0,
      };
    }
    if (nextPiece.armor < previousPiece.armor) {
      return { kind: "damage", amount: previousPiece.armor - nextPiece.armor };
    }
  }

  return null;
}

function sameCoord(a: HexCoord, b: HexCoord) {
  return a.q === b.q && a.r === b.r;
}

function sideLabel(side: Side) {
  return side === "player" ? "Player" : "Opponent";
}
