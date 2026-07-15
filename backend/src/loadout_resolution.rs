use std::error::Error;
use std::fmt;

use crate::deck_library::{
    DeckLibrary, DeckLibraryError, DeckRecipeSnapshot, SaveDeckRequest, deck_from_snapshot,
    starter_deck_snapshot, system_deck_by_id, system_deck_snapshot,
};
use crate::http_types::{AiOpponentRequest, DeckChoiceRequest};
use crate::match_session::{Card, HeroType, MatchProgressionLoadout, Side};
use crate::match_store::{MatchStoreError, SqliteMatchStore};
use crate::progression::{ProgressionError, ProgressionModule};

#[derive(Clone, Debug)]
pub(crate) struct FrozenMatchLoadout {
    pub(crate) hero_type: HeroType,
    pub(crate) deck_recipe: DeckRecipeSnapshot,
    pub(crate) cards: Vec<Card>,
    pub(crate) progression: MatchProgressionLoadout,
}

#[derive(Clone, Debug)]
pub(crate) struct SoloMatchLoadouts {
    pub(crate) player: FrozenMatchLoadout,
    pub(crate) opponent: FrozenMatchLoadout,
}

pub(crate) struct SoloMatchLoadoutRequest {
    pub(crate) user_id: Option<i64>,
    pub(crate) preferred_hero_type: HeroType,
    pub(crate) requested_hero_type: Option<HeroType>,
    pub(crate) player_deck: Option<DeckChoiceRequest>,
    pub(crate) legacy_player_deck_id: Option<i64>,
    pub(crate) ai_opponent: Option<AiOpponentRequest>,
    pub(crate) requested_rune_ids: Option<Vec<String>>,
}

pub(crate) struct SharedSeatLoadoutRequest<'a> {
    pub(crate) match_id: &'a str,
    pub(crate) seat_token: &'a str,
    pub(crate) user_id: Option<i64>,
    pub(crate) hero_type: HeroType,
    pub(crate) deck_choice: Option<DeckChoiceRequest>,
    pub(crate) legacy_deck_id: Option<i64>,
    pub(crate) requested_rune_ids: Option<Vec<String>>,
}

#[derive(Debug)]
pub(crate) enum LoadoutResolutionError {
    UnauthorizedAccountDeck,
    DeckNotFound,
    SharedSeatNotFound,
    Deck(DeckLibraryError),
    Progression(ProgressionError),
    Store(MatchStoreError),
}

impl fmt::Display for LoadoutResolutionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnauthorizedAccountDeck => write!(f, "Sign in to continue."),
            Self::DeckNotFound => write!(f, "Deck recipe was not found"),
            Self::SharedSeatNotFound => write!(f, "Shared match seat was not found"),
            Self::Deck(error) => write!(f, "{error}"),
            Self::Progression(error) => write!(f, "{error}"),
            Self::Store(error) => write!(f, "{error}"),
        }
    }
}

impl Error for LoadoutResolutionError {}

impl From<DeckLibraryError> for LoadoutResolutionError {
    fn from(error: DeckLibraryError) -> Self {
        Self::Deck(error)
    }
}

impl From<ProgressionError> for LoadoutResolutionError {
    fn from(error: ProgressionError) -> Self {
        Self::Progression(error)
    }
}

impl From<MatchStoreError> for LoadoutResolutionError {
    fn from(error: MatchStoreError) -> Self {
        Self::Store(error)
    }
}

pub(crate) fn default_deck_configuration(
    mut request: SaveDeckRequest,
    preferred_hero_type: HeroType,
) -> SaveDeckRequest {
    request.hero_type.get_or_insert(preferred_hero_type);
    request
}

pub(crate) fn validate_deck_configuration(
    store: &mut SqliteMatchStore,
    user_id: i64,
    request: &SaveDeckRequest,
) -> Result<(), ProgressionError> {
    let hero_type = request.hero_type.unwrap_or_default();
    let mut progression = ProgressionModule::new(store.connection_mut());
    progression
        .match_loadout(Some(user_id), hero_type, Some(request.rune_ids.clone()))
        .map(|_| ())
}

