export type Side = "player" | "opponent";

export type Phase = "planning" | "gameOver";

export type CardKind =
  | {
      type: "unit";
      attack: number;
      armor: number;
      movement: number;
    }
  | {
      type: "tactic";
      effect: "rally";
    };

export type Card = {
  id: string;
  name: string;
  cost: number;
  text: string;
  kind: CardKind;
};

export type Unit = {
  id: string;
  side: Side;
  name: string;
  attack: number;
  armor: number;
  movement: number;
};

export type Lane = {
  index: number;
  cells: Array<Unit | null>;
};

export type PlayerState = {
  side: Side;
  health: number;
  energy: number;
  maxEnergy: number;
  hand: Card[];
  deckCount: number;
};

export type GameState = {
  turn: number;
  phase: Phase;
  player: PlayerState;
  opponent: PlayerState;
  lanes: Lane[];
  log: string[];
  winner: Side | null;
};

