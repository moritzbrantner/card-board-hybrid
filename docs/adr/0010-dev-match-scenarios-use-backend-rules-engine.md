# Dev Match Scenarios Use The Backend Rules Engine

Rune Lanes will use backend-authored local-development match scenarios for playable interaction testing. A match scenario creates a normal persisted solo match from an authored starting state, then the existing match load and action endpoints drive play through the Rust rules engine.

This avoids duplicating card play, priority, attack, draw, hidden deck, discard, and replay behavior in TypeScript. Frontend Storybook stories remain useful for component states, but playable interactions that depend on match legality should start from a backend scenario.

Scenario APIs are debug-build-only and the frontend route is development-only. Scenario-created matches are persisted so normal load/action behavior works, but they are anonymous and intentionally isolated from account archive workflows.
