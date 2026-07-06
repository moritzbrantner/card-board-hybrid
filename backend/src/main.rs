mod card_catalog;
mod deck_library;
mod deck_recipe_legality;
mod identity;
mod match_access;
mod match_commands;
mod match_session;
mod match_store;
mod preferences;
mod progression;

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::body::Bytes;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::{HeaderMap, Method, StatusCode, header};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use card_catalog::{CatalogResponse, starter_catalog};
use deck_library::{
    DeckLibrary, DeckLibraryError, DeckRecipeSnapshot, SaveDeckRequest, starter_deck_snapshot,
    system_deck_by_id, system_deck_response, system_deck_snapshot,
};
use deck_recipe_legality::DeckLegalityPreviewRequest;
use futures_util::StreamExt;
use identity::{
    AccountProfile, BoardVisualMode, CreatedAuthSession, GeneratedAvatar, IdentityError,
    IdentityModule, PublicAccountProfile,
};
use match_access::{Actor, MatchAccess};
use match_commands::{MatchCommandError, MatchCommands};
use match_session::{
    HeroType, MatchActionRequest, MatchMode, MatchState, RecordedReplayFrame, ReplayEvent,
    ReplayVisibility, Side,
};
use match_store::{
    CreatedSharedMatch, MatchStoreError, SharedMatchStatus, SqliteMatchStore, StoredMatch,
    StoredMatchSummary, StoredReplayFrame, StoredSharedMatch,
};
use preferences::{PreferencesError, PreferencesModule, UpdatePreferencesRequest};
use progression::{
    MatchRewardSummary, ProgressionError, ProgressionModule, ProgressionResponse,
    ProgressionSummary, SaveRuneLoadoutRequest,
};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use tokio::time::{self, Duration, Instant};
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};

type SharedState = Arc<AppState>;

struct AppState {
    store: Mutex<SqliteMatchStore>,
    live_matches: Mutex<HashMap<String, broadcast::Sender<()>>>,
}

impl AppState {
    fn match_sender(&self, match_id: &str) -> broadcast::Sender<()> {
        let mut live_matches = self
            .live_matches
            .lock()
            .expect("live match lock should not be poisoned");
        live_matches
            .entry(match_id.to_string())
            .or_insert_with(|| {
                let (sender, _) = broadcast::channel(32);
                sender
            })
            .clone()
    }

    fn notify_match(&self, match_id: &str) {
        let sender = self.match_sender(match_id);
        let _ = sender.send(());
    }
}

#[derive(Serialize)]
struct ApiError {
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthRequest {
    email: String,
    password: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthUserResponse {
    id: i64,
    handle: String,
    email: String,
    display_name: String,
    avatar: GeneratedAvatarResponse,
    preferred_hero_type: HeroType,
    board_visual_mode: BoardVisualMode,
    progression_summary: ProgressionSummary,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthSessionResponse {
    token: String,
    user: AuthUserResponse,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthMessageResponse {
    message: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GeneratedAvatarResponse {
    symbol: String,
    color: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicDeckOwnerResponse {
    id: i64,
    handle: String,
    display_name: String,
    avatar: GeneratedAvatarResponse,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicDeckRecipeResponse {
    owner: PublicDeckOwnerResponse,
    deck: deck_library::DeckRecipeSummary,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateProfileRequest {
    display_name: String,
    handle: String,
    avatar: GeneratedAvatarRequest,
    #[serde(default, alias = "preferredWizardType")]
    preferred_hero_type: Option<HeroType>,
    #[serde(default)]
    board_visual_mode: Option<BoardVisualMode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeneratedAvatarRequest {
    symbol: String,
    color: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateMatchRequest {
    #[serde(default, alias = "wizardType")]
    hero_type: Option<HeroType>,
    #[serde(default)]
    player_deck: Option<DeckChoiceRequest>,
    #[serde(default)]
    player_deck_id: Option<i64>,
    #[serde(default)]
    ai_opponent: Option<AiOpponentRequest>,
    #[serde(default)]
    rune_ids: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(
    tag = "source",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum AiOpponentRequest {
    System {
        system_deck_id: String,
    },
    Account {
        deck_id: i64,
        #[serde(alias = "wizardType")]
        hero_type: HeroType,
    },
}

#[derive(Deserialize)]
#[serde(
    tag = "source",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum DeckChoiceRequest {
    Starter,
    System { system_deck_id: String },
    Account { deck_id: i64 },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JoinSharedMatchRequest {
    #[serde(alias = "wizardType")]
    hero_type: HeroType,
    #[serde(default)]
    deck_choice: Option<DeckChoiceRequest>,
    #[serde(default)]
    deck_recipe_id: Option<i64>,
    #[serde(default)]
    rune_ids: Option<Vec<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MatchResponse {
    match_id: String,
    match_state: MatchState,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    replay_frames: Vec<ReplayFrameResponse>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MatchArchiveResponse {
    matches: Vec<MatchSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MatchSummaryResponse {
    match_id: String,
    summary: MatchSummary,
    viewer: MatchSummaryViewer,
    reward: Option<MatchRewardSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MatchSummaryViewer {
    side: Option<Side>,
    result: ViewerResult,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
enum ViewerResult {
    Victory,
    Defeat,
    Spectator,
}

#[cfg(debug_assertions)]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MatchScenarioListResponse {
    scenarios: Vec<MatchScenarioSummary>,
}

#[cfg(debug_assertions)]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MatchScenarioSummary {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    primary_actions: &'static [&'static str],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MatchSummary {
    match_id: String,
    mode: MatchMode,
    created_at: i64,
    updated_at: i64,
    round: u32,
    phase: match_session::Phase,
    winner: Option<match_session::Side>,
    frame_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MatchReplayResponse {
    match_id: String,
    visibility: ReplayVisibility,
    summary: MatchSummary,
    frames: Vec<ReplayFrameResponse>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReplayFrameResponse {
    frame_index: u32,
    action_index: Option<u32>,
    event: ReplayEvent,
    match_state: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateSharedMatchResponse {
    match_id: String,
    mode: &'static str,
    status: &'static str,
    viewer_side: Side,
    player_seat_url: String,
    invite_seat_url: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SharedMatchResponse {
    match_id: String,
    mode: &'static str,
    status: &'static str,
    viewer_side: Side,
    viewer_hero_type: Option<HeroType>,
    opponent_hero_type: Option<HeroType>,
    viewer_ready: bool,
    opponent_ready: bool,
    active_side: Option<Side>,
    opponent_connected: bool,
    can_claim_forfeit_at: Option<i64>,
    match_state: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum SharedClientMessage {
    Action {
        request_id: String,
        action: MatchActionRequest,
    },
    ClaimForfeit {
        request_id: String,
    },
    Heartbeat,
}

#[derive(Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum SharedServerMessage {
    Snapshot {
        payload: SharedMatchResponse,
    },
    ActionAccepted {
        request_id: String,
        payload: SharedMatchResponse,
    },
    ActionRejected {
        request_id: String,
        message: String,
    },
    PresenceChanged {
        payload: SharedMatchResponse,
    },
    Error {
        message: String,
    },
}

#[tokio::main]
async fn main() {
    let store = SqliteMatchStore::from_environment().expect("match database should open");
    let app = create_app(store);
    serve(app).await;
}

fn create_app(store: SqliteMatchStore) -> Router {
    let state = Arc::new(AppState {
        store: Mutex::new(store),
        live_matches: Mutex::new(HashMap::new()),
    });
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE])
        .allow_headers(Any);

    let static_files = ServeDir::new("frontend/dist")
        .not_found_service(ServeFile::new("frontend/dist/index.html"));

    let router = Router::new()
        .route("/api/health", get(health))
        .route("/api/catalog/cards", get(catalog_cards))
        .route("/api/system-decks", get(system_decks))
        .route("/api/users/{handle}/decks/{deck_id}", get(load_public_deck))
        .route("/api/decks", get(list_decks).post(create_deck))
        .route("/api/decks/legality-preview", post(preview_deck_legality))
        .route(
            "/api/decks/{deck_id}",
            get(load_deck).patch(update_deck).delete(delete_deck),
        )
        .route("/api/decks/{deck_id}/duplicate", post(duplicate_deck))
        .route("/api/auth/register", post(register_account))
        .route("/api/auth/login", post(login_account))
        .route("/api/auth/logout", post(logout_account))
        .route("/api/auth/me", get(current_account))
        .route("/api/profile", get(load_profile).patch(update_profile))
        .route("/api/profile/matches", get(list_profile_matches))
        .route(
            "/api/preferences",
            get(load_preferences).patch(update_preferences),
        )
        .route("/api/progression", get(load_progression))
        .route(
            "/api/progression/heroes/{hero_type}/skills/{node_id}",
            post(unlock_progression_skill),
        )
        .route(
            "/api/progression/heroes/{hero_type}/respec",
            post(respec_progression_hero),
        )
        .route(
            "/api/progression/heroes/{hero_type}/loadout",
            axum::routing::patch(save_progression_loadout),
        )
        .route("/api/matches", get(list_matches).post(create_match))
        .route("/api/matches/{match_id}", get(load_match))
        .route("/api/matches/{match_id}/summary", get(load_match_summary))
        .route("/api/matches/{match_id}/replay", get(load_replay))
        .route("/api/matches/{match_id}/actions", post(apply_match_action))
        .route("/api/shared-matches", post(create_shared_match))
        .route(
            "/api/shared-matches/{match_id}/seats/{seat_token}",
            get(load_shared_match),
        )
        .route(
            "/api/shared-matches/{match_id}/seats/{seat_token}/join",
            post(join_shared_match),
        )
        .route(
            "/api/shared-matches/{match_id}/seats/{seat_token}/summary",
            get(load_shared_match_summary),
        )
        .route(
            "/api/shared-matches/{match_id}/seats/{seat_token}/replay",
            get(load_shared_replay),
        )
        .route(
            "/api/shared-matches/{match_id}/seats/{seat_token}/ws",
            get(shared_match_ws),
        );

    #[cfg(debug_assertions)]
    let router = router
        .route("/api/dev/match-scenarios", get(list_match_scenarios))
        .route(
            "/api/dev/match-scenarios/{scenario_id}/matches",
            post(create_match_scenario),
        );

    router
        .layer(cors)
        .fallback_service(static_files)
        .with_state(state)
}

async fn serve(app: Router) {
    let addr = SocketAddr::from(([127, 0, 0, 1], 4000));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("backend port 4000 should be available");

    println!("backend listening on http://{addr}");
    axum::serve(listener, app).await.expect("server should run");
}

async fn health() -> &'static str {
    "ok"
}

async fn catalog_cards() -> impl IntoResponse {
    Json(CatalogResponse {
        cards: starter_catalog(),
    })
}

async fn system_decks() -> impl IntoResponse {
    Json(system_deck_response())
}

async fn list_decks(State(state): State<SharedState>, headers: HeaderMap) -> impl IntoResponse {
    let profile = match required_profile_from_headers(&state, &headers) {
        Ok(profile) => profile,
        Err(response) => return response,
    };
    let response = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        let mut decks = DeckLibrary::new(store.connection_mut());
        match decks.list_for_user(profile.id) {
            Ok(response) => response,
            Err(error) => return deck_error_response(error),
        }
    };
    Json(response).into_response()
}

async fn create_deck(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(request): Json<SaveDeckRequest>,
) -> impl IntoResponse {
    let profile = match required_profile_from_headers(&state, &headers) {
        Ok(profile) => profile,
        Err(response) => return response,
    };
    let request = default_deck_configuration(request, profile.preferred_hero_type);
    let deck = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        if let Err(response) = validate_deck_configuration(&mut store, profile.id, &request) {
            return response;
        }
        let mut decks = DeckLibrary::new(store.connection_mut());
        match decks.create_for_user(profile.id, request) {
            Ok(deck) => deck,
            Err(error) => return deck_error_response(error),
        }
    };
    Json(deck).into_response()
}

async fn preview_deck_legality(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(request): Json<DeckLegalityPreviewRequest>,
) -> impl IntoResponse {
    if let Err(response) = required_profile_from_headers(&state, &headers) {
        return response;
    }

    Json(deck_recipe_legality::preview_requested_cards(request.cards)).into_response()
}

async fn load_deck(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(deck_id): Path<i64>,
) -> impl IntoResponse {
    let profile = match required_profile_from_headers(&state, &headers) {
        Ok(profile) => profile,
        Err(response) => return response,
    };
    let deck = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        let mut decks = DeckLibrary::new(store.connection_mut());
        match decks.load_for_user(profile.id, deck_id) {
            Ok(Some(deck)) => deck,
            Ok(None) => return deck_not_found_response(),
            Err(error) => return deck_error_response(error),
        }
    };
    Json(deck).into_response()
}

async fn load_public_deck(
    State(state): State<SharedState>,
    Path((handle, deck_id)): Path<(String, i64)>,
) -> impl IntoResponse {
    let response = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        let owner = {
            let identity = IdentityModule::new(store.connection_mut());
            match identity.public_profile_by_handle(&handle) {
                Ok(Some(owner)) => owner,
                Ok(None) => return deck_not_found_response(),
                Err(error) => return identity_error_response(error),
            }
        };
        let decks = DeckLibrary::new(store.connection_mut());
        let deck = match decks.load_public_for_user(owner.id, deck_id) {
            Ok(Some(deck)) => deck,
            Ok(None) => return deck_not_found_response(),
            Err(error) => return deck_error_response(error),
        };
        PublicDeckRecipeResponse {
            owner: PublicDeckOwnerResponse::from(owner),
            deck,
        }
    };

    Json(response).into_response()
}

async fn update_deck(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(deck_id): Path<i64>,
    Json(request): Json<SaveDeckRequest>,
) -> impl IntoResponse {
    let profile = match required_profile_from_headers(&state, &headers) {
        Ok(profile) => profile,
        Err(response) => return response,
    };
    let request = default_deck_configuration(request, profile.preferred_hero_type);
    let deck = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        if let Err(response) = validate_deck_configuration(&mut store, profile.id, &request) {
            return response;
        }
        let mut decks = DeckLibrary::new(store.connection_mut());
        match decks.update_for_user(profile.id, deck_id, request) {
            Ok(Some(deck)) => deck,
            Ok(None) => return deck_not_found_response(),
            Err(error) => return deck_error_response(error),
        }
    };
    Json(deck).into_response()
}

async fn duplicate_deck(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(deck_id): Path<i64>,
) -> impl IntoResponse {
    let profile = match required_profile_from_headers(&state, &headers) {
        Ok(profile) => profile,
        Err(response) => return response,
    };
    let deck = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        let mut decks = DeckLibrary::new(store.connection_mut());
        match decks.duplicate_for_user(profile.id, deck_id) {
            Ok(Some(deck)) => deck,
            Ok(None) => return deck_not_found_response(),
            Err(error) => return deck_error_response(error),
        }
    };
    Json(deck).into_response()
}

async fn delete_deck(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(deck_id): Path<i64>,
) -> impl IntoResponse {
    let profile = match required_profile_from_headers(&state, &headers) {
        Ok(profile) => profile,
        Err(response) => return response,
    };
    let deleted = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        let mut decks = DeckLibrary::new(store.connection_mut());
        match decks.delete_for_user(profile.id, deck_id) {
            Ok(deleted) => deleted,
            Err(error) => return deck_error_response(error),
        }
    };
    if !deleted {
        return deck_not_found_response();
    }
    Json(AuthMessageResponse {
        message: "Deck deleted",
    })
    .into_response()
}

async fn register_account(
    State(state): State<SharedState>,
    Json(request): Json<AuthRequest>,
) -> impl IntoResponse {
    let Some((email, normalized_email)) = identity::normalized_email(&request.email) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiError {
                message: "Enter a valid email address.".to_string(),
            }),
        )
            .into_response();
    };
    if request.password.len() < 8 && !normalized_email.ends_with("@local.dev") {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiError {
                message: "Password must be at least 8 characters.".to_string(),
            }),
        )
            .into_response();
    }

    let session = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        let mut identity = IdentityModule::new(store.connection_mut());
        match identity.register(&email, &normalized_email, &request.password) {
            Ok(Some(session)) => session,
            Ok(None) => {
                return (
                    StatusCode::CONFLICT,
                    Json(ApiError {
                        message: "That email already has an account.".to_string(),
                    }),
                )
                    .into_response();
            }
            Err(error) => return identity_error_response(error),
        }
    };

    Json(AuthSessionResponse::from(session)).into_response()
}

async fn login_account(
    State(state): State<SharedState>,
    Json(request): Json<AuthRequest>,
) -> impl IntoResponse {
    let Some((_, normalized_email)) = identity::normalized_email(&request.email) else {
        return invalid_credentials_response();
    };

    let session = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        let mut identity = IdentityModule::new(store.connection_mut());
        match identity.login(&normalized_email, &request.password) {
            Ok(Some(session)) => session,
            Ok(None) => return invalid_credentials_response(),
            Err(error) => return identity_error_response(error),
        }
    };

    Json(AuthSessionResponse::from(session)).into_response()
}

async fn current_account(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    match required_profile_from_headers(&state, &headers) {
        Ok(user) => Json(AuthUserResponse::from(user)).into_response(),
        Err(response) => response,
    }
}

async fn load_profile(State(state): State<SharedState>, headers: HeaderMap) -> impl IntoResponse {
    match required_profile_from_headers(&state, &headers) {
        Ok(profile) => Json(AuthUserResponse::from(profile)).into_response(),
        Err(response) => response,
    }
}

async fn update_profile(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(request): Json<UpdateProfileRequest>,
) -> impl IntoResponse {
    let profile = match required_profile_from_headers(&state, &headers) {
        Ok(profile) => profile,
        Err(response) => return response,
    };
    let display_name = request.display_name.trim();
    if display_name.is_empty() || display_name.len() > 32 {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiError {
                message: "Display name must be between 1 and 32 characters.".to_string(),
            }),
        )
            .into_response();
    }
    if !generated_avatar_is_valid(&request.avatar) {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiError {
                message: "Choose a valid generated avatar.".to_string(),
            }),
        )
            .into_response();
    }

    let updated = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        let mut identity = IdentityModule::new(store.connection_mut());
        match identity.update_profile(
            profile.id,
            &request.handle,
            display_name,
            GeneratedAvatar {
                symbol: request.avatar.symbol,
                color: request.avatar.color,
            },
            request
                .preferred_hero_type
                .unwrap_or(profile.preferred_hero_type),
            request
                .board_visual_mode
                .unwrap_or(profile.board_visual_mode),
        ) {
            Ok(Some(profile)) => profile,
            Ok(None) => return unauthorized_response(),
            Err(error) => return identity_error_response(error),
        }
    };

    Json(AuthUserResponse::from(updated)).into_response()
}

