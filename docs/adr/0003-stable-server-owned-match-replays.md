# Stable Server-Owned Match Replays

Rune Lanes persists generated replay events and internal replay frame snapshots when match actions are accepted. Server-owned replay data avoids duplicating the rules engine in TypeScript and keeps old replays stable after future rule changes, at the cost of a more complex write path and additional local SQLite storage.
