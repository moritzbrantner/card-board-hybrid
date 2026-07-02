mod card_catalog;
mod deck_library;
mod deck_recipe_legality;
mod identity;
mod match_access;
mod match_session;
mod match_store;

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
    IdentityModule,
};
use match_access::{Actor, MatchAccess};
use match_session::{
    MatchActionRequest, MatchMode, MatchState, RecordedReplayFrame, ReplayEvent, ReplayVisibility,
    Side, WizardType,
};
use match_store::{
    CreatedSharedMatch, MatchStoreError, SharedMatchStatus, SqliteMatchStore, StoredMatch,
    StoredMatchSummary, StoredReplayFrame, StoredSharedMatch,
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
    email: String,
    display_name: String,
    avatar: GeneratedAvatarResponse,
    preferred_wizard_type: WizardType,
    board_visual_mode: BoardVisualMode,
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateProfileRequest {
    display_name: String,
    avatar: GeneratedAvatarRequest,
    #[serde(default)]
    preferred_wizard_type: Option<WizardType>,
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
    #[serde(default)]
    wizard_type: Option<WizardType>,
    #[serde(default)]
    player_deck_id: Option<i64>,
    #[serde(default)]
    ai_opponent: Option<AiOpponentRequest>,
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
        wizard_type: WizardType,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JoinSharedMatchRequest {
    wizard_type: WizardType,
    #[serde(default)]
    deck_recipe_id: Option<i64>,
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
struct MatchSummary {
    match_id: String,
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
    viewer_wizard_type: Option<WizardType>,
    opponent_wizard_type: Option<WizardType>,
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

    Router::new()
        .route("/api/health", get(health))
        .route("/api/catalog/cards", get(catalog_cards))
        .route("/api/system-decks", get(system_decks))
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
        .route("/api/matches", get(list_matches).post(create_match))
        .route("/api/matches/{match_id}", get(load_match))
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
            "/api/shared-matches/{match_id}/seats/{seat_token}/ws",
            get(shared_match_ws),
        )
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
    let deck = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
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
    let deck = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
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
            display_name,
            GeneratedAvatar {
                symbol: request.avatar.symbol,
                color: request.avatar.color,
            },
            request
                .preferred_wizard_type
                .unwrap_or(profile.preferred_wizard_type),
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
            wizard_type: None,
            player_deck_id: None,
            ai_opponent: None,
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
        let player_wizard_type = request.wizard_type.unwrap_or_else(|| {
            profile
                .as_ref()
                .map(|profile| profile.preferred_wizard_type)
                .unwrap_or_default()
        });
        let (opponent_wizard_type, player_snapshot, opponent_snapshot) =
            match resolve_solo_deck_choices(
                &mut store,
                profile.as_ref().map(|profile| profile.id),
                request.player_deck_id,
                request.ai_opponent,
            ) {
                Ok(loadouts) => loadouts,
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
        let result = store.create_match_for_user_with_decks(
            player_wizard_type,
            opponent_wizard_type,
            player_deck,
            opponent_deck,
            profile.as_ref().map(|profile| profile.id),
        );
        match result {
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
        let deck_recipe = match resolve_optional_account_deck_choice(
            &mut store,
            profile.as_ref().map(|profile| profile.id),
            request.deck_recipe_id,
        ) {
            Ok(deck_recipe) => deck_recipe,
            Err(response) => return response,
        };
        match store.join_shared_match(
            &match_id,
            &seat_token,
            request.wizard_type,
            deck_recipe,
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
    store
        .mark_shared_seat_seen(match_id, seat_token)
        .map_err(|error| error.to_string())?;
    let shared = store
        .load_shared_match_for_seat(match_id, seat_token)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Shared match seat was not found".to_string())?;
    if shared.status != SharedMatchStatus::Active {
        return Err("Shared match is not active".to_string());
    }
    let mut match_state = shared
        .state
        .ok_or_else(|| "Shared match has not started".to_string())?;
    let action_index = store
        .next_action_index(match_id)
        .map_err(|error| error.to_string())?;
    let frames = match_state
        .apply_action_recording_for_side(shared.viewer_seat.side, action.clone(), action_index)
        .map_err(|error| error.to_string())?;
    store
        .save_action_and_replay_frames(match_id, action_index, &action, &match_state, &frames)
        .map_err(|error| error.to_string())?;
    store
        .load_shared_match_for_seat(match_id, seat_token)
        .map_err(|error| error.to_string())?
        .map(SharedMatchResponse::from)
        .ok_or_else(|| "Shared match seat was not found".to_string())
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
    let shared = store
        .load_shared_match_for_seat(match_id, seat_token)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Shared match seat was not found".to_string())?;
    if shared.status != SharedMatchStatus::Active {
        return Err("Shared match is not active".to_string());
    }
    let disconnected_at = shared
        .opposing_seat
        .disconnected_at
        .ok_or_else(|| "Opponent is still connected".to_string())?;
    if unix_timestamp() < disconnected_at + 120 {
        return Err("Forfeit is not claimable yet".to_string());
    }
    let mut match_state = shared
        .state
        .ok_or_else(|| "Shared match has not started".to_string())?;
    let action_index = store
        .next_action_index(match_id)
        .map_err(|error| error.to_string())?;
    let frames = match_state.forfeit_recording(shared.viewer_seat.side, action_index);
    store
        .mark_shared_match_forfeited(match_id, shared.viewer_seat.side)
        .map_err(|error| error.to_string())?;
    store
        .save_custom_action_and_replay_frames(
            match_id,
            action_index,
            r#"{"type":"claimForfeit"}"#,
            &match_state,
            &frames,
        )
        .map_err(|error| error.to_string())?;
    store
        .load_shared_match_for_seat(match_id, seat_token)
        .map_err(|error| error.to_string())?
        .map(SharedMatchResponse::from)
        .ok_or_else(|| "Shared match seat was not found".to_string())
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
    let (saved, replay_frames) = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        let mut stored_match = match store.load_match(&match_id) {
            Ok(Some(stored_match)) => stored_match,
            Ok(None) => {
                return (
                    StatusCode::NOT_FOUND,
                    Json(ApiError {
                        message: format!("Match {match_id} was not found"),
                    }),
                )
                    .into_response();
            }
            Err(error) => return store_error_response(error),
        };
        let actor = Actor::from(profile.as_ref());
        if !MatchAccess::new(&store).can_apply_solo_action(&actor, &match_id) {
            return match_not_found_response(&match_id);
        }

        let action_index = match store.next_action_index(&match_id) {
            Ok(action_index) => action_index,
            Err(error) => return store_error_response(error),
        };

        let frames = match stored_match
            .state
            .apply_action_recording(request.clone(), action_index)
        {
            Ok(frames) => frames,
            Err(error) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(ApiError {
                        message: error.to_string(),
                    }),
                )
                    .into_response();
            }
        };

        if let Err(error) = store.save_action_and_replay_frames(
            &stored_match.id,
            action_index,
            &request,
            &stored_match.state,
            &frames,
        ) {
            return store_error_response(error);
        }

        (stored_match, frames)
    };

    Json(MatchResponse::from_stored_with_replay_frames(
        saved,
        replay_frames,
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

fn identity_error_response(error: IdentityError) -> axum::response::Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
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
fn resolve_solo_deck_choices(
    store: &mut SqliteMatchStore,
    user_id: Option<i64>,
    player_deck_id: Option<i64>,
    ai_opponent: Option<AiOpponentRequest>,
) -> Result<(WizardType, DeckRecipeSnapshot, DeckRecipeSnapshot), axum::response::Response> {
    let player_snapshot = resolve_optional_account_deck_choice(store, user_id, player_deck_id)?;
    let (opponent_wizard_type, opponent_snapshot) = match ai_opponent {
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
            (system_deck.wizard_type, snapshot)
        }
        Some(AiOpponentRequest::Account {
            deck_id,
            wizard_type,
        }) => {
            let snapshot = resolve_required_account_deck_choice(store, user_id, deck_id)?;
            (wizard_type, snapshot)
        }
        None => (WizardType::Runekeeper, starter_deck_snapshot()),
    };

    Ok((opponent_wizard_type, player_snapshot, opponent_snapshot))
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
            email: profile.email,
            display_name: profile.display_name,
            avatar: GeneratedAvatarResponse {
                symbol: profile.avatar.symbol,
                color: profile.avatar.color,
            },
            preferred_wizard_type: profile.preferred_wizard_type,
            board_visual_mode: profile.board_visual_mode,
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
            viewer_wizard_type: shared.viewer_seat.wizard_type,
            opponent_wizard_type: shared.opposing_seat.wizard_type,
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
        assert_eq!(current_user["displayName"], "player");
        assert!(current_user["avatar"]["symbol"].as_str().is_some());
        assert!(current_user["avatar"]["color"].as_str().is_some());
        assert_eq!(current_user["preferredWizardType"], "runekeeper");
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
        assert_eq!(draft["legality"]["legal"], false);

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
    async fn match_creation_rejects_illegal_account_deck_and_uses_system_ai_wizard() {
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
                    r#"{{"wizardType":"runekeeper","playerDeckId":{draft_id}}}"#
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
                    r#"{"wizardType":"runekeeper","aiOpponent":{"source":"system","systemDeckId":"ember-burn"}}"#,
                ))
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            created["matchState"]["opponent"]["wizard"]["wizardType"],
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
                    r#"{"displayName":"Rune Pilot","avatar":{"symbol":"shield","color":"indigo"},"preferredWizardType":"chronomancer","boardVisualMode":"2d"}"#,
                ))
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(updated["displayName"], "Rune Pilot");
        assert_eq!(updated["avatar"]["symbol"], "shield");
        assert_eq!(updated["avatar"]["color"], "indigo");
        assert_eq!(updated["preferredWizardType"], "chronomancer");
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
        assert_eq!(loaded["displayName"], "Rune Pilot");
        assert_eq!(loaded["avatar"]["symbol"], "shield");
        assert_eq!(loaded["avatar"]["color"], "indigo");
        assert_eq!(loaded["preferredWizardType"], "chronomancer");
        assert_eq!(loaded["boardVisualMode"], "2d");

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
                        preferred_wizard_type TEXT NOT NULL DEFAULT 'runekeeper',
                        created_at INTEGER NOT NULL DEFAULT (unixepoch())
                    );
                    INSERT INTO users (
                        email,
                        email_normalized,
                        password_hash,
                        display_name,
                        avatar_symbol,
                        avatar_color,
                        preferred_wizard_type
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

        assert_eq!(board_visual_mode, "3d");

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
                    r#"{"displayName":"Avatar","avatar":{"symbol":"dragon","color":"void"},"preferredWizardType":"runekeeper"}"#,
                ))
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["message"], "Choose a valid generated avatar.");

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn profile_rejects_unknown_preferred_wizard_type() {
        let path = test_db_path("profile-wizard-invalid");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));
        let token = register_test_account(app.clone(), "wizard-invalid@example.com").await;

        let (status, _body) = json_request(
            app,
            Request::builder()
                .method("PATCH")
                .uri("/api/profile")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"displayName":"Avatar","avatar":{"symbol":"wand","color":"sky"},"preferredWizardType":"stormcaller"}"#,
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
                    r#"{"displayName":"Avatar","avatar":{"symbol":"wand","color":"sky"},"preferredWizardType":"runekeeper","boardVisualMode":"cinematic"}"#,
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
                .body(Body::from(r#"{"wizardType":"chronomancer"}"#))
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
                .body(Body::from(r#"{"wizardType":"pyromancer"}"#))
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
                .body(Body::from(r#"{"wizardType":"chronomancer"}"#))
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
    async fn create_match_accepts_player_wizard_type() {
        let path = test_db_path("create-wizard-type");
        let app = create_app(SqliteMatchStore::new(&path).expect("store should open"));

        let (status, created) = json_request(
            app,
            Request::builder()
                .method("POST")
                .uri("/api/matches")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"wizardType":"chronomancer"}"#))
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            created["matchState"]["player"]["wizard"]["wizardType"],
            "chronomancer"
        );
        assert_eq!(created["matchState"]["player"]["wizard"]["maxAp"], 4);
        assert_eq!(created["matchState"]["player"]["wizard"]["maxHp"], 16);
        assert_eq!(
            created["matchState"]["opponent"]["wizard"]["wizardType"],
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
                    r#"{"type":"movePiece","pieceId":"player-wizard","to":{"q":0,"r":0}}"#,
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
                .body(Body::from(r#"{"wizardType":"chronomancer"}"#))
                .expect("request should build"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(created["mode"], "shared");
        assert_eq!(created["status"], "setup");
        assert_eq!(created["viewerSide"], "player");
        assert!(created.get("viewerWizardType").is_none());
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
                .body(Body::from(r#"{"wizardType":"chronomancer"}"#))
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
        assert!(setup["viewerWizardType"].is_null());
        assert!(setup["opponentWizardType"].is_null());
        assert!(setup["matchState"].is_null());

        let (status, joined) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/api/shared-matches/{match_id}/seats/{opponent_token}/join"
                ))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"wizardType":"pyromancer"}"#))
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(joined["status"], "setup");
        assert_eq!(joined["viewerSide"], "opponent");
        assert_eq!(joined["viewerReady"], true);
        assert_eq!(joined["opponentReady"], false);
        assert_eq!(joined["viewerWizardType"], "pyromancer");
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
                .body(Body::from(r#"{"wizardType":"chronomancer"}"#))
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(activated["status"], "active");
        assert_eq!(activated["viewerSide"], "player");
        assert_eq!(activated["viewerReady"], true);
        assert_eq!(activated["opponentReady"], true);
        assert_eq!(activated["viewerWizardType"], "chronomancer");
        assert_eq!(activated["opponentWizardType"], "pyromancer");

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
            joined["matchState"]["opponent"]["wizard"]["wizardType"],
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
            player_view["matchState"]["player"]["wizard"]["wizardType"],
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
        assert_eq!(cards.len(), 32);
        assert_eq!(cards[0]["id"], "ember-squire");
        assert_eq!(cards[31]["id"], "comet-spear");
        assert_eq!(cards[0]["copyCount"], 5);
        assert_eq!(cards[4]["copyCount"], 1);
        assert_eq!(cards[19]["copyCount"], 1);
        assert_eq!(cards[16]["kind"]["priority"], 4);
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
