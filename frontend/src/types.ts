export type Side = "player" | "opponent";

export type Phase = "planning" | "matchOver";

export type MatchMode = "solo" | "shared";

export type Rarity = "basic" | "advanced" | "rare";

export type HexCoord = {
  q: number;
  r: number;
};

export type BuffTargetPolicy = "unitsOnly" | "heroesOnly" | "unitsAndHeroes";

export type BuildingEffect =
  | {
      type: "turnStartMana";
      amount: number;
    }
  | {
      type: "auraStatBonus";
      range: number;
      targets: BuffTargetPolicy;
      attack: number;
      armor: number;
      maxAp: number;
    }
  | {
      type: "activatedDamageLine";
      range: number;
      amount: number;
    }
  | {
      type: "activatedHeal";
      range: number;
      amount: number;
      targets: BuffTargetPolicy;
    }
  | {
      type: "activatedStatBonus";
      range: number;
      targets: BuffTargetPolicy;
      attack: number;
      armor: number;
      maxAp: number;
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
      type: "statBuff";
      attack: number;
      armor: number;
      maxAp: number;
      targets: BuffTargetPolicy;
    }
  | {
      type: "damage";
      amount: number;
    }
  | {
      type: "draw";
      amount: number;
    }
  | {
      type: "areaDamage";
      amount: number;
      radius: number;
    }
  | {
      type: "lineDamage";
      amount: number;
    };

export type ItemPassiveEffect = {
  type: "statBonus";
  attack: number;
  armor: number;
  maxAp: number;
};

