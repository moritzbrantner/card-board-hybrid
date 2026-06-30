mod card_catalog;
mod match_session;
mod match_store;

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::body::Bytes;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::{Method, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use card_catalog::{CatalogResponse, starter_catalog};
use futures_util::StreamExt;
use match_session::{
    MatchActionRequest, MatchMode, MatchState, ReplayEvent, ReplayVisibility, Side, WizardType,
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
struct CreateMatchRequest {
    wizard_type: WizardType,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JoinSharedMatchRequest {
    wizard_type: WizardType,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MatchResponse {
    match_id: String,
    match_state: MatchState,
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
        .allow_methods([Method::GET, Method::POST])
        .allow_headers(Any);

    let static_files = ServeDir::new("frontend/dist")
        .not_found_service(ServeFile::new("frontend/dist/index.html"));

    Router::new()
        .route("/api/health", get(health))
        .route("/api/catalog/cards", get(catalog_cards))
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

async fn list_matches(State(state): State<SharedState>) -> impl IntoResponse {
    let matches = {
        let store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        match store.list_replayable_matches() {
            Ok(matches) => matches,
            Err(error) => return store_error_response(error),
        }
    };

    Json(MatchArchiveResponse {
        matches: matches.into_iter().map(MatchSummary::from).collect(),
    })
    .into_response()
}

async fn create_match(State(state): State<SharedState>, body: Bytes) -> impl IntoResponse {
    let wizard_type = if body.is_empty() || body.iter().all(|byte| byte.is_ascii_whitespace()) {
        None
    } else {
        match serde_json::from_slice::<CreateMatchRequest>(&body) {
            Ok(request) => Some(request.wizard_type),
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
        let result = match wizard_type {
            Some(wizard_type) => store.create_match_with_wizard_type(wizard_type),
            None => store.create_match(),
        };
        match result {
            Ok(created) => created,
            Err(error) => return store_error_response(error),
        }
    };

    Json(MatchResponse::from(created)).into_response()
}

async fn create_shared_match(
    State(state): State<SharedState>,
    Json(_request): Json<CreateMatchRequest>,
) -> impl IntoResponse {
    let created = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        match store.create_shared_match() {
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
    Path((match_id, seat_token)): Path<(String, String)>,
    Json(request): Json<JoinSharedMatchRequest>,
) -> impl IntoResponse {
    let shared = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        match store.join_shared_match(&match_id, &seat_token, request.wizard_type) {
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
    Path(match_id): Path<String>,
) -> impl IntoResponse {
    let loaded = {
        let store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        match store.load_match(&match_id) {
            Ok(Some(loaded)) => loaded,
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
        }
    };

    Json(MatchResponse::from(loaded)).into_response()
}

async fn load_replay(
    State(state): State<SharedState>,
    Path(match_id): Path<String>,
) -> impl IntoResponse {
    let replay = {
        let store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        match store.load_replay(&match_id) {
            Ok(Some(replay)) => replay,
            Ok(None) => {
                return (
                    StatusCode::NOT_FOUND,
                    Json(ApiError {
                        message: format!("Replay for match {match_id} was not found"),
                    }),
                )
                    .into_response();
            }
            Err(error) => return store_error_response(error),
        }
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
    Path(match_id): Path<String>,
    Json(request): Json<MatchActionRequest>,
) -> impl IntoResponse {
    let saved = {
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

        stored_match
    };

    Json(MatchResponse::from(saved)).into_response()
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

fn shared_not_found_response() -> axum::response::Response {
    (
        StatusCode::NOT_FOUND,
        Json(ApiError {
            message: "Shared match seat was not found".to_string(),
        }),
    )
        .into_response()
}

impl From<StoredMatch> for MatchResponse {
    fn from(stored_match: StoredMatch) -> Self {
        Self {
            match_id: stored_match.id,
            match_state: stored_match.state,
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

    fn seat_token_from_url(url: &str) -> &str {
        url.rsplit('/')
            .next()
            .expect("seat URL should end in token")
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

        let (status, archive) = json_request(
            app.clone(),
            Request::builder()
                .uri("/api/matches")
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

        let (status, acted) = json_request(
            app,
            Request::builder()
                .method("POST")
                .uri(format!("/api/matches/{match_id}/actions"))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"type":"endTurn"}"#))
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(acted["matchId"], match_id);
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

        let (status, _) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri(format!("/api/matches/{match_id}/actions"))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"type":"endTurn"}"#))
                .expect("request should build"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);

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
            let (status, _) = json_request(
                app.clone(),
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/matches/{match_id}/actions"))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"type":"endTurn"}"#))
                    .expect("request should build"),
            )
            .await;
            assert_eq!(status, StatusCode::OK);
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

        let (status, created) = json_request(
            app.clone(),
            Request::builder()
                .method("POST")
                .uri("/api/shared-matches")
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
        assert_eq!(cards.len(), 10);
        assert_eq!(cards[0]["id"], "ember-squire");
        assert_eq!(cards[9]["id"], "starfire-bolt");
        assert_eq!(cards[0]["copyCount"], 8);
        assert_eq!(cards[4]["copyCount"], 4);
        assert_eq!(cards[8]["copyCount"], 1);
        assert_eq!(
            cards
                .iter()
                .map(|card| card["copyCount"]
                    .as_u64()
                    .expect("copy count should be numeric"))
                .sum::<u64>(),
            50
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