async fn list_profile_matches(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let profile = match required_profile_from_headers(&state, &headers) {
        Ok(profile) => profile,
        Err(response) => return response,
    };
    let matches = {
        let store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        match MatchAccess::new(&store).list_profile_matches(profile.id) {
            Ok(matches) => matches,
            Err(error) => return store_error_response(error),
        }
    };

    Json(MatchArchiveResponse {
        matches: matches.into_iter().map(MatchSummary::from).collect(),
    })
    .into_response()
}

async fn load_preferences(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let profile = match required_profile_from_headers(&state, &headers) {
        Ok(profile) => profile,
        Err(response) => return response,
    };
    let preferences = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        let preferences = PreferencesModule::new(store.connection_mut());
        match preferences.load_for_user(profile.id) {
            Ok(preferences) => preferences,
            Err(error) => return preferences_error_response(error),
        }
    };
    Json(preferences).into_response()
}

async fn update_preferences(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(request): Json<UpdatePreferencesRequest>,
) -> impl IntoResponse {
    let profile = match required_profile_from_headers(&state, &headers) {
        Ok(profile) => profile,
        Err(response) => return response,
    };
    let preferences = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        let mut preferences = PreferencesModule::new(store.connection_mut());
        match preferences.update_for_user(profile.id, request) {
            Ok(preferences) => preferences,
            Err(error) => return preferences_error_response(error),
        }
    };
    Json(preferences).into_response()
}

async fn load_progression(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let profile = match required_profile_from_headers(&state, &headers) {
        Ok(profile) => profile,
        Err(response) => return response,
    };
    let response = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        let mut progression = ProgressionModule::new(store.connection_mut());
        match progression.load_for_user(profile.id) {
            Ok(response) => response,
            Err(error) => return progression_error_response(error),
        }
    };
    Json(response).into_response()
}

async fn unlock_progression_skill(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path((hero_type, node_id)): Path<(HeroType, String)>,
) -> impl IntoResponse {
    mutate_progression(&state, &headers, |progression, user_id| {
        progression.unlock_skill(user_id, hero_type, &node_id)
    })
}

async fn respec_progression_hero(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(hero_type): Path<HeroType>,
) -> impl IntoResponse {
    mutate_progression(&state, &headers, |progression, user_id| {
        progression.respec_hero(user_id, hero_type)
    })
}

async fn save_progression_loadout(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(hero_type): Path<HeroType>,
    Json(request): Json<SaveRuneLoadoutRequest>,
) -> impl IntoResponse {
    mutate_progression(&state, &headers, |progression, user_id| {
        progression.save_rune_loadout(user_id, hero_type, request)
    })
}

fn mutate_progression(
    state: &SharedState,
    headers: &HeaderMap,
    mutate: impl FnOnce(
        &mut ProgressionModule<'_>,
        i64,
    ) -> Result<ProgressionResponse, ProgressionError>,
) -> axum::response::Response {
    let profile = match required_profile_from_headers(state, headers) {
        Ok(profile) => profile,
        Err(response) => return response,
    };
    let response = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        let mut progression = ProgressionModule::new(store.connection_mut());
        match mutate(&mut progression, profile.id) {
            Ok(response) => response,
            Err(error) => return progression_error_response(error),
        }
    };
    Json(response).into_response()
}

async fn logout_account(State(state): State<SharedState>, headers: HeaderMap) -> impl IntoResponse {
    let Some(token) = bearer_token_from_headers(&headers) else {
        return Json(AuthMessageResponse {
            message: "Signed out",
        })
        .into_response();
    };

    {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        let mut identity = IdentityModule::new(store.connection_mut());
        if let Err(error) = identity.logout(&token) {
            return identity_error_response(error);
        }
    }

    Json(AuthMessageResponse {
        message: "Signed out",
    })
    .into_response()
}

async fn list_matches(State(state): State<SharedState>, headers: HeaderMap) -> impl IntoResponse {
    let profile = match required_profile_from_headers(&state, &headers) {
        Ok(profile) => profile,
        Err(response) => return response,
    };
    let matches = {
        let store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        match store.list_replayable_matches_for_user(profile.id) {
            Ok(matches) => matches,
            Err(error) => return store_error_response(error),
        }
    };

    Json(MatchArchiveResponse {
        matches: matches.into_iter().map(MatchSummary::from).collect(),
    })
    .into_response()
}

async fn create_match(
    State(state): State<SharedState>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let profile = match optional_profile_from_headers(&state, &headers) {
        Ok(profile) => profile,
        Err(response) => return response,
    };
    let request = if body.is_empty() || body.iter().all(|byte| byte.is_ascii_whitespace()) {
        CreateMatchRequest {
            hero_type: None,
            player_deck: None,
            player_deck_id: None,
            ai_opponent: None,
            rune_ids: None,
        }
    } else {
        match serde_json::from_slice::<CreateMatchRequest>(&body) {
            Ok(request) => request,
            Err(error) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(ApiError {
                        message: format!("Invalid match request: {error}"),
                    }),
                )
                    .into_response();
            }
        }
    };

    let created = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        let (player_hero_type, player_snapshot, requested_rune_ids) =
            match resolve_player_loadout_choice(
                &mut store,
                profile.as_ref().map(|profile| profile.id),
                profile
                    .as_ref()
                    .map(|profile| profile.preferred_hero_type)
                    .unwrap_or_default(),
                request.hero_type,
                request.player_deck,
                request.player_deck_id,
                request.rune_ids,
            ) {
                Ok(loadouts) => loadouts,
                Err(response) => return response,
            };
        let (opponent_hero_type, opponent_snapshot) = match resolve_solo_ai_choice(
            &mut store,
            profile.as_ref().map(|profile| profile.id),
            request.ai_opponent,
        ) {
            Ok(loadout) => loadout,
            Err(response) => return response,
        };
        let player_deck = match deck_library::deck_from_snapshot(Side::Player, &player_snapshot) {
            Ok(deck) => deck,
            Err(error) => return deck_error_response(error),
        };
        let opponent_deck =
            match deck_library::deck_from_snapshot(Side::Opponent, &opponent_snapshot) {
                Ok(deck) => deck,
                Err(error) => return deck_error_response(error),
            };
        let player_progression = {
            let mut progression = ProgressionModule::new(store.connection_mut());
            match progression.match_loadout(
                profile.as_ref().map(|profile| profile.id),
                player_hero_type,
                requested_rune_ids,
            ) {
                Ok(loadout) => loadout,
                Err(error) => return progression_error_response(error),
            }
        };
        let result = store.create_match_for_user_with_decks(
            player_hero_type,
            opponent_hero_type,
            player_deck,
            opponent_deck,
            player_progression,
            Default::default(),
            profile.as_ref().map(|profile| profile.id),
        );
        match result {
            Ok(created) => created,
            Err(error) => return store_error_response(error),
        }
    };

    Json(MatchResponse::from(created)).into_response()
}

#[cfg(debug_assertions)]
async fn list_match_scenarios() -> impl IntoResponse {
    let scenarios = match_session::scenarios::match_scenarios()
        .into_iter()
        .map(MatchScenarioSummary::from)
        .collect();

    Json(MatchScenarioListResponse { scenarios }).into_response()
}

#[cfg(debug_assertions)]
async fn create_match_scenario(
    State(state): State<SharedState>,
    Path(scenario_id): Path<String>,
) -> impl IntoResponse {
    let Some(match_state) = match_session::scenarios::build_match_scenario(&scenario_id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiError {
                message: format!("Match scenario {scenario_id} was not found"),
            }),
        )
            .into_response();
    };

    let created = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        match store.create_scenario_match(&scenario_id, match_state) {
            Ok(created) => created,
            Err(error) => return store_error_response(error),
        }
    };

    Json(MatchResponse::from(created)).into_response()
}

async fn create_shared_match(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(_request): Json<CreateMatchRequest>,
) -> impl IntoResponse {
    let profile = match optional_profile_from_headers(&state, &headers) {
        Ok(profile) => profile,
        Err(response) => return response,
    };
    let created = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        match store.create_shared_match(profile.as_ref().map(|profile| profile.id)) {
            Ok(created) => created,
            Err(error) => return store_error_response(error),
        }
    };

    Json(CreateSharedMatchResponse::from(created)).into_response()
}

async fn load_shared_match(
    State(state): State<SharedState>,
    Path((match_id, seat_token)): Path<(String, String)>,
) -> impl IntoResponse {
    let shared = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        if let Err(error) = store.mark_shared_seat_seen(&match_id, &seat_token) {
            return store_error_response(error);
        }
        match store.load_shared_match_for_seat(&match_id, &seat_token) {
            Ok(Some(shared)) => shared,
            Ok(None) => return shared_not_found_response(),
            Err(error) => return store_error_response(error),
        }
    };

    Json(SharedMatchResponse::from(shared)).into_response()
}

async fn join_shared_match(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path((match_id, seat_token)): Path<(String, String)>,
    Json(request): Json<JoinSharedMatchRequest>,
) -> impl IntoResponse {
    let profile = match optional_profile_from_headers(&state, &headers) {
        Ok(profile) => profile,
        Err(response) => return response,
    };
    let shared = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        let deck_recipe = match resolve_shared_deck_choice(
            &mut store,
            profile.as_ref().map(|profile| profile.id),
            request.deck_choice,
            request.deck_recipe_id,
        ) {
            Ok(deck_recipe) => deck_recipe,
            Err(response) => return response,
        };
        let progression_loadout = {
            let mut progression = ProgressionModule::new(store.connection_mut());
            match progression.match_loadout(
                profile.as_ref().map(|profile| profile.id),
                request.hero_type,
                request.rune_ids,
            ) {
                Ok(loadout) => loadout,
                Err(error) => return progression_error_response(error),
            }
        };
        match store.join_shared_match(
            &match_id,
            &seat_token,
            request.hero_type,
            deck_recipe,
            progression_loadout,
            profile.as_ref().map(|profile| profile.id),
        ) {
            Ok(Some(shared)) => shared,
            Ok(None) => return shared_not_found_response(),
            Err(error) => return store_error_response(error),
        }
    };
    state.notify_match(&match_id);

    Json(SharedMatchResponse::from(shared)).into_response()
}

async fn shared_match_ws(
    ws: WebSocketUpgrade,
    State(state): State<SharedState>,
    Path((match_id, seat_token)): Path<(String, String)>,
) -> impl IntoResponse {
    let found = {
        let store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        match store.load_shared_match_for_seat(&match_id, &seat_token) {
            Ok(Some(_)) => true,
            Ok(None) => false,
            Err(error) => return store_error_response(error),
        }
    };
    if !found {
        return shared_not_found_response();
    }

    ws.on_upgrade(move |socket| handle_shared_socket(socket, state, match_id, seat_token))
        .into_response()
}