pub(crate) fn resolve_solo_match_loadouts(
    store: &mut SqliteMatchStore,
    request: SoloMatchLoadoutRequest,
) -> Result<SoloMatchLoadouts, LoadoutResolutionError> {
    let (player_hero_type, player_recipe, requested_rune_ids) = resolve_player_choice(
        store,
        request.user_id,
        request.preferred_hero_type,
        request.requested_hero_type,
        request.player_deck,
        request.legacy_player_deck_id,
        request.requested_rune_ids,
    )?;
    let player_progression =
        resolve_progression(store, request.user_id, player_hero_type, requested_rune_ids)?;
    let player = freeze_loadout(
        Side::Player,
        player_hero_type,
        player_recipe,
        player_progression,
    )?;

    let (opponent_hero_type, opponent_recipe) =
        resolve_solo_opponent_choice(store, request.user_id, request.ai_opponent)?;
    let opponent = freeze_loadout(
        Side::Opponent,
        opponent_hero_type,
        opponent_recipe,
        MatchProgressionLoadout::default(),
    )?;

    Ok(SoloMatchLoadouts { player, opponent })
}

pub(crate) fn resolve_shared_seat_loadout(
    store: &mut SqliteMatchStore,
    request: SharedSeatLoadoutRequest<'_>,
) -> Result<FrozenMatchLoadout, LoadoutResolutionError> {
    let deck_recipe = resolve_shared_deck_choice(
        store,
        request.user_id,
        request.deck_choice,
        request.legacy_deck_id,
    )?;
    let progression = resolve_progression(
        store,
        request.user_id,
        request.hero_type,
        request.requested_rune_ids,
    )?;
    let side = store
        .load_shared_match_for_seat(request.match_id, request.seat_token)?
        .map(|shared| shared.viewer_seat.side)
        .ok_or(LoadoutResolutionError::SharedSeatNotFound)?;

    freeze_loadout(side, request.hero_type, deck_recipe, progression)
}

fn freeze_loadout(
    side: Side,
    hero_type: HeroType,
    deck_recipe: DeckRecipeSnapshot,
    progression: MatchProgressionLoadout,
) -> Result<FrozenMatchLoadout, LoadoutResolutionError> {
    let cards = deck_from_snapshot(side, &deck_recipe)?;
    Ok(FrozenMatchLoadout {
        hero_type,
        deck_recipe,
        cards,
        progression,
    })
}

fn resolve_progression(
    store: &mut SqliteMatchStore,
    user_id: Option<i64>,
    hero_type: HeroType,
    requested_rune_ids: Option<Vec<String>>,
) -> Result<MatchProgressionLoadout, LoadoutResolutionError> {
    let mut progression = ProgressionModule::new(store.connection_mut());
    Ok(progression.match_loadout(user_id, hero_type, requested_rune_ids)?)
}

fn resolve_player_choice(
    store: &mut SqliteMatchStore,
    user_id: Option<i64>,
    preferred_hero_type: HeroType,
    requested_hero_type: Option<HeroType>,
    player_deck: Option<DeckChoiceRequest>,
    legacy_player_deck_id: Option<i64>,
    requested_rune_ids: Option<Vec<String>>,
) -> Result<(HeroType, DeckRecipeSnapshot, Option<Vec<String>>), LoadoutResolutionError> {
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
            let system_deck = system_deck_by_id(&system_deck_id)
                .ok_or_else(|| DeckLibraryError::UnknownSystemDeck(system_deck_id.clone()))?;
            Ok((
                requested_hero_type.unwrap_or(system_deck.hero_type),
                system_deck_snapshot(&system_deck_id)?,
                requested_rune_ids,
            ))
        }
        Some(DeckChoiceRequest::Account { deck_id }) => {
            let (snapshot, configured_hero_type, configured_rune_ids) =
                resolve_account_deck_loadout(store, user_id, deck_id)?;
            Ok((
                requested_hero_type.unwrap_or(configured_hero_type),
                snapshot,
                requested_rune_ids.or(Some(configured_rune_ids)),
            ))
        }
        None => {
            let deck_id = legacy_player_deck_id
                .expect("legacy deck id should exist after the empty choice branch");
            Ok((
                requested_hero_type.unwrap_or(preferred_hero_type),
                resolve_required_account_deck(store, user_id, deck_id)?,
                requested_rune_ids,
            ))
        }
    }
}

