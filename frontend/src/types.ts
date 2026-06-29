export type Side = "player" | "opponent";

export type Phase = "planning" | "matchOver";

export type Rarity = "basic" | "advanced" | "rare";

export type HexCoord = {
  q: number;
  r: number;
};

export type SpellEffect =
  | {
      type: "heal";
      amount: number;
    }
  | {
      type: "buff";
      attack: number;
      armor: number;
    }
  | {
      type: "damage";
      amount: number;
    };

export type CardKind =
  | {
      type: "unit";
      attack: number;
      armor: number;
      maxAp: number;
    }
  | {
      type: "spell";
      range: number;
      effect: SpellEffect;
    };

export type Card = {
  id: string;
  templateId: string;
  name: string;
  rarity: Rarity;
  cost: number;
  text: string;
  kind: CardKind;
};

export type Wizard = {
  id: string;
  side: Side;
  hp: number;
  maxHp: number;
  attack: number;
  position: HexCoord;
  apRemaining: number;
  maxAp: number;
  hasAttacked: boolean;
};

export type Unit = {
  id: string;
  side: Side;
  name: string;
  attack: number;
  armor: number;
  maxArmor: number;
  position: HexCoord;
  apRemaining: number;
  maxAp: number;
  hasAttacked: boolean;
};

export type HexTile = {
  coord: HexCoord;
};

export type HexBoard = {
  radius: number;
  tiles: HexTile[];
  units: Unit[];
};

export type MatchParticipantState = {
  side: Side;
  mana: number;
  maxMana: number;
  wizard: Wizard;
  deckCount: number;
  discardCount: number;
};

export type MatchPlayerState = MatchParticipantState & {
  hand: Card[];
};

export type MatchState = {
  round: number;
  phase: Phase;
  player: MatchPlayerState;
  opponent: MatchParticipantState;
  board: HexBoard;
  log: string[];
  winner: Side | null;
};

export type ActionTarget =
  | {
      type: "hex";
      coord: HexCoord;
    }
  | {
      type: "piece";
      pieceId: string;
    };

export type MatchActionRequest =
  | {
      type: "playCard";
      cardId: string;
      target: ActionTarget;
    }
  | {
      type: "movePiece";
      pieceId: string;
      to: HexCoord;
    }
  | {
      type: "attack";
      attackerId: string;
      targetId: string;
    }
  | {
      type: "endTurn";
    };
