use super::{
    ActionTarget, Card, CardKind, CardSummary, HexBoard, HexCoord, MatchError,
    MatchProgressionLoadout, PieceView, Side, SpellEffect, Unit,
};

pub(crate) struct PlannedUnitPlay {
    pub(crate) coord: HexCoord,
}

pub(crate) struct PlannedSpellPlay {
    pub(crate) priority: u8,
    pub(crate) target_id: String,
}

pub(crate) enum ResolvedSpellEffect {
    Heal {
        piece_id: String,
        amount: i32,
    },
    Buff {
        piece_id: String,
        attack: i32,
        armor: i32,
    },
    Damage {
        piece_ids: Vec<String>,
        amount: i32,
    },
    Draw {
        amount: u8,
    },
}

pub(crate) enum SpellLog {
    Heal { piece_id: String },
    Buff { piece_id: String },
    Damage { piece_id: String },
    Draw { amount: u8 },
    AreaDamage { piece_id: String },
    LineDamage,
}

pub(crate) struct ResolvedSpell {
    pub(crate) effect: ResolvedSpellEffect,
    pub(crate) log: SpellLog,
}

pub(crate) fn plan_unit_play(
    card: &Card,
    target: ActionTarget,
    caster_position: HexCoord,
    board: &HexBoard,
    is_occupied: impl Fn(HexCoord) -> bool,
) -> Result<PlannedUnitPlay, MatchError> {
    if !matches!(card.kind, CardKind::Unit { .. }) {
        return Err(MatchError::InvalidTarget);
    }

    let ActionTarget::Hex { coord } = target else {
        return Err(MatchError::InvalidTarget);
    };

    validate_unit_target(coord, caster_position, board, is_occupied)?;

    Ok(PlannedUnitPlay { coord })
}

pub(crate) fn plan_spell_play(
    card: &Card,
    target: ActionTarget,
    side: Side,
    caster_position: HexCoord,
    caster_wizard_id: &str,
    target_piece: &PieceView,
) -> Result<PlannedSpellPlay, MatchError> {
    let CardKind::Spell {
        range,
        priority,
        effect,
    } = &card.kind
    else {
        return Err(MatchError::InvalidTarget);
    };

    let ActionTarget::Piece { piece_id } = target else {
        return Err(MatchError::InvalidTarget);
    };

    if piece_id != target_piece.id {
        return Err(MatchError::PieceNotFound);
    }

    if caster_position.distance(target_piece.position) > i32::from(*range) {
        return Err(MatchError::InvalidTarget);
    }

    validate_spell_target(
        side,
        effect,
        caster_position,
        caster_wizard_id,
        target_piece,
    )?;

    Ok(PlannedSpellPlay {
        priority: *priority,
        target_id: target_piece.id.clone(),
    })
}

pub(crate) fn validate_spell_target(
    side: Side,
    effect: &SpellEffect,
    caster_position: HexCoord,
    caster_wizard_id: &str,
    target: &PieceView,
) -> Result<(), MatchError> {
    match effect {
        SpellEffect::Heal { .. } | SpellEffect::Buff { .. } if target.side != side => {
            Err(MatchError::InvalidTarget)
        }
        SpellEffect::Damage { .. }
        | SpellEffect::AreaDamage { .. }
        | SpellEffect::LineDamage { .. }
            if target.side == side =>
        {
            Err(MatchError::InvalidTarget)
        }
        SpellEffect::Draw { .. } if target.side != side || target.id != caster_wizard_id => {
            Err(MatchError::InvalidTarget)
        }
        SpellEffect::LineDamage { .. }
            if caster_position.direction_to(target.position).is_none() =>
        {
            Err(MatchError::InvalidTarget)
        }
        SpellEffect::Buff { .. } if target.id == caster_wizard_id => Err(MatchError::InvalidTarget),
        _ => Ok(()),
    }
}

