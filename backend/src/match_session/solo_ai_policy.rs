use std::collections::HashSet;

use super::{
    ActionTarget, Card, CardKind, HexCoord, PieceView, Side, SpellEffect, card_interactions,
};

#[derive(Clone, Debug)]
pub(super) struct SoloAiPolicy {
    rules: Vec<SoloAiRuleId>,
}

impl Default for SoloAiPolicy {
    fn default() -> Self {
        Self {
            rules: vec![
                SoloAiRuleId::AdjacentAttack,
                SoloAiRuleId::UsefulSpell,
                SoloAiRuleId::HighestCostUnitSummon,
                SoloAiRuleId::MoveTowardPlayerWizard,
            ],
        }
    }
}

impl SoloAiPolicy {
    pub(super) fn decide(&self, view: &SoloAiView) -> SoloAiDecision {
        for rule in &self.rules {
            if let Some(intent) = self.evaluate_rule(*rule, view) {
                return SoloAiDecision::TakeAction(intent);
            }
        }

        SoloAiDecision::FinishTurn
    }

    #[cfg(test)]
    fn rule_order(&self) -> &[SoloAiRuleId] {
        &self.rules
    }

    fn evaluate_rule(&self, rule: SoloAiRuleId, view: &SoloAiView) -> Option<SoloAiActionIntent> {
        match rule {
            SoloAiRuleId::AdjacentAttack => self.adjacent_attack(view),
            SoloAiRuleId::UsefulSpell => self.useful_spell(view),
            SoloAiRuleId::HighestCostUnitSummon => self.highest_cost_unit_summon(view),
            SoloAiRuleId::MoveTowardPlayerWizard => self.move_toward_player_wizard(view),
        }
    }

    fn adjacent_attack(&self, view: &SoloAiView) -> Option<SoloAiActionIntent> {
        let mut attackers = view.opponent_pieces.clone();
        attackers.sort_by_key(|piece| {
            if piece.id == view.opponent_wizard.id {
                1
            } else {
                0
            }
        });

        for attacker in attackers {
            if attacker.ap_remaining == 0 || attacker.has_attacked {
                continue;
            }
            if attacker.position.is_adjacent(view.player_wizard.position) {
                return Some(SoloAiActionIntent::Attack {
                    attacker_id: attacker.id,
                    target_id: view.player_wizard.id.clone(),
                });
            }
            if let Some(target) = view
                .player_units
                .iter()
                .find(|unit| attacker.position.is_adjacent(unit.position))
            {
                return Some(SoloAiActionIntent::Attack {
                    attacker_id: attacker.id,
                    target_id: target.id.clone(),
                });
            }
        }

        None
    }

    fn useful_spell(&self, view: &SoloAiView) -> Option<SoloAiActionIntent> {
        if view.opponent_wizard.ap_remaining == 0 {
            return None;
        }

        for card in view
            .opponent_hand
            .iter()
            .filter(|card| card.cost <= view.opponent_mana)
        {
            let CardKind::Spell { range, effect, .. } = &card.kind else {
                continue;
            };

            let in_range = |piece: &PieceView| {
                view.opponent_wizard.position.distance(piece.position) <= i32::from(*range)
            };
            let caster_position = view.opponent_wizard.position;
            let caster_wizard_id = view.opponent_wizard.id.as_str();
            let is_legal_spell_target = |piece: &PieceView| {
                in_range(piece)
                    && card_interactions::validate_spell_target(
                        Side::Opponent,
                        effect,
                        caster_position,
                        caster_wizard_id,
                        piece,
                    )
                    .is_ok()
            };

            let target = match effect {
                SpellEffect::Damage { .. } => view
                    .player_pieces
                    .iter()
                    .filter(|piece| is_legal_spell_target(piece))
                    .find(|piece| piece.id == view.player_wizard.id)
                    .or_else(|| {
                        view.player_pieces
                            .iter()
                            .find(|piece| is_legal_spell_target(piece))
                    }),
                SpellEffect::AreaDamage { .. } | SpellEffect::LineDamage { .. } => view
                    .player_pieces
                    .iter()
                    .find(|piece| is_legal_spell_target(piece)),
                SpellEffect::Heal { .. } => view
                    .opponent_pieces
                    .iter()
                    .filter(|piece| is_legal_spell_target(piece))
                    .find(|piece| view.damaged_piece_ids.contains(&piece.id)),
                SpellEffect::Buff { .. } => view
                    .opponent_units
                    .iter()
                    .filter(|piece| is_legal_spell_target(piece))
                    .max_by_key(|piece| piece.attack),
                SpellEffect::Draw { .. } => {
                    let target = &view.opponent_wizard;
                    if view.opponent_deck_count + view.opponent_discard_count > 0
                        && is_legal_spell_target(target)
                    {
                        Some(target)
                    } else {
                        None
                    }
                }
            };

            if let Some(target) = target {
                return Some(SoloAiActionIntent::PlayCard {
                    card_id: card.id.clone(),
                    target: ActionTarget::Piece {
                        piece_id: target.id.clone(),
                    },
                });
            }
        }

        None
    }

