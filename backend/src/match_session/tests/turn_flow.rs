use super::*;

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
    assert_eq!(game.player.max_mana, 3);
    assert_eq!(game.player.hand.len(), 5);
}

#[test]
fn solo_ai_actions_wait_for_player_priority_response() {
    let mut game = MatchState::new_with_seed(7);
    game.player.mana = 8;
    game.player.hero.ap_remaining = 3;
    game.player.hero.hp = 18;
    game.opponent.hero.position = hex(0, -1);
    game.opponent.hero.ap_remaining = 1;
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
            piece_id: game.player.hero.id.clone(),
        },
    })
    .expect("player can answer AI action with higher priority spell");

    assert_eq!(game.action_stack.len(), 2);
    assert_eq!(game.priority_side, Some(Side::Opponent));
    assert_eq!(game.player.hero.hp, 18);

    game.apply_action(MatchActionRequest::AdvanceAi)
        .expect("AI should pass priority to resolve the response");
    assert_eq!(game.player.hero.hp, 20);
    assert_eq!(game.priority_side, Some(Side::Player));
}

#[test]
fn turn_start_mana_comes_from_hero_and_occupied_mana_sources() {
    let mut game = MatchState::new_with_seed(7);
    game.player.hero.position = hex(0, 0);
    game.player.mana = 0;
    game.player.max_mana = 0;
    game.opponent.mana = 0;
    game.opponent.max_mana = 0;

    game.start_turn(Side::Player, &mut Vec::new(), None);

    assert_eq!(game.player.max_mana, 4);
    assert_eq!(game.player.mana, 4);
    assert_eq!(game.opponent.max_mana, 0);
    assert_eq!(game.opponent.mana, 0);
}

#[test]
fn adjacent_unoccupied_sources_do_not_generate_mana() {
    let mut game = MatchState::new_with_seed(7);
    game.player.hero.position = hex(0, 1);
    game.player.mana = 0;
    game.player.max_mana = 0;

    game.start_turn(Side::Player, &mut Vec::new(), None);

    assert_eq!(game.player.max_mana, 3);
    assert_eq!(game.player.mana, 3);
}

#[test]
fn any_side_can_draw_from_an_occupied_mana_source() {
    let mut game = MatchState::new_with_seed(7);
    game.board.mana_sources.push(hex(0, -2));
    game.opponent.hero.position = hex(0, -2);
    game.opponent.mana = 0;
    game.opponent.max_mana = 0;

    game.start_turn(Side::Opponent, &mut Vec::new(), None);

    assert_eq!(game.opponent.max_mana, 4);
    assert_eq!(game.opponent.mana, 4);
}

#[test]
fn unspent_mana_remains_for_reactions_until_next_own_turn_refresh() {
    let mut game = MatchState::new_with_seed_hero_types_and_mode(
        7,
        HeroType::Runekeeper,
        HeroType::Pyromancer,
        MatchMode::Shared,
    );
    game.player.mana = 5;
    game.player.max_mana = 5;

    game.apply_action_recording_for_side(Side::Player, MatchActionRequest::EndTurn, 0)
        .expect("player can end their active turn");

    assert_eq!(game.active_side, Side::Opponent);
    assert_eq!(game.player.mana, 5);
    assert_eq!(game.player.max_mana, 5);

    game.apply_action_recording_for_side(Side::Opponent, MatchActionRequest::EndTurn, 1)
        .expect("opponent can end their active turn");

    assert_eq!(game.active_side, Side::Player);
    assert_eq!(game.player.mana, 3);
    assert_eq!(game.player.max_mana, 3);
}

#[test]
fn solo_turn_start_refreshes_only_active_side_unit_armor() {
    let mut game = MatchState::new_with_seed(7);
    game.opponent.hand.clear();
    game.board.units.push(damaged_board_unit(
        "player-guard",
        Side::Player,
        hex(0, 2),
        1,
        4,
    ));
    game.board.units.push(damaged_board_unit(
        "opponent-guard",
        Side::Opponent,
        hex(0, -2),
        2,
        6,
    ));

    game.apply_action(MatchActionRequest::EndTurn)
        .expect("ending turn should start the opponent turn");

    assert_eq!(unit_armor(&game, "player-guard"), Some(1));
    assert_eq!(unit_armor(&game, "opponent-guard"), Some(6));

    advance_solo_ai_until_player_turn(&mut game);

    assert_eq!(unit_armor(&game, "player-guard"), Some(4));
    assert_eq!(unit_armor(&game, "opponent-guard"), Some(6));
}