fn resolve_solo_opponent_choice(
    store: &mut SqliteMatchStore,
    user_id: Option<i64>,
    ai_opponent: Option<AiOpponentRequest>,
) -> Result<(HeroType, DeckRecipeSnapshot), LoadoutResolutionError> {
    match ai_opponent {
        Some(AiOpponentRequest::System { system_deck_id }) => {
            let system_deck = system_deck_by_id(&system_deck_id)
                .ok_or_else(|| DeckLibraryError::UnknownSystemDeck(system_deck_id.clone()))?;
            Ok((
                system_deck.hero_type,
                system_deck_snapshot(&system_deck_id)?,
            ))
        }
        Some(AiOpponentRequest::Account { deck_id, hero_type }) => Ok((
            hero_type,
            resolve_required_account_deck(store, user_id, deck_id)?,
        )),
        None => Ok((HeroType::Runekeeper, starter_deck_snapshot())),
    }
}

fn resolve_shared_deck_choice(
    store: &mut SqliteMatchStore,
    user_id: Option<i64>,
    deck_choice: Option<DeckChoiceRequest>,
    legacy_deck_id: Option<i64>,
) -> Result<DeckRecipeSnapshot, LoadoutResolutionError> {
    match deck_choice {
        Some(DeckChoiceRequest::Starter) => Ok(starter_deck_snapshot()),
        Some(DeckChoiceRequest::System { system_deck_id }) => {
            Ok(system_deck_snapshot(&system_deck_id)?)
        }
        Some(DeckChoiceRequest::Account { deck_id }) => {
            resolve_required_account_deck(store, user_id, deck_id)
        }
        None => match legacy_deck_id {
            Some(deck_id) => resolve_required_account_deck(store, user_id, deck_id),
            None => Ok(starter_deck_snapshot()),
        },
    }
}

fn resolve_account_deck_loadout(
    store: &mut SqliteMatchStore,
    user_id: Option<i64>,
    deck_id: i64,
) -> Result<(DeckRecipeSnapshot, HeroType, Vec<String>), LoadoutResolutionError> {
    let user_id = user_id.ok_or(LoadoutResolutionError::UnauthorizedAccountDeck)?;
    let mut decks = DeckLibrary::new(store.connection_mut());
    let snapshot = decks
        .legal_snapshot_for_user(user_id, deck_id)?
        .ok_or(LoadoutResolutionError::DeckNotFound)?;
    let (hero_type, rune_ids) = decks
        .configuration_for_user(user_id, deck_id)?
        .ok_or(LoadoutResolutionError::DeckNotFound)?;
    Ok((snapshot, hero_type, rune_ids))
}

fn resolve_required_account_deck(
    store: &mut SqliteMatchStore,
    user_id: Option<i64>,
    deck_id: i64,
) -> Result<DeckRecipeSnapshot, LoadoutResolutionError> {
    let user_id = user_id.ok_or(LoadoutResolutionError::UnauthorizedAccountDeck)?;
    let mut decks = DeckLibrary::new(store.connection_mut());
    decks
        .legal_snapshot_for_user(user_id, deck_id)?
        .ok_or(LoadoutResolutionError::DeckNotFound)
}
