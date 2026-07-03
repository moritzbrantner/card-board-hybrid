export type Side = "player" | "opponent";

export type Phase = "planning" | "matchOver";

export type MatchMode = "solo" | "shared";

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
      priority: number;
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

export type CatalogCard = {
  id: string;
  templateId: string;
  name: string;
  rarity: Rarity;
  cost: number;
  text: string;
  kind: CardKind;
  copyCount: number;
  artKey: string;
  artPath: string;
};

export type CatalogResponse = {
  cards: CatalogCard[];
};

export type DeckCardCount = {
  templateId: string;
  count: number;
};

export type DeckRules = {
  maxDecksPerAccount: number;
  minCards: number;
  basicCopyLimit: number;
  advancedCopyLimit: number;
  rareCopyLimit: number;
  advancedTotalLimit: number;
  rareTotalLimit: number;
};

export type DeckLegality = {
  legal: boolean;
  totalCards: number;
  basicCards: number;
  advancedCards: number;
  rareCards: number;
  messages: string[];
};

export type DeckRecipeSummary = {
  id: number;
  name: string;
  isDefault: boolean;
  cards: DeckCardCount[];
  legality: DeckLegality;
  createdAt: number;
  updatedAt: number;
};

export type DeckRecipeDetail = DeckRecipeSummary;

export type DeckListResponse = {
  rules: DeckRules;
  decks: DeckRecipeSummary[];
};

export type SystemDeckRecipe = {
  id: string;
  name: string;
  wizardType: WizardType;
  cards: DeckCardCount[];
  legality: DeckLegality;
};

export type SystemDeckListResponse = {
  rules: DeckRules;
  decks: SystemDeckRecipe[];
};

export type SoloAiOpponentSelection =
  | {
      source: "system";
      systemDeckId: string;
    }
  | {
      source: "account";
      deckId: number;
      wizardType: WizardType;
    };

export type AuthUser = {
  id: number;
  email: string;
  displayName: string;
  avatar: GeneratedAvatar;
  preferredWizardType: WizardType;
  boardVisualMode: BoardVisualMode;
};

export type AuthSessionResponse = {
  token: string;
  user: AuthUser;
};

export type GeneratedAvatar = {
  symbol: string;
  color: string;
};

export type AccountProfile = AuthUser;

export type BoardVisualMode = "2d" | "3d";

export type Wizard = {
  id: string;
  side: Side;
  wizardType: WizardType;
  hp: number;
  maxHp: number;
  attack: number;
  position: HexCoord;
  apRemaining: number;
  maxAp: number;
  hasAttacked: boolean;
};

export type WizardType =
  | "runekeeper"
  | "pyromancer"
  | "chronomancer"
  | "warden"
  | "battlemage";

export type Unit = {
  id: string;
  side: Side;
  name: string;
  templateId?: string;
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
  hand?: Card[];
  handCount: number;
  deckCount: number;
  discardCount: number;
};

export type MatchPlayerState = MatchParticipantState & {
  hand: Card[];
};

export type MatchState = {
  mode: MatchMode;
  round: number;
  phase: Phase;
  activeSide: Side;
  prioritySide: Side | null;
  player: MatchPlayerState;
  opponent: MatchParticipantState;
  board: HexBoard;
  actionStack: StackItem[];
  log: string[];
  winner: Side | null;
};

export type StackItem = {
  id: string;
  side: Side;
  priority: number;
  action: StackAction;
};

export type StackAction =
  | {
      type: "playUnit";
      card: CardSummary;
      coord: HexCoord;
    }
  | {
      type: "castSpell";
      card: CardSummary;
      targetId: string;
    }
  | {
      type: "movePiece";
      pieceId: string;
      from: HexCoord;
      to: HexCoord;
    }
  | {
      type: "attack";
      attackerId: string;
      targetId: string;
    };

export type MatchResponse = {
  matchId: string;
  matchState: MatchState;
  replayFrames?: ReplayFrame[];
};

