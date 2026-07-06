use crate::deck_library::DeckRecipeSnapshot;
use crate::*;
use axum::response::IntoResponse;

pub(crate) fn default_deck_configuration(
    mut request: SaveDeckRequest,
    preferred_hero_type: HeroType,
) -> SaveDeckRequest {
    request.hero_type.get_or_insert(preferred_hero_type);
    request
}

#[allow(
    clippy::result_large_err,
    reason = "route helpers return Axum responses directly"
)]
pub(crate) fn validate_deck_configuration(
    store: &mut SqliteMatchStore,
    user_id: i64,
    request: &SaveDeckRequest,
) -> Result<(), axum::response::Response> {
    let hero_type = request.hero_type.unwrap_or_default();
    let mut progression = ProgressionModule::new(store.connection_mut());
    match progression.match_loadout(Some(user_id), hero_type, Some(request.rune_ids.clone())) {
        Ok(_) => Ok(()),
        Err(error) => Err(progression_error_response(error)),
    }
}

#[allow(
    clippy::result_large_err,
    reason = "route helpers return Axum responses directly"
)]
pub(crate) fn resolve_player_loadout_choice(
    store: &mut SqliteMatchStore,
    user_id: Option<i64>,
    preferred_hero_type: HeroType,
    requested_hero_type: Option<HeroType>,
    player_deck: Option<DeckChoiceRequest>,
    legacy_player_deck_id: Option<i64>,
    requested_rune_ids: Option<Vec<String>>,
) -> Result<(HeroType, DeckRecipeSnapshot, Option<Vec<String>>), axum::response::Response> {
    match player_deck {
        Some(DeckChoiceRequest::Starter) => Ok((
            requested_hero_type.unwrap_or(preferred_hero_type),
            starter_deck_snapshot(),
            requested_rune_ids,
        )),
        None if legacy_player_deck_id.is_none() => Ok((
            requested_hero_type.unwrap_or(preferred_hero_type),
            starter_deck_snapshot(),
            requested_rune_ids,
        )),
        Some(DeckChoiceRequest::System { system_deck_id }) => {
            let Some(system_deck) = system_deck_by_id(&system_deck_id) else {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(ApiError {
                        message: format!("Unknown system deck: {system_deck_id}"),
                    }),
                )
                    .into_response());
            };
            let snapshot = match system_deck_snapshot(&system_deck_id) {
                Ok(snapshot) => snapshot,
                Err(error) => return Err(deck_error_response(error)),
            };
            Ok((
                requested_hero_type.unwrap_or(system_deck.hero_type),
                snapshot,
                requested_rune_ids,
            ))
        }
        Some(DeckChoiceRequest::Account { deck_id }) => {
            let (snapshot, configured) = resolve_account_deck_loadout(store, user_id, deck_id)?;
            Ok((
                requested_hero_type.unwrap_or(configured.0),
                snapshot,
                requested_rune_ids.or(Some(configured.1)),
            ))
        }
        None => {
            let deck_id =
                legacy_player_deck_id.expect("legacy deck id should exist in this branch");
            let snapshot = resolve_required_account_deck_choice(store, user_id, deck_id)?;
            Ok((
                requested_hero_type.unwrap_or(preferred_hero_type),
                snapshot,
                requested_rune_ids,
            ))
        }
    }
}

#[allow(
    clippy::result_large_err,
    reason = "route helpers return Axum responses directly"
)]
pub(crate) fn resolve_solo_ai_choice(
    store: &mut SqliteMatchStore,
    user_id: Option<i64>,
    ai_opponent: Option<AiOpponentRequest>,
) -> Result<(HeroType, DeckRecipeSnapshot), axum::response::Response> {
    let loadout = match ai_opponent {
        Some(AiOpponentRequest::System { system_deck_id }) => {
            let Some(system_deck) = system_deck_by_id(&system_deck_id) else {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(ApiError {
                        message: format!("Unknown system deck: {system_deck_id}"),
                    }),
                )
                    .into_response());
            };
            let snapshot = match system_deck_snapshot(&system_deck_id) {
                Ok(snapshot) => snapshot,
                Err(error) => return Err(deck_error_response(error)),
            };
            (system_deck.hero_type, snapshot)
        }
        Some(AiOpponentRequest::Account { deck_id, hero_type }) => {
            let snapshot = resolve_required_account_deck_choice(store, user_id, deck_id)?;
            (hero_type, snapshot)
        }
        None => (HeroType::Runekeeper, starter_deck_snapshot()),
    };
    Ok(loadout)
}

