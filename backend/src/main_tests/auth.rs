use super::*;

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
