use crate::deck_library::{
    DeckLibrary, DeckLibraryError, DeckRecipeSnapshot, SaveDeckRequest, deck_from_snapshot,
    starter_deck_snapshot, system_deck_by_id, system_deck_snapshot,
};
use crate::http_types::{AiOpponentRequest, DeckChoiceRequest};
use crate::match_session::{Card, HeroType, MatchProgressionLoadout, Side};
use crate::match_store::SqliteMatchStore;
use crate::progression::{ProgressionError, ProgressionModule};

pub(crate) struct SoloMatchLoadoutRequest {
    pub(crate) user_id: Option<i64>,
    pub(crate) preferred_hero_type: HeroType,
    pub(crate) requested_hero_type: Option<HeroType>,
    pub(crate) player_deck: Option<DeckChoiceRequest>,
    pub(crate) legacy_player_deck_id: Option<i64>,
    pub(crate) requested_rune_ids: Option<Vec<String>>,
    pub(crate) ai_opponent: Option<AiOpponentRequest>,
}

pub(crate) struct SharedSeatLoadoutRequest {
    pub(crate) user_id: Option<i64>,
    pub(crate) hero_type: HeroType,
    pub(crate) deck_choice: Option<DeckChoiceRequest>,
    pub(crate) legacy_deck_id: Option<i64>,
    pub(crate) rune_ids: Option<Vec<String>>,
}

pub(crate) struct MatchSideLoadout {
    pub(crate) hero_type: HeroType,
    pub(crate) deck: Vec<Card>,
    pub(crate) progression: MatchProgressionLoadout,
}

pub(crate) struct SoloMatchLoadouts {
    pub(crate) player: MatchSideLoadout,
    pub(crate) opponent: MatchSideLoadout,
}

pub(crate) struct SharedSeatLoadout {
    pub(crate) hero_type: HeroType,
    pub(crate) deck_recipe: DeckRecipeSnapshot,
    pub(crate) progression: MatchProgressionLoadout,
}

#[derive(Debug)]
pub(crate) enum LoadoutResolutionError {
    Unauthorized,
    Deck(DeckLibraryError),
    Progression(ProgressionError),
}

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

struct PlayerLoadoutChoice {
    hero_type: HeroType,
    deck_recipe: DeckRecipeSnapshot,
    rune_ids: Option<Vec<String>>,
}

struct AiLoadoutChoice {
    hero_type: HeroType,
    deck_recipe: DeckRecipeSnapshot,
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
) -> Result<(), LoadoutResolutionError> {
    let hero_type = request.hero_type.unwrap_or_default();
    let mut progression = ProgressionModule::new(store.connection_mut());
    progression
        .match_loadout(Some(user_id), hero_type, Some(request.rune_ids.clone()))
        .map(|_| ())
        .map_err(LoadoutResolutionError::from)
}

pub(crate) fn resolve_solo_match_loadouts(
    store: &mut SqliteMatchStore,
    request: SoloMatchLoadoutRequest,
) -> Result<SoloMatchLoadouts, LoadoutResolutionError> {
    let player_choice = resolve_player_loadout_choice(
        store,
        request.user_id,
        request.preferred_hero_type,
        request.requested_hero_type,
        request.player_deck,
        request.legacy_player_deck_id,
        request.requested_rune_ids,
    )?;
    let player_deck = deck_from_snapshot(Side::Player, &player_choice.deck_recipe)?;
    let player_progression = {
        let mut progression = ProgressionModule::new(store.connection_mut());
        progression.match_loadout(
            request.user_id,
            player_choice.hero_type,
            player_choice.rune_ids.clone(),
        )?
    };

    let opponent_choice = resolve_solo_ai_choice(store, request.user_id, request.ai_opponent)?;
    let opponent_deck = deck_from_snapshot(Side::Opponent, &opponent_choice.deck_recipe)?;

    Ok(SoloMatchLoadouts {
        player: MatchSideLoadout {
            hero_type: player_choice.hero_type,
            deck: player_deck,
            progression: player_progression,
        },
        opponent: MatchSideLoadout {
            hero_type: opponent_choice.hero_type,
            deck: opponent_deck,
            progression: MatchProgressionLoadout::default(),
        },
    })
}