export type ItemActiveEffect = {
  type: "healCarrier";
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
    }
  | {
      type: "item";
      range: number;
      passive: ItemPassiveEffect;
      active?: ItemActiveEffect;
    }
  | {
      type: "building";
      effect: BuildingEffect;
    }
  | {
      type: "manaSource";
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
  heroType: HeroType;
  runeIds: string[];
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

export type PublicDeckRecipeResponse = {
  owner: {
    id: number;
    handle: string;
    displayName: string;
    avatar: GeneratedAvatar;
  };
  deck: DeckRecipeSummary;
};

export type SystemDeckRecipe = {
  id: string;
  name: string;
  heroType: HeroType;
  cards: DeckCardCount[];
  legality: DeckLegality;
};

export type SystemDeckListResponse = {
  rules: DeckRules;
  decks: SystemDeckRecipe[];
};

export type DeckChoice =
  | {
      source: "starter";
    }
  | {
      source: "system";
      systemDeckId: string;
    }
  | {
      source: "account";
      deckId: number;
    };

export type SoloAiOpponentSelection =
  | {
      source: "system";
      systemDeckId: string;
    }
  | {
      source: "account";
      deckId: number;
      heroType: HeroType;
    };

export type AuthUser = {
  id: number;
  handle: string;
  email: string;
  displayName: string;
  avatar: GeneratedAvatar;
  preferredHeroType: HeroType;
  boardVisualMode: BoardVisualMode;
  progressionSummary: ProgressionSummary;
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

export type PreferenceTheme = "system" | "dark" | "light" | "highContrast";

export type MotionPreference = "system" | "reduced" | "full";

export type AnimationSpeed = "slow" | "normal" | "fast";

export type BoardScale = "compact" | "normal" | "large";

export type HotkeyCommandId =
  | "cursorNorthwest"
  | "cursorNortheast"
  | "cursorEast"
  | "cursorWest"
  | "cursorSouthwest"
  | "cursorSoutheast"
  | "confirm"
  | "cancel"
  | "endTurn"
  | "passPriority"
  | "openCardInfo"
  | "openSettings"
  | "openCatalog"
  | "openDecks"
  | "openMatchArchive";

export type HotkeyBinding = {
  commandId: HotkeyCommandId;
  binding: string;
};

export type AccountPreferences = {
  theme: PreferenceTheme;
  motion: MotionPreference;
  animationSpeed: AnimationSpeed;
  boardScale: BoardScale;
  boardVisualMode: BoardVisualMode;
  hotkeys: HotkeyBinding[];
  updatedAt: number | null;
};

export type UpdatePreferencesRequest = Omit<AccountPreferences, "updatedAt">;

export type ProgressionSummary = {
  totalXp: number;
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  xpIntoLevel: number;
  xpToNextLevel: number;
  runeSlots: number;
};

export type RuneDefinition = {
  id: string;
  name: string;
  text: string;
  unlockLevel: number;
  unlocked: boolean;
};

export type HeroProgression = {
  heroType: HeroType;
  xp: number;
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  xpIntoLevel: number;
  xpToNextLevel: number;
  totalSkillPoints: number;
  spentSkillPoints: number;
  availableSkillPoints: number;
  unlockedSkillIds: string[];
};

export type HeroSkillTree = {
  heroType: HeroType;
  nodes: SkillNodeDefinition[];
};

export type SkillNodeDefinition = {
  id: string;
  name: string;
  text: string;
  root: boolean;
  prerequisiteId: string | null;
};

export type SavedRuneLoadout = {
  heroType: HeroType;
  runeIds: string[];
};

export type ProgressionResponse = {
  account: ProgressionSummary;
  runes: RuneDefinition[];
  heroes: HeroProgression[];
  skillTrees: HeroSkillTree[];
  loadouts: SavedRuneLoadout[];
};

export type MatchProgressionEffects = {
  maxHpDelta: number;
  attackDelta: number;
  maxApDelta: number;
  manaDelta: number;
  openingHandDelta: number;
  summonedUnitArmorDelta: number;
  firstSummonedUnitArmorDelta: number;
  spellDamageDelta: number;
};

export type MatchProgressionLoadout = {
  runeIds: string[];
  skillIds: string[];
  effects: MatchProgressionEffects;
};

export type Hero = {
  id: string;
  side: Side;
  heroType: HeroType;
  hp: number;
  maxHp: number;
  shield?: number;
  attack: number;
  attackRange: number;
  position: HexCoord;
  apRemaining: number;
  maxAp: number;
  hasAttacked: boolean;
};

export type HeroType =
  | "runekeeper"
  | "pyromancer"
  | "chronomancer"
  | "warden"
  | "battlemage"
  | "barbarian"
  | "archer"
  | "builder";

export type Unit = {
  id: string;
  side: Side;
  name: string;
  templateId?: string;
  attack: number;
  attackRange: number;
  armor: number;
  maxArmor: number;
  position: HexCoord;
  apRemaining: number;
  maxAp: number;
  hasAttacked: boolean;
  items: CarriedItem[];
};

export type CarriedItem = {
  id: string;
  templateId: string;
  name: string;
  passive: ItemPassiveEffect;
  active?: ItemActiveEffect;
  activeUsedThisTurn: boolean;
};

export type DroppedItem = {
  id: string;
  position: HexCoord;
  item: CarriedItem;
};

export type HexTile = {
  coord: HexCoord;
};

export type HexBoard = {
  radius: number;
  tiles: HexTile[];
  manaSources?: HexCoord[];
  buildings?: Building[];
  units: Unit[];
  droppedItems: DroppedItem[];
};

export type Building = {
  id: string;
  templateId: string;
  name: string;
  position: HexCoord;
  effect: BuildingEffect;
  activatedThisTurn: boolean;
};

export type MatchParticipantState = {
  side: Side;
  mana: number;
  maxMana: number;
  hero: Hero;
  progression: MatchProgressionLoadout;
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
    }
  | {
      type: "equipItem";
      card: CardSummary;
      unitId: string;
    }
  | {
      type: "buildManaSource";
      card: CardSummary;
      coord: HexCoord;
    }
  | {
      type: "buildBuilding";
      card: CardSummary;
      coord: HexCoord;
    }
  | {
      type: "activateItem";
      unitId: string;
      itemId: string;
    }
  | {
      type: "activateBuilding";
      buildingId: string;
      occupantId: string;
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
  viewerHeroType: HeroType | null;
  opponentHeroType: HeroType | null;
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

export type MatchScenarioSummary = {
  id: string;
  name: string;
  description: string;
  primaryActions: string[];
};

export type MatchScenarioListResponse = {
  scenarios: MatchScenarioSummary[];
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
      type: "activateItem";
      unitId: string;
      itemId: string;
    }
  | {
      type: "activateBuilding";
      buildingId: string;
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
      type: "manaSourceBuilt";
      side: Side;
      coord: HexCoord;
    }
  | {
      type: "buildingBuilt";
      side: Side;
      buildingId: string;
      name: string;
      coord: HexCoord;
    }
  | {
      type: "buildingActivated";
      side: Side;
      buildingId: string;
      name: string;
      occupantId: string;
    }
  | {
      type: "heroShielded";
      side: Side;
      heroId: string;
      amount: number;
    }
  | {
      type: "manaGained";
      side: Side;
      amount: number;
      source: {
        type: "barbarianKill";
        heroId: string;
        unitId: string;
      };
    }
  | {
      type: "itemEquipped";
      side: Side;
      unitId: string;
      itemId: string;
      name: string;
    }
  | {
      type: "itemDropped";
      side: Side;
      unitId: string;
      itemId: string;
      name: string;
      position: HexCoord;
    }
  | {
      type: "itemActivated";
      side: Side;
      unitId: string;
      itemId: string;
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