async fn handle_shared_socket(
    mut socket: WebSocket,
    state: SharedState,
    match_id: String,
    seat_token: String,
) {
    {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        let _ = store.mark_shared_seat_seen(&match_id, &seat_token);
    }

    let sender = state.match_sender(&match_id);
    let mut receiver = sender.subscribe();
    let mut heartbeat_timeout = time::interval(Duration::from_secs(5));
    let mut last_client_message = Instant::now();
    if let Some(message) = shared_snapshot_message(&state, &match_id, &seat_token, false) {
        if send_shared_message(&mut socket, message).await.is_err() {
            return;
        }
    }
    state.notify_match(&match_id);

    loop {
        tokio::select! {
            received = socket.next() => {
                let Some(received) = received else {
                    break;
                };
                let Ok(message) = received else {
                    break;
                };
                last_client_message = Instant::now();
                match message {
                    Message::Text(text) => {
                        handle_shared_client_text(&mut socket, &state, &match_id, &seat_token, &text).await;
                    }
                    Message::Close(_) => break,
                    _ => {}
                }
            }
            _ = heartbeat_timeout.tick() => {
                if last_client_message.elapsed() > Duration::from_secs(45) {
                    break;
                }
            }
            broadcast = receiver.recv() => {
                if broadcast.is_err() {
                    break;
                }
                if let Some(message) = shared_snapshot_message(&state, &match_id, &seat_token, false) {
                    if send_shared_message(&mut socket, message).await.is_err() {
                        break;
                    }
                }
            }
        }
    }

    {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        let _ = store.mark_shared_seat_disconnected(&match_id, &seat_token);
    }
    state.notify_match(&match_id);
}

async fn handle_shared_client_text(
    socket: &mut WebSocket,
    state: &SharedState,
    match_id: &str,
    seat_token: &str,
    text: &str,
) {
    let message = match serde_json::from_str::<SharedClientMessage>(text) {
        Ok(message) => message,
        Err(error) => {
            let _ = send_shared_message(
                socket,
                SharedServerMessage::Error {
                    message: format!("Invalid WebSocket message: {error}"),
                },
            )
            .await;
            return;
        }
    };

    match message {
        SharedClientMessage::Action { request_id, action } => {
            match apply_shared_socket_action(state, match_id, seat_token, action) {
                Ok(payload) => {
                    let _ = send_shared_message(
                        socket,
                        SharedServerMessage::ActionAccepted {
                            request_id,
                            payload,
                        },
                    )
                    .await;
                    state.notify_match(match_id);
                }
                Err(message) => {
                    let _ = send_shared_message(
                        socket,
                        SharedServerMessage::ActionRejected {
                            request_id,
                            message,
                        },
                    )
                    .await;
                }
            }
        }
        SharedClientMessage::ClaimForfeit { request_id } => {
            match claim_shared_forfeit(state, match_id, seat_token) {
                Ok(payload) => {
                    let _ = send_shared_message(
                        socket,
                        SharedServerMessage::ActionAccepted {
                            request_id,
                            payload,
                        },
                    )
                    .await;
                    state.notify_match(match_id);
                }
                Err(message) => {
                    let _ = send_shared_message(
                        socket,
                        SharedServerMessage::ActionRejected {
                            request_id,
                            message,
                        },
                    )
                    .await;
                }
            }
        }
        SharedClientMessage::Heartbeat => {
            let mut store = state
                .store
                .lock()
                .expect("store lock should not be poisoned");
            let _ = store.mark_shared_seat_seen(match_id, seat_token);
        }
    }
}

fn apply_shared_socket_action(
    state: &SharedState,
    match_id: &str,
    seat_token: &str,
    action: MatchActionRequest,
) -> Result<SharedMatchResponse, String> {
    let mut store = state
        .store
        .lock()
        .expect("store lock should not be poisoned");
    MatchCommands::new(&mut store)
        .apply_shared_seat_action(match_id, seat_token, action)
        .map(|applied| SharedMatchResponse::from(applied.shared_match))
        .map_err(|error| error.to_string())
}

fn claim_shared_forfeit(
    state: &SharedState,
    match_id: &str,
    seat_token: &str,
) -> Result<SharedMatchResponse, String> {
    let mut store = state
        .store
        .lock()
        .expect("store lock should not be poisoned");
    MatchCommands::new(&mut store)
        .claim_shared_forfeit(match_id, seat_token, unix_timestamp())
        .map(|applied| SharedMatchResponse::from(applied.shared_match))
        .map_err(|error| error.to_string())
}

fn shared_snapshot_message(
    state: &SharedState,
    match_id: &str,
    seat_token: &str,
    presence: bool,
) -> Option<SharedServerMessage> {
    let shared = {
        let store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        store
            .load_shared_match_for_seat(match_id, seat_token)
            .ok()
            .flatten()
    }?;
    let payload = SharedMatchResponse::from(shared);
    if presence {
        Some(SharedServerMessage::PresenceChanged { payload })
    } else {
        Some(SharedServerMessage::Snapshot { payload })
    }
}

async fn send_shared_message(
    socket: &mut WebSocket,
    message: SharedServerMessage,
) -> Result<(), axum::Error> {
    let text = serde_json::to_string(&message).expect("server message should serialize");
    socket.send(Message::Text(text.into())).await
}

fn unix_timestamp() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

async fn load_match(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(match_id): Path<String>,
) -> impl IntoResponse {
    let profile = match optional_profile_from_headers(&state, &headers) {
        Ok(profile) => profile,
        Err(response) => return response,
    };
    let loaded = {
        let store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        let loaded = match store.load_match(&match_id) {
            Ok(Some(loaded)) => loaded,
            Ok(None) => {
                return match_not_found_response(&match_id);
            }
            Err(error) => return store_error_response(error),
        };
        let actor = Actor::from(profile.as_ref());
        if !MatchAccess::new(&store).can_load_match(&actor, &match_id) {
            return match_not_found_response(&match_id);
        }
        loaded
    };

    Json(MatchResponse::from(loaded)).into_response()
}

async fn load_replay(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(match_id): Path<String>,
) -> impl IntoResponse {
    let profile = match optional_profile_from_headers(&state, &headers) {
        Ok(profile) => profile,
        Err(response) => return response,
    };
    let replay = {
        let store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        let replay = match store.load_replay(&match_id) {
            Ok(Some(replay)) => replay,
            Ok(None) => {
                return replay_not_found_response(&match_id);
            }
            Err(error) => return store_error_response(error),
        };
        let actor = Actor::from(profile.as_ref());
        if !MatchAccess::new(&store).can_load_replay(&actor, &match_id) {
            return replay_not_found_response(&match_id);
        }
        replay
    };

    if replay.summary.state.mode == MatchMode::Shared && replay.summary.state.winner.is_none() {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiError {
                message: format!("Replay for match {match_id} was not found"),
            }),
        )
            .into_response();
    }

    replay_response(replay)
}

async fn load_match_summary(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(match_id): Path<String>,
) -> impl IntoResponse {
    let profile = match optional_profile_from_headers(&state, &headers) {
        Ok(profile) => profile,
        Err(response) => return response,
    };
    let (summary, viewer_side, reward) = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        let replay = match store.load_replay(&match_id) {
            Ok(Some(replay)) => replay,
            Ok(None) => return match_summary_not_found_response(&match_id),
            Err(error) => return store_error_response(error),
        };
        let actor = Actor::from(profile.as_ref());
        if !MatchAccess::new(&store).can_load_replay(&actor, &match_id) {
            return match_summary_not_found_response(&match_id);
        }
        if replay.summary.state.winner.is_none() {
            return match_summary_not_found_response(&match_id);
        }
        let viewer_side = match (replay.summary.state.mode, profile.as_ref()) {
            (MatchMode::Solo, _) => Some(Side::Player),
            (MatchMode::Shared, Some(profile)) => {
                match store.completed_shared_participant_side(&match_id, profile.id) {
                    Ok(side) => side,
                    Err(error) => return store_error_response(error),
                }
            }
            (MatchMode::Shared, None) => None,
        };
        if replay.summary.state.mode == MatchMode::Shared && viewer_side.is_none() {
            return match_summary_not_found_response(&match_id);
        }
        let reward = if let (Some(profile), Some(viewer_side)) = (profile.as_ref(), viewer_side) {
            let progression = ProgressionModule::new(store.connection_mut());
            match progression.match_reward_summary(profile.id, &match_id, viewer_side) {
                Ok(reward) => reward,
                Err(error) => return progression_error_response(error),
            }
        } else {
            None
        };
        (replay.summary, viewer_side, reward)
    };

    let viewer = MatchSummaryViewer {
        side: viewer_side,
        result: viewer_result(viewer_side, summary.state.winner),
    };
    let match_id = summary.id.clone();
    Json(MatchSummaryResponse {
        match_id,
        summary: MatchSummary::from(summary),
        viewer,
        reward,
    })
    .into_response()
}

async fn load_shared_match_summary(
    State(state): State<SharedState>,
    Path((match_id, seat_token)): Path<(String, String)>,
) -> impl IntoResponse {
    let (summary, viewer_side, reward) = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        let shared = match store.load_shared_match_for_seat(&match_id, &seat_token) {
            Ok(Some(shared)) => shared,
            Ok(None) => return match_summary_not_found_response(&match_id),
            Err(error) => return store_error_response(error),
        };
        if shared.status == SharedMatchStatus::Active || shared.status == SharedMatchStatus::Setup {
            return match_summary_not_found_response(&match_id);
        }
        let replay = match store.load_replay(&match_id) {
            Ok(Some(replay)) => replay,
            Ok(None) => return match_summary_not_found_response(&match_id),
            Err(error) => return store_error_response(error),
        };
        if replay.summary.state.winner.is_none() {
            return match_summary_not_found_response(&match_id);
        }
        let viewer_side = shared.viewer_seat.side;
        let reward = if let Some(user_id) = shared.viewer_seat.participant_user_id {
            let progression = ProgressionModule::new(store.connection_mut());
            match progression.match_reward_summary(user_id, &match_id, viewer_side) {
                Ok(reward) => reward,
                Err(error) => return progression_error_response(error),
            }
        } else {
            None
        };
        (replay.summary, viewer_side, reward)
    };

    let viewer = MatchSummaryViewer {
        side: Some(viewer_side),
        result: viewer_result(Some(viewer_side), summary.state.winner),
    };
    let match_id = summary.id.clone();
    Json(MatchSummaryResponse {
        match_id,
        summary: MatchSummary::from(summary),
        viewer,
        reward,
    })
    .into_response()
}

async fn load_shared_replay(
    State(state): State<SharedState>,
    Path((match_id, seat_token)): Path<(String, String)>,
) -> impl IntoResponse {
    let replay = {
        let store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        let shared = match store.load_shared_match_for_seat(&match_id, &seat_token) {
            Ok(Some(shared)) => shared,
            Ok(None) => return replay_not_found_response(&match_id),
            Err(error) => return store_error_response(error),
        };
        if shared.status == SharedMatchStatus::Active || shared.status == SharedMatchStatus::Setup {
            return replay_not_found_response(&match_id);
        }
        let replay = match store.load_replay(&match_id) {
            Ok(Some(replay)) => replay,
            Ok(None) => return replay_not_found_response(&match_id),
            Err(error) => return store_error_response(error),
        };
        if replay.summary.state.winner.is_none() {
            return replay_not_found_response(&match_id);
        }
        replay
    };

    replay_response(replay)
}

fn replay_response(replay: match_store::StoredReplay) -> axum::response::Response {
    let visibility = if replay.summary.state.winner.is_some() {
        ReplayVisibility::Revealed
    } else {
        ReplayVisibility::Public
    };
    let match_id = replay.summary.id.clone();
    let summary = MatchSummary::from(replay.summary);
    let frames = replay
        .frames
        .into_iter()
        .map(|frame| ReplayFrameResponse::from_stored(frame, visibility))
        .collect();

    Json(MatchReplayResponse {
        match_id,
        visibility,
        summary,
        frames,
    })
    .into_response()
}

fn viewer_result(viewer_side: Option<Side>, winner: Option<Side>) -> ViewerResult {
    match (viewer_side, winner) {
        (Some(viewer_side), Some(winner)) if viewer_side == winner => ViewerResult::Victory,
        (Some(_), Some(_)) => ViewerResult::Defeat,
        _ => ViewerResult::Spectator,
    }
}

async fn apply_match_action(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(match_id): Path<String>,
    Json(request): Json<MatchActionRequest>,
) -> impl IntoResponse {
    let profile = match optional_profile_from_headers(&state, &headers) {
        Ok(profile) => profile,
        Err(response) => return response,
    };
    let applied = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        let actor = Actor::from(profile.as_ref());
        match MatchCommands::new(&mut store).apply_solo_action(actor, &match_id, request) {
            Ok(applied) => applied,
            Err(error) => return match_command_error_response(error, &match_id),
        }
    };

    Json(MatchResponse::from_stored_with_replay_frames(
        applied.stored_match,
        applied.replay_frames,
    ))
    .into_response()
}

fn store_error_response(error: MatchStoreError) -> axum::response::Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ApiError {
            message: error.to_string(),
        }),
    )
        .into_response()
}

fn match_command_error_response(
    error: MatchCommandError,
    match_id: &str,
) -> axum::response::Response {
    match error {
        MatchCommandError::NotFound | MatchCommandError::Forbidden => {
            match_not_found_response(match_id)
        }
        MatchCommandError::Rule(error) => (
            StatusCode::BAD_REQUEST,
            Json(ApiError {
                message: error.to_string(),
            }),
        )
            .into_response(),
        MatchCommandError::Store(error) => store_error_response(error),
        error => (
            StatusCode::BAD_REQUEST,
            Json(ApiError {
                message: error.to_string(),
            }),
        )
            .into_response(),
    }
}

fn deck_error_response(error: DeckLibraryError) -> axum::response::Response {
    let status = match error {
        DeckLibraryError::UnknownTemplate(_)
        | DeckLibraryError::NegativeCount(_)
        | DeckLibraryError::EmptyName
        | DeckLibraryError::NameTooLong
        | DeckLibraryError::TooManyDecks
        | DeckLibraryError::IllegalRecipe(_)
        | DeckLibraryError::UnknownSystemDeck(_) => StatusCode::BAD_REQUEST,
        DeckLibraryError::NotFound => StatusCode::NOT_FOUND,
        DeckLibraryError::Sqlite(_) | DeckLibraryError::Snapshot(_) => {
            StatusCode::INTERNAL_SERVER_ERROR
        }
    };
    (
        status,
        Json(ApiError {
            message: error.to_string(),
        }),
    )
        .into_response()
}

fn preferences_error_response(error: PreferencesError) -> axum::response::Response {
    match error {
        PreferencesError::Validation(message) => {
            (StatusCode::BAD_REQUEST, Json(ApiError { message })).into_response()
        }
        other => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiError {
                message: other.to_string(),
            }),
        )
            .into_response(),
    }
}

fn progression_error_response(error: ProgressionError) -> axum::response::Response {
    let status = match error {
        ProgressionError::Sqlite(_) | ProgressionError::Snapshot(_) => {
            StatusCode::INTERNAL_SERVER_ERROR
        }
        ProgressionError::UnknownRune(_)
        | ProgressionError::LockedRune(_)
        | ProgressionError::DuplicateRune(_)
        | ProgressionError::TooManyRunes { .. }
        | ProgressionError::UnknownSkill(_)
        | ProgressionError::SkillAlreadyUnlocked(_)
        | ProgressionError::SkillPrerequisiteMissing(_)
        | ProgressionError::NotEnoughSkillPoints => StatusCode::BAD_REQUEST,
    };
    (
        status,
        Json(ApiError {
            message: error.to_string(),
        }),
    )
        .into_response()
}

