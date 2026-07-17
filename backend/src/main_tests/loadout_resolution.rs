use super::*;
use crate::http_types::{AiOpponentRequest, DeckChoiceRequest};
use crate::loadout_resolution::{
    LoadoutResolutionError, SharedSeatLoadoutRequest, SoloMatchLoadoutRequest,
    resolve_shared_seat_loadout, resolve_solo_match_loadouts,
};
use crate::match_session::HeroType;

#[test]
fn solo_resolution_returns_complete_anonymous_starter_loadouts() {
    let path = test_db_path("loadout-solo-starter");
    let mut store = SqliteMatchStore::new(&path).expect("store should open");

    let resolved = resolve_solo_match_loadouts(
        &mut store,
        SoloMatchLoadoutRequest {
            user_id: None,
            preferred_hero_type: HeroType::Chronomancer,
            requested_hero_type: None,
            player_deck: None,
            legacy_player_deck_id: None,
            ai_opponent: None,
            requested_rune_ids: None,
        },
    )
    .expect("anonymous starter loadouts should resolve");

    assert_eq!(resolved.player.hero_type, HeroType::Chronomancer);
    assert_eq!(resolved.opponent.hero_type, HeroType::Runekeeper);
    assert_eq!(resolved.player.deck_recipe.name, "Balanced Starter");
    assert_eq!(resolved.player.cards.len(), 60);
    assert!(
        resolved
            .player
            .cards
            .iter()
            .all(|card| card.id.starts_with("p-"))
    );
    assert!(
        resolved
            .opponent
            .cards
            .iter()
            .all(|card| card.id.starts_with("o-"))
    );
    assert!(resolved.player.progression.rune_ids.is_empty());

    drop(store);
    let _ = fs::remove_file(path);
}

#[test]
fn solo_resolution_applies_system_and_account_configuration_with_overrides() {
    let path = test_db_path("loadout-solo-configured");
    let mut store = SqliteMatchStore::new(&path).expect("store should open");
    let user_id = 10_000;
    let deck_id = {
        let connection = store.connection_mut();
        let mut decks = crate::deck_library::DeckLibrary::new(connection);
        let decks = decks
            .list_for_user(user_id)
            .expect("experienced account deck should load");
        let deck_id = decks.decks[0].id;
        connection
            .execute(
                "UPDATE deck_recipes SET hero_type = 'pyromancer', rune_ids_json = '[\"vitality\"]' WHERE id = ?1",
                [deck_id],
            )
            .expect("deck configuration should update");
        deck_id
    };

    let configured = resolve_solo_match_loadouts(
        &mut store,
        SoloMatchLoadoutRequest {
            user_id: Some(user_id),
            preferred_hero_type: HeroType::Runekeeper,
            requested_hero_type: None,
            player_deck: Some(DeckChoiceRequest::Account { deck_id }),
            legacy_player_deck_id: None,
            ai_opponent: Some(AiOpponentRequest::System {
                system_deck_id: "ember-burn".to_string(),
            }),
            requested_rune_ids: None,
        },
    )
    .expect("configured loadouts should resolve");
    assert_eq!(configured.player.hero_type, HeroType::Pyromancer);
    assert_eq!(configured.player.progression.rune_ids, ["vitality"]);
    assert_eq!(configured.opponent.hero_type, HeroType::Pyromancer);
    assert_eq!(configured.opponent.deck_recipe.name, "Ember Burn");

    let overridden = resolve_solo_match_loadouts(
        &mut store,
        SoloMatchLoadoutRequest {
            user_id: Some(user_id),
            preferred_hero_type: HeroType::Runekeeper,
            requested_hero_type: Some(HeroType::Warden),
            player_deck: Some(DeckChoiceRequest::Account { deck_id }),
            legacy_player_deck_id: None,
            ai_opponent: None,
            requested_rune_ids: Some(Vec::new()),
        },
    )
    .expect("explicit overrides should resolve");
    assert_eq!(overridden.player.hero_type, HeroType::Warden);
    assert!(overridden.player.progression.rune_ids.is_empty());

    let legacy = resolve_solo_match_loadouts(
        &mut store,
        SoloMatchLoadoutRequest {
            user_id: Some(user_id),
            preferred_hero_type: HeroType::Chronomancer,
            requested_hero_type: None,
            player_deck: None,
            legacy_player_deck_id: Some(deck_id),
            ai_opponent: None,
            requested_rune_ids: Some(Vec::new()),
        },
    )
    .expect("legacy deck id should still resolve");
    assert_eq!(legacy.player.hero_type, HeroType::Chronomancer);
    assert_eq!(legacy.player.deck_recipe.name, "Balanced Starter");

    drop(store);
    let _ = fs::remove_file(path);
}

#[test]
fn shared_seat_resolution_freezes_the_seat_side_deck_and_progression() {
    let path = test_db_path("loadout-shared-seat");
    let mut store = SqliteMatchStore::new(&path).expect("store should open");
    let shared = store
        .create_shared_match(None, crate::match_store::SharedMatchFormat::Duel)
        .expect("shared match should be created");

    let resolved = resolve_shared_seat_loadout(
        &mut store,
        SharedSeatLoadoutRequest {
            match_id: &shared.match_id,
            seat_token: &shared.opponent_token,
            user_id: None,
            hero_type: HeroType::Warden,
            deck_choice: Some(DeckChoiceRequest::System {
                system_deck_id: "ember-burn".to_string(),
            }),
            legacy_deck_id: None,
            requested_rune_ids: None,
        },
    )
    .expect("shared seat loadout should resolve");

    assert_eq!(resolved.hero_type, HeroType::Warden);
    assert_eq!(resolved.deck_recipe.name, "Ember Burn");
    assert!(resolved.cards.iter().all(|card| card.id.starts_with("o-")));
    assert!(resolved.progression.rune_ids.is_empty());

    drop(store);
    let _ = fs::remove_file(path);
}

#[test]
fn resolution_returns_domain_errors_for_invalid_choices() {
    let path = test_db_path("loadout-errors");
    let mut store = SqliteMatchStore::new(&path).expect("store should open");

    let unauthorized = resolve_solo_match_loadouts(
        &mut store,
        SoloMatchLoadoutRequest {
            user_id: None,
            preferred_hero_type: HeroType::Runekeeper,
            requested_hero_type: None,
            player_deck: Some(DeckChoiceRequest::Account { deck_id: 42 }),
            legacy_player_deck_id: None,
            ai_opponent: None,
            requested_rune_ids: None,
        },
    )
    .expect_err("anonymous account deck should be rejected");
    assert!(matches!(
        unauthorized,
        LoadoutResolutionError::UnauthorizedAccountDeck
    ));

    let unknown_system = resolve_solo_match_loadouts(
        &mut store,
        SoloMatchLoadoutRequest {
            user_id: None,
            preferred_hero_type: HeroType::Runekeeper,
            requested_hero_type: None,
            player_deck: Some(DeckChoiceRequest::System {
                system_deck_id: "missing".to_string(),
            }),
            legacy_player_deck_id: None,
            ai_opponent: None,
            requested_rune_ids: None,
        },
    )
    .expect_err("unknown system deck should be rejected");
    assert!(matches!(
        unknown_system,
        LoadoutResolutionError::Deck(crate::deck_library::DeckLibraryError::UnknownSystemDeck(_))
    ));

    drop(store);
    let _ = fs::remove_file(path);
}