export type CreateSharedMatchResponse = {
  matchId: string;
  mode: "shared";
  status: SharedMatchStatus;
  viewerSide: Side;
  playerSeatUrl: string;
  inviteSeatUrl: string;
};

export type SharedMatchStatus = "setup" | "active" | "completed" | "forfeited";

export type SharedMatchResponse = {
  matchId: string;
  mode: "shared";
  status: SharedMatchStatus;
  viewerSide: Side;
  viewerWizardType: WizardType | null;
  opponentWizardType: WizardType | null;
  viewerReady: boolean;
  opponentReady: boolean;
  activeSide: Side | null;
  opponentConnected: boolean;
  canClaimForfeitAt: number | null;
  matchState: MatchState | null;
};

export type ReplayVisibility = "public" | "revealed";

export type MatchSummary = {
  matchId: string;
  createdAt: number;
  updatedAt: number;
  round: number;
  phase: Phase;
  winner: Side | null;
  frameCount: number;
};

export type MatchArchiveResponse = {
  matches: MatchSummary[];
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
    }
  | {
      type: "passPriority";
    }
  | {
      type: "advanceAi";
    };

export type SharedClientMessage =
  | {
      type: "action";
      requestId: string;
      action: MatchActionRequest;
    }
  | {
      type: "claimForfeit";
      requestId: string;
    }
  | {
      type: "heartbeat";
    };

export type SharedServerMessage =
  | {
      type: "snapshot";
      payload: SharedMatchResponse;
    }
  | {
      type: "actionAccepted";
      requestId: string;
      payload: SharedMatchResponse;
    }
  | {
      type: "actionRejected";
      requestId: string;
      message: string;
    }
  | {
      type: "presenceChanged";
      payload: SharedMatchResponse;
    }
  | {
      type: "error";
      message: string;
    };

export type CardSummary = {
  templateId: string;
  name: string;
  rarity: Rarity;
  cost: number;
  kind: CardKind;
};

export type ReplayEvent =
  | {
      type: "matchCreated";
    }
  | {
      type: "turnStarted";
      side: Side;
      round: number;
    }
  | {
      type: "turnEnded";
      side: Side;
      round: number;
    }
  | {
      type: "roundStarted";
      round: number;
    }
  | {
      type: "cardDrawn";
      side: Side;
      card: CardSummary | null;
      hidden: boolean;
    }
  | {
      type: "cardPlayed";
      side: Side;
      card: CardSummary;
      target: ActionTarget;
    }
  | {
      type: "actionQueued";
      side: Side;
      item: StackItem;
    }
  | {
      type: "unitSummoned";
      side: Side;
      unitId: string;
      name: string;
      position: HexCoord;
    }
  | {
      type: "pieceMoved";
      side: Side;
      pieceId: string;
      from: HexCoord;
      to: HexCoord;
    }
  | {
      type: "pieceAttacked";
      side: Side;
      attackerId: string;
      targetId: string;
      damageToTarget: number;
      counterDamageToAttacker: number;
    }
  | {
      type: "pieceHealed";
      side: Side;
      pieceId: string;
      amount: number;
    }
  | {
      type: "pieceBuffed";
      side: Side;
      pieceId: string;
      attackDelta: number;
      armorDelta: number;
    }
  | {
      type: "pieceDamaged";
      side: Side;
      pieceId: string;
      amount: number;
    }
  | {
      type: "unitDestroyed";
      side: Side;
      unitId: string;
      name: string;
    }
  | {
      type: "matchEnded";
      winner: Side;
    };

export type ReplayFrame = {
  frameIndex: number;
  actionIndex: number | null;
  event: ReplayEvent;
  matchState: MatchState;
};

export type MatchReplayResponse = {
  matchId: string;
  visibility: ReplayVisibility;
  summary: MatchSummary;
  frames: ReplayFrame[];
};
