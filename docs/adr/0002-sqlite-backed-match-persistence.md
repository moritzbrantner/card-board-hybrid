# SQLite-Backed Match Persistence

Rune Lanes persists created matches in a local SQLite database. A match receives
a short readable route ID, and the backend stores a serialized full internal
match snapshot for that ID.

SQLite is the right first persistence boundary because matches need to survive a
backend restart, but the project is still a local vertical slice. It avoids
introducing a server database while still giving the backend a real durable store
and queryable API boundary.

The first schema stores serialized snapshots rather than relationally modeling
cards, units, piles, logs, and hidden state. That keeps persistence isolated from
the rules engine while preserving hidden decks, discards, RNG state, and future
fields that are not part of the public API response.

Runtime data defaults to `data/rune-lanes.sqlite3`, an ignored local directory.
`RUNE_LANES_DB_PATH` overrides the location for isolated tests and non-default
local runs.
