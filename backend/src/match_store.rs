use std::env;
use std::error::Error;
use std::ffi::OsString;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, params};

use crate::match_session::MatchState;

pub const MATCH_DATABASE_PATH_ENV: &str = "RUNE_LANES_DB_PATH";

#[derive(Clone, Debug)]
pub struct StoredMatch {
    pub id: String,
    pub state: MatchState,
}

pub struct SqliteMatchStore {
    connection: Connection,
}

#[derive(Debug)]
pub enum MatchStoreError {
    Io(std::io::Error),
    Sqlite(rusqlite::Error),
    Snapshot(serde_json::Error),
}

impl fmt::Display for MatchStoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(f, "could not prepare match database: {error}"),
            Self::Sqlite(error) => write!(f, "could not access match database: {error}"),
            Self::Snapshot(error) => write!(f, "could not read persisted match snapshot: {error}"),
        }
    }
}

impl Error for MatchStoreError {}

impl From<std::io::Error> for MatchStoreError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<rusqlite::Error> for MatchStoreError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

impl From<serde_json::Error> for MatchStoreError {
    fn from(error: serde_json::Error) -> Self {
        Self::Snapshot(error)
    }
}

impl SqliteMatchStore {
    pub fn from_environment() -> Result<Self, MatchStoreError> {
        Self::new(database_path_from_environment())
    }

    pub fn new(path: impl AsRef<Path>) -> Result<Self, MatchStoreError> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let connection = Connection::open(path)?;
        connection.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS matches (
                id TEXT PRIMARY KEY NOT NULL,
                snapshot_json TEXT NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (unixepoch()),
                updated_at INTEGER NOT NULL DEFAULT (unixepoch())
            );
            ",
        )?;

        Ok(Self { connection })
    }

    pub fn create_match(&mut self) -> Result<StoredMatch, MatchStoreError> {
        for attempt in 0..8 {
            let id = readable_match_id(attempt);
            let state = MatchState::new();
            let snapshot = state.to_snapshot_json()?;

            let inserted = self.connection.execute(
                "
                INSERT OR IGNORE INTO matches (id, snapshot_json, created_at, updated_at)
                VALUES (?1, ?2, unixepoch(), unixepoch())
                ",
                params![id, snapshot],
            )?;

            if inserted == 1 {
                return Ok(StoredMatch { id, state });
            }
        }

        let id = readable_match_id(99);
        let state = MatchState::new();
        self.save_match(&id, &state)?;
        Ok(StoredMatch { id, state })
    }

    pub fn load_match(&self, id: &str) -> Result<Option<StoredMatch>, MatchStoreError> {
        let snapshot: Option<String> = self
            .connection
            .query_row(
                "SELECT snapshot_json FROM matches WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?;

        snapshot
            .map(|snapshot| {
                MatchState::from_snapshot_json(&snapshot).map(|state| StoredMatch {
                    id: id.to_string(),
                    state,
                })
            })
            .transpose()
            .map_err(MatchStoreError::from)
    }

    pub fn save_match(&mut self, id: &str, state: &MatchState) -> Result<(), MatchStoreError> {
        let snapshot = state.to_snapshot_json()?;
        self.connection.execute(
            "
            INSERT INTO matches (id, snapshot_json, created_at, updated_at)
            VALUES (?1, ?2, unixepoch(), unixepoch())
            ON CONFLICT(id) DO UPDATE SET
                snapshot_json = excluded.snapshot_json,
                updated_at = unixepoch()
            ",
            params![id, snapshot],
        )?;
        Ok(())
    }
}

pub fn database_path_from_environment() -> PathBuf {
    database_path_from_override(env::var_os(MATCH_DATABASE_PATH_ENV))
}

pub fn database_path_from_override(value: Option<OsString>) -> PathBuf {
    value
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("data/rune-lanes.sqlite3"))
}

fn readable_match_id(attempt: u32) -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(1);
    let suffix = if attempt == 0 {
        String::new()
    } else {
        format!("-{}", to_base36(u64::from(attempt)))
    };
    format!("rl-{}{}", to_base36(millis), suffix)
}

fn to_base36(mut value: u64) -> String {
    const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if value == 0 {
        return "0".to_string();
    }

    let mut out = Vec::new();
    while value > 0 {
        out.push(DIGITS[(value % 36) as usize]);
        value /= 36;
    }
    out.reverse();
    String::from_utf8(out).expect("base36 should be valid ASCII")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db_path(name: &str) -> PathBuf {
        let mut path = env::temp_dir();
        path.push(format!(
            "rune-lanes-{name}-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after epoch")
                .as_nanos()
        ));
        path
    }

    #[test]
    fn created_matches_can_be_loaded_from_sqlite() {
        let path = test_db_path("create-load");
        let created = {
            let mut store = SqliteMatchStore::new(&path).expect("store should open");
            store.create_match().expect("match should be created")
        };

        let reopened = SqliteMatchStore::new(&path)
            .expect("store should reopen")
            .load_match(&created.id)
            .expect("match should load")
            .expect("match should exist");

        assert_eq!(reopened.id, created.id);
        assert_eq!(reopened.state.round, created.state.round);
        assert_eq!(
            reopened.state.player.hand.len(),
            created.state.player.hand.len()
        );
        assert_eq!(
            reopened.state.opponent.deck_count,
            created.state.opponent.deck_count
        );

        let _ = fs::remove_file(path);
    }

    #[test]
    fn missing_matches_load_as_none() {
        let path = test_db_path("missing");
        let store = SqliteMatchStore::new(&path).expect("store should open");

        let missing = store
            .load_match("rl-missing")
            .expect("lookup should succeed");

        assert!(missing.is_none());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn database_path_override_uses_given_value() {
        assert_eq!(
            database_path_from_override(Some(OsString::from("/tmp/rune-lanes-test.sqlite3"))),
            PathBuf::from("/tmp/rune-lanes-test.sqlite3")
        );
    }
}