pub(crate) fn resolve_shared_seat_loadout(
    store: &mut SqliteMatchStore,
    request: SharedSeatLoadoutRequest,
) -> Result<SharedSeatLoadout, LoadoutResolutionError> {
    let deck_recipe = resolve_shared_deck_choice(
        store,
        request.user_id,
        request.deck_choice,
        request.legacy_deck_id,
    )?;
    let progression = {
        let mut progression = ProgressionModule::new(store.connection_mut());
        progression.match_loadout(request.user_id, request.hero_type, request.rune_ids)?
    };
    Ok(SharedSeatLoadout {
        hero_type: request.hero_type,
        deck_recipe,
        progression,
    })
}

fn resolve_player_loadout_choice(
    store: &mut SqliteMatchStore,
    user_id: Option<i64>,
    preferred_hero_type: HeroType,
    requested_hero_type: Option<HeroType>,
    player_deck: Option<DeckChoiceRequest>,
    legacy_player_deck_id: Option<i64>,
    requested_rune_ids: Option<Vec<String>>,
) -> Result<PlayerLoadoutChoice, LoadoutResolutionError> {
    match player_deck {
        Some(DeckChoiceRequest::Starter) => Ok(PlayerLoadoutChoice {
            hero_type: requested_hero_type.unwrap_or(preferred_hero_type),
            deck_recipe: starter_deck_snapshot(),
            rune_ids: requested_rune_ids,
        }),
        None if legacy_player_deck_id.is_none() => Ok(PlayerLoadoutChoice {
            hero_type: requested_hero_type.unwrap_or(preferred_hero_type),
            deck_recipe: starter_deck_snapshot(),
            rune_ids: requested_rune_ids,
        }),
        Some(DeckChoiceRequest::System { system_deck_id }) => {
            let Some(system_deck) = system_deck_by_id(&system_deck_id) else {
                return Err(DeckLibraryError::UnknownSystemDeck(system_deck_id).into());
            };
            let snapshot = system_deck_snapshot(&system_deck_id)?;
            Ok(PlayerLoadoutChoice {
                hero_type: requested_hero_type.unwrap_or(system_deck.hero_type),
                deck_recipe: snapshot,
                rune_ids: requested_rune_ids,
            })
        }
        Some(DeckChoiceRequest::Account { deck_id }) => {
            let account_loadout = resolve_account_deck_loadout(store, user_id, deck_id)?;
            Ok(PlayerLoadoutChoice {
                hero_type: requested_hero_type.unwrap_or(account_loadout.hero_type),
                deck_recipe: account_loadout.deck_recipe,
                rune_ids: requested_rune_ids.or(Some(account_loadout.rune_ids)),
            })
        }
        None => {
            let deck_id =
                legacy_player_deck_id.expect("legacy deck id should exist in this branch");
            let snapshot = resolve_required_account_deck_choice(store, user_id, deck_id)?;
            Ok(PlayerLoadoutChoice {
                hero_type: requested_hero_type.unwrap_or(preferred_hero_type),
                deck_recipe: snapshot,
                rune_ids: requested_rune_ids,
            })
        }
    }
}

fn resolve_solo_ai_choice(
    store: &mut SqliteMatchStore,
    user_id: Option<i64>,
    ai_opponent: Option<AiOpponentRequest>,
) -> Result<AiLoadoutChoice, LoadoutResolutionError> {
    let loadout = match ai_opponent {
        Some(AiOpponentRequest::System { system_deck_id }) => {
            let Some(system_deck) = system_deck_by_id(&system_deck_id) else {
                return Err(DeckLibraryError::UnknownSystemDeck(system_deck_id).into());
            };
            let snapshot = system_deck_snapshot(&system_deck_id)?;
            AiLoadoutChoice {
                hero_type: system_deck.hero_type,
                deck_recipe: snapshot,
            }
        }
        Some(AiOpponentRequest::Account { deck_id, hero_type }) => {
            let snapshot = resolve_required_account_deck_choice(store, user_id, deck_id)?;
            AiLoadoutChoice {
                hero_type,
                deck_recipe: snapshot,
            }
        }
        None => AiLoadoutChoice {
            hero_type: HeroType::Runekeeper,
            deck_recipe: starter_deck_snapshot(),
        },
    };
    Ok(loadout)
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
            resolve_required_account_deck_choice(store, user_id, deck_id)
        }
        None => resolve_optional_account_deck_choice(store, user_id, legacy_deck_id),
    }
}