pub(crate) fn resolve_spell(
    card: &CardSummary,
    side: Side,
    caster_position: HexCoord,
    caster_wizard_id: &str,
    target: &PieceView,
    enemy_pieces: &[PieceView],
    progression: &MatchProgressionLoadout,
) -> Result<ResolvedSpell, MatchError> {
    let CardKind::Spell { range, effect, .. } = &card.kind else {
        return Err(MatchError::InvalidTarget);
    };

    validate_spell_target(side, effect, caster_position, caster_wizard_id, target)?;

    let resolved = match effect {
        SpellEffect::Heal { amount } => ResolvedSpell {
            effect: ResolvedSpellEffect::Heal {
                piece_id: target.id.clone(),
                amount: *amount,
            },
            log: SpellLog::Heal {
                piece_id: target.id.clone(),
            },
        },
        SpellEffect::Buff { attack, armor } => ResolvedSpell {
            effect: ResolvedSpellEffect::Buff {
                piece_id: target.id.clone(),
                attack: *attack,
                armor: *armor,
            },
            log: SpellLog::Buff {
                piece_id: target.id.clone(),
            },
        },
        SpellEffect::Damage { amount } => ResolvedSpell {
            effect: ResolvedSpellEffect::Damage {
                piece_ids: vec![target.id.clone()],
                amount: damage_with_progression(*amount, progression),
            },
            log: SpellLog::Damage {
                piece_id: target.id.clone(),
            },
        },
        SpellEffect::Draw { amount } => ResolvedSpell {
            effect: ResolvedSpellEffect::Draw { amount: *amount },
            log: SpellLog::Draw { amount: *amount },
        },
        SpellEffect::AreaDamage { amount, radius } => ResolvedSpell {
            effect: ResolvedSpellEffect::Damage {
                piece_ids: enemy_piece_ids_in_area(
                    enemy_pieces,
                    target.position,
                    i32::from(*radius),
                ),
                amount: damage_with_progression(*amount, progression),
            },
            log: SpellLog::AreaDamage {
                piece_id: target.id.clone(),
            },
        },
        SpellEffect::LineDamage { amount } => {
            let Some(direction) = caster_position.direction_to(target.position) else {
                return Err(MatchError::InvalidTarget);
            };

            ResolvedSpell {
                effect: ResolvedSpellEffect::Damage {
                    piece_ids: enemy_piece_ids_on_line(
                        enemy_pieces,
                        caster_position,
                        direction,
                        i32::from(*range),
                    ),
                    amount: damage_with_progression(*amount, progression),
                },
                log: SpellLog::LineDamage,
            }
        }
    };

    Ok(resolved)
}

pub(crate) fn can_resolve_unit_play(
    coord: HexCoord,
    caster_position: HexCoord,
    board: &HexBoard,
    is_occupied: impl Fn(HexCoord) -> bool,
) -> bool {
    validate_unit_target(coord, caster_position, board, is_occupied).is_ok()
}

pub(crate) fn summon_unit_from_card(
    card: &CardSummary,
    side: Side,
    next_unit_id: impl FnOnce() -> String,
    coord: HexCoord,
    progression: &MatchProgressionLoadout,
    is_first_summoned_unit: bool,
) -> Option<Unit> {
    let CardKind::Unit {
        attack,
        armor,
        max_ap,
    } = &card.kind
    else {
        return None;
    };

    let mut armor = *armor + progression.effects.summoned_unit_armor_delta;
    if is_first_summoned_unit {
        armor += progression.effects.first_summoned_unit_armor_delta;
    }

    Some(Unit {
        id: next_unit_id(),
        side,
        name: card.name.clone(),
        template_id: Some(card.template_id.clone()),
        attack: *attack,
        armor,
        max_armor: armor,
        position: coord,
        ap_remaining: *max_ap / 2,
        max_ap: *max_ap,
        has_attacked: false,
        items: Vec::new(),
    })
}

fn validate_unit_target(
    coord: HexCoord,
    caster_position: HexCoord,
    board: &HexBoard,
    is_occupied: impl Fn(HexCoord) -> bool,
) -> Result<(), MatchError> {
    if !board.is_valid(coord) {
        return Err(MatchError::InvalidHex);
    }
    if !caster_position.is_adjacent(coord) {
        return Err(MatchError::InvalidTarget);
    }
    if is_occupied(coord) {
        return Err(MatchError::OccupiedHex);
    }

    Ok(())
}

fn damage_with_progression(amount: i32, progression: &MatchProgressionLoadout) -> i32 {
    (amount + progression.effects.spell_damage_delta).max(0)
}

fn enemy_piece_ids_in_area(
    enemy_pieces: &[PieceView],
    center: HexCoord,
    radius: i32,
) -> Vec<String> {
    enemy_pieces
        .iter()
        .filter(|piece| center.distance(piece.position) <= radius)
        .map(|piece| piece.id.clone())
        .collect()
}

fn enemy_piece_ids_on_line(
    enemy_pieces: &[PieceView],
    origin: HexCoord,
    direction: HexCoord,
    range: i32,
) -> Vec<String> {
    enemy_pieces
        .iter()
        .filter(|piece| origin.distance(piece.position) <= range)
        .filter(|piece| origin.direction_to(piece.position) == Some(direction))
        .map(|piece| piece.id.clone())
        .collect()
}
