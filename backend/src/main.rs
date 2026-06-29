mod game;

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::http::{Method, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use game::{GameActionRequest, GameState};
use serde::Serialize;
use tower_http::cors::{Any, CorsLayer};

type SharedGame = Arc<Mutex<GameState>>;

#[derive(Serialize)]
struct ApiError {
    message: String,
}

#[tokio::main]
async fn main() {
    let game = Arc::new(Mutex::new(GameState::new()));
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers(Any);

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/game", get(get_game))
        .route("/api/game/new", post(new_game))
        .route("/api/game/action", post(apply_action))
        .route("/api/game/resolve", post(resolve_turn))
        .layer(cors)
        .with_state(game);

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

async fn get_game(State(game): State<SharedGame>) -> Json<GameState> {
    Json(
        game.lock()
            .expect("game lock should not be poisoned")
            .clone(),
    )
}

async fn new_game(State(game): State<SharedGame>) -> Json<GameState> {
    let mut game = game.lock().expect("game lock should not be poisoned");
    *game = GameState::new();
    Json(game.clone())
}

async fn apply_action(
    State(game): State<SharedGame>,
    Json(request): Json<GameActionRequest>,
) -> impl IntoResponse {
    let mut game = game.lock().expect("game lock should not be poisoned");

    match game.apply_action(request) {
        Ok(()) => Json(game.clone()).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(ApiError {
                message: error.to_string(),
            }),
        )
            .into_response(),
    }
}

async fn resolve_turn(State(game): State<SharedGame>) -> Json<GameState> {
    let mut game = game.lock().expect("game lock should not be poisoned");
    let _ = game.apply_action(GameActionRequest::EndTurn);
    Json(game.clone())
}
