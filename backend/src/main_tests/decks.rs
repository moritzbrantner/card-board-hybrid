use super::*;

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
    assert_eq!(cards.len(), 79);
    let card_by_id = |id: &str| {
        cards
            .iter()
            .find(|card| card["id"] == id)
            .expect("card should exist")
    };
    assert_eq!(cards[0]["id"], "ember-squire");
    assert_eq!(cards[78]["id"], "surge-protocol");
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
