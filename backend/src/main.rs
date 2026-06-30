mod card_catalog;
mod match_session;
mod match_store;

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{Method, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use card_catalog::{CatalogResponse, starter_catalog};
use match_session::{MatchActionRequest, MatchState, ReplayEvent, ReplayVisibility, WizardType};
use match_store::{
    MatchStoreError, SqliteMatchStore, StoredMatch, StoredMatchSummary, StoredReplayFrame,
};
use serde::{Deserialize, Serialize};
use tower_http::cors::{Any, CorsLayer};

type SharedState = Arc<AppState>;

struct AppState {
    store: Mutex<SqliteMatchStore>,
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

#[tokio::main]
async fn main() {
    let store = SqliteMatchStore::from_environment().expect("match database should open");
    let app = create_app(store);
    serve(app).await;
}

fn create_app(store: SqliteMatchStore) -> Router {
    let state = Arc::new(AppState {
        store: Mutex::new(store),
    });
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers(Any);

    Router::new()
        .route("/api/health", get(health))
        .route("/api/catalog/cards", get(catalog_cards))
        .route("/api/matches", get(list_matches).post(create_match))
        .route("/api/matches/{match_id}", get(load_match))
        .route("/api/matches/{match_id}/replay", get(load_replay))
        .route("/api/matches/{match_id}/actions", post(apply_match_action))
        .layer(cors)
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

impl From<StoredMatch> for MatchResponse {
    fn from(stored_match: StoredMatch) -> Self {
        Self {
            match_id: stored_match.id,
            match_state: stored_match.state,
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
