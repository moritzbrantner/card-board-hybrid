use super::*;

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