fn identity_error_response(error: IdentityError) -> axum::response::Response {
    let status = match error {
        IdentityError::Validation(_) => StatusCode::BAD_REQUEST,
        IdentityError::Sqlite(_) | IdentityError::PasswordHash(_) => {
            StatusCode::INTERNAL_SERVER_ERROR
        }
    };
    (
        status,
        Json(ApiError {
            message: error.to_string(),
        }),
    )
        .into_response()
}

fn invalid_credentials_response() -> axum::response::Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(ApiError {
            message: "Email or password is incorrect.".to_string(),
        }),
    )
        .into_response()
}

fn unauthorized_response() -> axum::response::Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(ApiError {
            message: "Sign in to continue.".to_string(),
        }),
    )
        .into_response()
}

fn match_not_found_response(match_id: &str) -> axum::response::Response {
    (
        StatusCode::NOT_FOUND,
        Json(ApiError {
            message: format!("Match {match_id} was not found"),
        }),
    )
        .into_response()
}

fn replay_not_found_response(match_id: &str) -> axum::response::Response {
    (
        StatusCode::NOT_FOUND,
        Json(ApiError {
            message: format!("Replay for match {match_id} was not found"),
        }),
    )
        .into_response()
}

fn match_summary_not_found_response(match_id: &str) -> axum::response::Response {
    (
        StatusCode::NOT_FOUND,
        Json(ApiError {
            message: format!("Match summary for match {match_id} was not found"),
        }),
    )
        .into_response()
}

fn deck_not_found_response() -> axum::response::Response {
    (
        StatusCode::NOT_FOUND,
        Json(ApiError {
            message: "Deck recipe was not found".to_string(),
        }),
    )
        .into_response()
}

fn shared_not_found_response() -> axum::response::Response {
    (
        StatusCode::NOT_FOUND,
        Json(ApiError {
            message: "Shared match seat was not found".to_string(),
        }),
    )
        .into_response()
}

fn generated_avatar_is_valid(avatar: &GeneratedAvatarRequest) -> bool {
    const SYMBOLS: [&str; 6] = ["sparkles", "shield", "sword", "wand", "rune", "flame"];
    const COLORS: [&str; 6] = ["emerald", "indigo", "rose", "amber", "sky", "slate"];
    SYMBOLS.contains(&avatar.symbol.as_str()) && COLORS.contains(&avatar.color.as_str())
}

