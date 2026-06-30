# Private Seat Links And WebSocket-Authoritative Shared Matches

Rune Lanes keeps solo AI matches and adds shared human-vs-human matches as a separate mode. Shared matches use two private seat links: one for Player and one for Opponent. Each seat link is a capability that lets the holder view only that side's hand and submit only that side's actions.

The backend remains authoritative. Browsers send match actions over WebSockets, the Rust rules engine validates and applies them, SQLite stores the resulting snapshot and replay frames, and connected seats receive fresh side-specific snapshots. This preserves the existing server-owned replay model and avoids duplicating rules in TypeScript.

This trades account-level identity for a smaller share-link flow. Anyone with a seat link can occupy that seat, so seat links must be treated as private. The project deliberately does not add users, passwords, lobbies, matchmaking, or spectators for this version.

Production packaging is a single Axum app. The backend serves `/api`, WebSocket routes, and the built frontend assets from one origin, which keeps seat-link access and WebSocket connection setup straightforward.

Active shared matches are hidden from public playable archive rows and active replay URLs. Completed shared matches can appear as revealed replays.