#[allow(
    clippy::result_large_err,
    reason = "route helpers return Axum responses directly"
)]
pub(crate) fn resolve_shared_deck_choice(
    store: &mut SqliteMatchStore,
    user_id: Option<i64>,
    deck_choice: Option<DeckChoiceRequest>,
    legacy_deck_id: Option<i64>,
) -> Result<DeckRecipeSnapshot, axum::response::Response> {
    match deck_choice {
        Some(DeckChoiceRequest::Starter) => Ok(starter_deck_snapshot()),
        Some(DeckChoiceRequest::System { system_deck_id }) => {
            match system_deck_snapshot(&system_deck_id) {
                Ok(snapshot) => Ok(snapshot),
                Err(error) => Err(deck_error_response(error)),
            }
        }
        Some(DeckChoiceRequest::Account { deck_id }) => {
            resolve_required_account_deck_choice(store, user_id, deck_id)
        }
        None => resolve_optional_account_deck_choice(store, user_id, legacy_deck_id),
    }
}

#[allow(
    clippy::result_large_err,
    reason = "route helpers return Axum responses directly"
)]
pub(crate) fn resolve_optional_account_deck_choice(
    store: &mut SqliteMatchStore,
    user_id: Option<i64>,
    deck_id: Option<i64>,
) -> Result<DeckRecipeSnapshot, axum::response::Response> {
    match deck_id {
        Some(deck_id) => resolve_required_account_deck_choice(store, user_id, deck_id),
        None => Ok(starter_deck_snapshot()),
    }
}

#[allow(
    clippy::result_large_err,
    reason = "route helpers return Axum responses directly"
)]
pub(crate) fn resolve_account_deck_loadout(
    store: &mut SqliteMatchStore,
    user_id: Option<i64>,
    deck_id: i64,
) -> Result<(DeckRecipeSnapshot, (HeroType, Vec<String>)), axum::response::Response> {
    let Some(user_id) = user_id else {
        return Err(unauthorized_response());
    };
    let mut decks = DeckLibrary::new(store.connection_mut());
    let snapshot = match decks.legal_snapshot_for_user(user_id, deck_id) {
        Ok(Some(snapshot)) => snapshot,
        Ok(None) => return Err(deck_not_found_response()),
        Err(error) => return Err(deck_error_response(error)),
    };
    let configured = match decks.configuration_for_user(user_id, deck_id) {
        Ok(Some(configured)) => configured,
        Ok(None) => return Err(deck_not_found_response()),
        Err(error) => return Err(deck_error_response(error)),
    };
    Ok((snapshot, configured))
}

#[allow(
    clippy::result_large_err,
    reason = "route helpers return Axum responses directly"
)]
pub(crate) fn resolve_required_account_deck_choice(
    store: &mut SqliteMatchStore,
    user_id: Option<i64>,
    deck_id: i64,
) -> Result<DeckRecipeSnapshot, axum::response::Response> {
    let Some(user_id) = user_id else {
        return Err(unauthorized_response());
    };
    let mut decks = DeckLibrary::new(store.connection_mut());
    match decks.legal_snapshot_for_user(user_id, deck_id) {
        Ok(Some(snapshot)) => Ok(snapshot),
        Ok(None) => Err(deck_not_found_response()),
        Err(error) => Err(deck_error_response(error)),
    }
}