#[allow(
    clippy::result_large_err,
    reason = "route helpers return Axum responses directly"
)]
fn default_deck_configuration(
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
fn validate_deck_configuration(
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
fn resolve_player_loadout_choice(
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
fn resolve_solo_ai_choice(
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
fn resolve_shared_deck_choice(
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
fn resolve_optional_account_deck_choice(
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
fn resolve_account_deck_loadout(
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
fn resolve_required_account_deck_choice(
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

fn bearer_token_from_headers(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    value
        .strip_prefix("Bearer ")
        .filter(|token| !token.trim().is_empty())
        .map(str::to_string)
}

#[allow(
    clippy::result_large_err,
    reason = "route helpers return Axum responses directly"
)]
fn optional_profile_from_headers(
    state: &SharedState,
    headers: &HeaderMap,
) -> Result<Option<AccountProfile>, axum::response::Response> {
    let Some(token) = bearer_token_from_headers(headers) else {
        return Ok(None);
    };

    let profile = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        let identity = IdentityModule::new(store.connection_mut());
        match identity.current_profile(&token) {
            Ok(profile) => profile,
            Err(error) => return Err(identity_error_response(error)),
        }
    };

    profile.map(Some).ok_or_else(unauthorized_response)
}

#[allow(
    clippy::result_large_err,
    reason = "route helpers return Axum responses directly"
)]
fn required_profile_from_headers(
    state: &SharedState,
    headers: &HeaderMap,
) -> Result<AccountProfile, axum::response::Response> {
    optional_profile_from_headers(state, headers)?.ok_or_else(unauthorized_response)
}

impl From<AccountProfile> for AuthUserResponse {
    fn from(profile: AccountProfile) -> Self {
        Self {
            id: profile.id,
            handle: profile.public_handle,
            email: profile.email,
            display_name: profile.display_name,
            avatar: GeneratedAvatarResponse {
                symbol: profile.avatar.symbol,
                color: profile.avatar.color,
            },
            preferred_hero_type: profile.preferred_hero_type,
            board_visual_mode: profile.board_visual_mode,
            progression_summary: progression::summary_for_xp(profile.total_xp),
        }
    }
}

impl From<PublicAccountProfile> for PublicDeckOwnerResponse {
    fn from(profile: PublicAccountProfile) -> Self {
        Self {
            id: profile.id,
            handle: profile.public_handle,
            display_name: profile.display_name,
            avatar: GeneratedAvatarResponse {
                symbol: profile.avatar.symbol,
                color: profile.avatar.color,
            },
        }
    }
}

impl From<CreatedAuthSession> for AuthSessionResponse {
    fn from(session: CreatedAuthSession) -> Self {
        Self {
            token: session.token,
            user: AuthUserResponse::from(session.profile),
        }
    }
}

impl From<StoredMatch> for MatchResponse {
    fn from(stored_match: StoredMatch) -> Self {
        Self {
            match_id: stored_match.id,
            match_state: stored_match.state,
            replay_frames: Vec::new(),
        }
    }
}

#[cfg(debug_assertions)]
impl From<match_session::scenarios::MatchScenarioDefinition> for MatchScenarioSummary {
    fn from(scenario: match_session::scenarios::MatchScenarioDefinition) -> Self {
        Self {
            id: scenario.id,
            name: scenario.name,
            description: scenario.description,
            primary_actions: scenario.primary_actions,
        }
    }
}

impl MatchResponse {
    fn from_stored_with_replay_frames(
        stored_match: StoredMatch,
        replay_frames: Vec<RecordedReplayFrame>,
    ) -> Self {
        Self {
            match_id: stored_match.id,
            match_state: stored_match.state,
            replay_frames: replay_frames
                .iter()
                .enumerate()
                .map(|(index, frame)| ReplayFrameResponse::from_recorded(index as u32, frame))
                .collect(),
        }
    }
}

impl From<CreatedSharedMatch> for CreateSharedMatchResponse {
    fn from(created: CreatedSharedMatch) -> Self {
        Self {
            player_seat_url: format!("/match/{}/{}", created.match_id, created.player_token),
            invite_seat_url: format!("/match/{}/{}", created.match_id, created.opponent_token),
            match_id: created.match_id,
            mode: "shared",
            status: "setup",
            viewer_side: Side::Player,
        }
    }
}

impl From<StoredSharedMatch> for SharedMatchResponse {
    fn from(shared: StoredSharedMatch) -> Self {
        let active_side = shared.state.as_ref().and_then(|state| {
            if state.phase == match_session::Phase::MatchOver {
                None
            } else {
                Some(state.active_side)
            }
        });
        let match_state = shared
            .state
            .as_ref()
            .map(|state| state.public_value_for_side(shared.viewer_seat.side));
        let opponent_connected = shared.opposing_seat.joined_at.is_some()
            && shared.opposing_seat.disconnected_at.is_none();
        let can_claim_forfeit_at = if shared.status == SharedMatchStatus::Active {
            shared
                .opposing_seat
                .disconnected_at
                .map(|disconnected_at| disconnected_at + 120)
        } else {
            None
        };

        Self {
            match_id: shared.match_id,
            mode: "shared",
            status: shared.status.as_str(),
            viewer_side: shared.viewer_seat.side,
            viewer_hero_type: shared.viewer_seat.hero_type,
            opponent_hero_type: shared.opposing_seat.hero_type,
            viewer_ready: shared.viewer_seat.joined_at.is_some(),
            opponent_ready: shared.opposing_seat.joined_at.is_some(),
            active_side,
            opponent_connected,
            can_claim_forfeit_at,
            match_state,
        }
    }
}

impl From<StoredMatchSummary> for MatchSummary {
    fn from(summary: StoredMatchSummary) -> Self {
        Self {
            match_id: summary.id,
            mode: summary.state.mode,
            created_at: summary.created_at,
            updated_at: summary.updated_at,
            round: summary.state.round,
            phase: summary.state.phase,
            winner: summary.state.winner,
            frame_count: summary.frame_count,
        }
    }
}

impl ReplayFrameResponse {
    fn from_recorded(frame_index: u32, frame: &RecordedReplayFrame) -> Self {
        Self {
            frame_index,
            action_index: frame.action_index,
            event: frame.event.for_visibility(ReplayVisibility::Public),
            match_state: MatchState::from_snapshot_json(&frame.snapshot_json)
                .expect("recorded replay frame snapshot should deserialize")
                .replay_value(ReplayVisibility::Public),
        }
    }

    fn from_stored(frame: StoredReplayFrame, visibility: ReplayVisibility) -> Self {
        Self {
            frame_index: frame.frame_index,
            action_index: frame.action_index,
            event: frame.event.for_visibility(visibility),
            match_state: frame.state.replay_value(visibility),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use std::env;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tower::ServiceExt;

    fn test_db_path(name: &str) -> PathBuf {
        let mut path = env::temp_dir();
        path.push(format!(
            "rune-lanes-api-{name}-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after epoch")
                .as_nanos()
        ));
        path
    }

    async fn json_request(app: Router, request: Request<Body>) -> (StatusCode, serde_json::Value) {
        let response = app.oneshot(request).await.expect("request should complete");
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body should read");
        let json = serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);
        (status, json)
    }

    async fn post_match_action(
        app: Router,
        match_id: &str,
        action_json: &'static str,
    ) -> (StatusCode, serde_json::Value) {
        json_request(
            app,
            Request::builder()
                .method("POST")
                .uri(format!("/api/matches/{match_id}/actions"))
                .header("content-type", "application/json")
                .body(Body::from(action_json))
                .expect("request should build"),
        )
        .await
    }

    async fn advance_solo_match_to_player_turn(app: Router, match_id: &str) -> serde_json::Value {
        let mut last = serde_json::Value::Null;
        for _ in 0..50 {
            let match_state = &last["matchState"];
            if match_state["activeSide"] == "player"
                && match_state["actionStack"]
                    .as_array()
                    .is_some_and(Vec::is_empty)
            {
                return last;
            }

            let action = if match_state["prioritySide"] == "player" {
                r#"{"type":"passPriority"}"#
            } else {
                r#"{"type":"advanceAi"}"#
            };
            let (status, acted) = post_match_action(app.clone(), match_id, action).await;
            assert_eq!(status, StatusCode::OK);
            last = acted;
        }

        panic!("AI did not return control to the player");
    }

    fn seat_token_from_url(url: &str) -> &str {
        url.rsplit('/')
            .next()
            .expect("seat URL should end in token")
    }

    fn complete_match_by_forfeit(path: &std::path::Path, match_id: &str, winner: Side) {
        let mut store = SqliteMatchStore::new(path).expect("store should reopen");
        let mut stored = store
            .load_match(match_id)
            .expect("match lookup should succeed")
            .expect("match should exist");
        let frames = stored.state.forfeit_recording(winner, 0);
        store
            .save_custom_action_and_replay_frames(
                match_id,
                0,
                r#"{"type":"testForfeit"}"#,
                &stored.state,
                &frames,
            )
            .expect("completed match should save");
    }

    async fn register_test_account(app: Router, email: &str) -> String {
        let (status, body) = json_request(
            app,
            Request::builder()
                .method("POST")
                .uri("/api/auth/register")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"email":"{email}","password":"password123"}}"#
                )))
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        body["token"]
            .as_str()
            .expect("token should exist")
            .to_string()
    }

    fn default_preferences_payload() -> &'static str {
        r#"{"theme":"system","motion":"system","animationSpeed":"normal","boardScale":"normal","boardVisualMode":"3d","hotkeys":[{"commandId":"cursorNorthwest","binding":"Q"},{"commandId":"cursorNortheast","binding":"W"},{"commandId":"cursorEast","binding":"E"},{"commandId":"cursorWest","binding":"A"},{"commandId":"cursorSouthwest","binding":"S"},{"commandId":"cursorSoutheast","binding":"D"},{"commandId":"confirm","binding":"Enter"},{"commandId":"cancel","binding":"Escape"},{"commandId":"endTurn","binding":"T"},{"commandId":"passPriority","binding":"P"},{"commandId":"openCardInfo","binding":"I"},{"commandId":"openSettings","binding":","},{"commandId":"openCatalog","binding":"C"},{"commandId":"openDecks","binding":"K"},{"commandId":"openMatchArchive","binding":"M"}]}"#
    }

    fn custom_preferences_payload() -> &'static str {
        r#"{"theme":"highContrast","motion":"reduced","animationSpeed":"fast","boardScale":"large","boardVisualMode":"2d","hotkeys":[{"commandId":"cursorNorthwest","binding":"U"},{"commandId":"cursorNortheast","binding":"O"},{"commandId":"cursorEast","binding":"L"},{"commandId":"cursorWest","binding":"J"},{"commandId":"cursorSouthwest","binding":"N"},{"commandId":"cursorSoutheast","binding":"B"},{"commandId":"confirm","binding":"Enter"},{"commandId":"cancel","binding":"Escape"},{"commandId":"endTurn","binding":"Y"},{"commandId":"passPriority","binding":"R"},{"commandId":"openCardInfo","binding":"F"},{"commandId":"openSettings","binding":","},{"commandId":"openCatalog","binding":"G"},{"commandId":"openDecks","binding":"H"},{"commandId":"openMatchArchive","binding":"V"}]}"#
    }

    #[tokio::test]
    async fn account_registration_creates_a_session_for_current_user() {
        let path = test_db_path("auth-register");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));

        let token = register_test_account(app.clone(), "player@example.com").await;
        assert!(!token.is_empty());

        let (status, current_user) = json_request(
            app,
            Request::builder()
                .uri("/api/auth/me")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(current_user["email"], "player@example.com");
        assert_eq!(current_user["handle"], "player");
        assert_eq!(current_user["displayName"], "player");
        assert!(current_user["avatar"]["symbol"].as_str().is_some());
        assert!(current_user["avatar"]["color"].as_str().is_some());
        assert_eq!(current_user["preferredHeroType"], "runekeeper");
        assert_eq!(current_user["boardVisualMode"], "3d");
        assert!(current_user["id"].as_i64().unwrap() > 0);

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn signed_out_deck_library_requests_require_an_account() {
        let path = test_db_path("decks-auth");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));

        let (status, body) = json_request(
            app,
            Request::builder()
                .uri("/api/decks")
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body["message"], "Sign in to continue.");

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn signed_out_deck_legality_preview_requires_an_account() {
        let path = test_db_path("decks-preview-auth");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));

        let (status, body) = json_request(
            app,
            Request::builder()
                .method("POST")
                .uri("/api/decks/legality-preview")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"cards":[]}"#))
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body["message"], "Sign in to continue.");

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn signed_out_match_archive_requires_an_account() {
        let path = test_db_path("archive-auth");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));

        let (status, body) = json_request(
            app,
            Request::builder()
                .uri("/api/matches")
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body["message"], "Sign in to continue.");

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn debug_match_scenarios_can_be_listed() {
        let path = test_db_path("dev-scenarios-list");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));

        let (status, body) = json_request(
            app,
            Request::builder()
                .uri("/api/dev/match-scenarios")
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        let scenarios = body["scenarios"]
            .as_array()
            .expect("scenarios should exist");
        assert!(
            scenarios
                .iter()
                .any(|scenario| scenario["id"] == "play-unit-card")
        );
        assert!(
            scenarios
                .iter()
                .any(|scenario| scenario["id"] == "priority-response")
        );

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn debug_match_scenario_creation_returns_a_playable_match() {
        let path = test_db_path("dev-scenario-create");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));

        let (status, created) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/dev/match-scenarios/play-unit-card/matches")
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        let match_id = created["matchId"].as_str().expect("match id should exist");
        assert!(match_id.starts_with("dev-play-unit-card-"));
        assert_eq!(
            created["matchState"]["player"]["hand"][0]["templateId"],
            "ember-squire"
        );

        let (status, loaded) = json_request(
            app.clone(),
            Request::builder()
                .uri(format!("/api/matches/{match_id}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(loaded["matchId"], match_id);

        let (status, acted) = post_match_action(
            app,
            match_id,
            r#"{"type":"playCard","cardId":"scenario-ember-squire","target":{"type":"hex","coord":{"q":0,"r":0}}}"#,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(
            acted["matchState"]["board"]["units"]
                .as_array()
                .expect("units should exist")
                .iter()
                .any(|unit| unit["templateId"] == "ember-squire")
        );

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn unknown_debug_match_scenario_returns_not_found() {
        let path = test_db_path("dev-scenario-missing");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));

        let (status, body) = json_request(
            app,
            Request::builder()
                .method("POST")
                .uri("/api/dev/match-scenarios/missing/matches")
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["message"], "Match scenario missing was not found");

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn debug_match_scenarios_do_not_appear_in_account_archives() {
        let path = test_db_path("dev-scenario-archive");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));

        let (status, _created) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/dev/match-scenarios/play-unit-card/matches")
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);

        let token = register_test_account(app.clone(), "scenario-archive@example.com").await;
        let (status, archive) = json_request(
            app,
            Request::builder()
                .uri("/api/matches")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            archive["matches"]
                .as_array()
                .expect("matches should exist")
                .len(),
            0
        );

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn deck_legality_preview_returns_draft_legality_for_unsaved_counts() {
        let path = test_db_path("decks-preview");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));
        let token = register_test_account(app.clone(), "preview@example.com").await;

        let (status, preview) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/decks/legality-preview")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"cards":[{"templateId":"ember-squire","count":5}]}"#,
                ))
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(preview["legal"], false);
        assert_eq!(preview["totalCards"], 5);
        assert!(
            preview["messages"]
                .as_array()
                .expect("messages should be an array")
                .iter()
                .any(|message| message
                    .as_str()
                    .is_some_and(|message| message.contains("at least 60")))
        );

        let (status, preview) = json_request(
            app,
            Request::builder()
                .method("POST")
                .uri("/api/decks/legality-preview")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"cards":[{"templateId":"missing-card","count":60},{"templateId":"ember-squire","count":-1}]}"#,
                ))
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(preview["legal"], false);
        assert_eq!(preview["totalCards"], 60);
        let messages = preview["messages"]
            .as_array()
            .expect("messages should be an array");
        assert!(messages.iter().any(|message| {
            message
                .as_str()
                .is_some_and(|message| message.contains("not in the card catalog"))
        }));
        assert!(messages.iter().any(|message| {
            message
                .as_str()
                .is_some_and(|message| message.contains("must not be negative"))
        }));

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn deck_library_creates_starter_copy_and_allows_drafts() {
        let path = test_db_path("decks-starter-draft");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));
        let token = register_test_account(app.clone(), "decks@example.com").await;

        let (status, library) = json_request(
            app.clone(),
            Request::builder()
                .uri("/api/decks")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(library["decks"].as_array().unwrap().len(), 1);
        assert_eq!(library["decks"][0]["name"], "Balanced Starter");
        assert_eq!(library["decks"][0]["isDefault"], true);
        assert_eq!(library["decks"][0]["heroType"], "runekeeper");
        assert_eq!(library["decks"][0]["runeIds"].as_array().unwrap().len(), 0);
        assert_eq!(library["decks"][0]["legality"]["legal"], true);

        let (status, draft) = json_request(
            app,
            Request::builder()
                .method("POST")
                .uri("/api/decks")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"name":"Tiny Draft","cards":[{"templateId":"ember-squire","count":1}]}"#,
                ))
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(draft["name"], "Tiny Draft");
        assert_eq!(draft["heroType"], "runekeeper");
        assert_eq!(draft["runeIds"].as_array().unwrap().len(), 0);
        assert_eq!(draft["legality"]["legal"], false);

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn public_deck_url_returns_owner_and_deck_without_auth_or_email() {
        let path = test_db_path("decks-public-read");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));
        let owner_token = register_test_account(app.clone(), "public-owner@example.com").await;
        let _other_token = register_test_account(app.clone(), "other-owner@example.com").await;

        let (status, deck) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/decks")
                .header("authorization", format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"name":"Public Draft","cards":[{"templateId":"ember-squire","count":1}]}"#,
                ))
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let deck_id = deck["id"].as_i64().expect("deck id should exist");

        let (status, public_deck) = json_request(
            app.clone(),
            Request::builder()
                .uri(format!("/api/users/public-owner/decks/{deck_id}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(public_deck["owner"]["handle"], "public-owner");
        assert_eq!(public_deck["owner"]["displayName"], "public-owner");
        assert!(public_deck["owner"].get("email").is_none());
        assert_eq!(public_deck["deck"]["id"], deck_id);
        assert_eq!(public_deck["deck"]["name"], "Public Draft");

        let (status, _body) = json_request(
            app,
            Request::builder()
                .uri(format!("/api/users/other-owner/decks/{deck_id}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn deck_recipes_store_hero_configuration_and_validate_runes() {
        let path = test_db_path("decks-hero-config");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));
        let token = register_test_account(app.clone(), "configured@example.com").await;

        let (status, rejected) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/decks")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"name":"Locked Rune","heroType":"pyromancer","runeIds":["vitality"],"cards":[]}"#,
                ))
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(
            rejected["message"]
                .as_str()
                .expect("message should be a string")
                .contains("not unlocked")
        );

        let (status, created) = json_request(
            app,
            Request::builder()
                .method("POST")
                .uri("/api/decks")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"name":"Configured","heroType":"pyromancer","runeIds":[],"cards":[]}"#,
                ))
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(created["heroType"], "pyromancer");
        assert_eq!(created["runeIds"].as_array().unwrap().len(), 0);

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn deck_save_still_rejects_malformed_card_counts() {
        let path = test_db_path("decks-save-strict");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));
        let token = register_test_account(app.clone(), "strict@example.com").await;

        let (status, body) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/decks")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"name":"Bad Deck","cards":[{"templateId":"missing-card","count":1}]}"#,
                ))
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(
            body["message"]
                .as_str()
                .expect("message should be a string")
                .contains("Unknown card template")
        );

        let (status, body) = json_request(
            app,
            Request::builder()
                .method("POST")
                .uri("/api/decks")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"name":"Negative Deck","cards":[{"templateId":"ember-squire","count":-1}]}"#,
                ))
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(
            body["message"]
                .as_str()
                .expect("message should be a string")
                .contains("must not be negative")
        );

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn match_creation_rejects_illegal_account_deck_and_uses_system_ai_hero() {
        let path = test_db_path("match-deck-selection");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));
        let token = register_test_account(app.clone(), "loadout@example.com").await;

        let (_, draft) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/decks")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"name":"Tiny Draft","cards":[{"templateId":"ember-squire","count":1}]}"#,
                ))
                .expect("request should build"),
        )
        .await;
        let draft_id = draft["id"].as_i64().unwrap();

        let (status, rejected) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/matches")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"heroType":"runekeeper","playerDeckId":{draft_id}}}"#
                )))
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(
            rejected["message"]
                .as_str()
                .expect("message should be a string")
                .contains("not legal")
        );

        let (status, created) = json_request(
            app,
            Request::builder()
                .method("POST")
                .uri("/api/matches")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"heroType":"runekeeper","aiOpponent":{"source":"system","systemDeckId":"ember-burn"}}"#,
                ))
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            created["matchState"]["opponent"]["hero"]["heroType"],
            "pyromancer"
        );

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn signed_out_players_can_start_with_system_loadouts() {
        let path = test_db_path("player-system-loadout");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));

        let (status, created) = json_request(
            app,
            Request::builder()
                .method("POST")
                .uri("/api/matches")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"playerDeck":{"source":"system","systemDeckId":"ember-burn"}}"#,
                ))
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            created["matchState"]["player"]["hero"]["heroType"],
            "pyromancer"
        );

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn profile_can_update_display_name_and_generated_avatar() {
        let path = test_db_path("profile-update");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));
        let token = register_test_account(app.clone(), "profile@example.com").await;

        let (status, updated) = json_request(
            app.clone(),
            Request::builder()
                .method("PATCH")
                .uri("/api/profile")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"displayName":"Rune Pilot","handle":"rune-pilot","avatar":{"symbol":"shield","color":"indigo"},"preferredHeroType":"chronomancer","boardVisualMode":"2d"}"#,
                ))
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(updated["handle"], "rune-pilot");
        assert_eq!(updated["displayName"], "Rune Pilot");
        assert_eq!(updated["avatar"]["symbol"], "shield");
        assert_eq!(updated["avatar"]["color"], "indigo");
        assert_eq!(updated["preferredHeroType"], "chronomancer");
        assert_eq!(updated["boardVisualMode"], "2d");

        let (status, loaded) = json_request(
            app,
            Request::builder()
                .uri("/api/profile")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(loaded["handle"], "rune-pilot");
        assert_eq!(loaded["displayName"], "Rune Pilot");
        assert_eq!(loaded["avatar"]["symbol"], "shield");
        assert_eq!(loaded["avatar"]["color"], "indigo");
        assert_eq!(loaded["preferredHeroType"], "chronomancer");
        assert_eq!(loaded["boardVisualMode"], "2d");

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn profile_rejects_invalid_or_duplicate_public_handles() {
        let path = test_db_path("profile-handle-validation");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));
        let first_token = register_test_account(app.clone(), "first@example.com").await;
        let second_token = register_test_account(app.clone(), "second@example.com").await;

        let (status, body) = json_request(
            app.clone(),
            Request::builder()
                .method("PATCH")
                .uri("/api/profile")
                .header("authorization", format!("Bearer {first_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"displayName":"First","handle":"no","avatar":{"symbol":"wand","color":"sky"},"preferredHeroType":"runekeeper","boardVisualMode":"3d"}"#,
                ))
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(
            body["message"]
                .as_str()
                .expect("message should be a string")
                .contains("Public handle")
        );

        let (status, body) = json_request(
            app,
            Request::builder()
                .method("PATCH")
                .uri("/api/profile")
                .header("authorization", format!("Bearer {second_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"displayName":"Second","handle":"first","avatar":{"symbol":"wand","color":"sky"},"preferredHeroType":"runekeeper","boardVisualMode":"3d"}"#,
                ))
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["message"], "Public handle is already taken.");

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn preferences_return_defaults_for_new_account() {
        let path = test_db_path("preferences-defaults");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));
        let token = register_test_account(app.clone(), "preferences@example.com").await;

        let (status, preferences) = json_request(
            app,
            Request::builder()
                .uri("/api/preferences")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(preferences["theme"], "system");
        assert_eq!(preferences["motion"], "system");
        assert_eq!(preferences["animationSpeed"], "normal");
        assert_eq!(preferences["boardScale"], "normal");
        assert_eq!(preferences["boardVisualMode"], "3d");
        assert_eq!(preferences["updatedAt"], serde_json::Value::Null);
        assert_eq!(preferences["hotkeys"].as_array().unwrap().len(), 15);
        assert_eq!(preferences["hotkeys"][0]["commandId"], "cursorNorthwest");
        assert_eq!(preferences["hotkeys"][0]["binding"], "Q");
        assert_eq!(preferences["hotkeys"][6]["commandId"], "confirm");
        assert_eq!(preferences["hotkeys"][6]["binding"], "Enter");
        assert_eq!(preferences["hotkeys"][7]["commandId"], "cancel");
        assert_eq!(preferences["hotkeys"][7]["binding"], "Escape");

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn preferences_persist_full_normalized_payload_for_account() {
        let path = test_db_path("preferences-persist");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));
        let token = register_test_account(app.clone(), "preferences-save@example.com").await;

        let (status, updated) = json_request(
            app.clone(),
            Request::builder()
                .method("PATCH")
                .uri("/api/preferences")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(custom_preferences_payload()))
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(updated["theme"], "highContrast");
        assert_eq!(updated["motion"], "reduced");
        assert_eq!(updated["animationSpeed"], "fast");
        assert_eq!(updated["boardScale"], "large");
        assert_eq!(updated["boardVisualMode"], "2d");
        assert!(updated["updatedAt"].as_i64().is_some());
        assert_eq!(updated["hotkeys"][0]["commandId"], "cursorNorthwest");
        assert_eq!(updated["hotkeys"][0]["binding"], "U");

        let (status, loaded) = json_request(
            app,
            Request::builder()
                .uri("/api/preferences")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(loaded["theme"], "highContrast");
        assert_eq!(loaded["motion"], "reduced");
        assert_eq!(loaded["animationSpeed"], "fast");
        assert_eq!(loaded["boardScale"], "large");
        assert_eq!(loaded["boardVisualMode"], "2d");
        assert_eq!(loaded["hotkeys"], updated["hotkeys"]);

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn preferences_read_merges_stored_hotkeys_with_current_defaults() {
        let path = test_db_path("preferences-merge");
        {
            let _store = SqliteMatchStore::new(&path).expect("store should migrate");
        }
        {
            let connection = rusqlite::Connection::open(&path).expect("db should reopen");
            connection
                .pragma_update(None, "foreign_keys", "ON")
                .expect("foreign keys should enable");
            connection
                .execute(
                    "
                    INSERT INTO users (
                        id,
                        email,
                        email_normalized,
                        password_hash,
                        display_name,
                        avatar_symbol,
                        avatar_color,
                        preferred_hero_type,
                        board_visual_mode
                    )
                    VALUES (501, 'merge@example.com', 'merge@example.com', 'unused', 'Merge', 'rune', 'sky', 'runekeeper', '3d')
                    ",
                    [],
                )
                .expect("user should seed");
            connection
                .execute(
                    "
                    INSERT INTO auth_sessions (token, user_id, expires_at)
                    VALUES ('merge-token', 501, unixepoch() + 3600)
                    ",
                    [],
                )
                .expect("session should seed");
            connection
                .execute(
                    "
                    INSERT INTO account_preferences (
                        user_id,
                        theme,
                        motion,
                        animation_speed,
                        board_scale,
                        hotkeys_json
                    )
                    VALUES (
                        501,
                        'dark',
                        'full',
                        'slow',
                        'compact',
                        '[{\"commandId\":\"cursorNorthwest\",\"binding\":\"T\"},{\"commandId\":\"endTurn\",\"binding\":\"Y\"},{\"commandId\":\"futureCommand\",\"binding\":\"Z\"}]'
                    )
                    ",
                    [],
                )
                .expect("partial preferences should seed");
        }

        let app = create_app(SqliteMatchStore::new(&path).expect("store should reopen"));
        let (status, preferences) = json_request(
            app,
            Request::builder()
                .uri("/api/preferences")
                .header("authorization", "Bearer merge-token")
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(preferences["theme"], "dark");
        assert_eq!(preferences["motion"], "full");
        assert_eq!(preferences["animationSpeed"], "slow");
        assert_eq!(preferences["boardScale"], "compact");
        assert_eq!(preferences["boardVisualMode"], "3d");
        assert_eq!(preferences["hotkeys"].as_array().unwrap().len(), 15);
        assert_eq!(preferences["hotkeys"][0]["commandId"], "cursorNorthwest");
        assert_eq!(preferences["hotkeys"][0]["binding"], "Q");
        assert_eq!(preferences["hotkeys"][8]["commandId"], "endTurn");
        assert_eq!(preferences["hotkeys"][8]["binding"], "Y");

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn signed_out_preferences_requests_require_an_account() {
        let path = test_db_path("preferences-auth");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));

        let (status, body) = json_request(
            app.clone(),
            Request::builder()
                .uri("/api/preferences")
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body["message"], "Sign in to continue.");

        let (status, body) = json_request(
            app,
            Request::builder()
                .method("PATCH")
                .uri("/api/preferences")
                .header("content-type", "application/json")
                .body(Body::from(default_preferences_payload()))
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body["message"], "Sign in to continue.");

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn preferences_reject_unknown_visual_values() {
        let path = test_db_path("preferences-visual-invalid");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));
        let token = register_test_account(app.clone(), "preferences-visual@example.com").await;

        let (status, _body) = json_request(
            app,
            Request::builder()
                .method("PATCH")
                .uri("/api/preferences")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"theme":"system","motion":"system","animationSpeed":"normal","boardScale":"normal","boardVisualMode":"cinematic","hotkeys":[]}"#,
                ))
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn preferences_load_legacy_profile_board_visual_mode() {
        let path = test_db_path("preferences-legacy-board-mode");
        {
            let _store = SqliteMatchStore::new(&path).expect("store should migrate");
        }
        {
            let connection = rusqlite::Connection::open(&path).expect("db should reopen");
            connection
                .pragma_update(None, "foreign_keys", "ON")
                .expect("foreign keys should enable");
            connection
                .execute(
                    "
                    INSERT INTO users (
                        id,
                        email,
                        email_normalized,
                        password_hash,
                        display_name,
                        avatar_symbol,
                        avatar_color,
                        preferred_hero_type,
                        board_visual_mode
                    )
                    VALUES (502, 'legacy-board@example.com', 'legacy-board@example.com', 'unused', 'Legacy', 'rune', 'sky', 'runekeeper', '2d')
                    ",
                    [],
                )
                .expect("user should seed");
            connection
                .execute(
                    "
                    INSERT INTO auth_sessions (token, user_id, expires_at)
                    VALUES ('legacy-board-token', 502, unixepoch() + 3600)
                    ",
                    [],
                )
                .expect("session should seed");
        }

        let app = create_app(SqliteMatchStore::new(&path).expect("store should reopen"));
        let (status, preferences) = json_request(
            app,
            Request::builder()
                .uri("/api/preferences")
                .header("authorization", "Bearer legacy-board-token")
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(preferences["boardVisualMode"], "2d");

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn legacy_profile_board_visual_mode_updates_sync_preferences() {
        let path = test_db_path("profile-board-mode-sync");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));
        let token = register_test_account(app.clone(), "profile-sync@example.com").await;

        let (status, updated) = json_request(
            app.clone(),
            Request::builder()
                .method("PATCH")
                .uri("/api/profile")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"displayName":"Profile Sync","handle":"profile-sync","avatar":{"symbol":"wand","color":"sky"},"preferredHeroType":"runekeeper","boardVisualMode":"2d"}"#,
                ))
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(updated["boardVisualMode"], "2d");

        let (status, preferences) = json_request(
            app,
            Request::builder()
                .uri("/api/preferences")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(preferences["boardVisualMode"], "2d");

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn preferences_reject_invalid_hotkey_payloads() {
        let path = test_db_path("preferences-hotkey-invalid");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));
        let token = register_test_account(app.clone(), "preferences-hotkeys@example.com").await;

        for (payload, expected_message) in [
            (
                r#"{"theme":"system","motion":"system","animationSpeed":"normal","boardScale":"normal","boardVisualMode":"3d","hotkeys":[{"commandId":"unknown","binding":"Z"}]}"#,
                "Unknown hotkey command",
            ),
            (
                r#"{"theme":"system","motion":"system","animationSpeed":"normal","boardScale":"normal","boardVisualMode":"3d","hotkeys":[{"commandId":"cursorNorthwest","binding":""}]}"#,
                "Hotkey bindings cannot be empty.",
            ),
            (
                r#"{"theme":"system","motion":"system","animationSpeed":"normal","boardScale":"normal","boardVisualMode":"3d","hotkeys":[{"commandId":"cursorNorthwest","binding":"Q"},{"commandId":"cursorNortheast","binding":"Q"},{"commandId":"cursorEast","binding":"E"},{"commandId":"cursorWest","binding":"A"},{"commandId":"cursorSouthwest","binding":"S"},{"commandId":"cursorSoutheast","binding":"D"},{"commandId":"confirm","binding":"Enter"},{"commandId":"cancel","binding":"Escape"},{"commandId":"endTurn","binding":"T"},{"commandId":"passPriority","binding":"P"},{"commandId":"openCardInfo","binding":"I"},{"commandId":"openSettings","binding":","},{"commandId":"openCatalog","binding":"C"},{"commandId":"openDecks","binding":"K"},{"commandId":"openMatchArchive","binding":"M"}]}"#,
                "Duplicate hotkey binding",
            ),
            (
                r#"{"theme":"system","motion":"system","animationSpeed":"normal","boardScale":"normal","boardVisualMode":"3d","hotkeys":[{"commandId":"cursorNorthwest","binding":"Shift+Q"},{"commandId":"cursorNortheast","binding":"W"},{"commandId":"cursorEast","binding":"E"},{"commandId":"cursorWest","binding":"A"},{"commandId":"cursorSouthwest","binding":"S"},{"commandId":"cursorSoutheast","binding":"D"},{"commandId":"confirm","binding":"Enter"},{"commandId":"cancel","binding":"Escape"},{"commandId":"endTurn","binding":"T"},{"commandId":"passPriority","binding":"P"},{"commandId":"openCardInfo","binding":"I"},{"commandId":"openSettings","binding":","},{"commandId":"openCatalog","binding":"C"},{"commandId":"openDecks","binding":"K"},{"commandId":"openMatchArchive","binding":"M"}]}"#,
                "Malformed hotkey binding",
            ),
            (
                r#"{"theme":"system","motion":"system","animationSpeed":"normal","boardScale":"normal","boardVisualMode":"3d","hotkeys":[{"commandId":"cursorNorthwest","binding":"Escape"},{"commandId":"cursorNortheast","binding":"W"},{"commandId":"cursorEast","binding":"E"},{"commandId":"cursorWest","binding":"A"},{"commandId":"cursorSouthwest","binding":"S"},{"commandId":"cursorSoutheast","binding":"D"},{"commandId":"confirm","binding":"Enter"},{"commandId":"cancel","binding":"Q"},{"commandId":"endTurn","binding":"T"},{"commandId":"passPriority","binding":"P"},{"commandId":"openCardInfo","binding":"I"},{"commandId":"openSettings","binding":","},{"commandId":"openCatalog","binding":"C"},{"commandId":"openDecks","binding":"K"},{"commandId":"openMatchArchive","binding":"M"}]}"#,
                "reserved",
            ),
        ] {
            let (status, body) = json_request(
                app.clone(),
                Request::builder()
                    .method("PATCH")
                    .uri("/api/preferences")
                    .header("authorization", format!("Bearer {token}"))
                    .header("content-type", "application/json")
                    .body(Body::from(payload))
                    .expect("request should build"),
            )
            .await;

            assert_eq!(status, StatusCode::BAD_REQUEST);
            assert!(
                body["message"]
                    .as_str()
                    .expect("message should be a string")
                    .contains(expected_message)
            );
        }

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn account_deletion_removes_preferences() {
        let path = test_db_path("preferences-cascade");
        {
            let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));
            let token = register_test_account(app.clone(), "preferences-delete@example.com").await;

            let (status, _) = json_request(
                app,
                Request::builder()
                    .method("PATCH")
                    .uri("/api/preferences")
                    .header("authorization", format!("Bearer {token}"))
                    .header("content-type", "application/json")
                    .body(Body::from(custom_preferences_payload()))
                    .expect("request should build"),
            )
            .await;
            assert_eq!(status, StatusCode::OK);
        }

        let connection = rusqlite::Connection::open(&path).expect("db should reopen");
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .expect("foreign keys should enable");
        let user_id: i64 = connection
            .query_row(
                "SELECT id FROM users WHERE email_normalized = 'preferences-delete@example.com'",
                [],
                |row| row.get(0),
            )
            .expect("user should exist");

        connection
            .execute("DELETE FROM users WHERE id = ?1", [user_id])
            .expect("user should delete");
        let preferences_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM account_preferences WHERE user_id = ?1",
                [user_id],
                |row| row.get(0),
            )
            .expect("preferences count should load");

        assert_eq!(preferences_count, 0);

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn existing_profiles_migrate_to_default_board_visual_mode() {
        let path = test_db_path("profile-board-mode-migration");
        {
            let connection = rusqlite::Connection::open(&path).expect("db should open");
            connection
                .execute_batch(
                    "
                    CREATE TABLE users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        email TEXT NOT NULL,
                        email_normalized TEXT NOT NULL UNIQUE,
                        password_hash TEXT NOT NULL,
                        display_name TEXT NOT NULL DEFAULT '',
                        avatar_symbol TEXT NOT NULL DEFAULT 'sparkles',
                        avatar_color TEXT NOT NULL DEFAULT 'emerald',
                        preferred_hero_type TEXT NOT NULL DEFAULT 'runekeeper',
                        created_at INTEGER NOT NULL DEFAULT (unixepoch())
                    );
                    INSERT INTO users (
                        email,
                        email_normalized,
                        password_hash,
                        display_name,
                        avatar_symbol,
                        avatar_color,
                        preferred_hero_type
                    )
                    VALUES (
                        'migrated@example.com',
                        'migrated@example.com',
                        'unused',
                        'Migrated',
                        'rune',
                        'sky',
                        'warden'
                    );
                    ",
                )
                .expect("old users table should seed");
        }

        let _store = SqliteMatchStore::new(&path).expect("store should migrate");
        let connection = rusqlite::Connection::open(&path).expect("db should reopen");
        let board_visual_mode: String = connection
            .query_row(
                "SELECT board_visual_mode FROM users WHERE email_normalized = 'migrated@example.com'",
                [],
                |row| row.get(0),
            )
            .expect("migrated user should load");
        let public_handle: String = connection
            .query_row(
                "SELECT public_handle FROM users WHERE email_normalized = 'migrated@example.com'",
                [],
                |row| row.get(0),
            )
            .expect("migrated public handle should load");

        assert_eq!(board_visual_mode, "3d");
        assert_eq!(public_handle, "migrated");

        let _ = fs::remove_file(path);
    }

    #[test]
    fn hero_migration_preserves_durable_data_and_discards_legacy_matches() {
        let path = test_db_path("hero-migration");
        {
            let connection = rusqlite::Connection::open(&path).expect("database should open");
            connection
                .execute_batch(
                    r#"
                    CREATE TABLE users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        email TEXT NOT NULL,
                        email_normalized TEXT NOT NULL UNIQUE,
                        public_handle TEXT UNIQUE,
                        password_hash TEXT NOT NULL,
                        display_name TEXT NOT NULL DEFAULT '',
                        avatar_symbol TEXT NOT NULL DEFAULT 'sparkles',
                        avatar_color TEXT NOT NULL DEFAULT 'emerald',
                        preferred_wizard_type TEXT NOT NULL DEFAULT 'runekeeper',
                        board_visual_mode TEXT NOT NULL DEFAULT '3d',
                        total_xp INTEGER NOT NULL DEFAULT 0,
                        created_at INTEGER NOT NULL DEFAULT (unixepoch())
                    );
                    INSERT INTO users (id, email, email_normalized, public_handle, password_hash, display_name, preferred_wizard_type)
                    VALUES (1, 'hero@example.com', 'hero@example.com', 'hero', 'hash', 'Hero', 'pyromancer');

                    CREATE TABLE deck_recipes (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        name TEXT NOT NULL,
                        is_default INTEGER NOT NULL DEFAULT 0,
                        wizard_type TEXT NOT NULL DEFAULT 'runekeeper',
                        rune_ids_json TEXT NOT NULL DEFAULT '[]',
                        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
                        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
                    );
                    INSERT INTO deck_recipes (id, user_id, name, wizard_type, rune_ids_json)
                    VALUES (10, 1, 'Legacy Deck', 'chronomancer', '["force"]');
                    CREATE TABLE deck_recipe_cards (
                        deck_id INTEGER NOT NULL,
                        template_id TEXT NOT NULL,
                        count INTEGER NOT NULL,
                        PRIMARY KEY (deck_id, template_id)
                    );

                    CREATE TABLE wizard_mastery (
                        user_id INTEGER NOT NULL,
                        wizard_type TEXT NOT NULL,
                        xp INTEGER NOT NULL DEFAULT 0,
                        PRIMARY KEY (user_id, wizard_type)
                    );
                    INSERT INTO wizard_mastery (user_id, wizard_type, xp) VALUES (1, 'pyromancer', 300);
                    CREATE TABLE wizard_skill_unlocks (
                        user_id INTEGER NOT NULL,
                        wizard_type TEXT NOT NULL,
                        node_id TEXT NOT NULL,
                        unlocked_at INTEGER NOT NULL,
                        PRIMARY KEY (user_id, wizard_type, node_id)
                    );
                    INSERT INTO wizard_skill_unlocks (user_id, wizard_type, node_id, unlocked_at)
                    VALUES (1, 'pyromancer', 'pyromancer-heated-focus', 123);
                    CREATE TABLE wizard_rune_loadouts (
                        user_id INTEGER NOT NULL,
                        wizard_type TEXT NOT NULL,
                        rune_ids_json TEXT NOT NULL,
                        updated_at INTEGER NOT NULL,
                        PRIMARY KEY (user_id, wizard_type)
                    );
                    INSERT INTO wizard_rune_loadouts (user_id, wizard_type, rune_ids_json, updated_at)
                    VALUES (1, 'pyromancer', '["vitality"]', 456);
                    CREATE TABLE match_xp_awards (
                        match_id TEXT NOT NULL,
                        user_id INTEGER NOT NULL,
                        account_xp INTEGER NOT NULL,
                        wizard_type TEXT NOT NULL,
                        wizard_xp INTEGER NOT NULL,
                        won INTEGER NOT NULL,
                        awarded_at INTEGER NOT NULL,
                        PRIMARY KEY (match_id, user_id)
                    );
                    INSERT INTO match_xp_awards (match_id, user_id, account_xp, wizard_type, wizard_xp, won, awarded_at)
                    VALUES ('legacy-match', 1, 150, 'pyromancer', 150, 1, 789);

                    CREATE TABLE matches (
                        id TEXT PRIMARY KEY NOT NULL,
                        snapshot_json TEXT NOT NULL,
                        initial_snapshot_json TEXT,
                        completed_at INTEGER,
                        mode TEXT NOT NULL DEFAULT 'solo',
                        owner_user_id INTEGER,
                        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
                        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
                    );
                    INSERT INTO matches (id, snapshot_json, initial_snapshot_json)
                    VALUES ('legacy-match', '{"player":{"wizard":{"id":"player-wizard","wizardType":"pyromancer"}}}', '{}');
                    CREATE TABLE match_actions (
                        match_id TEXT NOT NULL,
                        action_index INTEGER NOT NULL,
                        request_json TEXT NOT NULL,
                        accepted_at INTEGER NOT NULL,
                        PRIMARY KEY (match_id, action_index)
                    );
                    INSERT INTO match_actions (match_id, action_index, request_json, accepted_at)
                    VALUES ('legacy-match', 1, '{"pieceId":"player-wizard"}', 1);
                    CREATE TABLE match_replay_frames (
                        match_id TEXT NOT NULL,
                        frame_index INTEGER NOT NULL,
                        action_index INTEGER,
                        event_json TEXT NOT NULL,
                        snapshot_json TEXT NOT NULL,
                        created_at INTEGER NOT NULL,
                        PRIMARY KEY (match_id, frame_index)
                    );
                    INSERT INTO match_replay_frames (match_id, frame_index, event_json, snapshot_json, created_at)
                    VALUES ('legacy-match', 0, '{"type":"matchCreated"}', '{"player":{"wizard":{}}}', 1);
                    CREATE TABLE shared_matches (
                        match_id TEXT PRIMARY KEY NOT NULL,
                        status TEXT NOT NULL,
                        creator_user_id INTEGER,
                        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
                        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
                        forfeit_winner TEXT
                    );
                    INSERT INTO shared_matches (match_id, status) VALUES ('legacy-match', 'setup');
                    CREATE TABLE match_seats (
                        match_id TEXT NOT NULL,
                        side TEXT NOT NULL,
                        seat_token TEXT NOT NULL UNIQUE,
                        wizard_type TEXT,
                        joined_at INTEGER,
                        last_seen_at INTEGER,
                        disconnected_at INTEGER,
                        deck_recipe_name TEXT,
                        deck_recipe_snapshot_json TEXT,
                        progression_loadout_json TEXT,
                        PRIMARY KEY (match_id, side)
                    );
                    INSERT INTO match_seats (match_id, side, seat_token, wizard_type)
                    VALUES ('legacy-match', 'player', 'seat', 'pyromancer');
                    "#,
                )
                .expect("legacy schema should seed");
        }

        let mut store = SqliteMatchStore::new(&path).expect("migration should succeed");
        let connection = store.connection_mut();

        let preferred_hero_type: String = connection
            .query_row(
                "SELECT preferred_hero_type FROM users WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .expect("preferred hero should migrate");
        assert_eq!(preferred_hero_type, "pyromancer");
        let deck_hero_type: String = connection
            .query_row(
                "SELECT hero_type FROM deck_recipes WHERE id = 10",
                [],
                |row| row.get(0),
            )
            .expect("deck hero should migrate");
        assert_eq!(deck_hero_type, "chronomancer");
        let mastery_xp: i64 = connection
            .query_row(
                "SELECT xp FROM hero_mastery WHERE user_id = 1 AND hero_type = 'pyromancer'",
                [],
                |row| row.get(0),
            )
            .expect("hero mastery should migrate");
        assert_eq!(mastery_xp, 300);
        let unlocked_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM hero_skill_unlocks", [], |row| {
                row.get(0)
            })
            .expect("hero skill unlocks should migrate");
        assert_eq!(unlocked_count, 1);
        let rune_ids_json: String = connection
            .query_row(
                "SELECT rune_ids_json FROM hero_rune_loadouts WHERE user_id = 1 AND hero_type = 'pyromancer'",
                [],
                |row| row.get(0),
            )
            .expect("hero rune loadout should migrate");
        assert_eq!(rune_ids_json, "[\"vitality\"]");
        let award_hero_type: String = connection
            .query_row(
                "SELECT hero_type FROM match_xp_awards WHERE match_id = 'legacy-match'",
                [],
                |row| row.get(0),
            )
            .expect("match award hero type should migrate");
        assert_eq!(award_hero_type, "pyromancer");

        for table in [
            "matches",
            "match_actions",
            "match_replay_frames",
            "shared_matches",
            "match_seats",
        ] {
            let count: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .expect("table should be queryable");
            assert_eq!(count, 0, "{table} should be discarded");
        }

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn profile_rejects_unknown_generated_avatar_values() {
        let path = test_db_path("profile-avatar-invalid");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));
        let token = register_test_account(app.clone(), "avatar@example.com").await;

        let (status, body) = json_request(
            app,
            Request::builder()
                .method("PATCH")
                .uri("/api/profile")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"displayName":"Avatar","handle":"avatar","avatar":{"symbol":"dragon","color":"void"},"preferredHeroType":"runekeeper"}"#,
                ))
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["message"], "Choose a valid generated avatar.");

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn profile_rejects_unknown_preferred_hero_type() {
        let path = test_db_path("profile-hero-invalid");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));
        let token = register_test_account(app.clone(), "hero-invalid@example.com").await;

        let (status, _body) = json_request(
            app,
            Request::builder()
                .method("PATCH")
                .uri("/api/profile")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"displayName":"Avatar","handle":"avatar","avatar":{"symbol":"wand","color":"sky"},"preferredHeroType":"stormcaller"}"#,
                ))
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn profile_rejects_unknown_board_visual_mode() {
        let path = test_db_path("profile-board-mode-invalid");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));
        let token = register_test_account(app.clone(), "board-invalid@example.com").await;

        let (status, _body) = json_request(
            app,
            Request::builder()
                .method("PATCH")
                .uri("/api/profile")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"displayName":"Avatar","handle":"avatar","avatar":{"symbol":"wand","color":"sky"},"preferredHeroType":"runekeeper","boardVisualMode":"cinematic"}"#,
                ))
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn signed_in_match_archive_only_lists_that_users_matches() {
        let path = test_db_path("auth-archive-scope");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));

        let first_token = register_test_account(app.clone(), "first@example.com").await;
        let second_token = register_test_account(app.clone(), "second@example.com").await;

        let (_, first_match) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/matches")
                .header("authorization", format!("Bearer {first_token}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        let first_match_id = first_match["matchId"].as_str().unwrap().to_string();

        let (_, second_match) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/matches")
                .header("authorization", format!("Bearer {second_token}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        let second_match_id = second_match["matchId"].as_str().unwrap().to_string();

        let (status, first_archive) = json_request(
            app.clone(),
            Request::builder()
                .uri("/api/matches")
                .header("authorization", format!("Bearer {first_token}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(first_archive["matches"].as_array().unwrap().len(), 1);
        assert_eq!(first_archive["matches"][0]["matchId"], first_match_id);

        let (status, second_load_from_first_user) = json_request(
            app,
            Request::builder()
                .uri(format!("/api/matches/{second_match_id}"))
                .header("authorization", format!("Bearer {first_token}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(
            second_load_from_first_user["message"],
            format!("Match {second_match_id} was not found")
        );

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn profile_matches_list_owned_solo_matches_only() {
        let path = test_db_path("profile-solo-history");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));

        let first_token = register_test_account(app.clone(), "history-first@example.com").await;
        let second_token = register_test_account(app.clone(), "history-second@example.com").await;

        let (_, first_match) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/matches")
                .header("authorization", format!("Bearer {first_token}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        let first_match_id = first_match["matchId"].as_str().unwrap().to_string();

        let _ = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/matches")
                .header("authorization", format!("Bearer {second_token}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;

        let (status, profile_matches) = json_request(
            app,
            Request::builder()
                .uri("/api/profile/matches")
                .header("authorization", format!("Bearer {first_token}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(profile_matches["matches"].as_array().unwrap().len(), 1);
        assert_eq!(profile_matches["matches"][0]["matchId"], first_match_id);

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn profile_matches_include_completed_shared_matches_joined_by_account() {
        let path = test_db_path("profile-shared-history");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));
        let token = register_test_account(app.clone(), "shared-creator@example.com").await;

        let (_, created) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/shared-matches")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"heroType":"chronomancer"}"#))
                .expect("request should build"),
        )
        .await;
        let match_id = created["matchId"].as_str().expect("match id should exist");
        let player_token = seat_token_from_url(
            created["playerSeatUrl"]
                .as_str()
                .expect("player URL exists"),
        );
        let opponent_token = seat_token_from_url(
            created["inviteSeatUrl"]
                .as_str()
                .expect("invite URL exists"),
        );

        let _ = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/api/shared-matches/{match_id}/seats/{opponent_token}/join"
                ))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"heroType":"pyromancer"}"#))
                .expect("request should build"),
        )
        .await;
        let _ = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/api/shared-matches/{match_id}/seats/{player_token}/join"
                ))
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"heroType":"chronomancer"}"#))
                .expect("request should build"),
        )
        .await;

        let connection = rusqlite::Connection::open(&path).expect("test database should open");
        connection
            .execute(
                "UPDATE shared_matches SET status = 'completed' WHERE match_id = ?1",
                rusqlite::params![match_id],
            )
            .expect("shared match should be markable complete");

        let (status, profile_matches) = json_request(
            app,
            Request::builder()
                .uri("/api/profile/matches")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(profile_matches["matches"].as_array().unwrap().len(), 1);
        assert_eq!(profile_matches["matches"][0]["matchId"], match_id);

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn create_match_persists_and_can_be_loaded_by_id() {
        let path = test_db_path("create-load");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));

        let (status, created) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/matches")
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let match_id = created["matchId"].as_str().expect("match id should exist");
        assert!(match_id.starts_with("rl-"));
        assert_eq!(created["matchState"]["round"], 1);

        let (status, loaded) = json_request(
            app,
            Request::builder()
                .uri(format!("/api/matches/{match_id}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(loaded["matchId"], match_id);
        assert_eq!(
            loaded["matchState"]["player"]["hand"]
                .as_array()
                .unwrap()
                .len(),
            4
        );
        assert!(loaded["matchState"]["opponent"].get("hand").is_none());
        assert!(path.exists());

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn create_match_accepts_player_hero_type() {
        let path = test_db_path("create-hero-type");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));

        let (status, created) = json_request(
            app,
            Request::builder()
                .method("POST")
                .uri("/api/matches")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"heroType":"chronomancer"}"#))
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            created["matchState"]["player"]["hero"]["heroType"],
            "chronomancer"
        );
        assert_eq!(created["matchState"]["player"]["hero"]["maxAp"], 4);
        assert_eq!(created["matchState"]["player"]["hero"]["maxHp"], 16);
        assert_eq!(
            created["matchState"]["opponent"]["hero"]["heroType"],
            "runekeeper"
        );

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn create_match_initializes_archive_and_replay_frame() {
        let path = test_db_path("archive-replay");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));
        let token = register_test_account(app.clone(), "archive-replay@example.com").await;

        let (status, created) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/matches")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let match_id = created["matchId"].as_str().expect("match id should exist");

        let (status, archive) = json_request(
            app.clone(),
            Request::builder()
                .uri("/api/matches")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(archive["matches"][0]["matchId"], match_id);
        assert_eq!(archive["matches"][0]["frameCount"], 1);

        let (status, replay) = json_request(
            app.clone(),
            Request::builder()
                .uri(format!("/api/matches/{match_id}/replay"))
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(replay["visibility"], "public");
        assert_eq!(replay["frames"][0]["frameIndex"], 0);
        assert_eq!(replay["frames"][0]["event"]["type"], "matchCreated");

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn completed_match_summary_includes_viewer_reward_unlocks() {
        let path = test_db_path("match-summary-reward");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));
        let token = register_test_account(app.clone(), "summary-reward@example.com").await;

        let (status, created) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/matches")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"heroType":"pyromancer"}"#))
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let match_id = created["matchId"].as_str().expect("match id should exist");
        complete_match_by_forfeit(&path, match_id, Side::Player);

        let (status, summary) = json_request(
            app,
            Request::builder()
                .uri(format!("/api/matches/{match_id}/summary"))
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(summary["matchId"], match_id);
        assert_eq!(summary["summary"]["mode"], "solo");
        assert_eq!(summary["viewer"]["side"], "player");
        assert_eq!(summary["viewer"]["result"], "victory");
        assert_eq!(summary["reward"]["accountXpGained"], 150);
        assert_eq!(summary["reward"]["heroXpGained"], 150);
        assert_eq!(summary["reward"]["winBonusXp"], 50);
        assert_eq!(summary["reward"]["account"]["before"]["level"], 1);
        assert_eq!(summary["reward"]["account"]["after"]["level"], 2);
        assert!(
            summary["reward"]["unlocks"]
                .as_array()
                .unwrap()
                .iter()
                .any(|unlock| unlock["type"] == "runeUnlocked" && unlock["runeId"] == "vitality")
        );
        assert!(
            summary["reward"]["unlocks"]
                .as_array()
                .unwrap()
                .iter()
                .any(|unlock| unlock["type"] == "skillPointUnlocked")
        );

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn completed_shared_seat_links_can_load_summary_and_replay() {
        let path = test_db_path("shared-summary-replay");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));

        let (status, created) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/shared-matches")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"heroType":"chronomancer"}"#))
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let match_id = created["matchId"].as_str().expect("match id should exist");
        let player_token = seat_token_from_url(
            created["playerSeatUrl"]
                .as_str()
                .expect("player URL exists"),
        );
        let opponent_token = seat_token_from_url(
            created["inviteSeatUrl"]
                .as_str()
                .expect("invite URL exists"),
        );

        for (token, hero_type) in [(player_token, "pyromancer"), (opponent_token, "warden")] {
            let (status, _) = json_request(
                app.clone(),
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/shared-matches/{match_id}/seats/{token}/join"))
                    .header("content-type", "application/json")
                    .body(Body::from(format!(r#"{{"heroType":"{hero_type}"}}"#)))
                    .expect("request should build"),
            )
            .await;
            assert_eq!(status, StatusCode::OK);
        }

        complete_match_by_forfeit(&path, match_id, Side::Opponent);

        let (status, player_summary) = json_request(
            app.clone(),
            Request::builder()
                .uri(format!(
                    "/api/shared-matches/{match_id}/seats/{player_token}/summary"
                ))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(player_summary["summary"]["mode"], "shared");
        assert_eq!(player_summary["viewer"]["side"], "player");
        assert_eq!(player_summary["viewer"]["result"], "defeat");
        assert!(player_summary["reward"].is_null());

        let (status, opponent_summary) = json_request(
            app.clone(),
            Request::builder()
                .uri(format!(
                    "/api/shared-matches/{match_id}/seats/{opponent_token}/summary"
                ))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(opponent_summary["viewer"]["side"], "opponent");
        assert_eq!(opponent_summary["viewer"]["result"], "victory");

        let (status, replay) = json_request(
            app,
            Request::builder()
                .uri(format!(
                    "/api/shared-matches/{match_id}/seats/{opponent_token}/replay"
                ))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(replay["visibility"], "revealed");
        assert_eq!(replay["summary"]["winner"], "opponent");

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn completed_shared_account_participant_can_load_summary_from_match_route() {
        let path = test_db_path("shared-account-summary");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));
        let player_auth = register_test_account(app.clone(), "shared-player@example.com").await;
        let opponent_auth = register_test_account(app.clone(), "shared-opponent@example.com").await;

        let (status, created) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/shared-matches")
                .header("authorization", format!("Bearer {player_auth}"))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"heroType":"chronomancer"}"#))
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let match_id = created["matchId"].as_str().expect("match id should exist");
        let player_token = seat_token_from_url(
            created["playerSeatUrl"]
                .as_str()
                .expect("player URL exists"),
        );
        let opponent_token = seat_token_from_url(
            created["inviteSeatUrl"]
                .as_str()
                .expect("invite URL exists"),
        );

        for (token, auth, hero_type) in [
            (player_token, &player_auth, "pyromancer"),
            (opponent_token, &opponent_auth, "warden"),
        ] {
            let (status, _) = json_request(
                app.clone(),
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/shared-matches/{match_id}/seats/{token}/join"))
                    .header("authorization", format!("Bearer {auth}"))
                    .header("content-type", "application/json")
                    .body(Body::from(format!(r#"{{"heroType":"{hero_type}"}}"#)))
                    .expect("request should build"),
            )
            .await;
            assert_eq!(status, StatusCode::OK);
        }

        complete_match_by_forfeit(&path, match_id, Side::Opponent);

        let (status, summary) = json_request(
            app.clone(),
            Request::builder()
                .uri(format!("/api/matches/{match_id}/summary"))
                .header("authorization", format!("Bearer {player_auth}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(summary["summary"]["mode"], "shared");
        assert_eq!(summary["viewer"]["side"], "player");
        assert_eq!(summary["viewer"]["result"], "defeat");
        assert_eq!(summary["reward"]["accountXpGained"], 100);

        let (status, replay) = json_request(
            app,
            Request::builder()
                .uri(format!("/api/matches/{match_id}/replay"))
                .header("authorization", format!("Bearer {opponent_auth}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(replay["summary"]["mode"], "shared");
        assert_eq!(replay["visibility"], "revealed");

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn match_actions_persist_and_reload_by_match_id() {
        let path = test_db_path("action-persist");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));

        let (status, created) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/matches")
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let match_id = created["matchId"].as_str().expect("match id should exist");

        let (status, acted) =
            post_match_action(app.clone(), match_id, r#"{"type":"endTurn"}"#).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(acted["matchId"], match_id);
        assert_eq!(acted["matchState"]["round"], 1);
        assert_eq!(acted["matchState"]["activeSide"], "opponent");

        let acted = advance_solo_match_to_player_turn(app.clone(), match_id).await;
        assert_eq!(acted["matchState"]["round"], 2);
        assert_eq!(
            acted["matchState"]["player"]["hand"]
                .as_array()
                .unwrap()
                .len(),
            5
        );
        assert!(acted["matchState"]["player"].get("deck").is_none());
        assert!(acted["matchState"]["player"].get("discard").is_none());
        assert!(acted["matchState"]["opponent"].get("hand").is_none());

        let reopened = create_app(SqliteMatchStore::new(&path).expect("store should reopen"));
        let (status, loaded) = json_request(
            reopened,
            Request::builder()
                .uri(format!("/api/matches/{match_id}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(loaded["matchState"], acted["matchState"]);

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn accepted_actions_append_action_record_and_internal_replay_frames() {
        let path = test_db_path("action-replay");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));

        let (_, created) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/matches")
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        let match_id = created["matchId"].as_str().expect("match id should exist");

        let (status, _) = post_match_action(app.clone(), match_id, r#"{"type":"endTurn"}"#).await;
        assert_eq!(status, StatusCode::OK);
        advance_solo_match_to_player_turn(app.clone(), match_id).await;

        let (status, replay) = json_request(
            app.clone(),
            Request::builder()
                .uri(format!("/api/matches/{match_id}/replay"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let frames = replay["frames"].as_array().expect("frames should exist");
        assert!(frames.len() > 3);
        assert!(frames.iter().any(|frame| {
            frame["event"]["type"] == "turnStarted" && frame["event"]["side"] == "opponent"
        }));
        let (status, loaded) = json_request(
            app,
            Request::builder()
                .uri(format!("/api/matches/{match_id}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            frames.last().expect("last frame exists")["matchState"],
            loaded["matchState"]
        );

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn match_action_response_includes_replay_frames_for_live_playback() {
        let path = test_db_path("action-live-frames");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));

        let (_, created) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/matches")
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        let match_id = created["matchId"].as_str().expect("match id should exist");

        let (status, _) = post_match_action(app.clone(), match_id, r#"{"type":"endTurn"}"#).await;
        assert_eq!(status, StatusCode::OK);
        let (status, advanced) =
            post_match_action(app.clone(), match_id, r#"{"type":"advanceAi"}"#).await;
        assert_eq!(status, StatusCode::OK);

        let frames = advanced["replayFrames"]
            .as_array()
            .expect("live replay frames should exist");
        assert!(frames.iter().any(|frame| {
            frame["event"]["type"] == "actionQueued" && frame["event"]["side"] == "opponent"
        }));
        assert_eq!(
            frames.last().expect("last frame should exist")["matchState"],
            advanced["matchState"]
        );

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn invalid_actions_do_not_append_replay_frames() {
        let path = test_db_path("invalid-replay");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));

        let (_, created) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/matches")
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        let match_id = created["matchId"].as_str().expect("match id should exist");

        let (status, _) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri(format!("/api/matches/{match_id}/actions"))
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"type":"movePiece","pieceId":"player-hero","to":{"q":0,"r":0}}"#,
                ))
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);

        let (status, replay) = json_request(
            app,
            Request::builder()
                .uri(format!("/api/matches/{match_id}/replay"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(replay["frames"].as_array().unwrap().len(), 1);

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn active_replay_redacts_opponent_hidden_draws() {
        let path = test_db_path("redacted-replay");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));

        let (_, created) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/matches")
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        let match_id = created["matchId"].as_str().expect("match id should exist");

        for _ in 0..2 {
            let (status, _) =
                post_match_action(app.clone(), match_id, r#"{"type":"endTurn"}"#).await;
            assert_eq!(status, StatusCode::OK);
            advance_solo_match_to_player_turn(app.clone(), match_id).await;
        }

        let (status, replay) = json_request(
            app,
            Request::builder()
                .uri(format!("/api/matches/{match_id}/replay"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let hidden_draw = replay["frames"]
            .as_array()
            .unwrap()
            .iter()
            .find(|frame| {
                frame["event"]["type"] == "cardDrawn"
                    && frame["event"]["side"] == "opponent"
                    && frame["event"]["hidden"] == true
            })
            .expect("opponent hidden draw should be present");
        assert!(hidden_draw["event"]["card"].is_null());

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn shared_match_creation_returns_private_seat_links_and_hides_setup_from_archive() {
        let path = test_db_path("shared-create");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));
        let token = register_test_account(app.clone(), "shared-create@example.com").await;

        let (status, created) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/shared-matches")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"heroType":"chronomancer"}"#))
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(created["mode"], "shared");
        assert_eq!(created["status"], "setup");
        assert_eq!(created["viewerSide"], "player");
        assert!(created.get("viewerHeroType").is_none());
        assert_ne!(created["playerSeatUrl"], created["inviteSeatUrl"]);
        assert!(
            created["playerSeatUrl"]
                .as_str()
                .unwrap()
                .contains("/match/")
        );
        assert!(
            created["inviteSeatUrl"]
                .as_str()
                .unwrap()
                .contains("/match/")
        );

        let (status, archive) = json_request(
            app,
            Request::builder()
                .uri("/api/matches")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(archive["matches"].as_array().unwrap().is_empty());

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn shared_match_join_exposes_only_the_viewer_seat_hand() {
        let path = test_db_path("shared-join");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));
        let token = register_test_account(app.clone(), "shared-join@example.com").await;

        let (_, created) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/shared-matches")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"heroType":"chronomancer"}"#))
                .expect("request should build"),
        )
        .await;
        let match_id = created["matchId"].as_str().expect("match id should exist");
        let player_token = seat_token_from_url(
            created["playerSeatUrl"]
                .as_str()
                .expect("player URL exists"),
        );
        let opponent_token = seat_token_from_url(
            created["inviteSeatUrl"]
                .as_str()
                .expect("invite URL exists"),
        );

        let (status, setup) = json_request(
            app.clone(),
            Request::builder()
                .uri(format!(
                    "/api/shared-matches/{match_id}/seats/{player_token}"
                ))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(setup["status"], "setup");
        assert_eq!(setup["viewerReady"], false);
        assert_eq!(setup["opponentReady"], false);
        assert!(setup["viewerHeroType"].is_null());
        assert!(setup["opponentHeroType"].is_null());
        assert!(setup["matchState"].is_null());

        let (status, joined) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/api/shared-matches/{match_id}/seats/{opponent_token}/join"
                ))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"heroType":"pyromancer"}"#))
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(joined["status"], "setup");
        assert_eq!(joined["viewerSide"], "opponent");
        assert_eq!(joined["viewerReady"], true);
        assert_eq!(joined["opponentReady"], false);
        assert_eq!(joined["viewerHeroType"], "pyromancer");
        assert!(joined["matchState"].is_null());

        let (status, activated) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/api/shared-matches/{match_id}/seats/{player_token}/join"
                ))
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"heroType":"chronomancer"}"#))
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(activated["status"], "active");
        assert_eq!(activated["viewerSide"], "player");
        assert_eq!(activated["viewerReady"], true);
        assert_eq!(activated["opponentReady"], true);
        assert_eq!(activated["viewerHeroType"], "chronomancer");
        assert_eq!(activated["opponentHeroType"], "pyromancer");

        let (status, joined) = json_request(
            app.clone(),
            Request::builder()
                .uri(format!(
                    "/api/shared-matches/{match_id}/seats/{opponent_token}"
                ))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(joined["status"], "active");
        assert_eq!(joined["viewerSide"], "opponent");
        assert_eq!(
            joined["matchState"]["opponent"]["hero"]["heroType"],
            "pyromancer"
        );
        assert!(joined["matchState"]["opponent"].get("hand").is_some());
        assert!(joined["matchState"]["player"].get("hand").is_none());
        assert_eq!(joined["matchState"]["opponent"]["handCount"], 4);
        assert_eq!(joined["matchState"]["player"]["handCount"], 4);

        let (status, player_view) = json_request(
            app.clone(),
            Request::builder()
                .uri(format!(
                    "/api/shared-matches/{match_id}/seats/{player_token}"
                ))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            player_view["matchState"]["player"]["hero"]["heroType"],
            "chronomancer"
        );
        assert!(player_view["matchState"]["player"].get("hand").is_some());
        assert!(player_view["matchState"]["opponent"].get("hand").is_none());
        assert_eq!(player_view["matchState"]["player"]["handCount"], 4);
        assert_eq!(player_view["matchState"]["opponent"]["handCount"], 4);

        let (status, _) = json_request(
            app.clone(),
            Request::builder()
                .uri(format!("/api/matches/{match_id}/replay"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);

        let (status, archive) = json_request(
            app,
            Request::builder()
                .uri("/api/matches")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(archive["matches"].as_array().unwrap().is_empty());

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn missing_match_returns_json_404() {
        let path = test_db_path("missing");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));

        let (status, body) = json_request(
            app,
            Request::builder()
                .uri("/api/matches/rl-unknown")
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["message"], "Match rl-unknown was not found");

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn missing_match_action_returns_json_404() {
        let path = test_db_path("missing-action");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));

        let (status, body) = json_request(
            app,
            Request::builder()
                .method("POST")
                .uri("/api/matches/rl-unknown/actions")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"type":"endTurn"}"#))
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["message"], "Match rl-unknown was not found");

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn catalog_cards_return_starter_recipe_order_and_copy_counts() {
        let path = test_db_path("catalog");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));

        let (status, body) = json_request(
            app,
            Request::builder()
                .uri("/api/catalog/cards")
                .body(Body::empty())
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        let cards = body["cards"].as_array().expect("cards should be an array");
        assert_eq!(cards.len(), 55);
        let card_by_id = |id: &str| {
            cards
                .iter()
                .find(|card| card["id"] == id)
                .expect("card should exist")
        };
        assert_eq!(cards[0]["id"], "ember-squire");
        assert_eq!(cards[54]["id"], "surge-protocol");
        assert_eq!(card_by_id("ember-squire")["copyCount"], 4);
        assert_eq!(card_by_id("mana-well")["copyCount"], 5);
        assert_eq!(card_by_id("mana-well")["kind"]["type"], "building");
        assert_eq!(card_by_id("blade-dancer")["copyCount"], 1);
        assert_eq!(card_by_id("ember-flask")["copyCount"], 1);
        assert_eq!(card_by_id("rune-charm")["kind"]["type"], "item");
        assert_eq!(card_by_id("arcane-parry")["kind"]["priority"], 4);
        assert_eq!(
            cards
                .iter()
                .map(|card| card["copyCount"]
                    .as_u64()
                    .expect("copy count should be numeric"))
                .sum::<u64>(),
            60
        );
        assert!(cards.iter().all(|card| {
            card["artPath"]
                .as_str()
                .is_some_and(|path| path.starts_with("/card-art/"))
        }));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn database_path_defaults_to_ignored_data_directory() {
        assert_eq!(
            match_store::database_path_from_environment(),
            PathBuf::from("data/rune-lanes.sqlite3")
        );
    }
}
