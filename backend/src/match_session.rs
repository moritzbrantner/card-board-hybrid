use std::collections::HashSet;
use std::error::Error;
use std::fmt;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::ser::SerializeStruct;
use serde::{Deserialize, Serialize};
use serde_json::json;

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
        let field_count = if self.expose_hand { 8 } else { 7 };
        let mut state = serializer.serialize_struct("PlayerState", field_count)?;
        state.serialize_field("side", &self.player.side)?;
        state.serialize_field("mana", &self.player.mana)?;
        state.serialize_field("maxMana", &self.player.max_mana)?;
        state.serialize_field("wizard", &self.player.wizard)?;
        if self.expose_hand {
            state.serialize_field("hand", &self.player.hand)?;
        }
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
    pub hand: Vec<Card>,
    pub deck_count: usize,
    pub discard_count: usize,
    deck: Vec<Card>,
    discard: Vec<Card>,
    rng_seed: u64,
    has_started_first_turn: bool,
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
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SpellEffect {
    Heal { amount: i32 },
    Buff { attack: i32, armor: i32 },
    Damage { amount: i32 },
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
    EndTurn,
    PassPriority,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
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
    StackPending,
    EmptyStack,
    PriorityTooLow,
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
            Self::StackPending => "resolve the stack before taking that action",
            Self::EmptyStack => "there are no pending actions to resolve",
            Self::PriorityTooLow => "spell priority must be greater than the pending action",
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

    pub fn new_with_loadouts(
        player_wizard_type: WizardType,
        opponent_wizard_type: WizardType,
        player_deck: Vec<Card>,
        opponent_deck: Vec<Card>,
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

    pub fn new_shared_with_loadouts(
        player_wizard_type: WizardType,
        opponent_wizard_type: WizardType,
        player_deck: Vec<Card>,
        opponent_deck: Vec<Card>,
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
        )
    }

    fn new_with_seed_wizard_types_mode_and_decks(
        seed: u64,
        player_wizard_type: WizardType,
        opponent_wizard_type: WizardType,
        mode: MatchMode,
        player_deck: Vec<Card>,
        opponent_deck: Vec<Card>,
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
            ),
            opponent: PlayerState::new(
                Side::Opponent,
                seed ^ 0x0B0E_1234_9876_5432,
                opponent_wizard_type,
                opponent_deck,
            ),
            board: HexBoard::new(BOARD_RADIUS),
            action_stack: Vec::new(),
            priority_side: None,
            log: vec!["The wizards enter the hex arena.".to_string()],
            winner: None,
            next_stack_item_id: 1,
            next_unit_id: 1,
        };

        for _ in 0..OPENING_HAND_SIZE {
            game.player.draw();
            game.opponent.draw();
        }
        game.grant_round_mana_from_control();
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
        }?;

        Ok(frames)
    }

    fn require_turn_action_side(&self, side: Side) -> Result<(), MatchError> {
        if !self.action_stack.is_empty() {
            return Err(MatchError::StackPending);
        }
        if self.mode == MatchMode::Shared && side != self.active_side {
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
        self.run_opponent_turn(frames, action_index);
        self.check_winner(frames, action_index);

        if self.phase == Phase::Planning {
            self.round += 1;
            self.reset_unit_armor_for_new_round();
            self.grant_round_mana_from_control();
            self.start_turn(Side::Player, frames, action_index);
            self.log.insert(0, format!("Round {} begins.", self.round));
            self.truncate_log();
            self.record_replay_frame(
                frames,
                action_index,
                ReplayEvent::RoundStarted { round: self.round },
            );
        }

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
            self.grant_round_mana_from_control();
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

    fn grant_round_mana_from_control(&mut self) {
        let player_mana = self.mana_from_control(Side::Player);
        let opponent_mana = self.mana_from_control(Side::Opponent);

        self.player.max_mana = player_mana;
        self.player.mana = player_mana;
        self.opponent.max_mana = opponent_mana;
        self.opponent.mana = opponent_mana;
    }

    fn mana_from_control(&self, side: Side) -> u8 {
        let friendly_control = self.controlled_hexes(side);
        let enemy_control = self.controlled_hexes(side.opponent());
        friendly_control
            .difference(&enemy_control)
            .count()
            .min(usize::from(MAX_MANA)) as u8
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

        if self.action_stack.is_empty() {
            if self.mode == MatchMode::Shared && side != self.active_side {
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
                let ActionTarget::Hex { coord } = target else {
                    return Err(MatchError::InvalidTarget);
                };
                let wizard_position = self.player_ref(side).wizard.position;
                if !self.board.is_valid(coord) {
                    return Err(MatchError::InvalidHex);
                }
                if !wizard_position.is_adjacent(coord) {
                    return Err(MatchError::InvalidTarget);
                }
                if self.is_occupied(coord) {
                    return Err(MatchError::OccupiedHex);
                }

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
                        coord,
                    },
                );
                self.record_replay_frame(
                    frames,
                    action_index,
                    ReplayEvent::CardPlayed {
                        side,
                        card: CardSummary::from(&card),
                        target: ActionTarget::Hex { coord },
                    },
                );
                self.record_replay_frame(
                    frames,
                    action_index,
                    ReplayEvent::ActionQueued { side, item },
                );
            }
            CardKind::Spell {
                range,
                priority,
                effect,
            } => {
                let ActionTarget::Piece { piece_id } = target else {
                    return Err(MatchError::InvalidTarget);
                };
                let target = self
                    .piece_view(&piece_id)
                    .ok_or(MatchError::PieceNotFound)?;
                let caster_position = self.player_ref(side).wizard.position;
                if caster_position.distance(target.position) > i32::from(*range) {
                    return Err(MatchError::InvalidTarget);
                }
                self.validate_spell_target(side, effect, &target)?;
                self.spend_card_resources(side, &card_id, &card)?;
                self.log.insert(
                    0,
                    format!("{} put {} on the stack.", side.label(), card.name),
                );
                let item = self.push_stack_item(
                    side,
                    *priority,
                    StackAction::CastSpell {
                        card: CardSummary::from(&card),
                        target_id: target.id.clone(),
                    },
                );
                self.record_replay_frame(
                    frames,
                    action_index,
                    ReplayEvent::CardPlayed {
                        side,
                        card: CardSummary::from(&card),
                        target: ActionTarget::Piece {
                            piece_id: target.id,
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

        if self.mode == MatchMode::Solo {
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

    fn validate_spell_target(
        &self,
        side: Side,
        effect: &SpellEffect,
        target: &PieceView,
    ) -> Result<(), MatchError> {
        match effect {
            SpellEffect::Heal { .. } | SpellEffect::Buff { .. } if target.side != side => {
                Err(MatchError::InvalidTarget)
            }
            SpellEffect::Damage { .. } if target.side == side => Err(MatchError::InvalidTarget),
            SpellEffect::Buff { .. } if self.is_wizard_id(&target.id) => {
                Err(MatchError::InvalidTarget)
            }
            _ => Ok(()),
        }
    }

    fn apply_spell(
        &mut self,
        side: Side,
        effect: &SpellEffect,
        target_id: &str,
        card_name: &str,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) {
        match effect {
            SpellEffect::Heal { amount } => {
                self.heal_piece(target_id, *amount);
                self.log.insert(
                    0,
                    format!("{} cast {} to heal {}.", side.label(), card_name, target_id),
                );
                self.record_replay_frame(
                    frames,
                    action_index,
                    ReplayEvent::PieceHealed {
                        side,
                        piece_id: target_id.to_string(),
                        amount: *amount,
                    },
                );
            }
            SpellEffect::Buff { attack, armor } => {
                if let Some(unit) = self
                    .board
                    .units
                    .iter_mut()
                    .find(|unit| unit.id == target_id)
                {
                    unit.attack += *attack;
                    unit.armor += *armor;
                    unit.max_armor += *armor;
                    self.log.insert(
                        0,
                        format!("{} cast {} on {}.", side.label(), card_name, unit.name),
                    );
                    self.record_replay_frame(
                        frames,
                        action_index,
                        ReplayEvent::PieceBuffed {
                            side,
                            piece_id: target_id.to_string(),
                            attack_delta: *attack,
                            armor_delta: *armor,
                        },
                    );
                }
            }
            SpellEffect::Damage { amount } => {
                self.damage_piece(target_id, *amount);
                self.record_replay_frame(
                    frames,
                    action_index,
                    ReplayEvent::PieceDamaged {
                        side,
                        piece_id: target_id.to_string(),
                        amount: *amount,
                    },
                );
                self.remove_dead_units(frames, action_index);
                self.log.insert(
                    0,
                    format!("{} cast {} at {}.", side.label(), card_name, target_id),
                );
            }
        }
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
        let CardKind::Unit {
            attack,
            armor,
            max_ap,
        } = &card.kind
        else {
            return;
        };

        if !self.board.is_valid(coord) || self.is_occupied(coord) {
            self.log
                .insert(0, format!("{} could not resolve.", card.name));
            return;
        }

        let unit = Unit {
            id: self.next_unit_id(side),
            side,
            name: card.name.clone(),
            template_id: Some(card.template_id.clone()),
            attack: *attack,
            armor: *armor,
            max_armor: *armor,
            position: coord,
            ap_remaining: *max_ap / 2,
            max_ap: *max_ap,
            has_attacked: false,
        };
        let unit_id = unit.id.clone();
        let unit_name = unit.name.clone();
        let unit_position = unit.position;
        self.board.units.push(unit);
        self.log
            .insert(0, format!("{} summoned {}.", side.label(), card.name));
        self.record_replay_frame(
            frames,
            action_index,
            ReplayEvent::UnitSummoned {
                side,
                unit_id,
                name: unit_name,
                position: unit_position,
            },
        );
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
        if self.validate_spell_target(side, effect, &target).is_err() {
            self.log
                .insert(0, format!("{} had no legal target.", card.name));
            return;
        }

        self.apply_spell(side, effect, target_id, &card.name, frames, action_index);
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
        if self.mode == MatchMode::Solo {
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
        if self.mode == MatchMode::Solo {
            self.resolve_all_stack(frames, action_index);
        }
        self.check_winner(frames, action_index);
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

    fn run_opponent_turn(
        &mut self,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) {
        self.log
            .insert(0, "Opponent begins their turn.".to_string());

        for _ in 0..24 {
            if self.phase == Phase::MatchOver {
                return;
            }
            if let Some((attacker_id, target_id)) = self.best_opponent_attack() {
                let _ = self.attack_for_side(
                    Side::Opponent,
                    &attacker_id,
                    &target_id,
                    frames,
                    action_index,
                );
                continue;
            }
            if self.try_opponent_spell(frames, action_index) {
                continue;
            }
            if self.try_opponent_summon(frames, action_index) {
                continue;
            }
            if self.try_opponent_move(frames, action_index) {
                continue;
            }
            break;
        }

        self.log.insert(0, "Opponent ended their turn.".to_string());
        self.record_replay_frame(
            frames,
            action_index,
            ReplayEvent::TurnEnded {
                side: Side::Opponent,
                round: self.round,
            },
        );
        self.truncate_log();
    }

    fn best_opponent_attack(&self) -> Option<(String, String)> {
        let mut attackers = self.pieces_for_side(Side::Opponent);
        attackers.sort_by_key(|piece| if self.is_wizard_id(&piece.id) { 1 } else { 0 });

        for attacker in attackers {
            if attacker.ap_remaining == 0 || attacker.has_attacked {
                continue;
            }
            if attacker.position.is_adjacent(self.player.wizard.position) {
                return Some((attacker.id, self.player.wizard.id.clone()));
            }
            if let Some(target) = self
                .board
                .units
                .iter()
                .filter(|unit| unit.side == Side::Player)
                .find(|unit| attacker.position.is_adjacent(unit.position))
            {
                return Some((attacker.id, target.id.clone()));
            }
        }

        None
    }

    fn try_opponent_spell(
        &mut self,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) -> bool {
        let Some((card, target)) = self.pick_opponent_spell() else {
            return false;
        };

        self.play_card_for_side(
            Side::Opponent,
            card.id,
            ActionTarget::Piece {
                piece_id: target.id,
            },
            frames,
            action_index,
        )
        .is_ok()
    }

    fn pick_opponent_spell(&self) -> Option<(Card, PieceView)> {
        let opponent = &self.opponent;
        if opponent.wizard.ap_remaining == 0 {
            return None;
        }

        for card in opponent
            .hand
            .iter()
            .filter(|card| card.cost <= opponent.mana)
        {
            let CardKind::Spell { range, effect, .. } = &card.kind else {
                continue;
            };

            let in_range = |piece: &PieceView| {
                opponent.wizard.position.distance(piece.position) <= i32::from(*range)
            };

            match effect {
                SpellEffect::Damage { .. } => {
                    let target = self
                        .pieces_for_side(Side::Player)
                        .into_iter()
                        .filter(in_range)
                        .find(|piece| self.is_wizard_id(&piece.id))
                        .or_else(|| {
                            self.pieces_for_side(Side::Player)
                                .into_iter()
                                .find(in_range)
                        });
                    if let Some(target) = target {
                        return Some((card.clone(), target));
                    }
                }
                SpellEffect::Heal { .. } => {
                    let target = self
                        .pieces_for_side(Side::Opponent)
                        .into_iter()
                        .filter(in_range)
                        .find(|piece| self.piece_is_damaged(&piece.id));
                    if let Some(target) = target {
                        return Some((card.clone(), target));
                    }
                }
                SpellEffect::Buff { .. } => {
                    let target = self
                        .board
                        .units
                        .iter()
                        .filter(|unit| unit.side == Side::Opponent)
                        .map(PieceView::from)
                        .filter(in_range)
                        .max_by_key(|piece| piece.attack);
                    if let Some(target) = target {
                        return Some((card.clone(), target));
                    }
                }
            }
        }

        None
    }

    fn try_opponent_summon(
        &mut self,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) -> bool {
        let opponent = &self.opponent;
        if opponent.wizard.ap_remaining == 0 {
            return false;
        }

        let Some(card) = opponent
            .hand
            .iter()
            .filter(|card| card.cost <= opponent.mana)
            .filter(|card| matches!(card.kind, CardKind::Unit { .. }))
            .max_by_key(|card| card.cost)
            .cloned()
        else {
            return false;
        };

        let Some(coord) = self.best_summon_hex(Side::Opponent) else {
            return false;
        };

        self.play_card_for_side(
            Side::Opponent,
            card.id,
            ActionTarget::Hex { coord },
            frames,
            action_index,
        )
        .is_ok()
    }

    fn try_opponent_move(
        &mut self,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) -> bool {
        let player_wizard = self.player.wizard.position;
        let Some((piece, destination)) = self
            .pieces_for_side(Side::Opponent)
            .into_iter()
            .filter(|piece| piece.ap_remaining > 0)
            .filter_map(|piece| {
                self.empty_neighbors(piece.position)
                    .into_iter()
                    .min_by_key(|coord| coord.distance(player_wizard))
                    .filter(|coord| {
                        coord.distance(player_wizard) < piece.position.distance(player_wizard)
                    })
                    .map(|coord| (piece, coord))
            })
            .next()
        else {
            return false;
        };

        self.move_piece_for_side(Side::Opponent, &piece.id, destination, frames, action_index)
            .is_ok()
    }

    fn best_summon_hex(&self, side: Side) -> Option<HexCoord> {
        let enemy_wizard = self.player_ref(side.opponent()).wizard.position;
        self.empty_neighbors(self.player_ref(side).wizard.position)
            .into_iter()
            .min_by_key(|coord| coord.distance(enemy_wizard))
    }

    fn start_turn(
        &mut self,
        side: Side,
        frames: &mut Vec<RecordedReplayFrame>,
        action_index: Option<u32>,
    ) {
        self.active_side = side;
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
            .map(|unit| (unit.side, unit.id.clone(), unit.name.clone()))
            .collect();
        self.board.units.retain(|unit| unit.armor > 0);
        for (side, unit_id, name) in destroyed {
            self.record_replay_frame(
                frames,
                action_index,
                ReplayEvent::UnitDestroyed {
                    side,
                    unit_id,
                    name,
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

    fn empty_neighbors(&self, coord: HexCoord) -> Vec<HexCoord> {
        coord
            .neighbors()
            .into_iter()
            .filter(|neighbor| self.board.is_valid(*neighbor))
            .filter(|neighbor| !self.is_occupied(*neighbor))
            .collect()
    }

    fn is_wizard_id(&self, piece_id: &str) -> bool {
        self.player.wizard.id == piece_id || self.opponent.wizard.id == piece_id
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
        }
    }

    fn is_valid(&self, coord: HexCoord) -> bool {
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

    fn is_adjacent(self, other: Self) -> bool {
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
}

impl PlayerState {
    fn new(side: Side, mut rng_seed: u64, wizard_type: WizardType, mut deck: Vec<Card>) -> Self {
        shuffle(&mut deck, &mut rng_seed);

        Self {
            side,
            mana: STARTING_MANA,
            max_mana: STARTING_MANA,
            wizard: Wizard::new(side, wizard_type),
            hand: Vec::new(),
            deck_count: deck.len(),
            discard_count: 0,
            deck,
            discard: Vec::new(),
            rng_seed,
            has_started_first_turn: false,
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
    fn new(side: Side, wizard_type: WizardType) -> Self {
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

        Self {
            id: id.to_string(),
            side,
            wizard_type,
            hp: profile.max_hp,
            max_hp: profile.max_hp,
            attack: profile.attack,
            position,
            ap_remaining: profile.max_ap,
            max_ap: profile.max_ap,
            has_attacked: false,
        }
    }
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
        assert_eq!(starter_card_templates().len(), 24);
        assert_eq!(game.player.hand.len(), 4);
        assert_eq!(game.player.deck_count, 56);
    }

    #[test]
    fn playing_a_unit_spends_mana_and_wizard_ap_and_summons_adjacent() {
        let mut game = MatchState::new_with_seed(7);
        let card = player_unit_card(&game, "ember-squire");
        let card_id = put_card_in_hand(&mut game, card);

        game.apply_action(MatchActionRequest::PlayCard {
            card_id,
            target: ActionTarget::Hex { coord: hex(0, 2) },
        })
        .expect("unit should be playable next to wizard");

        let unit = game.board.units.first().expect("unit should be on board");
        assert_eq!(game.player.mana, 3);
        assert_eq!(game.player.wizard.ap_remaining, 2);
        assert_eq!(unit.position, hex(0, 2));
        assert_eq!(unit.template_id.as_deref(), Some("ember-squire"));
        assert_eq!(unit.ap_remaining, 1);
        assert_eq!(unit.max_ap, 2);
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
        });

        let heal = starter_card_templates()
            .into_iter()
            .find(|card| card.template_id == "mending-rune")
            .expect("heal exists");
        let heal_id = put_card_in_hand(&mut game, heal);
        game.apply_action(MatchActionRequest::PlayCard {
            card_id: heal_id,
            target: ActionTarget::Piece {
                piece_id: "ally".to_string(),
            },
        })
        .expect("heal should work");
        assert_eq!(
            game.board
                .units
                .iter()
                .find(|unit| unit.id == "ally")
                .map(|unit| unit.armor),
            Some(4)
        );

        let buff = starter_card_templates()
            .into_iter()
            .find(|card| card.template_id == "war-chant")
            .expect("buff exists");
        let buff_id = put_card_in_hand(&mut game, buff);
        game.apply_action(MatchActionRequest::PlayCard {
            card_id: buff_id,
            target: ActionTarget::Piece {
                piece_id: "ally".to_string(),
            },
        })
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

        let bolt = starter_card_templates()
            .into_iter()
            .find(|card| card.template_id == "starfire-bolt")
            .expect("bolt exists");
        let bolt_id = put_card_in_hand(&mut game, bolt);
        game.player.mana = 5;
        game.player.wizard.ap_remaining = 1;
        game.apply_action(MatchActionRequest::PlayCard {
            card_id: bolt_id,
            target: ActionTarget::Piece {
                piece_id: "enemy".to_string(),
            },
        })
        .expect("bolt should work");
        assert!(!game.board.units.iter().any(|unit| unit.id == "enemy"));
    }

    #[test]
    fn ending_turn_runs_ai_and_advances_round() {
        let mut game = MatchState::new_with_seed(7);

        game.apply_action(MatchActionRequest::EndTurn)
            .expect("ending turn should work");

        assert_eq!(game.round, 2);
        assert_eq!(game.player.max_mana, game.mana_from_control(Side::Player));
        assert_eq!(game.player.hand.len(), 5);
    }

    #[test]
    fn round_start_mana_comes_from_uncontested_controlled_hexes() {
        let mut game = MatchState::new_with_seed(7);
        game.player.wizard.position = hex(0, 1);
        game.opponent.wizard.position = hex(0, -1);

        game.grant_round_mana_from_control();

        assert_eq!(game.player.max_mana, 6);
        assert_eq!(game.player.mana, 6);
        assert_eq!(game.opponent.max_mana, 6);
        assert_eq!(game.opponent.mana, 6);
        assert!(game.controlled_hexes(Side::Player).contains(&hex(0, 0)));
        assert!(game.controlled_hexes(Side::Opponent).contains(&hex(0, 0)));
    }

    #[test]
    fn shared_mana_is_not_refreshed_when_turn_passes_within_same_round() {
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
        assert_eq!(game.opponent.mana, 2);
        assert_eq!(game.opponent.max_mana, 4);
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
        });

        game.apply_action(MatchActionRequest::EndTurn)
            .expect("ending turn should advance to the next round");

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