fn resolve_optional_account_deck_choice(
    store: &mut SqliteMatchStore,
    user_id: Option<i64>,
    deck_id: Option<i64>,
) -> Result<DeckRecipeSnapshot, LoadoutResolutionError> {
    match deck_id {
        Some(deck_id) => resolve_required_account_deck_choice(store, user_id, deck_id),
        None => Ok(starter_deck_snapshot()),
    }
}

struct AccountDeckLoadout {
    deck_recipe: DeckRecipeSnapshot,
    hero_type: HeroType,
    rune_ids: Vec<String>,
}

fn resolve_account_deck_loadout(
    store: &mut SqliteMatchStore,
    user_id: Option<i64>,
    deck_id: i64,
) -> Result<AccountDeckLoadout, LoadoutResolutionError> {
    let Some(user_id) = user_id else {
        return Err(LoadoutResolutionError::Unauthorized);
    };
    let mut decks = DeckLibrary::new(store.connection_mut());
    let snapshot = decks
        .legal_snapshot_for_user(user_id, deck_id)?
        .ok_or(DeckLibraryError::NotFound)?;
    let (hero_type, rune_ids) = decks
        .configuration_for_user(user_id, deck_id)?
        .ok_or(DeckLibraryError::NotFound)?;
    Ok(AccountDeckLoadout {
        deck_recipe: snapshot,
        hero_type,
        rune_ids,
    })
}

