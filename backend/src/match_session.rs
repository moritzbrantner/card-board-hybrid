use std::collections::HashSet;
use std::error::Error;
use std::fmt;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::ser::SerializeStruct;
use serde::{Deserialize, Serialize};
use serde_json::json;

#[path = "card_interactions.rs"]
mod card_interactions;
mod solo_ai_policy;

use solo_ai_policy::{SoloAiActionIntent, SoloAiDecision, SoloAiPolicy, SoloAiView};

const BOARD_RADIUS: i32 = 3;
const STARTING_MANA: u8 = 2;
const MAX_MANA: u8 = 8;
const OPENING_HAND_SIZE: usize = 4;

#[derive(Clone, Debug)]
pub struct MatchState {
    pub mode: MatchMode,
    pub round: u32,
    pub phase: Phase,
    pub active_side: Side,
    pub priority_side: Option<Side>,
    pub player: PlayerState,
    pub opponent: PlayerState,
    pub board: HexBoard,
    pub action_stack: Vec<StackItem>,
    pub log: Vec<String>,
    pub winner: Option<Side>,
    next_stack_item_id: u32,
    next_unit_id: u32,
    next_item_id: u32,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReplayVisibility {
    Public,
    Revealed,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MatchMode {
    Solo,
    Shared,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardSummary {
    pub template_id: String,
    pub name: String,
    pub rarity: Rarity,
    pub cost: u8,
    pub kind: CardKind,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ReplayEvent {
    MatchCreated,
    TurnStarted {
        side: Side,
        round: u32,
    },
    TurnEnded {
        side: Side,
        round: u32,
    },
    RoundStarted {
        round: u32,
    },
    CardDrawn {
        side: Side,
        card: Option<CardSummary>,
        hidden: bool,
    },
    CardPlayed {
        side: Side,
        card: CardSummary,
        target: ActionTarget,
    },
    ActionQueued {
        side: Side,
        item: StackItem,
    },
    UnitSummoned {
        side: Side,
        unit_id: String,
        name: String,
        position: HexCoord,
    },
    PieceMoved {
        side: Side,
        piece_id: String,
        from: HexCoord,
        to: HexCoord,
    },
    PieceAttacked {
        side: Side,
        attacker_id: String,
        target_id: String,
        damage_to_target: i32,
        counter_damage_to_attacker: i32,
    },
    PieceHealed {
        side: Side,
        piece_id: String,
        amount: i32,
    },
    PieceBuffed {
        side: Side,
        piece_id: String,
        attack_delta: i32,
        armor_delta: i32,
    },
    PieceDamaged {
        side: Side,
        piece_id: String,
        amount: i32,
    },
    UnitDestroyed {
        side: Side,
        unit_id: String,
        name: String,
    },
    ItemEquipped {
        side: Side,
        unit_id: String,
        item_id: String,
        name: String,
    },
    ItemDropped {
        side: Side,
        unit_id: String,
        item_id: String,
        name: String,
        position: HexCoord,
    },
    ItemActivated {
        side: Side,
        unit_id: String,
        item_id: String,
        name: String,
    },
    MatchEnded {
        winner: Side,
    },
}

#[derive(Clone, Debug)]
pub struct RecordedReplayFrame {
    pub action_index: Option<u32>,
    pub event: ReplayEvent,
    pub snapshot_json: String,
}

impl Serialize for MatchState {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut state = serializer.serialize_struct("MatchState", 11)?;
        state.serialize_field("mode", &self.mode)?;
        state.serialize_field("round", &self.round)?;
        state.serialize_field("phase", &self.phase)?;
        state.serialize_field("activeSide", &self.active_side)?;
        state.serialize_field("prioritySide", &self.priority_side)?;
        state.serialize_field(
            "player",
            &PublicPlayerState {
                player: &self.player,
                expose_hand: true,
            },
        )?;
        state.serialize_field(
            "opponent",
            &PublicPlayerState {
                player: &self.opponent,
                expose_hand: false,
            },
        )?;
        state.serialize_field("board", &self.board)?;
        state.serialize_field("actionStack", &self.action_stack)?;
        state.serialize_field("log", &self.log)?;
        state.serialize_field("winner", &self.winner)?;
        state.end()
    }
}

struct PublicPlayerState<'a> {
    player: &'a PlayerState,
    expose_hand: bool,
}

impl Serialize for PublicPlayerState<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let field_count = if self.expose_hand { 10 } else { 9 };
        let mut state = serializer.serialize_struct("PlayerState", field_count)?;
        state.serialize_field("side", &self.player.side)?;
        state.serialize_field("mana", &self.player.mana)?;
        state.serialize_field("maxMana", &self.player.max_mana)?;
        state.serialize_field("wizard", &self.player.wizard)?;
        state.serialize_field("progression", &self.player.progression)?;
        if self.expose_hand {
            state.serialize_field("hand", &self.player.hand)?;
        }
        state.serialize_field("handCount", &self.player.hand.len())?;
        state.serialize_field("deckCount", &self.player.deck_count)?;
        state.serialize_field("discardCount", &self.player.discard_count)?;
        state.end()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Planning,
    MatchOver,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    Player,
    Opponent,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerState {
    pub side: Side,
    pub mana: u8,
    pub max_mana: u8,
    pub wizard: Wizard,
    #[serde(default)]
    pub progression: MatchProgressionLoadout,
    pub hand: Vec<Card>,
    pub deck_count: usize,
    pub discard_count: usize,
    deck: Vec<Card>,
    discard: Vec<Card>,
    rng_seed: u64,
    has_started_first_turn: bool,
    #[serde(default)]
    summoned_unit_count: u32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchProgressionLoadout {
    #[serde(default)]
    pub rune_ids: Vec<String>,
    #[serde(default)]
    pub skill_ids: Vec<String>,
    #[serde(default)]
    pub effects: MatchProgressionEffects,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchProgressionEffects {
    #[serde(default)]
    pub max_hp_delta: i32,
    #[serde(default)]
    pub attack_delta: i32,
    #[serde(default)]
    pub max_ap_delta: i8,
    #[serde(default)]
    pub mana_delta: i8,
    #[serde(default)]
    pub opening_hand_delta: u8,
    #[serde(default)]
    pub summoned_unit_armor_delta: i32,
    #[serde(default)]
    pub first_summoned_unit_armor_delta: i32,
    #[serde(default)]
    pub spell_damage_delta: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Wizard {
    pub id: String,
    pub side: Side,
    #[serde(default)]
    pub wizard_type: WizardType,
    pub hp: i32,
    pub max_hp: i32,
    pub attack: i32,
    pub position: HexCoord,
    pub ap_remaining: u8,
    pub max_ap: u8,
    pub has_attacked: bool,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WizardType {
    #[default]
    Runekeeper,
    Pyromancer,
    Chronomancer,
    Warden,
    Battlemage,
}

struct WizardProfile {
    max_hp: i32,
    attack: i32,
    max_ap: u8,
}

impl WizardType {
    fn profile(self) -> WizardProfile {
        match self {
            Self::Runekeeper => WizardProfile {
                max_hp: 20,
                attack: 1,
                max_ap: 3,
            },
            Self::Pyromancer => WizardProfile {
                max_hp: 18,
                attack: 2,
                max_ap: 3,
            },
            Self::Chronomancer => WizardProfile {
                max_hp: 16,
                attack: 1,
                max_ap: 4,
            },
            Self::Warden => WizardProfile {
                max_hp: 24,
                attack: 1,
                max_ap: 2,
            },
            Self::Battlemage => WizardProfile {
                max_hp: 20,
                attack: 2,
                max_ap: 2,
            },
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HexBoard {
    pub radius: i32,
    pub tiles: Vec<HexTile>,
    pub units: Vec<Unit>,
    #[serde(default)]
    pub dropped_items: Vec<DroppedItem>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HexTile {
    pub coord: HexCoord,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct HexCoord {
    pub q: i32,
    pub r: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Unit {
    pub id: String,
    pub side: Side,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_id: Option<String>,
    pub attack: i32,
    pub armor: i32,
    pub max_armor: i32,
    pub position: HexCoord,
    pub ap_remaining: u8,
    pub max_ap: u8,
    pub has_attacked: bool,
    #[serde(default)]
    pub items: Vec<CarriedItem>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CarriedItem {
    pub id: String,
    pub template_id: String,
    pub name: String,
    pub passive: ItemPassiveEffect,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active: Option<ItemActiveEffect>,
    #[serde(default)]
    pub active_used_this_turn: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedItem {
    pub id: String,
    pub position: HexCoord,
    pub item: CarriedItem,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub id: String,
    pub template_id: String,
    pub name: String,
    pub rarity: Rarity,
    pub cost: u8,
    pub text: String,
    pub kind: CardKind,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Rarity {
    Basic,
    Advanced,
    Rare,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CardKind {
    Unit {
        attack: i32,
        armor: i32,
        max_ap: u8,
    },
    Spell {
        range: u8,
        #[serde(default)]
        priority: u8,
        effect: SpellEffect,
    },
    Item {
        range: u8,
        passive: ItemPassiveEffect,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        active: Option<ItemActiveEffect>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SpellEffect {
    Heal { amount: i32 },
    Buff { attack: i32, armor: i32 },
    Damage { amount: i32 },
    Draw { amount: u8 },
    AreaDamage { amount: i32, radius: u8 },
    LineDamage { amount: i32 },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ItemPassiveEffect {
    StatBonus { attack: i32, armor: i32, max_ap: i8 },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ItemActiveEffect {
    HealCarrier { amount: i32 },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum MatchActionRequest {
    PlayCard {
        card_id: String,
        target: ActionTarget,
    },
    MovePiece {
        piece_id: String,
        to: HexCoord,
    },
    Attack {
        attacker_id: String,
        target_id: String,
    },
    ActivateItem {
        unit_id: String,
        item_id: String,
    },
    EndTurn,
    PassPriority,
    AdvanceAi,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ActionTarget {
    Hex { coord: HexCoord },
    Piece { piece_id: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MatchError {
    MatchOver,
    NotActiveSide,
    NotPrioritySide,
    CardNotFound,
    NotEnoughMana,
    NoActionPoints,
    InvalidHex,
    OccupiedHex,
    InvalidTarget,
    PieceNotFound,
    NotYourPiece,
    NotAdjacent,
    AlreadyAttacked,
    ItemNotFound,
    ItemExhausted,
    StackPending,
    EmptyStack,
    PriorityTooLow,
    AiUnavailable,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StackItem {
    pub id: String,
    pub side: Side,
    pub priority: u8,
    pub action: StackAction,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum StackAction {
    PlayUnit {
        card: CardSummary,
        coord: HexCoord,
    },
    CastSpell {
        card: CardSummary,
        target_id: String,
    },
    MovePiece {
        piece_id: String,
        from: HexCoord,
        to: HexCoord,
    },
    Attack {
        attacker_id: String,
        target_id: String,
    },
    EquipItem {
        card: CardSummary,
        unit_id: String,
    },
    ActivateItem {
        unit_id: String,
        item_id: String,
    },
}

#[derive(Clone, Debug)]
struct PieceView {
    id: String,
    side: Side,
    position: HexCoord,
    attack: i32,
    ap_remaining: u8,
    has_attacked: bool,
}

impl fmt::Display for MatchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::MatchOver => "the match is over",
            Self::NotActiveSide => "it is not your turn",
            Self::NotPrioritySide => "you do not have priority",
            Self::CardNotFound => "card is no longer in hand",
            Self::NotEnoughMana => "not enough mana",
            Self::NoActionPoints => "not enough action points",
            Self::InvalidHex => "that hex is not on the board",
            Self::OccupiedHex => "that hex is occupied",
            Self::InvalidTarget => "that target is not legal",
            Self::PieceNotFound => "piece not found",
            Self::NotYourPiece => "that piece is not yours",
            Self::NotAdjacent => "target is not adjacent",
            Self::AlreadyAttacked => "that piece has already attacked this turn",
            Self::ItemNotFound => "item not found",
            Self::ItemExhausted => "that item has already been activated this turn",
            Self::StackPending => "resolve the stack before taking that action",
            Self::EmptyStack => "there are no pending actions to resolve",
            Self::PriorityTooLow => "spell priority must be greater than the pending action",
            Self::AiUnavailable => "the AI is not ready to act",
        };

        f.write_str(message)
    }
}

impl Error for MatchError {}

impl MatchState {
    #[allow(dead_code, reason = "kept as the default rules-engine constructor")]
    pub fn new() -> Self {
        Self::new_with_player_wizard_type(WizardType::default())
    }

    pub fn new_with_player_wizard_type(player_wizard_type: WizardType) -> Self {
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos() as u64)
            .unwrap_or(1);

        Self::new_with_seed_and_player_wizard_type(seed, player_wizard_type)
    }

    #[allow(
        dead_code,
        reason = "kept as a progression-free constructor for tests and callers"
    )]
    pub fn new_with_loadouts(
        player_wizard_type: WizardType,
        opponent_wizard_type: WizardType,
        player_deck: Vec<Card>,
        opponent_deck: Vec<Card>,
    ) -> Self {
        Self::new_with_progression_loadouts(
            player_wizard_type,
            opponent_wizard_type,
            player_deck,
            opponent_deck,
            MatchProgressionLoadout::default(),
            MatchProgressionLoadout::default(),
        )
    }

    pub fn new_with_progression_loadouts(
        player_wizard_type: WizardType,
        opponent_wizard_type: WizardType,
        player_deck: Vec<Card>,
        opponent_deck: Vec<Card>,
        player_progression: MatchProgressionLoadout,
        opponent_progression: MatchProgressionLoadout,
    ) -> Self {
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos() as u64)
            .unwrap_or(1);

        Self::new_with_seed_wizard_types_mode_and_decks(
            seed,
            player_wizard_type,
            opponent_wizard_type,
            MatchMode::Solo,
            player_deck,
            opponent_deck,
            player_progression,
            opponent_progression,
        )
    }

    #[allow(
        dead_code,
        reason = "kept as the default shared rules-engine constructor"
    )]
    pub fn new_shared_with_wizard_types(
        player_wizard_type: WizardType,
        opponent_wizard_type: WizardType,
    ) -> Self {
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos() as u64)
            .unwrap_or(1);

        Self::new_with_seed_wizard_types_and_mode(
            seed,
            player_wizard_type,
            opponent_wizard_type,
            MatchMode::Shared,
        )
    }

    #[allow(
        dead_code,
        reason = "kept as a progression-free constructor for tests and callers"
    )]
    pub fn new_shared_with_loadouts(
        player_wizard_type: WizardType,
        opponent_wizard_type: WizardType,
        player_deck: Vec<Card>,
        opponent_deck: Vec<Card>,
    ) -> Self {
        Self::new_shared_with_progression_loadouts(
            player_wizard_type,
            opponent_wizard_type,
            player_deck,
            opponent_deck,
            MatchProgressionLoadout::default(),
            MatchProgressionLoadout::default(),
        )
    }

    pub fn new_shared_with_progression_loadouts(
        player_wizard_type: WizardType,
        opponent_wizard_type: WizardType,
        player_deck: Vec<Card>,
        opponent_deck: Vec<Card>,
        player_progression: MatchProgressionLoadout,
        opponent_progression: MatchProgressionLoadout,
    ) -> Self {
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos() as u64)
            .unwrap_or(1);

        Self::new_with_seed_wizard_types_mode_and_decks(
            seed,
            player_wizard_type,
            opponent_wizard_type,
            MatchMode::Shared,
            player_deck,
            opponent_deck,
            player_progression,
            opponent_progression,
        )
    }

    pub fn to_snapshot_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(&MatchSnapshot::from(self))
    }

    pub fn from_snapshot_json(snapshot: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str::<MatchSnapshot>(snapshot).map(Self::from)
    }

    pub fn initial_replay_frame(&self) -> RecordedReplayFrame {
        RecordedReplayFrame {
            action_index: None,
            event: ReplayEvent::MatchCreated,
            snapshot_json: self
                .to_snapshot_json()
                .expect("match snapshot should serialize for replay"),
        }
    }

    pub fn replay_value(&self, visibility: ReplayVisibility) -> serde_json::Value {
        json!({
            "mode": self.mode,
            "round": self.round,
            "phase": self.phase,
            "activeSide": self.active_side,
            "prioritySide": self.priority_side,
            "player": self.player.replay_value(true),
            "opponent": self.opponent.replay_value(visibility == ReplayVisibility::Revealed),
            "board": self.board,
            "actionStack": self.action_stack,
            "log": self.log,
            "winner": self.winner,
        })
    }

    #[allow(
        dead_code,
        reason = "kept as the deterministic rules-engine test constructor"
    )]
    fn new_with_seed(seed: u64) -> Self {
        Self::new_with_seed_and_player_wizard_type(seed, WizardType::default())
    }

    fn new_with_seed_and_player_wizard_type(seed: u64, player_wizard_type: WizardType) -> Self {
        Self::new_with_seed_wizard_types_and_mode(
            seed,
            player_wizard_type,
            WizardType::Runekeeper,
            MatchMode::Solo,
        )
    }

    fn new_with_seed_wizard_types_and_mode(
        seed: u64,
        player_wizard_type: WizardType,
        opponent_wizard_type: WizardType,
        mode: MatchMode,
    ) -> Self {
        let player_deck = crate::deck_library::deck_from_snapshot(
            Side::Player,
            &crate::deck_library::starter_deck_snapshot(),
        )
        .expect("starter player deck should be valid");
        let opponent_deck = crate::deck_library::deck_from_snapshot(
            Side::Opponent,
            &crate::deck_library::starter_deck_snapshot(),
        )
        .expect("starter opponent deck should be valid");
        Self::new_with_seed_wizard_types_mode_and_decks(
            seed,
            player_wizard_type,
            opponent_wizard_type,
            mode,
            player_deck,
            opponent_deck,
            MatchProgressionLoadout::default(),
            MatchProgressionLoadout::default(),
        )
    }

    #[allow(
        clippy::too_many_arguments,
        reason = "test and store constructors pass mirrored player/opponent setup explicitly"
    )]
    fn new_with_seed_wizard_types_mode_and_decks(
        seed: u64,
        player_wizard_type: WizardType,
        opponent_wizard_type: WizardType,
        mode: MatchMode,
        player_deck: Vec<Card>,
        opponent_deck: Vec<Card>,
        player_progression: MatchProgressionLoadout,
        opponent_progression: MatchProgressionLoadout,
    ) -> Self {
        let mut game = Self {
            mode,
            round: 1,
            phase: Phase::Planning,
            active_side: Side::Player,
            player: PlayerState::new(
                Side::Player,
                seed ^ 0xA11C_E551_1234_5678,
                player_wizard_type,
                player_deck,
                player_progression,
            ),
            opponent: PlayerState::new(
                Side::Opponent,
                seed ^ 0x0B0E_1234_9876_5432,
                opponent_wizard_type,
                opponent_deck,
                opponent_progression,
            ),
            board: HexBoard::new(BOARD_RADIUS),
            action_stack: Vec::new(),
            priority_side: None,
            log: vec!["The wizards enter the hex arena.".to_string()],
            winner: None,
            next_stack_item_id: 1,
            next_unit_id: 1,
            next_item_id: 1,
        };

        for _ in 0..opening_hand_size(&game.player.progression) {
            game.player.draw();
        }
        for _ in 0..opening_hand_size(&game.opponent.progression) {
            game.opponent.draw();
        }
        let mut ignored_frames = Vec::new();
        game.start_turn(Side::Player, &mut ignored_frames, None);

        game
    }

    #[allow(dead_code, reason = "kept as the non-recording rules-engine API")]
    pub fn apply_action(&mut self, request: MatchActionRequest) -> Result<(), MatchError> {
        self.apply_action_internal(Side::Player, request, None)
            .map(|_| ())
    }

    pub fn apply_action_recording(
        &mut self,
        request: MatchActionRequest,
        action_index: u32,
    ) -> Result<Vec<RecordedReplayFrame>, MatchError> {
        self.apply_action_recording_for_side(Side::Player, request, action_index)
    }

    pub fn apply_action_recording_for_side(
        &mut self,
        side: Side,
        request: MatchActionRequest,
        action_index: u32,
    ) -> Result<Vec<RecordedReplayFrame>, MatchError> {
        self.apply_action_internal(side, request, Some(action_index))
    }

    pub fn forfeit_recording(
        &mut self,
        winner: Side,
        action_index: u32,
    ) -> Vec<RecordedReplayFrame> {
        let mut frames = Vec::new();
        if self.phase == Phase::MatchOver {
            return frames;
        }

        self.phase = Phase::MatchOver;
        self.winner = Some(winner);
        self.log
            .insert(0, format!("{} wins by forfeit.", winner.label()));
        self.truncate_log();
        self.record_replay_frame(
            &mut frames,
            Some(action_index),
            ReplayEvent::MatchEnded { winner },
        );
        frames
    }

    pub fn public_value_for_side(&self, viewer_side: Side) -> serde_json::Value {
        json!({
            "mode": self.mode,
            "round": self.round,
            "phase": self.phase,
            "activeSide": self.active_side,
            "prioritySide": self.priority_side,
            "player": self.player.replay_value(viewer_side == Side::Player),
            "opponent": self.opponent.replay_value(viewer_side == Side::Opponent),
            "board": self.board,
            "actionStack": self.action_stack,
            "log": self.log,
            "winner": self.winner,
        })
    }

    fn apply_action_internal(
        &mut self,
        side: Side,
        request: MatchActionRequest,
        action_index: Option<u32>,
    ) -> Result<Vec<RecordedReplayFrame>, MatchError> {
        if self.phase == Phase::MatchOver {
            return Err(MatchError::MatchOver);
        }

        let mut frames = Vec::new();
        match request {
            MatchActionRequest::PlayCard { card_id, target } => {
                self.play_card_for_side(side, card_id, target, &mut frames, action_index)
            }
            MatchActionRequest::MovePiece { piece_id, to } => {
                self.require_turn_action_side(side)?;
                self.move_piece_for_side(side, &piece_id, to, &mut frames, action_index)
            }
            MatchActionRequest::Attack {
                attacker_id,
                target_id,
            } => {
                self.require_turn_action_side(side)?;
                self.attack_for_side(side, &attacker_id, &target_id, &mut frames, action_index)
            }
            MatchActionRequest::ActivateItem { unit_id, item_id } => {
                self.require_turn_action_side(side)?;
                self.activate_item_for_side(side, &unit_id, &item_id, &mut frames, action_index)
            }
            MatchActionRequest::EndTurn => {
                self.require_turn_action_side(side)?;
                if !self.action_stack.is_empty() {
                    return Err(MatchError::StackPending);
                }
                if self.mode == MatchMode::Shared {
                    self.end_shared_turn(side, &mut frames, action_index);
                } else {
                    self.end_player_turn(&mut frames, action_index);
                }
                Ok(())
            }
            MatchActionRequest::PassPriority => {
                self.pass_priority_for_side(side, &mut frames, action_index)
            }
            MatchActionRequest::AdvanceAi => self.advance_solo_ai(&mut frames, action_index),
        }?;

        Ok(frames)
    }

    fn require_turn_action_side(&self, side: Side) -> Result<(), MatchError> {
        if !self.action_stack.is_empty() {
            return Err(MatchError::StackPending);
        }
        if side != self.active_side {
            return Err(MatchError::NotActiveSide);
        }
        Ok(())
    }

    fn record_replay_frame(
        &self,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
        event: ReplayEvent,
    ) {
        frames.push(RecordedReplayFrame {
            action_index,
            event,
            snapshot_json: self
                .to_snapshot_json()
                .expect("match snapshot should serialize for replay"),
        });
    }

    fn end_player_turn(
        &mut self,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) {
        self.log.insert(0, "You ended your turn.".to_string());
        self.record_replay_frame(
            frames,
            action_index,
            ReplayEvent::TurnEnded {
                side: Side::Player,
                round: self.round,
            },
        );
        self.start_turn(Side::Opponent, frames, action_index);
        self.truncate_log();
    }

    fn end_shared_turn(
        &mut self,
        side: Side,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) {
        self.log
            .insert(0, format!("{} ended their turn.", side.label()));
        self.record_replay_frame(
            frames,
            action_index,
            ReplayEvent::TurnEnded {
                side,
                round: self.round,
            },
        );

        if side == Side::Opponent {
            self.round += 1;
            self.reset_unit_armor_for_new_round();
            self.log.insert(0, format!("Round {} begins.", self.round));
            self.truncate_log();
            self.record_replay_frame(
                frames,
                action_index,
                ReplayEvent::RoundStarted { round: self.round },
            );
        }

        self.start_turn(side.opponent(), frames, action_index);
        self.truncate_log();
    }

    fn reset_unit_armor_for_new_round(&mut self) {
        for unit in self.board.units.iter_mut().filter(|unit| unit.armor > 0) {
            unit.armor = unit.max_armor;
        }
    }

    fn refresh_mana_from_control(&mut self, side: Side) {
        let mana = mana_with_progression(
            self.mana_from_control(side),
            self.player_ref(side).progression.effects.mana_delta,
        );
        let player = self.player_mut(side);
        player.max_mana = mana;
        player.mana = mana;
    }

    fn mana_from_control(&self, side: Side) -> u8 {
        self.controlled_hexes(side).len().min(usize::from(MAX_MANA)) as u8
    }

    fn controlled_hexes(&self, side: Side) -> HashSet<HexCoord> {
        let mut controlled = HashSet::new();
        for piece in self.pieces_for_side(side) {
            controlled.insert(piece.position);
            for neighbor in piece.position.neighbors() {
                if self.board.is_valid(neighbor) {
                    controlled.insert(neighbor);
                }
            }
        }
        controlled
    }

    fn play_card_for_side(
        &mut self,
        side: Side,
        card_id: String,
        target: ActionTarget,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) -> Result<(), MatchError> {
        let stack_was_empty = self.action_stack.is_empty();
        let card = {
            let player = self.player_ref(side);
            player
                .hand
                .iter()
                .find(|card| card.id == card_id)
                .cloned()
                .ok_or(MatchError::CardNotFound)?
        };

        {
            let player = self.player_ref(side);
            if player.mana < card.cost {
                return Err(MatchError::NotEnoughMana);
            }
            if player.wizard.ap_remaining == 0 {
                return Err(MatchError::NoActionPoints);
            }
        }

        if stack_was_empty {
            if side != self.active_side {
                return Err(MatchError::NotActiveSide);
            }
        } else {
            if self.priority_side != Some(side) {
                return Err(MatchError::NotPrioritySide);
            }
            let CardKind::Spell { priority, .. } = &card.kind else {
                return Err(MatchError::StackPending);
            };
            let pending_priority = self
                .action_stack
                .last()
                .map(|item| item.priority)
                .unwrap_or_default();
            if *priority <= pending_priority {
                return Err(MatchError::PriorityTooLow);
            }
        }

        match &card.kind {
            CardKind::Unit { .. } => {
                let wizard_position = self.player_ref(side).wizard.position;
                let planned_unit_play = card_interactions::plan_unit_play(
                    &card,
                    target,
                    wizard_position,
                    &self.board,
                    |coord| self.is_occupied(coord),
                )?;

                self.spend_card_resources(side, &card_id, &card)?;
                self.log.insert(
                    0,
                    format!("{} put {} on the stack.", side.label(), card.name),
                );
                let item = self.push_stack_item(
                    side,
                    0,
                    StackAction::PlayUnit {
                        card: CardSummary::from(&card),
                        coord: planned_unit_play.coord,
                    },
                );
                self.record_replay_frame(
                    frames,
                    action_index,
                    ReplayEvent::CardPlayed {
                        side,
                        card: CardSummary::from(&card),
                        target: ActionTarget::Hex {
                            coord: planned_unit_play.coord,
                        },
                    },
                );
                self.record_replay_frame(
                    frames,
                    action_index,
                    ReplayEvent::ActionQueued { side, item },
                );
            }
            CardKind::Item { .. } => {
                let ActionTarget::Piece { piece_id } = target else {
                    return Err(MatchError::InvalidTarget);
                };
                let target = self
                    .board
                    .units
                    .iter()
                    .find(|unit| unit.id == piece_id)
                    .cloned()
                    .ok_or(MatchError::PieceNotFound)?;
                let caster_position = self.player_ref(side).wizard.position;
                let planned_item_play = card_interactions::plan_item_play(
                    &card,
                    ActionTarget::Piece { piece_id },
                    side,
                    caster_position,
                    &target,
                )?;

                self.spend_card_resources(side, &card_id, &card)?;
                self.log.insert(
                    0,
                    format!("{} put {} on the stack.", side.label(), card.name),
                );
                let item = self.push_stack_item(
                    side,
                    0,
                    StackAction::EquipItem {
                        card: CardSummary::from(&card),
                        unit_id: planned_item_play.unit_id.clone(),
                    },
                );
                self.record_replay_frame(
                    frames,
                    action_index,
                    ReplayEvent::CardPlayed {
                        side,
                        card: CardSummary::from(&card),
                        target: ActionTarget::Piece {
                            piece_id: planned_item_play.unit_id,
                        },
                    },
                );
                self.record_replay_frame(
                    frames,
                    action_index,
                    ReplayEvent::ActionQueued { side, item },
                );
            }
            CardKind::Spell { .. } => {
                let ActionTarget::Piece { piece_id } = target else {
                    return Err(MatchError::InvalidTarget);
                };
                let target = self
                    .piece_view(&piece_id)
                    .ok_or(MatchError::PieceNotFound)?;
                let caster_position = self.player_ref(side).wizard.position;
                let planned_spell_play = card_interactions::plan_spell_play(
                    &card,
                    ActionTarget::Piece { piece_id },
                    side,
                    caster_position,
                    &self.player_ref(side).wizard.id,
                    &target,
                )?;
                self.spend_card_resources(side, &card_id, &card)?;
                self.log.insert(
                    0,
                    format!("{} put {} on the stack.", side.label(), card.name),
                );
                let item = self.push_stack_item(
                    side,
                    planned_spell_play.priority,
                    StackAction::CastSpell {
                        card: CardSummary::from(&card),
                        target_id: planned_spell_play.target_id.clone(),
                    },
                );
                self.record_replay_frame(
                    frames,
                    action_index,
                    ReplayEvent::CardPlayed {
                        side,
                        card: CardSummary::from(&card),
                        target: ActionTarget::Piece {
                            piece_id: planned_spell_play.target_id,
                        },
                    },
                );
                self.record_replay_frame(
                    frames,
                    action_index,
                    ReplayEvent::ActionQueued { side, item },
                );
            }
        }

        if self.mode == MatchMode::Solo && side == Side::Player && stack_was_empty {
            self.resolve_all_stack(frames, action_index);
        }
        self.check_winner(frames, action_index);
        self.truncate_log();
        Ok(())
    }

    fn spend_card_resources(
        &mut self,
        side: Side,
        card_id: &str,
        card: &Card,
    ) -> Result<(), MatchError> {
        let player = self.player_mut(side);
        let hand_index = player
            .hand
            .iter()
            .position(|candidate| candidate.id == card_id)
            .ok_or(MatchError::CardNotFound)?;

        if player.mana < card.cost {
            return Err(MatchError::NotEnoughMana);
        }
        if player.wizard.ap_remaining == 0 {
            return Err(MatchError::NoActionPoints);
        }

        player.mana -= card.cost;
        player.wizard.ap_remaining -= 1;
        let card = player.hand.remove(hand_index);
        player.discard.push(card);
        player.discard_count = player.discard.len();
        Ok(())
    }

    fn apply_resolved_spell(
        &mut self,
        side: Side,
        resolved_spell: card_interactions::ResolvedSpell,
        card_name: &str,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) {
        match resolved_spell.effect {
            card_interactions::ResolvedSpellEffect::Heal { piece_id, amount } => {
                self.heal_piece(&piece_id, amount);
                self.log.insert(
                    0,
                    format!("{} cast {} to heal {}.", side.label(), card_name, piece_id),
                );
                self.record_replay_frame(
                    frames,
                    action_index,
                    ReplayEvent::PieceHealed {
                        side,
                        piece_id,
                        amount,
                    },
                );
            }
            card_interactions::ResolvedSpellEffect::Buff {
                piece_id,
                attack,
                armor,
            } => {
                if let Some(unit) = self.board.units.iter_mut().find(|unit| unit.id == piece_id) {
                    unit.attack += attack;
                    unit.armor += armor;
                    unit.max_armor += armor;
                    self.log.insert(
                        0,
                        format!("{} cast {} on {}.", side.label(), card_name, unit.name),
                    );
                    self.record_replay_frame(
                        frames,
                        action_index,
                        ReplayEvent::PieceBuffed {
                            side,
                            piece_id,
                            attack_delta: attack,
                            armor_delta: armor,
                        },
                    );
                }
            }
            card_interactions::ResolvedSpellEffect::Damage { piece_ids, amount } => {
                self.damage_pieces(side, piece_ids, amount, frames, action_index);
                self.log_spell_resolution(side, card_name, resolved_spell.log);
            }
            card_interactions::ResolvedSpellEffect::Draw { amount } => {
                let drawn = self.draw_cards_for_side(side, amount);
                for card in drawn {
                    self.record_replay_frame(
                        frames,
                        action_index,
                        ReplayEvent::CardDrawn {
                            side,
                            card: Some(CardSummary::from(&card)),
                            hidden: side == Side::Opponent,
                        },
                    );
                }
                self.log_spell_resolution(side, card_name, resolved_spell.log);
            }
        }
    }

    fn log_spell_resolution(
        &mut self,
        side: Side,
        card_name: &str,
        log: card_interactions::SpellLog,
    ) {
        let message = match log {
            card_interactions::SpellLog::Heal { piece_id } => {
                format!("{} cast {} to heal {}.", side.label(), card_name, piece_id)
            }
            card_interactions::SpellLog::Buff { piece_id } => {
                format!("{} cast {} on {}.", side.label(), card_name, piece_id)
            }
            card_interactions::SpellLog::Damage { piece_id } => {
                format!("{} cast {} at {}.", side.label(), card_name, piece_id)
            }
            card_interactions::SpellLog::Draw { amount } => {
                format!("{} cast {} to draw {}.", side.label(), card_name, amount)
            }
            card_interactions::SpellLog::AreaDamage { piece_id } => {
                format!("{} cast {} around {}.", side.label(), card_name, piece_id)
            }
            card_interactions::SpellLog::LineDamage => {
                format!("{} cast {} down a line.", side.label(), card_name)
            }
        };

        self.log.insert(0, message);
    }

    fn push_stack_item(&mut self, side: Side, priority: u8, action: StackAction) -> StackItem {
        let item = StackItem {
            id: format!("stack-{}", self.next_stack_item_id),
            side,
            priority,
            action,
        };
        self.next_stack_item_id += 1;
        self.action_stack.push(item.clone());
        self.priority_side = Some(side.opponent());
        item
    }

    fn pass_priority_for_side(
        &mut self,
        side: Side,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) -> Result<(), MatchError> {
        if self.action_stack.is_empty() {
            return Err(MatchError::EmptyStack);
        }
        if self.priority_side != Some(side) {
            return Err(MatchError::NotPrioritySide);
        }

        self.resolve_top_stack_item(frames, action_index);
        self.check_winner(frames, action_index);
        self.truncate_log();
        Ok(())
    }

    fn resolve_all_stack(
        &mut self,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) {
        while !self.action_stack.is_empty() && self.phase != Phase::MatchOver {
            self.resolve_top_stack_item(frames, action_index);
            self.check_winner(frames, action_index);
        }
    }

    fn resolve_top_stack_item(
        &mut self,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) {
        let Some(item) = self.action_stack.pop() else {
            self.priority_side = None;
            return;
        };

        match item.action {
            StackAction::PlayUnit { card, coord } => {
                self.resolve_unit_card(item.side, card, coord, frames, action_index);
            }
            StackAction::CastSpell { card, target_id } => {
                self.resolve_spell_card(item.side, card, &target_id, frames, action_index);
            }
            StackAction::MovePiece { piece_id, from, to } => {
                self.resolve_move(item.side, &piece_id, from, to, frames, action_index);
            }
            StackAction::Attack {
                attacker_id,
                target_id,
            } => {
                self.resolve_attack(item.side, &attacker_id, &target_id, frames, action_index);
            }
            StackAction::EquipItem { card, unit_id } => {
                self.resolve_item_card(item.side, card, &unit_id, frames, action_index);
            }
            StackAction::ActivateItem { unit_id, item_id } => {
                self.resolve_item_activation(item.side, &unit_id, &item_id, frames, action_index);
            }
        }

        self.priority_side = self.action_stack.last().map(|item| item.side.opponent());
    }

    fn resolve_unit_card(
        &mut self,
        side: Side,
        card: CardSummary,
        coord: HexCoord,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) {
        let wizard_position = self.player_ref(side).wizard.position;
        if !card_interactions::can_resolve_unit_play(coord, wizard_position, &self.board, |coord| {
            self.is_occupied(coord)
        }) {
            self.log
                .insert(0, format!("{} could not resolve.", card.name));
            return;
        }

        let progression = self.player_ref(side).progression.clone();
        let is_first_summoned_unit = self.player_ref(side).summoned_unit_count == 0;
        let Some(unit) = card_interactions::summon_unit_from_card(
            &card,
            side,
            || self.next_unit_id(side),
            coord,
            &progression,
            is_first_summoned_unit,
        ) else {
            return;
        };
        let unit_id = unit.id.clone();
        let unit_name = unit.name.clone();
        let unit_position = unit.position;
        self.board.units.push(unit);
        self.player_mut(side).summoned_unit_count += 1;
        self.log
            .insert(0, format!("{} summoned {}.", side.label(), card.name));
        self.record_replay_frame(
            frames,
            action_index,
            ReplayEvent::UnitSummoned {
                side,
                unit_id: unit_id.clone(),
                name: unit_name,
                position: unit_position,
            },
        );
        self.pick_up_dropped_items_at(side, &unit_id, unit_position, frames, action_index);
    }

    fn resolve_spell_card(
        &mut self,
        side: Side,
        card: CardSummary,
        target_id: &str,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) {
        let CardKind::Spell { effect, .. } = &card.kind else {
            return;
        };
        let Some(target) = self.piece_view(target_id) else {
            self.log
                .insert(0, format!("{} had no legal target.", card.name));
            return;
        };
        let caster_position = self.player_ref(side).wizard.position;
        let caster_wizard_id = self.player_ref(side).wizard.id.clone();
        if card_interactions::validate_spell_target(
            side,
            effect,
            caster_position,
            &caster_wizard_id,
            &target,
        )
        .is_err()
        {
            self.log
                .insert(0, format!("{} had no legal target.", card.name));
            return;
        }

        let enemy_pieces = self.pieces_for_side(side.opponent());
        let progression = self.player_ref(side).progression.clone();
        let Ok(resolved_spell) = card_interactions::resolve_spell(
            &card,
            side,
            caster_position,
            &caster_wizard_id,
            &target,
            &enemy_pieces,
            &progression,
        ) else {
            self.log
                .insert(0, format!("{} had no legal target.", card.name));
            return;
        };

        self.apply_resolved_spell(side, resolved_spell, &card.name, frames, action_index);
    }

    fn resolve_item_card(
        &mut self,
        side: Side,
        card: CardSummary,
        unit_id: &str,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) {
        let item_id = self.next_item_id(side);
        let Some(unit_index) = self
            .board
            .units
            .iter()
            .position(|unit| unit.id == unit_id && unit.side == side)
        else {
            self.log
                .insert(0, format!("{} had no legal carrier.", card.name));
            return;
        };

        let unit = &mut self.board.units[unit_index];
        let card_name = card.name.clone();
        if card_interactions::equip_item_from_card(card, item_id.clone(), unit).is_err() {
            return;
        }
        self.log.insert(
            0,
            format!("{} equipped {} to {}.", side.label(), card_name, unit.name),
        );
        self.record_replay_frame(
            frames,
            action_index,
            ReplayEvent::ItemEquipped {
                side,
                unit_id: unit_id.to_string(),
                item_id,
                name: card_name,
            },
        );
    }

    fn resolve_item_activation(
        &mut self,
        side: Side,
        unit_id: &str,
        item_id: &str,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) {
        let Some(unit) = self
            .board
            .units
            .iter()
            .find(|unit| unit.id == unit_id && unit.side == side)
        else {
            self.log.insert(
                0,
                format!("Item activation by {} had no legal item.", unit_id),
            );
            return;
        };

        let Ok(resolved_item_activation) =
            card_interactions::resolve_item_activation(unit, item_id)
        else {
            self.log.insert(
                0,
                format!("Item activation by {} had no legal item.", unit_id),
            );
            return;
        };

        match resolved_item_activation.effect {
            card_interactions::ResolvedItemActiveEffect::HealCarrier { unit_id, amount } => {
                self.heal_piece(&unit_id, amount);
                self.record_replay_frame(
                    frames,
                    action_index,
                    ReplayEvent::PieceHealed {
                        side,
                        piece_id: unit_id,
                        amount,
                    },
                );
            }
        }

        self.log.insert(
            0,
            format!(
                "{} activated {}.",
                side.label(),
                resolved_item_activation.item_name
            ),
        );
        self.record_replay_frame(
            frames,
            action_index,
            ReplayEvent::ItemActivated {
                side,
                unit_id: unit_id.to_string(),
                item_id: item_id.to_string(),
                name: resolved_item_activation.item_name,
            },
        );
    }

    fn move_piece_for_side(
        &mut self,
        side: Side,
        piece_id: &str,
        to: HexCoord,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) -> Result<(), MatchError> {
        let piece = self.piece_view(piece_id).ok_or(MatchError::PieceNotFound)?;
        if piece.side != side {
            return Err(MatchError::NotYourPiece);
        }
        if piece.ap_remaining == 0 {
            return Err(MatchError::NoActionPoints);
        }
        if !self.board.is_valid(to) {
            return Err(MatchError::InvalidHex);
        }
        if !piece.position.is_adjacent(to) {
            return Err(MatchError::NotAdjacent);
        }
        if self.is_occupied(to) {
            return Err(MatchError::OccupiedHex);
        }

        if self.player.wizard.id == piece_id {
            self.player.wizard.ap_remaining -= 1;
        } else if self.opponent.wizard.id == piece_id {
            self.opponent.wizard.ap_remaining -= 1;
        } else if let Some(unit) = self.board.units.iter_mut().find(|unit| unit.id == piece_id) {
            unit.ap_remaining -= 1;
        }

        self.log
            .insert(0, format!("{} put a move on the stack.", side.label()));
        let item = self.push_stack_item(
            side,
            0,
            StackAction::MovePiece {
                piece_id: piece_id.to_string(),
                from: piece.position,
                to,
            },
        );
        self.record_replay_frame(
            frames,
            action_index,
            ReplayEvent::ActionQueued { side, item },
        );
        if self.mode == MatchMode::Solo && side == Side::Player {
            self.resolve_all_stack(frames, action_index);
        }
        self.truncate_log();
        Ok(())
    }

    fn resolve_move(
        &mut self,
        side: Side,
        piece_id: &str,
        from: HexCoord,
        to: HexCoord,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) {
        let Some(piece) = self.piece_view(piece_id) else {
            self.log
                .insert(0, format!("Move by {} had no legal piece.", piece_id));
            return;
        };
        if piece.side != side
            || piece.position != from
            || !self.board.is_valid(to)
            || self.is_occupied(to)
        {
            self.log
                .insert(0, format!("Move by {} had no legal path.", piece_id));
            return;
        }

        if self.player.wizard.id == piece_id {
            self.player.wizard.position = to;
        } else if self.opponent.wizard.id == piece_id {
            self.opponent.wizard.position = to;
        } else if let Some(unit) = self.board.units.iter_mut().find(|unit| unit.id == piece_id) {
            unit.position = to;
        }

        self.log
            .insert(0, format!("{} moved {}.", side.label(), piece_id));
        self.record_replay_frame(
            frames,
            action_index,
            ReplayEvent::PieceMoved {
                side,
                piece_id: piece_id.to_string(),
                from,
                to,
            },
        );
        self.pick_up_dropped_items_at(side, piece_id, to, frames, action_index);
    }

    fn attack_for_side(
        &mut self,
        side: Side,
        attacker_id: &str,
        target_id: &str,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) -> Result<(), MatchError> {
        let attacker = self
            .piece_view(attacker_id)
            .ok_or(MatchError::PieceNotFound)?;
        let target = self
            .piece_view(target_id)
            .ok_or(MatchError::PieceNotFound)?;

        if attacker.side != side {
            return Err(MatchError::NotYourPiece);
        }
        if target.side == side {
            return Err(MatchError::InvalidTarget);
        }
        if attacker.ap_remaining == 0 {
            return Err(MatchError::NoActionPoints);
        }
        if attacker.has_attacked {
            return Err(MatchError::AlreadyAttacked);
        }
        if !attacker.position.is_adjacent(target.position) {
            return Err(MatchError::NotAdjacent);
        }

        self.mark_attacker_spent(attacker_id);
        self.log
            .insert(0, format!("{} put an attack on the stack.", side.label()));
        let item = self.push_stack_item(
            side,
            0,
            StackAction::Attack {
                attacker_id: attacker_id.to_string(),
                target_id: target_id.to_string(),
            },
        );
        self.record_replay_frame(
            frames,
            action_index,
            ReplayEvent::ActionQueued { side, item },
        );
        if self.mode == MatchMode::Solo && side == Side::Player {
            self.resolve_all_stack(frames, action_index);
        }
        self.check_winner(frames, action_index);
        self.truncate_log();
        Ok(())
    }

    fn activate_item_for_side(
        &mut self,
        side: Side,
        unit_id: &str,
        item_id: &str,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) -> Result<(), MatchError> {
        let unit = self
            .board
            .units
            .iter_mut()
            .find(|unit| unit.id == unit_id)
            .ok_or(MatchError::PieceNotFound)?;
        if unit.side != side {
            return Err(MatchError::NotYourPiece);
        }
        if unit.ap_remaining == 0 {
            return Err(MatchError::NoActionPoints);
        }
        let item = unit
            .items
            .iter_mut()
            .find(|item| item.id == item_id)
            .ok_or(MatchError::ItemNotFound)?;
        if item.active.is_none() {
            return Err(MatchError::InvalidTarget);
        }
        if item.active_used_this_turn {
            return Err(MatchError::ItemExhausted);
        }

        unit.ap_remaining -= 1;
        item.active_used_this_turn = true;
        self.log.insert(
            0,
            format!("{} put {}'s item on the stack.", side.label(), unit.name),
        );
        let stack_item = self.push_stack_item(
            side,
            0,
            StackAction::ActivateItem {
                unit_id: unit_id.to_string(),
                item_id: item_id.to_string(),
            },
        );
        self.record_replay_frame(
            frames,
            action_index,
            ReplayEvent::ActionQueued {
                side,
                item: stack_item,
            },
        );
        if self.mode == MatchMode::Solo && side == Side::Player {
            self.resolve_all_stack(frames, action_index);
        }
        self.truncate_log();
        Ok(())
    }

    fn resolve_attack(
        &mut self,
        side: Side,
        attacker_id: &str,
        target_id: &str,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) {
        let Some(attacker) = self.piece_view(attacker_id) else {
            self.log.insert(
                0,
                format!("Attack by {} had no legal attacker.", attacker_id),
            );
            return;
        };
        let Some(target) = self.piece_view(target_id) else {
            self.log
                .insert(0, format!("Attack by {} had no legal target.", attacker_id));
            return;
        };

        if attacker.side != side
            || target.side == side
            || !attacker.position.is_adjacent(target.position)
        {
            self.log
                .insert(0, format!("Attack by {} had no legal target.", attacker_id));
            return;
        }

        self.damage_piece(target_id, attacker.attack);
        self.damage_piece(attacker_id, target.attack);
        self.record_replay_frame(
            frames,
            action_index,
            ReplayEvent::PieceAttacked {
                side,
                attacker_id: attacker_id.to_string(),
                target_id: target_id.to_string(),
                damage_to_target: attacker.attack,
                counter_damage_to_attacker: target.attack,
            },
        );
        self.remove_dead_units(frames, action_index);
        self.log.insert(
            0,
            format!(
                "{} attacked {} with {}.",
                side.label(),
                target_id,
                attacker_id
            ),
        );
    }

    fn advance_solo_ai(
        &mut self,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) -> Result<(), MatchError> {
        if self.mode != MatchMode::Solo {
            return Err(MatchError::AiUnavailable);
        }

        if !self.action_stack.is_empty() {
            if self.priority_side != Some(Side::Opponent) {
                return Err(MatchError::NotPrioritySide);
            }
            self.pass_priority_for_side(Side::Opponent, frames, action_index)?;
            return Ok(());
        }

        if self.active_side != Side::Opponent {
            return Err(MatchError::AiUnavailable);
        }

        let policy = SoloAiPolicy::default();
        let decision = policy.decide(&self.solo_ai_view());
        if self.apply_solo_ai_decision(decision, frames, action_index) {
            self.check_winner(frames, action_index);
        } else {
            self.finish_opponent_turn(frames, action_index);
        }

        self.truncate_log();
        Ok(())
    }

    fn apply_solo_ai_decision(
        &mut self,
        decision: SoloAiDecision,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) -> bool {
        match decision {
            SoloAiDecision::TakeAction(SoloAiActionIntent::Attack {
                attacker_id,
                target_id,
            }) => self
                .attack_for_side(
                    Side::Opponent,
                    &attacker_id,
                    &target_id,
                    frames,
                    action_index,
                )
                .is_ok(),
            SoloAiDecision::TakeAction(SoloAiActionIntent::PlayCard { card_id, target }) => self
                .play_card_for_side(Side::Opponent, card_id, target, frames, action_index)
                .is_ok(),
            SoloAiDecision::TakeAction(SoloAiActionIntent::MovePiece { piece_id, to }) => self
                .move_piece_for_side(Side::Opponent, &piece_id, to, frames, action_index)
                .is_ok(),
            SoloAiDecision::FinishTurn => false,
        }
    }

    fn finish_opponent_turn(
        &mut self,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) {
        self.log.insert(0, "Opponent ended their turn.".to_string());
        self.record_replay_frame(
            frames,
            action_index,
            ReplayEvent::TurnEnded {
                side: Side::Opponent,
                round: self.round,
            },
        );

        if self.phase == Phase::Planning {
            self.round += 1;
            self.reset_unit_armor_for_new_round();
            self.start_turn(Side::Player, frames, action_index);
            self.log.insert(0, format!("Round {} begins.", self.round));
            self.truncate_log();
            self.record_replay_frame(
                frames,
                action_index,
                ReplayEvent::RoundStarted { round: self.round },
            );
        }
    }

    fn start_turn(
        &mut self,
        side: Side,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) {
        self.active_side = side;
        self.refresh_mana_from_control(side);
        let should_draw = self.player_ref(side).has_started_first_turn;
        let mut drawn = None;
        {
            let player = self.player_mut(side);
            player.wizard.ap_remaining = player.wizard.max_ap;
            player.wizard.has_attacked = false;
            if should_draw {
                drawn = player.draw();
            } else {
                player.has_started_first_turn = true;
            }
        }
        for unit in self.board.units.iter_mut().filter(|unit| unit.side == side) {
            unit.ap_remaining = unit.max_ap;
            unit.has_attacked = false;
            for item in &mut unit.items {
                item.active_used_this_turn = false;
            }
        }
        self.record_replay_frame(
            frames,
            action_index,
            ReplayEvent::TurnStarted {
                side,
                round: self.round,
            },
        );
        if let Some(card) = drawn {
            self.record_replay_frame(
                frames,
                action_index,
                ReplayEvent::CardDrawn {
                    side,
                    card: Some(CardSummary::from(&card)),
                    hidden: side == Side::Opponent,
                },
            );
        }
    }

    fn player_ref(&self, side: Side) -> &PlayerState {
        match side {
            Side::Player => &self.player,
            Side::Opponent => &self.opponent,
        }
    }

    fn player_mut(&mut self, side: Side) -> &mut PlayerState {
        match side {
            Side::Player => &mut self.player,
            Side::Opponent => &mut self.opponent,
        }
    }

    fn solo_ai_view(&self) -> SoloAiView {
        let opponent_wizard = PieceView::from(&self.opponent.wizard);
        let player_wizard = PieceView::from(&self.player.wizard);
        let opponent_units: Vec<_> = self
            .board
            .units
            .iter()
            .filter(|unit| unit.side == Side::Opponent)
            .map(PieceView::from)
            .collect();
        let player_units: Vec<_> = self
            .board
            .units
            .iter()
            .filter(|unit| unit.side == Side::Player)
            .map(PieceView::from)
            .collect();
        let mut opponent_pieces = vec![opponent_wizard.clone()];
        opponent_pieces.extend(opponent_units.clone());
        let mut player_pieces = vec![player_wizard.clone()];
        player_pieces.extend(player_units.clone());
        let occupied_hexes = opponent_pieces
            .iter()
            .chain(player_pieces.iter())
            .map(|piece| piece.position)
            .collect();
        let valid_hexes = self.board.tiles.iter().map(|tile| tile.coord).collect();
        let mut damaged_piece_ids = HashSet::new();
        for piece in opponent_pieces.iter().chain(player_pieces.iter()) {
            if self.piece_is_damaged(&piece.id) {
                damaged_piece_ids.insert(piece.id.clone());
            }
        }

        SoloAiView {
            opponent_wizard,
            player_wizard,
            opponent_pieces,
            player_pieces,
            opponent_units,
            player_units,
            opponent_hand: self.opponent.hand.clone(),
            opponent_mana: self.opponent.mana,
            opponent_deck_count: self.opponent.deck_count,
            opponent_discard_count: self.opponent.discard_count,
            valid_hexes,
            occupied_hexes,
            damaged_piece_ids,
        }
    }

    fn pieces_for_side(&self, side: Side) -> Vec<PieceView> {
        let mut pieces = vec![PieceView::from(&self.player_ref(side).wizard)];
        pieces.extend(
            self.board
                .units
                .iter()
                .filter(|unit| unit.side == side)
                .map(PieceView::from),
        );
        pieces
    }

    fn piece_view(&self, piece_id: &str) -> Option<PieceView> {
        if self.player.wizard.id == piece_id {
            return Some(PieceView::from(&self.player.wizard));
        }
        if self.opponent.wizard.id == piece_id {
            return Some(PieceView::from(&self.opponent.wizard));
        }
        self.board
            .units
            .iter()
            .find(|unit| unit.id == piece_id)
            .map(PieceView::from)
    }

    fn mark_attacker_spent(&mut self, piece_id: &str) {
        if self.player.wizard.id == piece_id {
            self.player.wizard.ap_remaining -= 1;
            self.player.wizard.has_attacked = true;
            return;
        }
        if self.opponent.wizard.id == piece_id {
            self.opponent.wizard.ap_remaining -= 1;
            self.opponent.wizard.has_attacked = true;
            return;
        }
        if let Some(unit) = self.board.units.iter_mut().find(|unit| unit.id == piece_id) {
            unit.ap_remaining -= 1;
            unit.has_attacked = true;
        }
    }

    fn damage_piece(&mut self, piece_id: &str, amount: i32) {
        if self.player.wizard.id == piece_id {
            self.player.wizard.hp -= amount;
            return;
        }
        if self.opponent.wizard.id == piece_id {
            self.opponent.wizard.hp -= amount;
            return;
        }
        if let Some(unit) = self.board.units.iter_mut().find(|unit| unit.id == piece_id) {
            unit.armor -= amount;
        }
    }

    fn damage_pieces(
        &mut self,
        side: Side,
        piece_ids: Vec<String>,
        amount: i32,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) {
        for piece_id in piece_ids {
            self.damage_piece(&piece_id, amount);
            self.record_replay_frame(
                frames,
                action_index,
                ReplayEvent::PieceDamaged {
                    side,
                    piece_id,
                    amount,
                },
            );
        }
        self.remove_dead_units(frames, action_index);
    }

    fn draw_cards_for_side(&mut self, side: Side, amount: u8) -> Vec<Card> {
        let player = self.player_mut(side);
        (0..amount).filter_map(|_| player.draw()).collect()
    }

    fn heal_piece(&mut self, piece_id: &str, amount: i32) {
        if self.player.wizard.id == piece_id {
            self.player.wizard.hp = (self.player.wizard.hp + amount).min(self.player.wizard.max_hp);
            return;
        }
        if self.opponent.wizard.id == piece_id {
            self.opponent.wizard.hp =
                (self.opponent.wizard.hp + amount).min(self.opponent.wizard.max_hp);
            return;
        }
        if let Some(unit) = self.board.units.iter_mut().find(|unit| unit.id == piece_id) {
            unit.armor = (unit.armor + amount).min(unit.max_armor);
        }
    }

    fn piece_is_damaged(&self, piece_id: &str) -> bool {
        if self.player.wizard.id == piece_id {
            return self.player.wizard.hp < self.player.wizard.max_hp;
        }
        if self.opponent.wizard.id == piece_id {
            return self.opponent.wizard.hp < self.opponent.wizard.max_hp;
        }
        self.board
            .units
            .iter()
            .find(|unit| unit.id == piece_id)
            .is_some_and(|unit| unit.armor < unit.max_armor)
    }

    fn remove_dead_units(
        &mut self,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) {
        let destroyed: Vec<_> = self
            .board
            .units
            .iter()
            .filter(|unit| unit.armor <= 0)
            .map(|unit| {
                (
                    unit.side,
                    unit.id.clone(),
                    unit.name.clone(),
                    unit.position,
                    unit.items.clone(),
                )
            })
            .collect();
        self.board.units.retain(|unit| unit.armor > 0);
        for (side, unit_id, name, position, items) in destroyed {
            self.record_replay_frame(
                frames,
                action_index,
                ReplayEvent::UnitDestroyed {
                    side,
                    unit_id: unit_id.clone(),
                    name,
                },
            );
            for item in items {
                let dropped_id = format!("dropped-{}", item.id);
                self.board.dropped_items.push(DroppedItem {
                    id: dropped_id,
                    position,
                    item: item.clone(),
                });
                self.record_replay_frame(
                    frames,
                    action_index,
                    ReplayEvent::ItemDropped {
                        side,
                        unit_id: unit_id.clone(),
                        item_id: item.id,
                        name: item.name,
                        position,
                    },
                );
            }
        }
    }

    fn pick_up_dropped_items_at(
        &mut self,
        side: Side,
        unit_id: &str,
        position: HexCoord,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) {
        let Some(unit_index) =
            self.board.units.iter().position(|unit| {
                unit.id == unit_id && unit.side == side && unit.position == position
            })
        else {
            return;
        };

        let mut picked_up = Vec::new();
        self.board.dropped_items.retain(|dropped_item| {
            if dropped_item.position == position {
                picked_up.push(dropped_item.item.clone());
                false
            } else {
                true
            }
        });

        for item in picked_up {
            let item_id = item.id.clone();
            let item_name = item.name.clone();
            {
                let unit = &mut self.board.units[unit_index];
                card_interactions::apply_item_passive(unit, &item.passive);
                unit.items.push(item);
            }
            self.log
                .insert(0, format!("{} picked up {}.", unit_id, item_name));
            self.record_replay_frame(
                frames,
                action_index,
                ReplayEvent::ItemEquipped {
                    side,
                    unit_id: unit_id.to_string(),
                    item_id,
                    name: item_name,
                },
            );
        }
    }

    fn check_winner(&mut self, frames: &mut Vec<RecordedReplayFrame>, action_index: Option<u32>) {
        if self.phase == Phase::MatchOver {
            return;
        }

        let winner = match (self.player.wizard.hp <= 0, self.opponent.wizard.hp <= 0) {
            (true, true) => Some(Side::Player),
            (false, true) => Some(Side::Player),
            (true, false) => Some(Side::Opponent),
            (false, false) => None,
        };

        if let Some(winner) = winner {
            self.phase = Phase::MatchOver;
            self.winner = Some(winner);
            self.log.insert(0, format!("{} wins.", winner.label()));
            self.truncate_log();
            self.record_replay_frame(frames, action_index, ReplayEvent::MatchEnded { winner });
        }
    }

    fn is_occupied(&self, coord: HexCoord) -> bool {
        self.player.wizard.position == coord
            || self.opponent.wizard.position == coord
            || self.board.units.iter().any(|unit| unit.position == coord)
    }

    fn next_unit_id(&mut self, side: Side) -> String {
        let prefix = match side {
            Side::Player => "P",
            Side::Opponent => "O",
        };
        let id = format!("{prefix}{}", self.next_unit_id);
        self.next_unit_id += 1;
        id
    }

    fn next_item_id(&mut self, side: Side) -> String {
        let prefix = match side {
            Side::Player => "PI",
            Side::Opponent => "OI",
        };
        let id = format!("{prefix}{}", self.next_item_id);
        self.next_item_id += 1;
        id
    }

    fn truncate_log(&mut self) {
        self.log.truncate(12);
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MatchSnapshot {
    #[serde(default = "default_match_mode")]
    mode: MatchMode,
    round: u32,
    phase: Phase,
    #[serde(default = "default_active_side")]
    active_side: Side,
    #[serde(default)]
    priority_side: Option<Side>,
    player: PlayerState,
    opponent: PlayerState,
    board: HexBoard,
    #[serde(default)]
    action_stack: Vec<StackItem>,
    log: Vec<String>,
    winner: Option<Side>,
    #[serde(default = "default_next_stack_item_id")]
    next_stack_item_id: u32,
    next_unit_id: u32,
    #[serde(default = "default_next_item_id")]
    next_item_id: u32,
}

impl From<&MatchState> for MatchSnapshot {
    fn from(match_state: &MatchState) -> Self {
        Self {
            round: match_state.round,
            mode: match_state.mode,
            phase: match_state.phase.clone(),
            active_side: match_state.active_side,
            priority_side: match_state.priority_side,
            player: match_state.player.clone(),
            opponent: match_state.opponent.clone(),
            board: match_state.board.clone(),
            action_stack: match_state.action_stack.clone(),
            log: match_state.log.clone(),
            winner: match_state.winner,
            next_stack_item_id: match_state.next_stack_item_id,
            next_unit_id: match_state.next_unit_id,
            next_item_id: match_state.next_item_id,
        }
    }
}

impl From<MatchSnapshot> for MatchState {
    fn from(snapshot: MatchSnapshot) -> Self {
        Self {
            round: snapshot.round,
            mode: snapshot.mode,
            phase: snapshot.phase,
            active_side: snapshot.active_side,
            priority_side: snapshot.priority_side,
            player: snapshot.player,
            opponent: snapshot.opponent,
            board: snapshot.board,
            action_stack: snapshot.action_stack,
            log: snapshot.log,
            winner: snapshot.winner,
            next_stack_item_id: snapshot.next_stack_item_id,
            next_unit_id: snapshot.next_unit_id,
            next_item_id: snapshot.next_item_id,
        }
    }
}

fn default_match_mode() -> MatchMode {
    MatchMode::Solo
}

fn default_active_side() -> Side {
    Side::Player
}

fn default_next_stack_item_id() -> u32 {
    1
}

fn default_next_item_id() -> u32 {
    1
}

impl HexBoard {
    fn new(radius: i32) -> Self {
        let mut tiles = Vec::new();
        for q in -radius..=radius {
            for r in -radius..=radius {
                let coord = HexCoord { q, r };
                if coord.distance(HexCoord { q: 0, r: 0 }) <= radius {
                    tiles.push(HexTile { coord });
                }
            }
        }
        tiles.sort_by_key(|tile| (tile.coord.r, tile.coord.q));
        Self {
            radius,
            tiles,
            units: Vec::new(),
            dropped_items: Vec::new(),
        }
    }

    pub(crate) fn is_valid(&self, coord: HexCoord) -> bool {
        coord.distance(HexCoord { q: 0, r: 0 }) <= self.radius
    }
}

impl HexCoord {
    fn distance(self, other: Self) -> i32 {
        let dq = self.q - other.q;
        let dr = self.r - other.r;
        let ds = -self.q - self.r - (-other.q - other.r);
        dq.abs().max(dr.abs()).max(ds.abs())
    }

    pub(crate) fn is_adjacent(self, other: Self) -> bool {
        self.distance(other) == 1
    }

    fn neighbors(self) -> [Self; 6] {
        [
            Self {
                q: self.q + 1,
                r: self.r,
            },
            Self {
                q: self.q + 1,
                r: self.r - 1,
            },
            Self {
                q: self.q,
                r: self.r - 1,
            },
            Self {
                q: self.q - 1,
                r: self.r,
            },
            Self {
                q: self.q - 1,
                r: self.r + 1,
            },
            Self {
                q: self.q,
                r: self.r + 1,
            },
        ]
    }

    fn direction_to(self, other: Self) -> Option<Self> {
        let distance = self.distance(other);
        if distance == 0 {
            return None;
        }

        Self::directions()
            .into_iter()
            .find(|direction| self.offset(*direction, distance) == other)
    }

    fn offset(self, direction: Self, distance: i32) -> Self {
        Self {
            q: self.q + direction.q * distance,
            r: self.r + direction.r * distance,
        }
    }

    fn directions() -> [Self; 6] {
        [
            Self { q: 1, r: 0 },
            Self { q: 1, r: -1 },
            Self { q: 0, r: -1 },
            Self { q: -1, r: 0 },
            Self { q: -1, r: 1 },
            Self { q: 0, r: 1 },
        ]
    }
}

impl PlayerState {
    fn new(
        side: Side,
        mut rng_seed: u64,
        wizard_type: WizardType,
        mut deck: Vec<Card>,
        progression: MatchProgressionLoadout,
    ) -> Self {
        shuffle(&mut deck, &mut rng_seed);
        let mana = mana_with_progression(STARTING_MANA, progression.effects.mana_delta);

        Self {
            side,
            mana,
            max_mana: mana,
            wizard: Wizard::new(side, wizard_type, &progression.effects),
            progression,
            hand: Vec::new(),
            deck_count: deck.len(),
            discard_count: 0,
            deck,
            discard: Vec::new(),
            rng_seed,
            has_started_first_turn: false,
            summoned_unit_count: 0,
        }
    }

    fn draw(&mut self) -> Option<Card> {
        if self.deck.is_empty() && !self.discard.is_empty() {
            self.deck.append(&mut self.discard);
            shuffle(&mut self.deck, &mut self.rng_seed);
        }

        let drawn = self.deck.pop();
        if let Some(card) = drawn.clone() {
            self.hand.push(card);
        }
        self.deck_count = self.deck.len();
        self.discard_count = self.discard.len();
        drawn
    }
}

impl PlayerState {
    fn replay_value(&self, expose_hand: bool) -> serde_json::Value {
        let mut value = json!({
            "side": self.side,
            "mana": self.mana,
            "maxMana": self.max_mana,
            "wizard": self.wizard,
            "progression": self.progression,
            "handCount": self.hand.len(),
            "deckCount": self.deck_count,
            "discardCount": self.discard_count,
        });

        if expose_hand {
            value["hand"] = json!(self.hand);
        }

        value
    }
}

impl From<&Card> for CardSummary {
    fn from(card: &Card) -> Self {
        Self {
            template_id: card.template_id.clone(),
            name: card.name.clone(),
            rarity: card.rarity,
            cost: card.cost,
            kind: card.kind.clone(),
        }
    }
}

impl ReplayEvent {
    pub fn for_visibility(&self, visibility: ReplayVisibility) -> Self {
        match (visibility, self) {
            (
                ReplayVisibility::Public,
                Self::CardDrawn {
                    side: Side::Opponent,
                    hidden,
                    ..
                },
            ) if *hidden => Self::CardDrawn {
                side: Side::Opponent,
                card: None,
                hidden: true,
            },
            _ => self.clone(),
        }
    }
}

impl Wizard {
    fn new(side: Side, wizard_type: WizardType, effects: &MatchProgressionEffects) -> Self {
        let (id, position) = match side {
            Side::Player => (
                "player-wizard",
                HexCoord {
                    q: 0,
                    r: BOARD_RADIUS,
                },
            ),
            Side::Opponent => (
                "opponent-wizard",
                HexCoord {
                    q: 0,
                    r: -BOARD_RADIUS,
                },
            ),
        };
        let profile = wizard_type.profile();
        let max_hp = (profile.max_hp + effects.max_hp_delta).max(1);
        let attack = (profile.attack + effects.attack_delta).max(0);
        let max_ap = (i16::from(profile.max_ap) + i16::from(effects.max_ap_delta)).max(1) as u8;

        Self {
            id: id.to_string(),
            side,
            wizard_type,
            hp: max_hp,
            max_hp,
            attack,
            position,
            ap_remaining: max_ap,
            max_ap,
            has_attacked: false,
        }
    }
}

fn opening_hand_size(progression: &MatchProgressionLoadout) -> usize {
    OPENING_HAND_SIZE + usize::from(progression.effects.opening_hand_delta)
}

fn mana_with_progression(base: u8, delta: i8) -> u8 {
    let value = i16::from(base) + i16::from(delta);
    value.clamp(0, i16::from(MAX_MANA) + i16::from(delta.max(0))) as u8
}

impl From<&Wizard> for PieceView {
    fn from(wizard: &Wizard) -> Self {
        Self {
            id: wizard.id.clone(),
            side: wizard.side,
            position: wizard.position,
            attack: wizard.attack,
            ap_remaining: wizard.ap_remaining,
            has_attacked: wizard.has_attacked,
        }
    }
}

impl From<&Unit> for PieceView {
    fn from(unit: &Unit) -> Self {
        Self {
            id: unit.id.clone(),
            side: unit.side,
            position: unit.position,
            attack: unit.attack,
            ap_remaining: unit.ap_remaining,
            has_attacked: unit.has_attacked,
        }
    }
}

impl Side {
    fn label(self) -> &'static str {
        match self {
            Self::Player => "You",
            Self::Opponent => "Opponent",
        }
    }

    fn opponent(self) -> Self {
        match self {
            Self::Player => Self::Opponent,
            Self::Opponent => Self::Player,
        }
    }
}

impl Side {
    pub(crate) fn card_prefix(self) -> &'static str {
        match self {
            Self::Player => "p",
            Self::Opponent => "o",
        }
    }
}

fn shuffle<T>(items: &mut [T], seed: &mut u64) {
    if items.len() <= 1 {
        return;
    }

    for index in (1..items.len()).rev() {
        *seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        let swap_index = (*seed as usize) % (index + 1);
        items.swap(index, swap_index);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card_catalog::starter_card_templates;

    fn hex(q: i32, r: i32) -> HexCoord {
        HexCoord { q, r }
    }

    fn player_unit_card(game: &MatchState, template_id: &str) -> Card {
        game.player
            .hand
            .iter()
            .chain(game.player.deck.iter())
            .find(|card| card.template_id == template_id)
            .expect("card should exist in starter deck")
            .clone()
    }

    fn put_card_in_hand(game: &mut MatchState, card: Card) -> String {
        let id = card.id.clone();
        game.player.hand.push(card);
        id
    }

    fn put_card_in_side_hand(game: &mut MatchState, side: Side, card: Card) -> String {
        let id = card.id.clone();
        game.player_mut(side).hand.push(card);
        id
    }

    fn advance_solo_ai_until_player_turn(game: &mut MatchState) {
        for _ in 0..50 {
            if game.active_side == Side::Player && game.action_stack.is_empty() {
                return;
            }

            if game.priority_side == Some(Side::Player) {
                game.apply_action(MatchActionRequest::PassPriority)
                    .expect("player can pass priority");
            } else {
                game.apply_action(MatchActionRequest::AdvanceAi)
                    .expect("AI can advance");
            }
        }

        panic!("AI did not return control to the player");
    }

    fn unit_armor(game: &MatchState, unit_id: &str) -> Option<i32> {
        game.board
            .units
            .iter()
            .find(|unit| unit.id == unit_id)
            .map(|unit| unit.armor)
    }

    fn card_play_event_names(frames: &[RecordedReplayFrame]) -> Vec<&'static str> {
        frames
            .iter()
            .filter_map(|frame| match frame.event {
                ReplayEvent::CardPlayed { .. } => Some("cardPlayed"),
                ReplayEvent::ActionQueued { .. } => Some("actionQueued"),
                ReplayEvent::UnitSummoned { .. } => Some("unitSummoned"),
                ReplayEvent::PieceHealed { .. } => Some("pieceHealed"),
                ReplayEvent::PieceBuffed { .. } => Some("pieceBuffed"),
                ReplayEvent::PieceDamaged { .. } => Some("pieceDamaged"),
                ReplayEvent::CardDrawn { .. } => Some("cardDrawn"),
                ReplayEvent::ItemEquipped { .. } => Some("itemEquipped"),
                ReplayEvent::ItemActivated { .. } => Some("itemActivated"),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn radius_three_board_has_thirty_seven_tiles() {
        let game = MatchState::new_with_seed(7);

        assert_eq!(game.board.radius, 3);
        assert_eq!(game.board.tiles.len(), 37);
        assert!(game.board.is_valid(hex(0, 0)));
        assert!(!game.board.is_valid(hex(4, 0)));
    }

    #[test]
    fn match_action_payloads_accept_camel_case_api_fields() {
        let action: MatchActionRequest = serde_json::from_str(
            r#"{
                "type": "playCard",
                "cardId": "p-0-ember-squire",
                "target": {
                    "type": "hex",
                    "coord": { "q": 0, "r": 2 }
                }
            }"#,
        )
        .expect("frontend play-card payload should deserialize");

        match action {
            MatchActionRequest::PlayCard { card_id, target } => {
                assert_eq!(card_id, "p-0-ember-squire");
                assert!(matches!(target, ActionTarget::Hex { coord } if coord == hex(0, 2)));
            }
            _ => panic!("expected play-card action"),
        }

        let action: MatchActionRequest = serde_json::from_str(
            r#"{
                "type": "attack",
                "attackerId": "player-wizard",
                "targetId": "opponent-wizard"
            }"#,
        )
        .expect("frontend attack payload should deserialize");

        assert!(matches!(
            action,
            MatchActionRequest::Attack {
                attacker_id,
                target_id
            } if attacker_id == "player-wizard" && target_id == "opponent-wizard"
        ));
    }

    #[test]
    fn card_payloads_emit_camel_case_kind_fields() {
        let game = MatchState::new_with_seed(7);
        let card = game
            .player
            .hand
            .iter()
            .chain(game.player.deck.iter())
            .find(|card| matches!(card.kind, CardKind::Unit { .. }))
            .expect("starter deck should contain a unit");

        let value = serde_json::to_value(card).expect("card should serialize");

        assert!(value["kind"].get("maxAp").is_some());
        assert!(value["kind"].get("max_ap").is_none());

        let spell = starter_card_templates()
            .into_iter()
            .find(|card| card.template_id == "arcane-parry")
            .expect("starter deck should contain a spell");
        let value = serde_json::to_value(spell).expect("spell should serialize");
        assert_eq!(value["kind"]["priority"], 4);
    }

    #[test]
    fn terminal_match_phase_serializes_as_match_over() {
        let mut game = MatchState::new_with_seed(7);
        game.phase = Phase::MatchOver;

        let value = serde_json::to_value(&game).expect("match should serialize");

        assert_eq!(value["phase"], "matchOver");
        assert_ne!(value["phase"], "gameOver");
    }

    #[test]
    fn public_match_state_hides_opponent_hand_and_private_piles() {
        let game = MatchState::new_with_seed(7);

        let value = serde_json::to_value(&game).expect("match should serialize");

        assert!(value["player"].get("hand").is_some());
        assert!(value["player"].get("deck").is_none());
        assert!(value["player"].get("discard").is_none());
        assert!(value["opponent"].get("hand").is_none());
        assert!(value["opponent"].get("deck").is_none());
        assert!(value["opponent"].get("discard").is_none());
        assert_eq!(value["player"]["handCount"], 4);
        assert_eq!(value["opponent"]["handCount"], 4);
        assert_eq!(value["opponent"]["deckCount"], 56);
    }

    #[test]
    fn public_match_state_serializes_player_discard_count_after_unit_play() {
        let mut game = MatchState::new_with_seed(7);
        let value = serde_json::to_value(&game).expect("match should serialize");
        assert_eq!(value["player"]["discardCount"], 0);

        let card = player_unit_card(&game, "ember-squire");
        let card_id = put_card_in_hand(&mut game, card);

        game.apply_action(MatchActionRequest::PlayCard {
            card_id,
            target: ActionTarget::Hex { coord: hex(0, 2) },
        })
        .expect("unit should be playable next to wizard");

        let value = serde_json::to_value(&game).expect("match should serialize");
        assert_eq!(value["player"]["discardCount"], 1);
    }

    #[test]
    fn public_match_state_serializes_player_discard_count_after_spell_play() {
        let mut game = MatchState::new_with_seed(7);
        game.board.units.push(Unit {
            id: "ally".to_string(),
            side: Side::Player,
            name: "Stoneguard".to_string(),
            template_id: Some("stoneguard".to_string()),
            attack: 1,
            armor: 2,
            max_armor: 4,
            position: hex(0, 2),
            ap_remaining: 2,
            max_ap: 2,
            has_attacked: false,
            items: Vec::new(),
        });
        let card = starter_card_templates()
            .into_iter()
            .find(|card| card.template_id == "mending-rune")
            .expect("heal exists");
        let card_id = put_card_in_hand(&mut game, card);

        game.apply_action(MatchActionRequest::PlayCard {
            card_id,
            target: ActionTarget::Piece {
                piece_id: "ally".to_string(),
            },
        })
        .expect("spell should be playable on damaged ally");

        let value = serde_json::to_value(&game).expect("match should serialize");
        assert_eq!(value["player"]["discardCount"], 1);
    }

    #[test]
    fn match_snapshot_restores_hidden_piles_rng_unit_ids_and_first_turn_flags() {
        let mut game = MatchState::new_with_seed(7);
        let card = player_unit_card(&game, "ember-squire");
        let card_id = put_card_in_hand(&mut game, card);

        game.apply_action(MatchActionRequest::PlayCard {
            card_id,
            target: ActionTarget::Hex { coord: hex(0, 2) },
        })
        .expect("unit should be playable next to wizard");

        let snapshot = game.to_snapshot_json().expect("snapshot should serialize");
        let mut restored =
            MatchState::from_snapshot_json(&snapshot).expect("snapshot should deserialize");

        assert_eq!(restored.player.deck.len(), game.player.deck.len());
        assert_eq!(restored.player.discard.len(), game.player.discard.len());
        assert_eq!(restored.player.rng_seed, game.player.rng_seed);
        assert_eq!(
            restored.player.has_started_first_turn,
            game.player.has_started_first_turn
        );
        assert_eq!(restored.next_unit_id, game.next_unit_id);

        game.apply_action(MatchActionRequest::EndTurn)
            .expect("end turn should apply");
        restored
            .apply_action(MatchActionRequest::EndTurn)
            .expect("end turn should apply after restore");

        assert_eq!(
            serde_json::to_value(&restored).expect("restored match should serialize"),
            serde_json::to_value(&game).expect("match should serialize")
        );
    }

    #[test]
    fn wizards_start_on_opposite_centered_edges() {
        let game = MatchState::new_with_seed(7);

        assert_eq!(game.player.wizard.position, hex(0, 3));
        assert_eq!(game.opponent.wizard.position, hex(0, -3));
        assert_eq!(game.player.wizard.hp, 20);
        assert_eq!(game.player.wizard.attack, 1);
        assert_eq!(game.player.wizard.ap_remaining, 3);
    }

    #[test]
    fn selected_wizard_type_sets_player_starting_stats() {
        let game = MatchState::new_with_seed_and_player_wizard_type(7, WizardType::Pyromancer);

        assert_eq!(game.player.wizard.wizard_type, WizardType::Pyromancer);
        assert_eq!(game.player.wizard.hp, 18);
        assert_eq!(game.player.wizard.attack, 2);
        assert_eq!(game.player.wizard.ap_remaining, 3);
        assert_eq!(game.opponent.wizard.wizard_type, WizardType::Runekeeper);
    }

    #[test]
    fn starter_deck_has_the_expected_rarity_counts() {
        let game = MatchState::new_with_seed(7);
        let all_cards: Vec<_> = game
            .player
            .hand
            .iter()
            .chain(game.player.deck.iter())
            .collect();

        assert_eq!(all_cards.len(), 60);
        assert_eq!(
            all_cards
                .iter()
                .filter(|card| card.rarity == Rarity::Basic)
                .count(),
            50
        );
        assert_eq!(
            all_cards
                .iter()
                .filter(|card| card.rarity == Rarity::Advanced)
                .count(),
            9
        );
        assert_eq!(
            all_cards
                .iter()
                .filter(|card| card.rarity == Rarity::Rare)
                .count(),
            1
        );
        assert_eq!(starter_card_templates().len(), 34);
        assert_eq!(game.player.hand.len(), 4);
        assert_eq!(game.player.deck_count, 56);
    }

    #[test]
    fn playing_a_unit_spends_mana_and_wizard_ap_and_summons_adjacent() {
        let mut game = MatchState::new_with_seed(7);
        let card = player_unit_card(&game, "ember-squire");
        let card_id = put_card_in_hand(&mut game, card);

        let frames = game
            .apply_action_recording(
                MatchActionRequest::PlayCard {
                    card_id,
                    target: ActionTarget::Hex { coord: hex(0, 2) },
                },
                3,
            )
            .expect("unit should be playable next to wizard");

        let unit = game.board.units.first().expect("unit should be on board");
        assert_eq!(game.player.mana, 3);
        assert_eq!(game.player.wizard.ap_remaining, 2);
        assert_eq!(unit.position, hex(0, 2));
        assert_eq!(unit.template_id.as_deref(), Some("ember-squire"));
        assert_eq!(unit.ap_remaining, 1);
        assert_eq!(unit.max_ap, 2);
        assert_eq!(
            card_play_event_names(&frames),
            vec!["cardPlayed", "actionQueued", "unitSummoned"]
        );
    }

    #[test]
    fn unit_summons_must_target_empty_adjacent_hexes() {
        let mut game = MatchState::new_with_seed(7);
        let card = player_unit_card(&game, "ember-squire");
        let card_id = put_card_in_hand(&mut game, card);

        let result = game.apply_action(MatchActionRequest::PlayCard {
            card_id,
            target: ActionTarget::Hex { coord: hex(0, 1) },
        });

        assert_eq!(result, Err(MatchError::InvalidTarget));
    }

    #[test]
    fn unit_summons_reject_occupied_adjacent_hexes() {
        let mut game = MatchState::new_with_seed(7);
        game.board.units.push(Unit {
            id: "blocking-unit".to_string(),
            side: Side::Player,
            name: "Blocking Unit".to_string(),
            template_id: Some("blocking-unit".to_string()),
            attack: 1,
            armor: 1,
            max_armor: 1,
            position: hex(0, 2),
            ap_remaining: 1,
            max_ap: 2,
            has_attacked: false,
            items: Vec::new(),
        });
        let card = player_unit_card(&game, "ember-squire");
        let card_id = put_card_in_hand(&mut game, card);
        let initial_mana = game.player.mana;
        let initial_wizard_ap = game.player.wizard.ap_remaining;

        let result = game.apply_action(MatchActionRequest::PlayCard {
            card_id,
            target: ActionTarget::Hex { coord: hex(0, 2) },
        });

        assert_eq!(result, Err(MatchError::OccupiedHex));
        assert_eq!(game.player.mana, initial_mana);
        assert_eq!(game.player.wizard.ap_remaining, initial_wizard_ap);
        assert_eq!(game.board.units.len(), 1);
    }

    #[test]
    fn movement_costs_action_points_and_requires_empty_adjacency() {
        let mut game = MatchState::new_with_seed(7);

        game.apply_action(MatchActionRequest::MovePiece {
            piece_id: "player-wizard".to_string(),
            to: hex(0, 2),
        })
        .expect("wizard can move one hex");

        assert_eq!(game.player.wizard.position, hex(0, 2));
        assert_eq!(game.player.wizard.ap_remaining, 2);

        let result = game.apply_action(MatchActionRequest::MovePiece {
            piece_id: "player-wizard".to_string(),
            to: hex(0, 0),
        });

        assert_eq!(result, Err(MatchError::NotAdjacent));
    }

    #[test]
    fn adjacent_attacks_apply_counterdamage_once_per_piece() {
        let mut game = MatchState::new_with_seed(7);
        game.board.units.push(Unit {
            id: "player-unit".to_string(),
            side: Side::Player,
            name: "Rune Bruiser".to_string(),
            template_id: Some("rune-bruiser".to_string()),
            attack: 2,
            armor: 2,
            max_armor: 2,
            position: hex(0, 0),
            ap_remaining: 2,
            max_ap: 2,
            has_attacked: false,
            items: Vec::new(),
        });
        game.board.units.push(Unit {
            id: "opponent-unit".to_string(),
            side: Side::Opponent,
            name: "Stoneguard".to_string(),
            template_id: Some("stoneguard".to_string()),
            attack: 1,
            armor: 4,
            max_armor: 4,
            position: hex(1, 0),
            ap_remaining: 2,
            max_ap: 2,
            has_attacked: false,
            items: Vec::new(),
        });

        game.apply_action(MatchActionRequest::Attack {
            attacker_id: "player-unit".to_string(),
            target_id: "opponent-unit".to_string(),
        })
        .expect("adjacent attack should work");

        let player = game
            .board
            .units
            .iter()
            .find(|unit| unit.id == "player-unit")
            .expect("player unit survives");
        let opponent = game
            .board
            .units
            .iter()
            .find(|unit| unit.id == "opponent-unit")
            .expect("opponent unit survives");
        assert_eq!(player.armor, 1);
        assert_eq!(opponent.armor, 2);
        assert!(player.has_attacked);

        let result = game.apply_action(MatchActionRequest::Attack {
            attacker_id: "player-unit".to_string(),
            target_id: "opponent-unit".to_string(),
        });

        assert_eq!(result, Err(MatchError::AlreadyAttacked));
    }

    #[test]
    fn spells_heal_buff_and_damage_with_caps() {
        let mut game = MatchState::new_with_seed(7);
        game.player.mana = 8;
        game.player.wizard.ap_remaining = 3;
        game.board.units.push(Unit {
            id: "ally".to_string(),
            side: Side::Player,
            name: "Stoneguard".to_string(),
            template_id: Some("stoneguard".to_string()),
            attack: 1,
            armor: 2,
            max_armor: 4,
            position: hex(0, 2),
            ap_remaining: 2,
            max_ap: 2,
            has_attacked: false,
            items: Vec::new(),
        });
        game.board.units.push(Unit {
            id: "enemy".to_string(),
            side: Side::Opponent,
            name: "Swift Familiar".to_string(),
            template_id: Some("swift-familiar".to_string()),
            attack: 1,
            armor: 4,
            max_armor: 4,
            position: hex(0, 0),
            ap_remaining: 3,
            max_ap: 3,
            has_attacked: false,
            items: Vec::new(),
        });

        let heal = starter_card_templates()
            .into_iter()
            .find(|card| card.template_id == "mending-rune")
            .expect("heal exists");
        let heal_id = put_card_in_hand(&mut game, heal);
        let heal_frames = game
            .apply_action_recording(
                MatchActionRequest::PlayCard {
                    card_id: heal_id,
                    target: ActionTarget::Piece {
                        piece_id: "ally".to_string(),
                    },
                },
                10,
            )
            .expect("heal should work");
        assert_eq!(
            game.board
                .units
                .iter()
                .find(|unit| unit.id == "ally")
                .map(|unit| unit.armor),
            Some(4)
        );
        assert_eq!(
            card_play_event_names(&heal_frames),
            vec!["cardPlayed", "actionQueued", "pieceHealed"]
        );

        let buff = starter_card_templates()
            .into_iter()
            .find(|card| card.template_id == "war-chant")
            .expect("buff exists");
        let buff_id = put_card_in_hand(&mut game, buff);
        let buff_frames = game
            .apply_action_recording(
                MatchActionRequest::PlayCard {
                    card_id: buff_id,
                    target: ActionTarget::Piece {
                        piece_id: "ally".to_string(),
                    },
                },
                11,
            )
            .expect("buff should work");
        let ally = game
            .board
            .units
            .iter()
            .find(|unit| unit.id == "ally")
            .expect("ally survives");
        assert_eq!(ally.attack, 2);
        assert_eq!(ally.armor, 5);
        assert_eq!(ally.max_armor, 5);
        assert_eq!(
            card_play_event_names(&buff_frames),
            vec!["cardPlayed", "actionQueued", "pieceBuffed"]
        );

        let bolt = starter_card_templates()
            .into_iter()
            .find(|card| card.template_id == "starfire-bolt")
            .expect("bolt exists");
        let bolt_id = put_card_in_hand(&mut game, bolt);
        game.player.mana = 5;
        game.player.wizard.ap_remaining = 1;
        let damage_frames = game
            .apply_action_recording(
                MatchActionRequest::PlayCard {
                    card_id: bolt_id,
                    target: ActionTarget::Piece {
                        piece_id: "enemy".to_string(),
                    },
                },
                12,
            )
            .expect("bolt should work");
        assert!(!game.board.units.iter().any(|unit| unit.id == "enemy"));
        assert_eq!(
            card_play_event_names(&damage_frames),
            vec!["cardPlayed", "actionQueued", "pieceDamaged"]
        );
    }

    #[test]
    fn item_cards_equip_passives_activate_and_drop_when_carrier_dies() {
        let mut game = MatchState::new_with_seed(7);
        game.player.mana = 8;
        game.player.wizard.ap_remaining = 3;
        game.board.units.push(Unit {
            id: "ally".to_string(),
            side: Side::Player,
            name: "Stoneguard".to_string(),
            template_id: Some("stoneguard".to_string()),
            attack: 1,
            armor: 1,
            max_armor: 4,
            position: hex(0, 2),
            ap_remaining: 2,
            max_ap: 2,
            has_attacked: false,
            items: Vec::new(),
        });
        let flask = starter_card_templates()
            .into_iter()
            .find(|card| card.template_id == "ember-flask")
            .expect("item exists");
        let flask_id = put_card_in_hand(&mut game, flask);

        let equip_frames = game
            .apply_action_recording(
                MatchActionRequest::PlayCard {
                    card_id: flask_id,
                    target: ActionTarget::Piece {
                        piece_id: "ally".to_string(),
                    },
                },
                20,
            )
            .expect("item should equip to an allied unit");

        let item_id = {
            let ally = game
                .board
                .units
                .iter()
                .find(|unit| unit.id == "ally")
                .expect("ally should survive");
            assert_eq!(ally.attack, 2);
            assert_eq!(ally.items.len(), 1);
            ally.items[0].id.clone()
        };
        assert_eq!(
            card_play_event_names(&equip_frames),
            vec!["cardPlayed", "actionQueued", "itemEquipped"]
        );

        let activation_frames = game
            .apply_action_recording(
                MatchActionRequest::ActivateItem {
                    unit_id: "ally".to_string(),
                    item_id: item_id.clone(),
                },
                21,
            )
            .expect("active item should be usable by its carrier");

        let ally = game
            .board
            .units
            .iter()
            .find(|unit| unit.id == "ally")
            .expect("ally should survive");
        assert_eq!(ally.armor, 3);
        assert_eq!(ally.ap_remaining, 1);
        assert!(ally.items[0].active_used_this_turn);
        assert_eq!(
            card_play_event_names(&activation_frames),
            vec!["actionQueued", "pieceHealed", "itemActivated"]
        );

        let result = game.apply_action(MatchActionRequest::ActivateItem {
            unit_id: "ally".to_string(),
            item_id,
        });
        assert_eq!(result, Err(MatchError::ItemExhausted));

        let mut frames = Vec::new();
        game.damage_pieces(
            Side::Opponent,
            vec!["ally".to_string()],
            10,
            &mut frames,
            None,
        );

        assert!(!game.board.units.iter().any(|unit| unit.id == "ally"));
        assert_eq!(game.board.dropped_items.len(), 1);
        assert_eq!(game.board.dropped_items[0].item.name, "Ember Flask");
        assert!(
            frames
                .iter()
                .any(|frame| matches!(frame.event, ReplayEvent::ItemDropped { .. }))
        );
    }

    #[test]
    fn item_cards_only_target_allied_units_in_range() {
        let mut game = MatchState::new_with_seed(7);
        game.player.mana = 8;
        game.player.wizard.ap_remaining = 3;
        game.board.units.push(Unit {
            id: "ally-out-of-range".to_string(),
            side: Side::Player,
            name: "Far Guard".to_string(),
            template_id: Some("stoneguard".to_string()),
            attack: 1,
            armor: 1,
            max_armor: 4,
            position: hex(0, 0),
            ap_remaining: 2,
            max_ap: 2,
            has_attacked: false,
            items: Vec::new(),
        });
        game.board.units.push(Unit {
            id: "enemy-in-range".to_string(),
            side: Side::Opponent,
            name: "Ash Hound".to_string(),
            template_id: Some("ash-hound".to_string()),
            attack: 1,
            armor: 3,
            max_armor: 3,
            position: hex(0, 2),
            ap_remaining: 2,
            max_ap: 2,
            has_attacked: false,
            items: Vec::new(),
        });
        let flask = starter_card_templates()
            .into_iter()
            .find(|card| card.template_id == "ember-flask")
            .expect("item exists");
        let flask_id = put_card_in_hand(&mut game, flask);
        let initial_mana = game.player.mana;
        let initial_wizard_ap = game.player.wizard.ap_remaining;

        let enemy_result = game.apply_action(MatchActionRequest::PlayCard {
            card_id: flask_id.clone(),
            target: ActionTarget::Piece {
                piece_id: "enemy-in-range".to_string(),
            },
        });
        let range_result = game.apply_action(MatchActionRequest::PlayCard {
            card_id: flask_id,
            target: ActionTarget::Piece {
                piece_id: "ally-out-of-range".to_string(),
            },
        });

        assert_eq!(enemy_result, Err(MatchError::InvalidTarget));
        assert_eq!(range_result, Err(MatchError::InvalidTarget));
        assert_eq!(game.player.mana, initial_mana);
        assert_eq!(game.player.wizard.ap_remaining, initial_wizard_ap);
        assert!(game.board.units.iter().all(|unit| unit.items.is_empty()));
    }

    #[test]
    fn units_pick_up_dropped_items_by_moving_onto_their_hex() {
        let mut game = MatchState::new_with_seed(7);
        game.board.units.push(Unit {
            id: "attacker".to_string(),
            side: Side::Player,
            name: "Rune Bruiser".to_string(),
            template_id: Some("rune-bruiser".to_string()),
            attack: 3,
            armor: 3,
            max_armor: 3,
            position: hex(1, 1),
            ap_remaining: 2,
            max_ap: 2,
            has_attacked: false,
            items: Vec::new(),
        });
        game.board.units.push(Unit {
            id: "looter".to_string(),
            side: Side::Player,
            name: "Swift Familiar".to_string(),
            template_id: Some("swift-familiar".to_string()),
            attack: 1,
            armor: 1,
            max_armor: 1,
            position: hex(-1, 2),
            ap_remaining: 2,
            max_ap: 2,
            has_attacked: false,
            items: Vec::new(),
        });
        game.board.units.push(Unit {
            id: "carrier".to_string(),
            side: Side::Opponent,
            name: "Ash Hound".to_string(),
            template_id: Some("ash-hound".to_string()),
            attack: 1,
            armor: 3,
            max_armor: 3,
            position: hex(0, 2),
            ap_remaining: 2,
            max_ap: 2,
            has_attacked: false,
            items: vec![CarriedItem {
                id: "OI9".to_string(),
                template_id: "ember-flask".to_string(),
                name: "Ember Flask".to_string(),
                passive: ItemPassiveEffect::StatBonus {
                    attack: 1,
                    armor: 0,
                    max_ap: 0,
                },
                active: Some(ItemActiveEffect::HealCarrier { amount: 2 }),
                active_used_this_turn: false,
            }],
        });

        game.apply_action(MatchActionRequest::Attack {
            attacker_id: "attacker".to_string(),
            target_id: "carrier".to_string(),
        })
        .expect("adjacent attack should destroy the carrier");
        assert!(!game.board.units.iter().any(|unit| unit.id == "carrier"));
        assert_eq!(game.board.dropped_items.len(), 1);

        game.apply_action(MatchActionRequest::MovePiece {
            piece_id: "looter".to_string(),
            to: hex(0, 2),
        })
        .expect("unit should move onto the dropped item");

        let looter = game
            .board
            .units
            .iter()
            .find(|unit| unit.id == "looter")
            .expect("looter survives");
        assert_eq!(looter.position, hex(0, 2));
        assert_eq!(looter.attack, 2);
        assert_eq!(looter.items.len(), 1);
        assert_eq!(looter.items[0].name, "Ember Flask");
        assert!(game.board.dropped_items.is_empty());

        game.apply_action(MatchActionRequest::ActivateItem {
            unit_id: "looter".to_string(),
            item_id: "OI9".to_string(),
        })
        .expect("picked up item should be usable by its new carrier");
    }

    #[test]
    fn draw_spells_target_the_caster_and_draw_cards() {
        let mut game = MatchState::new_with_seed(7);
        game.player.mana = 8;
        game.player.wizard.ap_remaining = 3;
        let initial_hand = game.player.hand.len();
        let initial_deck = game.player.deck_count;
        let insight = starter_card_templates()
            .into_iter()
            .find(|card| card.template_id == "runic-insight")
            .expect("draw spell exists");
        let insight_id = put_card_in_hand(&mut game, insight);

        let frames = game
            .apply_action_recording(
                MatchActionRequest::PlayCard {
                    card_id: insight_id,
                    target: ActionTarget::Piece {
                        piece_id: game.player.wizard.id.clone(),
                    },
                },
                30,
            )
            .expect("draw spell should target the caster");

        assert_eq!(game.player.hand.len(), initial_hand + 1);
        assert_eq!(game.player.deck_count, initial_deck - 1);
        assert_eq!(game.player.discard_count, 1);
        assert_eq!(
            card_play_event_names(&frames),
            vec!["cardPlayed", "actionQueued", "cardDrawn"]
        );
        assert!(frames.iter().any(|frame| matches!(
            &frame.event,
            ReplayEvent::CardDrawn {
                side: Side::Player,
                card: Some(_),
                hidden: false,
            }
        )));
    }

    #[test]
    fn public_replay_redacts_hidden_opponent_draws() {
        let mut game = MatchState::new_with_seed(7);
        game.apply_action_recording(MatchActionRequest::EndTurn, 40)
            .expect("ending turn should start the opponent turn");
        advance_solo_ai_until_player_turn(&mut game);
        let initial_hand = game.opponent.hand.len();
        let initial_deck = game.opponent.deck_count;

        let frames = game
            .apply_action_recording(MatchActionRequest::EndTurn, 41)
            .expect("ending turn should start the opponent turn again");

        let draw_frame = frames
            .iter()
            .find(|frame| matches!(frame.event, ReplayEvent::CardDrawn { .. }))
            .expect("opponent turn start should draw a card");
        assert!(matches!(
            &draw_frame.event,
            ReplayEvent::CardDrawn {
                side: Side::Opponent,
                card: Some(_),
                hidden: true,
            }
        ));
        assert!(matches!(
            draw_frame.event.for_visibility(ReplayVisibility::Public),
            ReplayEvent::CardDrawn {
                side: Side::Opponent,
                card: None,
                hidden: true,
            }
        ));

        let replay_state = MatchState::from_snapshot_json(&draw_frame.snapshot_json)
            .expect("replay snapshot should deserialize");
        let public_value = replay_state.replay_value(ReplayVisibility::Public);
        assert!(public_value["opponent"].get("hand").is_none());
        assert_eq!(public_value["opponent"]["handCount"], initial_hand + 1);
        assert_eq!(public_value["opponent"]["deckCount"], initial_deck - 1);

        let revealed_value = replay_state.replay_value(ReplayVisibility::Revealed);
        assert!(revealed_value["opponent"].get("hand").is_some());
    }

    #[test]
    fn area_damage_hits_enemies_near_the_target_only() {
        let mut game = MatchState::new_with_seed(7);
        game.player.mana = 8;
        game.player.wizard.ap_remaining = 3;
        game.board.units.push(Unit {
            id: "enemy-center".to_string(),
            side: Side::Opponent,
            name: "Stoneguard".to_string(),
            template_id: Some("stoneguard".to_string()),
            attack: 1,
            armor: 4,
            max_armor: 4,
            position: hex(0, 1),
            ap_remaining: 2,
            max_ap: 2,
            has_attacked: false,
            items: Vec::new(),
        });
        game.board.units.push(Unit {
            id: "enemy-neighbor".to_string(),
            side: Side::Opponent,
            name: "Rune Bruiser".to_string(),
            template_id: Some("rune-bruiser".to_string()),
            attack: 2,
            armor: 3,
            max_armor: 3,
            position: hex(1, 0),
            ap_remaining: 2,
            max_ap: 2,
            has_attacked: false,
            items: Vec::new(),
        });
        game.board.units.push(Unit {
            id: "ally-neighbor".to_string(),
            side: Side::Player,
            name: "Ember Squire".to_string(),
            template_id: Some("ember-squire".to_string()),
            attack: 1,
            armor: 2,
            max_armor: 2,
            position: hex(-1, 2),
            ap_remaining: 2,
            max_ap: 2,
            has_attacked: false,
            items: Vec::new(),
        });
        let cinder = starter_card_templates()
            .into_iter()
            .find(|card| card.template_id == "cinder-ring")
            .expect("area spell exists");
        let cinder_id = put_card_in_hand(&mut game, cinder);

        let frames = game
            .apply_action_recording(
                MatchActionRequest::PlayCard {
                    card_id: cinder_id,
                    target: ActionTarget::Piece {
                        piece_id: "enemy-center".to_string(),
                    },
                },
                50,
            )
            .expect("area damage should be playable on an enemy");

        assert_eq!(unit_armor(&game, "enemy-center"), Some(3));
        assert_eq!(unit_armor(&game, "enemy-neighbor"), Some(2));
        assert_eq!(unit_armor(&game, "ally-neighbor"), Some(2));
        assert_eq!(
            card_play_event_names(&frames),
            vec!["cardPlayed", "actionQueued", "pieceDamaged", "pieceDamaged",]
        );
    }

    #[test]
    fn line_damage_hits_enemies_in_a_straight_line() {
        let mut game = MatchState::new_with_seed(7);
        game.player.mana = 8;
        game.player.wizard.ap_remaining = 3;
        game.board.units.push(Unit {
            id: "enemy-front".to_string(),
            side: Side::Opponent,
            name: "Stoneguard".to_string(),
            template_id: Some("stoneguard".to_string()),
            attack: 1,
            armor: 4,
            max_armor: 4,
            position: hex(0, 1),
            ap_remaining: 2,
            max_ap: 2,
            has_attacked: false,
            items: Vec::new(),
        });
        game.board.units.push(Unit {
            id: "enemy-back".to_string(),
            side: Side::Opponent,
            name: "Rune Bruiser".to_string(),
            template_id: Some("rune-bruiser".to_string()),
            attack: 2,
            armor: 3,
            max_armor: 3,
            position: hex(0, 0),
            ap_remaining: 2,
            max_ap: 2,
            has_attacked: false,
            items: Vec::new(),
        });
        game.board.units.push(Unit {
            id: "enemy-offline".to_string(),
            side: Side::Opponent,
            name: "Swift Familiar".to_string(),
            template_id: Some("swift-familiar".to_string()),
            attack: 1,
            armor: 3,
            max_armor: 3,
            position: hex(1, 0),
            ap_remaining: 3,
            max_ap: 3,
            has_attacked: false,
            items: Vec::new(),
        });
        let ray = starter_card_templates()
            .into_iter()
            .find(|card| card.template_id == "prism-ray")
            .expect("line spell exists");
        let ray_id = put_card_in_hand(&mut game, ray);

        let frames = game
            .apply_action_recording(
                MatchActionRequest::PlayCard {
                    card_id: ray_id,
                    target: ActionTarget::Piece {
                        piece_id: "enemy-front".to_string(),
                    },
                },
                60,
            )
            .expect("line damage should be playable on a straight-line enemy");

        assert_eq!(unit_armor(&game, "enemy-front"), Some(2));
        assert_eq!(unit_armor(&game, "enemy-back"), Some(1));
        assert_eq!(unit_armor(&game, "enemy-offline"), Some(3));
        assert_eq!(
            card_play_event_names(&frames),
            vec!["cardPlayed", "actionQueued", "pieceDamaged", "pieceDamaged",]
        );
    }

    #[test]
    fn line_damage_rejects_non_straight_targets() {
        let mut game = MatchState::new_with_seed(7);
        game.player.mana = 8;
        game.player.wizard.ap_remaining = 3;
        game.board.units.push(Unit {
            id: "enemy-offline".to_string(),
            side: Side::Opponent,
            name: "Swift Familiar".to_string(),
            template_id: Some("swift-familiar".to_string()),
            attack: 1,
            armor: 3,
            max_armor: 3,
            position: hex(1, 1),
            ap_remaining: 3,
            max_ap: 3,
            has_attacked: false,
            items: Vec::new(),
        });
        let ray = starter_card_templates()
            .into_iter()
            .find(|card| card.template_id == "prism-ray")
            .expect("line spell exists");
        let ray_id = put_card_in_hand(&mut game, ray);

        let result = game.apply_action(MatchActionRequest::PlayCard {
            card_id: ray_id,
            target: ActionTarget::Piece {
                piece_id: "enemy-offline".to_string(),
            },
        });

        assert_eq!(result, Err(MatchError::InvalidTarget));
    }

    #[test]
    fn ending_turn_starts_paced_ai_turn() {
        let mut game = MatchState::new_with_seed(7);

        game.apply_action(MatchActionRequest::EndTurn)
            .expect("ending turn should work");

        assert_eq!(game.round, 1);
        assert_eq!(game.active_side, Side::Opponent);
        assert_eq!(game.action_stack.len(), 0);
    }

    #[test]
    fn advancing_ai_eventually_advances_round() {
        let mut game = MatchState::new_with_seed(7);

        game.apply_action(MatchActionRequest::EndTurn)
            .expect("ending turn should work");

        advance_solo_ai_until_player_turn(&mut game);

        assert_eq!(game.round, 2);
        assert_eq!(game.active_side, Side::Player);
        assert_eq!(game.player.max_mana, game.mana_from_control(Side::Player));
        assert_eq!(game.player.hand.len(), 5);
    }

    #[test]
    fn solo_ai_actions_wait_for_player_priority_response() {
        let mut game = MatchState::new_with_seed(7);
        game.player.mana = 8;
        game.player.wizard.ap_remaining = 3;
        game.player.wizard.hp = 18;
        game.opponent.wizard.position = hex(0, -1);
        game.opponent.wizard.ap_remaining = 1;
        let salve = starter_card_templates()
            .into_iter()
            .find(|card| card.template_id == "quick-salve")
            .expect("priority response spell exists");
        let salve_id = put_card_in_side_hand(&mut game, Side::Player, salve);

        game.apply_action(MatchActionRequest::EndTurn)
            .expect("ending turn should start AI turn");
        game.apply_action(MatchActionRequest::AdvanceAi)
            .expect("AI should queue an attack");

        assert_eq!(game.action_stack.len(), 1);
        assert_eq!(game.priority_side, Some(Side::Player));

        game.apply_action(MatchActionRequest::PlayCard {
            card_id: salve_id,
            target: ActionTarget::Piece {
                piece_id: game.player.wizard.id.clone(),
            },
        })
        .expect("player can answer AI action with higher priority spell");

        assert_eq!(game.action_stack.len(), 2);
        assert_eq!(game.priority_side, Some(Side::Opponent));
        assert_eq!(game.player.wizard.hp, 18);

        game.apply_action(MatchActionRequest::AdvanceAi)
            .expect("AI should pass priority to resolve the response");
        assert_eq!(game.player.wizard.hp, 20);
        assert_eq!(game.priority_side, Some(Side::Player));
    }

    #[test]
    fn turn_start_mana_comes_from_controlled_hexes() {
        let mut game = MatchState::new_with_seed(7);
        game.player.wizard.position = hex(0, 1);
        game.opponent.wizard.position = hex(0, -1);
        game.player.mana = 0;
        game.player.max_mana = 0;
        game.opponent.mana = 0;
        game.opponent.max_mana = 0;

        game.start_turn(Side::Player, &mut Vec::new(), None);

        assert!(game.controlled_hexes(Side::Player).contains(&hex(0, 0)));
        assert!(game.controlled_hexes(Side::Opponent).contains(&hex(0, 0)));
        assert_eq!(game.player.max_mana, 7);
        assert_eq!(game.player.mana, 7);
        assert_eq!(game.opponent.max_mana, 0);
        assert_eq!(game.opponent.mana, 0);
    }

    #[test]
    fn shared_turn_start_refreshes_only_the_active_side_mana() {
        let mut game = MatchState::new_with_seed_wizard_types_and_mode(
            7,
            WizardType::Runekeeper,
            WizardType::Pyromancer,
            MatchMode::Shared,
        );
        game.player.mana = 1;
        game.player.max_mana = 4;
        game.opponent.mana = 2;
        game.opponent.max_mana = 4;

        game.apply_action_recording_for_side(Side::Player, MatchActionRequest::EndTurn, 0)
            .expect("player can end their active turn");

        assert_eq!(game.round, 1);
        assert_eq!(game.active_side, Side::Opponent);
        assert_eq!(game.player.mana, 1);
        assert_eq!(game.player.max_mana, 4);
        assert_eq!(game.opponent.mana, game.mana_from_control(Side::Opponent));
        assert_eq!(
            game.opponent.max_mana,
            game.mana_from_control(Side::Opponent)
        );
    }

    #[test]
    fn solo_round_start_resets_surviving_unit_armor_to_max_armor() {
        let mut game = MatchState::new_with_seed(7);
        game.opponent.hand.clear();
        game.board.units.push(Unit {
            id: "player-guard".to_string(),
            side: Side::Player,
            name: "Stoneguard".to_string(),
            template_id: Some("stoneguard".to_string()),
            attack: 1,
            armor: 1,
            max_armor: 4,
            position: hex(0, 2),
            ap_remaining: 2,
            max_ap: 2,
            has_attacked: false,
            items: Vec::new(),
        });
        game.board.units.push(Unit {
            id: "opponent-guard".to_string(),
            side: Side::Opponent,
            name: "Stoneguard".to_string(),
            template_id: Some("stoneguard".to_string()),
            attack: 1,
            armor: 2,
            max_armor: 6,
            position: hex(0, -2),
            ap_remaining: 2,
            max_ap: 2,
            has_attacked: false,
            items: Vec::new(),
        });

        game.apply_action(MatchActionRequest::EndTurn)
            .expect("ending turn should advance to the next round");
        advance_solo_ai_until_player_turn(&mut game);

        assert_eq!(
            game.board
                .units
                .iter()
                .find(|unit| unit.id == "player-guard")
                .map(|unit| unit.armor),
            Some(4)
        );
        assert_eq!(
            game.board
                .units
                .iter()
                .find(|unit| unit.id == "opponent-guard")
                .map(|unit| unit.armor),
            Some(6)
        );
    }

    #[test]
    fn shared_matches_reject_inactive_side_actions() {
        let mut game = MatchState::new_with_seed_wizard_types_and_mode(
            7,
            WizardType::Runekeeper,
            WizardType::Pyromancer,
            MatchMode::Shared,
        );

        let result =
            game.apply_action_recording_for_side(Side::Opponent, MatchActionRequest::EndTurn, 0);

        assert_eq!(result.err(), Some(MatchError::NotActiveSide));
    }

    #[test]
    fn shared_turns_pass_between_humans_without_running_ai() {
        let mut game = MatchState::new_with_seed_wizard_types_and_mode(
            7,
            WizardType::Runekeeper,
            WizardType::Pyromancer,
            MatchMode::Shared,
        );

        game.apply_action_recording_for_side(Side::Player, MatchActionRequest::EndTurn, 0)
            .expect("player can end their active turn");

        assert_eq!(game.active_side, Side::Opponent);
        assert_eq!(game.round, 1);
        assert_eq!(game.opponent.wizard.wizard_type, WizardType::Pyromancer);

        game.apply_action_recording_for_side(Side::Opponent, MatchActionRequest::EndTurn, 1)
            .expect("opponent can end their active turn");

        assert_eq!(game.active_side, Side::Player);
        assert_eq!(game.round, 2);
        assert_eq!(game.player.hand.len(), 5);
    }

    #[test]
    fn shared_round_start_resets_surviving_unit_armor_to_max_armor() {
        let mut game = MatchState::new_with_seed_wizard_types_and_mode(
            7,
            WizardType::Runekeeper,
            WizardType::Pyromancer,
            MatchMode::Shared,
        );
        game.board.units.push(Unit {
            id: "guard".to_string(),
            side: Side::Player,
            name: "Stoneguard".to_string(),
            template_id: Some("stoneguard".to_string()),
            attack: 1,
            armor: 1,
            max_armor: 5,
            position: hex(0, 2),
            ap_remaining: 2,
            max_ap: 2,
            has_attacked: false,
            items: Vec::new(),
        });

        game.apply_action_recording_for_side(Side::Player, MatchActionRequest::EndTurn, 0)
            .expect("player can end their active turn");
        assert_eq!(
            game.board
                .units
                .iter()
                .find(|unit| unit.id == "guard")
                .map(|unit| unit.armor),
            Some(1)
        );

        game.apply_action_recording_for_side(Side::Opponent, MatchActionRequest::EndTurn, 1)
            .expect("opponent can end their active turn");

        assert_eq!(
            game.board
                .units
                .iter()
                .find(|unit| unit.id == "guard")
                .map(|unit| unit.armor),
            Some(5)
        );
    }

    #[test]
    fn shared_spell_responses_require_higher_priority_and_resolve_lifo() {
        let mut game = MatchState::new_with_seed_wizard_types_and_mode(
            7,
            WizardType::Runekeeper,
            WizardType::Pyromancer,
            MatchMode::Shared,
        );
        game.player.mana = 8;
        game.opponent.mana = 8;
        game.player.wizard.ap_remaining = 3;
        game.opponent.wizard.ap_remaining = 3;
        game.opponent.wizard.position = hex(0, -2);
        game.board.units.push(Unit {
            id: "guard".to_string(),
            side: Side::Opponent,
            name: "Stoneguard".to_string(),
            template_id: Some("stoneguard".to_string()),
            attack: 1,
            armor: 4,
            max_armor: 4,
            position: hex(0, 0),
            ap_remaining: 2,
            max_ap: 2,
            has_attacked: false,
            items: Vec::new(),
        });

        let bolt = starter_card_templates()
            .into_iter()
            .find(|card| card.template_id == "starfire-bolt")
            .expect("damage spell exists");
        let parry = starter_card_templates()
            .into_iter()
            .find(|card| card.template_id == "arcane-parry")
            .expect("priority response spell exists");
        let bolt_id = put_card_in_side_hand(&mut game, Side::Player, bolt);
        let parry_id = put_card_in_side_hand(&mut game, Side::Opponent, parry);

        game.apply_action_recording_for_side(
            Side::Player,
            MatchActionRequest::PlayCard {
                card_id: bolt_id,
                target: ActionTarget::Piece {
                    piece_id: "guard".to_string(),
                },
            },
            0,
        )
        .expect("active player can put a spell on the stack");

        assert_eq!(game.action_stack.len(), 1);
        assert_eq!(game.priority_side, Some(Side::Opponent));
        assert_eq!(
            game.board
                .units
                .iter()
                .find(|unit| unit.id == "guard")
                .map(|unit| unit.armor),
            Some(4)
        );

        game.apply_action_recording_for_side(
            Side::Opponent,
            MatchActionRequest::PlayCard {
                card_id: parry_id,
                target: ActionTarget::Piece {
                    piece_id: "guard".to_string(),
                },
            },
            1,
        )
        .expect("opponent can answer with higher priority");

        assert_eq!(game.action_stack.len(), 2);
        assert_eq!(game.priority_side, Some(Side::Player));

        game.apply_action_recording_for_side(Side::Player, MatchActionRequest::PassPriority, 2)
            .expect("player can pass to resolve the response");
        assert_eq!(
            game.board
                .units
                .iter()
                .find(|unit| unit.id == "guard")
                .map(|unit| (unit.armor, unit.max_armor)),
            Some((6, 6))
        );
        assert_eq!(game.priority_side, Some(Side::Opponent));

        game.apply_action_recording_for_side(Side::Opponent, MatchActionRequest::PassPriority, 3)
            .expect("opponent can pass to resolve the original spell");
        assert_eq!(game.action_stack.len(), 0);
        assert_eq!(game.priority_side, None);
        assert_eq!(
            game.board
                .units
                .iter()
                .find(|unit| unit.id == "guard")
                .map(|unit| unit.armor),
            Some(2)
        );
    }

    #[test]
    fn lower_priority_spells_cannot_answer_pending_actions() {
        let mut game = MatchState::new_with_seed_wizard_types_and_mode(
            7,
            WizardType::Runekeeper,
            WizardType::Pyromancer,
            MatchMode::Shared,
        );
        game.player.mana = 8;
        game.opponent.mana = 8;
        game.opponent.wizard.position = hex(0, -2);
        game.board.units.push(Unit {
            id: "guard".to_string(),
            side: Side::Opponent,
            name: "Stoneguard".to_string(),
            template_id: Some("stoneguard".to_string()),
            attack: 1,
            armor: 4,
            max_armor: 4,
            position: hex(0, 0),
            ap_remaining: 2,
            max_ap: 2,
            has_attacked: false,
            items: Vec::new(),
        });

        let bolt = starter_card_templates()
            .into_iter()
            .find(|card| card.template_id == "starfire-bolt")
            .expect("higher priority damage spell exists");
        let chant = starter_card_templates()
            .into_iter()
            .find(|card| card.template_id == "war-chant")
            .expect("lower priority spell exists");
        let bolt_id = put_card_in_side_hand(&mut game, Side::Player, bolt);
        let chant_id = put_card_in_side_hand(&mut game, Side::Opponent, chant);

        game.apply_action_recording_for_side(
            Side::Player,
            MatchActionRequest::PlayCard {
                card_id: bolt_id,
                target: ActionTarget::Piece {
                    piece_id: "guard".to_string(),
                },
            },
            0,
        )
        .expect("active player can put a spell on the stack");

        let result = game.apply_action_recording_for_side(
            Side::Opponent,
            MatchActionRequest::PlayCard {
                card_id: chant_id,
                target: ActionTarget::Piece {
                    piece_id: "guard".to_string(),
                },
            },
            1,
        );

        assert_eq!(result.err(), Some(MatchError::PriorityTooLow));
    }

    #[test]
    fn wizard_death_ends_the_match() {
        let mut game = MatchState::new_with_seed(7);
        game.board.units.push(Unit {
            id: "player-unit".to_string(),
            side: Side::Player,
            name: "Iron Colossus".to_string(),
            template_id: Some("iron-colossus".to_string()),
            attack: 20,
            armor: 6,
            max_armor: 6,
            position: hex(0, -2),
            ap_remaining: 1,
            max_ap: 1,
            has_attacked: false,
            items: Vec::new(),
        });

        game.apply_action(MatchActionRequest::Attack {
            attacker_id: "player-unit".to_string(),
            target_id: "opponent-wizard".to_string(),
        })
        .expect("wizard can be attacked when adjacent");

        assert_eq!(game.phase, Phase::MatchOver);
        assert_eq!(game.winner, Some(Side::Player));
    }
}
