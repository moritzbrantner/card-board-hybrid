mod app_state;
mod auth_context;
mod card_catalog;
mod deck_library;
mod deck_recipe_legality;
mod http_errors;
mod http_types;
mod identity;
mod loadout_resolution;
mod match_access;
mod match_commands;
mod match_session;
mod match_store;
mod preferences;
mod progression;
mod routes;

use std::net::SocketAddr;

use axum::Router;
pub(crate) use http_types::*;
#[cfg(test)]
use match_session::Side;
use match_store::SqliteMatchStore;
use routes::create_app;

#[tokio::main]
async fn main() {
    let store = SqliteMatchStore::from_environment().expect("match database should open");
    let app = create_app(store);
    serve(app).await;
}

async fn serve(app: Router) {
    let addr = SocketAddr::from(([127, 0, 0, 1], 4000));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("backend port 4000 should be available");

    println!("backend listening on http://{addr}");
    axum::serve(listener, app).await.expect("server should run");
}

#[cfg(test)]
#[path = "main_tests/mod.rs"]
mod tests;