fn resolve_required_account_deck_choice(
    store: &mut SqliteMatchStore,
    user_id: Option<i64>,
    deck_id: i64,
) -> Result<DeckRecipeSnapshot, LoadoutResolutionError> {
    let Some(user_id) = user_id else {
        return Err(LoadoutResolutionError::Unauthorized);
    };
    let mut decks = DeckLibrary::new(store.connection_mut());
    decks
        .legal_snapshot_for_user(user_id, deck_id)?
        .ok_or(DeckLibraryError::NotFound)
        .map_err(LoadoutResolutionError::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::deck_library::DeckCardCountRequest;
    use crate::identity::IdentityModule;
    use std::env;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_db_path(name: &str) -> PathBuf {
        let mut path = env::temp_dir();
        path.push(format!(
            "rune-lanes-loadout-{name}-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after epoch")
                .as_nanos()
        ));
        path
    }

    fn test_store(name: &str) -> (SqliteMatchStore, PathBuf) {
        let path = test_db_path(name);
        let store = SqliteMatchStore::new(&path).expect("store should open");
        (store, path)
    }

    fn register_user(store: &mut SqliteMatchStore, email: &str) -> i64 {
        let mut identity = IdentityModule::new(store.connection_mut());
        identity
            .register(email, email, "password123")
            .expect("registration should succeed")
            .expect("new account should be created")
            .profile
            .id
    }

    fn grant_account_xp(store: &mut SqliteMatchStore, user_id: i64, total_xp: i64) {
        store
            .connection_mut()
            .execute(
                "UPDATE users SET total_xp = ?2 WHERE id = ?1",
                rusqlite::params![user_id, total_xp],
            )
            .expect("xp should update");
    }

    fn legal_deck_request(
        name: &str,
        hero_type: HeroType,
        rune_ids: Vec<String>,
    ) -> SaveDeckRequest {
        SaveDeckRequest {
            name: name.to_string(),
            cards: starter_deck_snapshot()
                .cards
                .into_iter()
                .map(|card| DeckCardCountRequest {
                    template_id: card.template_id,
                    count: i32::from(card.count),
                })
                .collect(),
            is_default: Some(false),
            hero_type: Some(hero_type),
            rune_ids,
        }
    }

    fn create_account_deck(
        store: &mut SqliteMatchStore,
        user_id: i64,
        hero_type: HeroType,
        rune_ids: Vec<String>,
    ) -> i64 {
        let mut decks = DeckLibrary::new(store.connection_mut());
        decks
            .create_for_user(
                user_id,
                legal_deck_request("Configured", hero_type, rune_ids),
            )
            .expect("deck should save")
            .id
    }

    #[test]
    fn solo_loadout_uses_account_deck_hero_and_runes_when_not_overridden() {
        let (mut store, path) = test_store("account-config");
        let user_id = register_user(&mut store, "loadout-account@example.com");
        grant_account_xp(&mut store, user_id, 20_000);
        let deck_id = create_account_deck(
            &mut store,
            user_id,
            HeroType::Pyromancer,
            vec!["vitality".to_string()],
        );

        let loadouts = resolve_solo_match_loadouts(
            &mut store,
            SoloMatchLoadoutRequest {
                user_id: Some(user_id),
                preferred_hero_type: HeroType::Warden,
                requested_hero_type: None,
                player_deck: Some(DeckChoiceRequest::Account { deck_id }),
                legacy_player_deck_id: None,
                requested_rune_ids: None,
                ai_opponent: None,
            },
        )
        .expect("loadout should resolve");

        assert_eq!(loadouts.player.hero_type, HeroType::Pyromancer);
        assert_eq!(loadouts.player.progression.rune_ids, ["vitality"]);
        assert!(
            loadouts
                .player
                .deck
                .iter()
                .all(|card| card.id.starts_with("p-"))
        );
        assert_eq!(loadouts.opponent.hero_type, HeroType::Runekeeper);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn solo_loadout_request_overrides_account_deck_hero_and_runes() {
        let (mut store, path) = test_store("account-overrides");
        let user_id = register_user(&mut store, "loadout-overrides@example.com");
        grant_account_xp(&mut store, user_id, 20_000);
        let deck_id = create_account_deck(
            &mut store,
            user_id,
            HeroType::Pyromancer,
            vec!["vitality".to_string()],
        );

        let loadouts = resolve_solo_match_loadouts(
            &mut store,
            SoloMatchLoadoutRequest {
                user_id: Some(user_id),
                preferred_hero_type: HeroType::Warden,
                requested_hero_type: Some(HeroType::Barbarian),
                player_deck: Some(DeckChoiceRequest::Account { deck_id }),
                legacy_player_deck_id: None,
                requested_rune_ids: Some(Vec::new()),
                ai_opponent: None,
            },
        )
        .expect("loadout should resolve");

        assert_eq!(loadouts.player.hero_type, HeroType::Barbarian);
        assert!(loadouts.player.progression.rune_ids.is_empty());

        let _ = fs::remove_file(path);
    }

    #[test]
    fn solo_loadout_rejects_anonymous_account_deck() {
        let (mut store, path) = test_store("anonymous-account");

        let error = match resolve_solo_match_loadouts(
            &mut store,
            SoloMatchLoadoutRequest {
                user_id: None,
                preferred_hero_type: HeroType::Runekeeper,
                requested_hero_type: None,
                player_deck: Some(DeckChoiceRequest::Account { deck_id: 42 }),
                legacy_player_deck_id: None,
                requested_rune_ids: None,
                ai_opponent: None,
            },
        ) {
            Ok(_) => panic!("anonymous account deck should be rejected"),
            Err(error) => error,
        };

        assert!(matches!(error, LoadoutResolutionError::Unauthorized));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn shared_seat_loadout_resolves_system_deck_and_progression() {
        let (mut store, path) = test_store("shared-system");

        let loadout = resolve_shared_seat_loadout(
            &mut store,
            SharedSeatLoadoutRequest {
                user_id: None,
                hero_type: HeroType::Warden,
                deck_choice: Some(DeckChoiceRequest::System {
                    system_deck_id: "ember-burn".to_string(),
                }),
                legacy_deck_id: None,
                rune_ids: None,
            },
        )
        .expect("shared seat loadout should resolve");

        assert_eq!(loadout.hero_type, HeroType::Warden);
        assert_eq!(loadout.deck_recipe.name, "Ember Burn");
        assert!(loadout.progression.rune_ids.is_empty());

        let _ = fs::remove_file(path);
    }
}
