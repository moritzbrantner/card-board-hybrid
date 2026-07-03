use super::{
    ActionTarget, Card, CardKind, CardSummary, HexBoard, HexCoord, MatchError,
    MatchProgressionLoadout, Side, Unit,
};

pub(crate) struct PlannedUnitPlay {
    pub(crate) coord: HexCoord,
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