    fn highest_cost_unit_summon(&self, view: &SoloAiView) -> Option<SoloAiActionIntent> {
        if view.opponent_wizard.ap_remaining == 0 {
            return None;
        }

        let card = view
            .opponent_hand
            .iter()
            .filter(|card| card.cost <= view.opponent_mana)
            .filter(|card| matches!(card.kind, CardKind::Unit { .. }))
            .max_by_key(|card| card.cost)?;

        let coord = self.best_summon_hex(view)?;

        Some(SoloAiActionIntent::PlayCard {
            card_id: card.id.clone(),
            target: ActionTarget::Hex { coord },
        })
    }

    fn move_toward_player_wizard(&self, view: &SoloAiView) -> Option<SoloAiActionIntent> {
        let player_wizard = view.player_wizard.position;
        let (piece, destination) = view
            .opponent_pieces
            .iter()
            .filter(|piece| piece.ap_remaining > 0)
            .filter_map(|piece| {
                self.empty_neighbors(view, piece.position)
                    .into_iter()
                    .min_by_key(|coord| coord.distance(player_wizard))
                    .filter(|coord| {
                        coord.distance(player_wizard) < piece.position.distance(player_wizard)
                    })
                    .map(|coord| (piece, coord))
            })
            .next()?;

        Some(SoloAiActionIntent::MovePiece {
            piece_id: piece.id.clone(),
            to: destination,
        })
    }

    fn best_summon_hex(&self, view: &SoloAiView) -> Option<HexCoord> {
        self.empty_neighbors(view, view.opponent_wizard.position)
            .into_iter()
            .min_by_key(|coord| coord.distance(view.player_wizard.position))
    }

    fn empty_neighbors(&self, view: &SoloAiView, coord: HexCoord) -> Vec<HexCoord> {
        coord
            .neighbors()
            .into_iter()
            .filter(|neighbor| view.valid_hexes.contains(neighbor))
            .filter(|neighbor| !view.occupied_hexes.contains(neighbor))
            .collect()
    }
}

