mod match_session;

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::http::{Method, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use match_session::{MatchActionRequest, MatchState};
use serde::Serialize;
use tower_http::cors::{Any, CorsLayer};

type SharedMatch = Arc<Mutex<MatchState>>;

#[derive(Serialize)]
struct ApiError {
    message: String,
}

#[tokio::main]
async fn main() {
    let match_state = Arc::new(Mutex::new(MatchState::new()));
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers(Any);

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/match", get(get_match))
        .route("/api/match/new", post(new_match))
        .route("/api/match/action", post(apply_action))
        .route("/api/match/resolve", post(resolve_turn))
        .layer(cors)
        .with_state(match_state);

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

async fn get_match(State(match_state): State<SharedMatch>) -> Json<MatchState> {
    Json(
        match_state
            .lock()
            .expect("match lock should not be poisoned")
            .clone(),
    )
}

async fn new_match(State(match_state): State<SharedMatch>) -> Json<MatchState> {
    let mut match_state = match_state
        .lock()
        .expect("match lock should not be poisoned");
    *match_state = MatchState::new();
    Json(match_state.clone())
}

async fn apply_action(
    State(match_state): State<SharedMatch>,
    Json(request): Json<MatchActionRequest>,
) -> impl IntoResponse {
    let mut match_state = match_state
        .lock()
        .expect("match lock should not be poisoned");

    match match_state.apply_action(request) {
        Ok(()) => Json(match_state.clone()).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(ApiError {
                message: error.to_string(),
            }),
        )
            .into_response(),
    }
}

async fn resolve_turn(State(match_state): State<SharedMatch>) -> Json<MatchState> {
    let mut match_state = match_state
        .lock()
        .expect("match lock should not be poisoned");
    let _ = match_state.apply_action(MatchActionRequest::EndTurn);
    Json(match_state.clone())
}
