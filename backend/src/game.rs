use std::error::Error;
use std::fmt;

use serde::{Deserialize, Serialize};

const LANE_COUNT: usize = 3;
const LANE_LENGTH: usize = 5;
const STARTING_HEALTH: i32 = 20;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameState {
    pub turn: u32,
    pub phase: Phase,
    pub player: PlayerState,
    pub opponent: PlayerState,
    pub lanes: Vec<Lane>,
    pub log: Vec<String>,
    pub winner: Option<Side>,
    #[serde(skip)]
    next_unit_id: u32,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Planning,
    GameOver,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    Player,
    Opponent,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerState {
    pub side: Side,
    pub health: i32,
    pub energy: u8,
    pub max_energy: u8,
    pub hand: Vec<Card>,
    pub deck_count: usize,
    #[serde(skip)]
    deck: Vec<Card>,
    #[serde(skip)]
    discard: Vec<Card>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lane {
    pub index: usize,
    pub cells: Vec<Option<Unit>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Unit {
    pub id: String,
    pub side: Side,
    pub name: String,
    pub attack: i32,
    pub armor: i32,
    pub movement: u8,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub id: String,
    pub name: String,
    pub cost: u8,
    pub text: String,
    pub kind: CardKind,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CardKind {
    Unit {
        attack: i32,
        armor: i32,
        movement: u8,
    },
    Tactic {
        effect: TacticEffect,
    },
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TacticEffect {
    Rally,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayCardRequest {
    pub card_id: String,
    pub lane: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GameError {
    GameOver,
    CardNotFound,
    NotEnoughEnergy,
    InvalidLane,
    SpawnBlocked,
}

impl fmt::Display for GameError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::GameOver => "the game is over",
            Self::CardNotFound => "card is no longer in hand",
            Self::NotEnoughEnergy => "not enough energy",
            Self::InvalidLane => "that lane does not exist",
            Self::SpawnBlocked => "the deployment cell is occupied",
        };

        f.write_str(message)
    }
}

impl Error for GameError {}

impl GameState {
    pub fn new() -> Self {
        let mut game = Self {
            turn: 1,
            phase: Phase::Planning,
            player: PlayerState::new(Side::Player),
            opponent: PlayerState::new(Side::Opponent),
            lanes: (0..LANE_COUNT)
                .map(|index| Lane {
                    index,
                    cells: vec![None; LANE_LENGTH],
                })
                .collect(),
            log: vec!["The board is set.".to_string()],
            winner: None,
            next_unit_id: 1,
        };

        for _ in 0..4 {
            game.player.draw();
            game.opponent.draw();
        }

        game
    }

    pub fn play_card(&mut self, request: PlayCardRequest) -> Result<(), GameError> {
        if self.phase == Phase::GameOver {
            return Err(GameError::GameOver);
        }

        self.play_card_for_side(Side::Player, request.card_id, request.lane)
    }

    pub fn resolve_turn(&mut self) {
        if self.phase == Phase::GameOver {
            return;
        }

        self.opponent_play();
        self.resolve_board();
        self.check_winner();

        if self.phase == Phase::Planning {
            self.turn += 1;
            let max_energy = (2 + self.turn).min(6) as u8;
            self.player.refresh(max_energy);
            self.opponent.refresh(max_energy);
            self.log.insert(0, format!("Turn {} begins.", self.turn));
            self.truncate_log();
        }
    }

    fn play_card_for_side(
        &mut self,
        side: Side,
        card_id: String,
        lane_index: usize,
    ) -> Result<(), GameError> {
        if lane_index >= self.lanes.len() {
            return Err(GameError::InvalidLane);
        }

        let player = self.player_mut(side);
        let hand_index = player
            .hand
            .iter()
            .position(|card| card.id == card_id)
            .ok_or(GameError::CardNotFound)?;
        let card = player.hand[hand_index].clone();

        if card.cost > player.energy {
            return Err(GameError::NotEnoughEnergy);
        }

        if matches!(card.kind, CardKind::Unit { .. }) {
            let spawn_index = spawn_cell(side);
            if self.lanes[lane_index].cells[spawn_index].is_some() {
                return Err(GameError::SpawnBlocked);
            }
        }

        let player = self.player_mut(side);
        player.energy -= card.cost;
        let card = player.hand.remove(hand_index);
        player.discard.push(card.clone());

        match card.kind {
            CardKind::Unit {
                attack,
                armor,
                movement,
            } => {
                let unit = Unit {
                    id: self.next_unit_id(side),
                    side,
                    name: card.name.clone(),
                    attack,
                    armor,
                    movement,
                };
                let spawn_index = spawn_cell(side);
                self.lanes[lane_index].cells[spawn_index] = Some(unit);
                self.log.insert(
                    0,
                    format!(
                        "{} deployed {} to lane {}.",
                        side.label(),
                        card.name,
                        lane_index + 1
                    ),
                );
            }
            CardKind::Tactic {
                effect: TacticEffect::Rally,
            } => {
                let mut buffed = 0;
                for cell in &mut self.lanes[lane_index].cells {
                    if let Some(unit) = cell {
                        if unit.side == side {
                            unit.attack += 1;
                            unit.armor += 1;
                            buffed += 1;
                        }
                    }
                }

                self.log.insert(
                    0,
                    format!(
                        "{} rallied {} unit{} in lane {}.",
                        side.label(),
                        buffed,
                        if buffed == 1 { "" } else { "s" },
                        lane_index + 1
                    ),
                );
            }
        }

        self.truncate_log();
        Ok(())
    }

    fn opponent_play(&mut self) {
        let Some((card_id, lane)) = self.pick_opponent_action() else {
            self.log.insert(0, "Opponent held their cards.".to_string());
            return;
        };

        if self
            .play_card_for_side(Side::Opponent, card_id, lane)
            .is_err()
        {
            self.log
                .insert(0, "Opponent hesitated and passed.".to_string());
        }
    }

    fn pick_opponent_action(&self) -> Option<(String, usize)> {
        let opponent = &self.opponent;

        for card in opponent
            .hand
            .iter()
            .filter(|card| card.cost <= opponent.energy)
        {
            match card.kind {
                CardKind::Unit { .. } => {
                    if let Some(lane) = self.best_open_opponent_lane() {
                        return Some((card.id.clone(), lane));
                    }
                }
                CardKind::Tactic { .. } => {
                    if let Some(lane) = self.lane_with_opponent_units() {
                        return Some((card.id.clone(), lane));
                    }
                }
            }
        }

        None
    }

    fn best_open_opponent_lane(&self) -> Option<usize> {
        self.lanes
            .iter()
            .filter(|lane| lane.cells[spawn_cell(Side::Opponent)].is_none())
            .max_by_key(|lane| {
                lane.cells
                    .iter()
                    .flatten()
                    .filter(|unit| unit.side == Side::Player)
                    .count()
            })
            .map(|lane| lane.index)
    }

    fn lane_with_opponent_units(&self) -> Option<usize> {
        self.lanes
            .iter()
            .find(|lane| {
                lane.cells
                    .iter()
                    .flatten()
                    .any(|unit| unit.side == Side::Opponent)
            })
            .map(|lane| lane.index)
    }

    fn resolve_board(&mut self) {
        let mut player_damage = 0;
        let mut opponent_damage = 0;
        let mut events = Vec::new();

        for lane in &mut self.lanes {
            advance_side(lane, Side::Player, &mut opponent_damage, &mut events);
            advance_side(lane, Side::Opponent, &mut player_damage, &mut events);
        }

        self.player.health -= player_damage;
        self.opponent.health -= opponent_damage;

        if opponent_damage > 0 {
            events.push(format!("You dealt {opponent_damage} breakthrough damage."));
        }
        if player_damage > 0 {
            events.push(format!(
                "Opponent dealt {player_damage} breakthrough damage."
            ));
        }
        if events.is_empty() {
            events.push("The lines shifted without a breakthrough.".to_string());
        }

        for event in events.into_iter().rev() {
            self.log.insert(0, event);
        }
        self.truncate_log();
    }

    fn check_winner(&mut self) {
        let winner = match (self.player.health <= 0, self.opponent.health <= 0) {
            (true, true) => Some(Side::Player),
            (false, true) => Some(Side::Player),
            (true, false) => Some(Side::Opponent),
            (false, false) => None,
        };

        if let Some(winner) = winner {
            self.phase = Phase::GameOver;
            self.winner = Some(winner);
            self.log.insert(0, format!("{} wins.", winner.label()));
            self.truncate_log();
        }
    }

    fn player_mut(&mut self, side: Side) -> &mut PlayerState {
        match side {
            Side::Player => &mut self.player,
            Side::Opponent => &mut self.opponent,
        }
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
        self.log.truncate(10);
    }
}

impl PlayerState {
    fn new(side: Side) -> Self {
        let deck = starter_deck(side);

        Self {
            side,
            health: STARTING_HEALTH,
            energy: 3,
            max_energy: 3,
            hand: Vec::new(),
            deck_count: deck.len(),
            deck,
            discard: Vec::new(),
        }
    }

    fn draw(&mut self) {
        if self.deck.is_empty() {
            self.deck.append(&mut self.discard);
        }

        if let Some(card) = self.deck.pop() {
            self.hand.push(card);
            self.deck_count = self.deck.len();
        }
    }

    fn refresh(&mut self, max_energy: u8) {
        self.max_energy = max_energy;
        self.energy = max_energy;
        self.draw();
    }
}

impl Side {
    fn label(self) -> &'static str {
        match self {
            Self::Player => "You",
            Self::Opponent => "Opponent",
        }
    }
}

fn advance_side(
    lane: &mut Lane,
    side: Side,
    breakthrough_damage: &mut i32,
    events: &mut Vec<String>,
) {
    let positions: Box<dyn Iterator<Item = usize>> = match side {
        Side::Player => Box::new((0..LANE_LENGTH).rev()),
        Side::Opponent => Box::new(0..LANE_LENGTH),
    };

    for position in positions {
        let Some(unit) = lane.cells[position].take() else {
            continue;
        };

        if unit.side != side {
            lane.cells[position] = Some(unit);
            continue;
        }

        move_unit(lane, position, unit, breakthrough_damage, events);
    }
}

fn move_unit(
    lane: &mut Lane,
    starting_position: usize,
    mut unit: Unit,
    breakthrough_damage: &mut i32,
    events: &mut Vec<String>,
) {
    let mut position = starting_position;

    for _ in 0..unit.movement {
        let Some(next_position) = next_cell(unit.side, position) else {
            *breakthrough_damage += unit.attack;
            events.push(format!(
                "{} broke through lane {} for {}.",
                unit.name,
                lane.index + 1,
                unit.attack
            ));
            return;
        };

        match lane.cells[next_position].take() {
            None => position = next_position,
            Some(mut blocker) if blocker.side != unit.side => {
                blocker.armor -= unit.attack;
                unit.armor -= blocker.attack;

                let unit_survived = unit.armor > 0;
                let blocker_survived = blocker.armor > 0;

                match (unit_survived, blocker_survived) {
                    (true, true) => {
                        events.push(format!(
                            "{} and {} clashed in lane {}.",
                            unit.name,
                            blocker.name,
                            lane.index + 1
                        ));
                        lane.cells[next_position] = Some(blocker);
                        lane.cells[position] = Some(unit);
                    }
                    (true, false) => {
                        events.push(format!(
                            "{} destroyed {} in lane {}.",
                            unit.name,
                            blocker.name,
                            lane.index + 1
                        ));
                        lane.cells[position] = Some(unit);
                    }
                    (false, true) => {
                        events.push(format!(
                            "{} stopped {} in lane {}.",
                            blocker.name,
                            unit.name,
                            lane.index + 1
                        ));
                        lane.cells[next_position] = Some(blocker);
                    }
                    (false, false) => {
                        events.push(format!(
                            "{} and {} fell in lane {}.",
                            unit.name,
                            blocker.name,
                            lane.index + 1
                        ));
                    }
                }
                return;
            }
            Some(friend) => {
                lane.cells[next_position] = Some(friend);
                lane.cells[position] = Some(unit);
                return;
            }
        }
    }

    lane.cells[position] = Some(unit);
}

fn next_cell(side: Side, position: usize) -> Option<usize> {
    match side {
        Side::Player => {
            let next = position + 1;
            (next < LANE_LENGTH).then_some(next)
        }
        Side::Opponent => position.checked_sub(1),
    }
}

fn spawn_cell(side: Side) -> usize {
    match side {
        Side::Player => 0,
        Side::Opponent => LANE_LENGTH - 1,
    }
}

fn starter_deck(side: Side) -> Vec<Card> {
    let prefix = match side {
        Side::Player => "p",
        Side::Opponent => "o",
    };
    let templates = [
        card_template(
            "Vanguard",
            1,
            "1 attack / 3 armor. A reliable lane holder.",
            CardKind::Unit {
                attack: 1,
                armor: 3,
                movement: 1,
            },
        ),
        card_template(
            "Runner",
            1,
            "1 attack / 1 armor. Moves two cells.",
            CardKind::Unit {
                attack: 1,
                armor: 1,
                movement: 2,
            },
        ),
        card_template(
            "Ballista",
            2,
            "3 attack / 1 armor. Breaks blockers quickly.",
            CardKind::Unit {
                attack: 3,
                armor: 1,
                movement: 1,
            },
        ),
        card_template(
            "Warden",
            2,
            "1 attack / 5 armor. Holds the board.",
            CardKind::Unit {
                attack: 1,
                armor: 5,
                movement: 1,
            },
        ),
        card_template(
            "Rally Standard",
            2,
            "Friendly units in the lane gain +1 attack and +1 armor.",
            CardKind::Tactic {
                effect: TacticEffect::Rally,
            },
        ),
    ];

    (0..3)
        .flat_map(|copy| {
            templates.clone().into_iter().map(move |mut card| {
                card.id = format!("{prefix}-{copy}-{}", card.id);
                card
            })
        })
        .rev()
        .collect()
}

fn card_template(name: &str, cost: u8, text: &str, kind: CardKind) -> Card {
    Card {
        id: name.to_lowercase().replace(' ', "-"),
        name: name.to_string(),
        cost,
        text: text.to_string(),
        kind,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn playing_a_unit_spends_energy_and_places_it_on_the_board() {
        let mut game = GameState::new();
        let card = game
            .player
            .hand
            .iter()
            .find(|card| matches!(card.kind, CardKind::Unit { .. }))
            .expect("starting hand should contain a unit")
            .clone();

        game.play_card(PlayCardRequest {
            card_id: card.id,
            lane: 1,
        })
        .expect("card should be playable");

        assert_eq!(game.player.energy, 3 - card.cost);
        assert_eq!(
            game.lanes[1].cells[0].as_ref().map(|unit| unit.side),
            Some(Side::Player)
        );
    }

    #[test]
    fn units_score_when_they_cross_the_far_edge() {
        let mut game = GameState::new();
        game.lanes[0].cells[4] = Some(Unit {
            id: "test".to_string(),
            side: Side::Player,
            name: "Runner".to_string(),
            attack: 2,
            armor: 1,
            movement: 1,
        });

        game.resolve_board();

        assert_eq!(game.opponent.health, STARTING_HEALTH - 2);
        assert!(game.lanes[0].cells[4].is_none());
    }

    #[test]
    fn opposing_units_fight_instead_of_overlapping() {
        let mut game = GameState::new();
        game.lanes[0].cells[1] = Some(Unit {
            id: "player".to_string(),
            side: Side::Player,
            name: "Vanguard".to_string(),
            attack: 1,
            armor: 3,
            movement: 1,
        });
        game.lanes[0].cells[2] = Some(Unit {
            id: "opponent".to_string(),
            side: Side::Opponent,
            name: "Ballista".to_string(),
            attack: 3,
            armor: 1,
            movement: 1,
        });

        game.resolve_board();

        let occupied_cells = game.lanes[0]
            .cells
            .iter()
            .filter(|cell| cell.is_some())
            .count();
        assert_eq!(occupied_cells, 0);
    }
}