#[derive(Clone, Debug)]
pub(super) struct SoloAiView {
    pub(super) opponent_wizard: PieceView,
    pub(super) player_wizard: PieceView,
    pub(super) opponent_pieces: Vec<PieceView>,
    pub(super) player_pieces: Vec<PieceView>,
    pub(super) opponent_units: Vec<PieceView>,
    pub(super) player_units: Vec<PieceView>,
    pub(super) opponent_hand: Vec<Card>,
    pub(super) opponent_mana: u8,
    pub(super) opponent_deck_count: usize,
    pub(super) opponent_discard_count: usize,
    pub(super) valid_hexes: HashSet<HexCoord>,
    pub(super) occupied_hexes: HashSet<HexCoord>,
    pub(super) damaged_piece_ids: HashSet<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum SoloAiDecision {
    TakeAction(SoloAiActionIntent),
    FinishTurn,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum SoloAiActionIntent {
    Attack {
        attacker_id: String,
        target_id: String,
    },
    PlayCard {
        card_id: String,
        target: ActionTarget,
    },
    MovePiece {
        piece_id: String,
        to: HexCoord,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum SoloAiRuleId {
    AdjacentAttack,
    UsefulSpell,
    HighestCostUnitSummon,
    MoveTowardPlayerWizard,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::match_session::Rarity;

    fn policy_decision(view: SoloAiView) -> SoloAiDecision {
        SoloAiPolicy::default().decide(&view)
    }

    fn base_view() -> SoloAiView {
        let opponent_wizard = piece("opponent-wizard", Side::Opponent, hex(0, -3));
        let player_wizard = piece("player-wizard", Side::Player, hex(0, 3));
        let opponent_pieces = vec![opponent_wizard.clone()];
        let player_pieces = vec![player_wizard.clone()];
        let valid_hexes = (-3..=3)
            .flat_map(|q| (-3..=3).map(move |r| hex(q, r)))
            .filter(|coord| coord.distance(hex(0, 0)) <= 3)
            .collect();
        let occupied_hexes = vec![opponent_wizard.position, player_wizard.position]
            .into_iter()
            .collect();

        SoloAiView {
            opponent_wizard,
            player_wizard,
            opponent_pieces,
            player_pieces,
            opponent_units: Vec::new(),
            player_units: Vec::new(),
            opponent_hand: Vec::new(),
            opponent_mana: 0,
            opponent_deck_count: 0,
            opponent_discard_count: 0,
            valid_hexes,
            occupied_hexes,
            damaged_piece_ids: HashSet::new(),
        }
    }

    fn piece(id: &str, side: Side, position: HexCoord) -> PieceView {
        PieceView {
            id: id.to_string(),
            side,
            position,
            attack: 1,
            ap_remaining: 1,
            has_attacked: false,
        }
    }

    fn hex(q: i32, r: i32) -> HexCoord {
        HexCoord { q, r }
    }

    fn unit_card(id: &str, cost: u8) -> Card {
        card(
            id,
            cost,
            CardKind::Unit {
                attack: 1,
                armor: 1,
                max_ap: 1,
            },
        )
    }

    fn spell_card(id: &str, cost: u8, effect: SpellEffect) -> Card {
        card(
            id,
            cost,
            CardKind::Spell {
                range: 6,
                priority: 1,
                effect,
            },
        )
    }

    fn card(id: &str, cost: u8, kind: CardKind) -> Card {
        Card {
            id: id.to_string(),
            template_id: id.to_string(),
            name: id.to_string(),
            rarity: Rarity::Basic,
            cost,
            text: String::new(),
            kind,
        }
    }

    #[test]
    fn rule_order_is_stable() {
        assert_eq!(
            SoloAiPolicy::default().rule_order(),
            &[
                SoloAiRuleId::AdjacentAttack,
                SoloAiRuleId::UsefulSpell,
                SoloAiRuleId::HighestCostUnitSummon,
                SoloAiRuleId::MoveTowardPlayerWizard,
            ]
        );
    }

    #[test]
    fn adjacent_attack_beats_spell_summon_and_move() {
        let mut view = base_view();
        let opponent_unit = piece("opponent-unit", Side::Opponent, hex(0, 2));
        view.opponent_pieces.push(opponent_unit.clone());
        view.opponent_units.push(opponent_unit.clone());
        view.occupied_hexes.insert(opponent_unit.position);
        view.opponent_hand = vec![
            spell_card("damage", 1, SpellEffect::Damage { amount: 1 }),
            unit_card("unit", 1),
        ];
        view.opponent_mana = 2;

        assert_eq!(
            policy_decision(view),
            SoloAiDecision::TakeAction(SoloAiActionIntent::Attack {
                attacker_id: "opponent-unit".to_string(),
                target_id: "player-wizard".to_string(),
            })
        );
    }

    #[test]
    fn spent_or_already_attacked_pieces_are_ignored() {
        let mut view = base_view();
        let mut spent = piece("spent-unit", Side::Opponent, hex(0, 2));
        spent.ap_remaining = 0;
        let mut attacked = piece("attacked-unit", Side::Opponent, hex(1, 2));
        attacked.has_attacked = true;
        view.opponent_pieces
            .extend([spent.clone(), attacked.clone()]);
        view.opponent_units
            .extend([spent.clone(), attacked.clone()]);
        view.occupied_hexes
            .extend([spent.position, attacked.position]);

        assert_eq!(
            policy_decision(view),
            SoloAiDecision::TakeAction(SoloAiActionIntent::MovePiece {
                piece_id: "opponent-wizard".to_string(),
                to: hex(0, -2),
            })
        );
    }

    #[test]
    fn damage_spell_targets_player_wizard_when_legal() {
        let mut view = base_view();
        let player_unit = piece("player-unit", Side::Player, hex(0, 2));
        view.player_pieces.push(player_unit.clone());
        view.player_units.push(player_unit.clone());
        view.occupied_hexes.insert(player_unit.position);
        view.opponent_hand = vec![spell_card("damage", 1, SpellEffect::Damage { amount: 1 })];
        view.opponent_mana = 1;

        assert_eq!(
            policy_decision(view),
            SoloAiDecision::TakeAction(SoloAiActionIntent::PlayCard {
                card_id: "damage".to_string(),
                target: ActionTarget::Piece {
                    piece_id: "player-wizard".to_string(),
                },
            })
        );
    }

    #[test]
    fn heal_spell_only_fires_for_damaged_allied_pieces() {
        let mut view = base_view();
        view.opponent_hand = vec![spell_card("heal", 1, SpellEffect::Heal { amount: 1 })];
        view.opponent_mana = 1;

        assert_eq!(
            policy_decision(view.clone()),
            SoloAiDecision::TakeAction(SoloAiActionIntent::MovePiece {
                piece_id: "opponent-wizard".to_string(),
                to: hex(0, -2),
            })
        );

        view.damaged_piece_ids.insert("opponent-wizard".to_string());

        assert_eq!(
            policy_decision(view),
            SoloAiDecision::TakeAction(SoloAiActionIntent::PlayCard {
                card_id: "heal".to_string(),
                target: ActionTarget::Piece {
                    piece_id: "opponent-wizard".to_string(),
                },
            })
        );
    }

    #[test]
    fn buff_spell_picks_highest_attack_allied_unit() {
        let mut view = base_view();
        let mut low_attack = piece("low", Side::Opponent, hex(0, -2));
        low_attack.attack = 1;
        let mut high_attack = piece("high", Side::Opponent, hex(1, -2));
        high_attack.attack = 4;
        view.opponent_pieces
            .extend([low_attack.clone(), high_attack.clone()]);
        view.opponent_units
            .extend([low_attack.clone(), high_attack.clone()]);
        view.occupied_hexes
            .extend([low_attack.position, high_attack.position]);
        view.opponent_hand = vec![spell_card(
            "buff",
            1,
            SpellEffect::Buff {
                attack: 1,
                armor: 1,
            },
        )];
        view.opponent_mana = 1;

        assert_eq!(
            policy_decision(view),
            SoloAiDecision::TakeAction(SoloAiActionIntent::PlayCard {
                card_id: "buff".to_string(),
                target: ActionTarget::Piece {
                    piece_id: "high".to_string(),
                },
            })
        );
    }

    #[test]
    fn summon_picks_highest_cost_affordable_unit_and_closest_valid_hex() {
        let mut view = base_view();
        view.opponent_hand = vec![unit_card("cheap", 1), unit_card("expensive", 3)];
        view.opponent_mana = 3;

        assert_eq!(
            policy_decision(view),
            SoloAiDecision::TakeAction(SoloAiActionIntent::PlayCard {
                card_id: "expensive".to_string(),
                target: ActionTarget::Hex { coord: hex(0, -2) },
            })
        );
    }

    #[test]
    fn move_picks_a_closer_empty_neighboring_hex() {
        let view = base_view();

        assert_eq!(
            policy_decision(view),
            SoloAiDecision::TakeAction(SoloAiActionIntent::MovePiece {
                piece_id: "opponent-wizard".to_string(),
                to: hex(0, -2),
            })
        );
    }

    #[test]
    fn no_legal_rule_returns_finish_turn() {
        let mut view = base_view();
        view.opponent_wizard.ap_remaining = 0;
        view.opponent_pieces[0].ap_remaining = 0;

        assert_eq!(policy_decision(view), SoloAiDecision::FinishTurn);
    }
}
