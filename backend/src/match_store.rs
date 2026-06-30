use std::env;
use std::error::Error;
use std::ffi::OsString;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rand::RngCore;
use rand::rngs::OsRng;
use rusqlite::{Connection, OptionalExtension, Transaction, params};

use crate::match_session::{
    MatchActionRequest, MatchState, RecordedReplayFrame, ReplayEvent, Side, WizardType,
};

pub const MATCH_DATABASE_PATH_ENV: &str = "RUNE_LANES_DB_PATH";

#[derive(Clone, Debug)]
pub struct StoredMatch {
    pub id: String,
    pub state: MatchState,
}

#[derive(Clone, Debug)]
pub struct StoredMatchSummary {
    pub id: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub frame_count: usize,
    pub state: MatchState,
}

#[derive(Clone, Debug)]
pub struct StoredReplayFrame {
    pub frame_index: u32,
    pub action_index: Option<u32>,
    pub event: ReplayEvent,
    pub state: MatchState,
}

#[derive(Clone, Debug)]
pub struct StoredReplay {
    pub summary: StoredMatchSummary,
    pub frames: Vec<StoredReplayFrame>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SharedMatchStatus {
    Setup,
    Active,
    Completed,
    Forfeited,
}

#[derive(Clone, Debug)]
pub struct StoredSharedSeat {
    pub side: Side,
    pub seat_token: String,
    pub wizard_type: Option<WizardType>,
    pub joined_at: Option<i64>,
    pub disconnected_at: Option<i64>,
}

#[derive(Clone, Debug)]
pub struct StoredSharedMatch {
    pub match_id: String,
    pub status: SharedMatchStatus,
    pub viewer_seat: StoredSharedSeat,
    pub opposing_seat: StoredSharedSeat,
    pub state: Option<MatchState>,
}

#[derive(Clone, Debug)]
pub struct CreatedSharedMatch {
    pub match_id: String,
    pub player_token: String,
    pub opponent_token: String,
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
                initial_snapshot_json TEXT,
                completed_at INTEGER,
                mode TEXT NOT NULL DEFAULT 'solo',
                created_at INTEGER NOT NULL DEFAULT (unixepoch()),
                updated_at INTEGER NOT NULL DEFAULT (unixepoch())
            );
            CREATE TABLE IF NOT EXISTS match_actions (
                match_id TEXT NOT NULL,
                action_index INTEGER NOT NULL,
                request_json TEXT NOT NULL,
                accepted_at INTEGER NOT NULL,
                PRIMARY KEY (match_id, action_index)
            );
            CREATE TABLE IF NOT EXISTS match_replay_frames (
                match_id TEXT NOT NULL,
                frame_index INTEGER NOT NULL,
                action_index INTEGER,
                event_json TEXT NOT NULL,
                snapshot_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (match_id, frame_index)
            );
            CREATE TABLE IF NOT EXISTS shared_matches (
                match_id TEXT PRIMARY KEY NOT NULL,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (unixepoch()),
                updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
                forfeit_winner TEXT
            );
            CREATE TABLE IF NOT EXISTS match_seats (
                match_id TEXT NOT NULL,
                side TEXT NOT NULL,
                seat_token TEXT NOT NULL UNIQUE,
                wizard_type TEXT,
                joined_at INTEGER,
                last_seen_at INTEGER,
                disconnected_at INTEGER,
                PRIMARY KEY (match_id, side)
            );
            ",
        )?;
        add_column_if_missing(&connection, "matches", "initial_snapshot_json", "TEXT")?;
        add_column_if_missing(&connection, "matches", "completed_at", "INTEGER")?;
        add_column_if_missing(
            &connection,
            "matches",
            "mode",
            "TEXT NOT NULL DEFAULT 'solo'",
        )?;

        Ok(Self { connection })
    }

    pub fn create_match(&mut self) -> Result<StoredMatch, MatchStoreError> {
        self.create_match_with_wizard_type(WizardType::default())
    }

    pub fn create_match_with_wizard_type(
        &mut self,
        player_wizard_type: WizardType,
    ) -> Result<StoredMatch, MatchStoreError> {
        for attempt in 0..8 {
            let id = readable_match_id(attempt);
            let state = MatchState::new_with_player_wizard_type(player_wizard_type);
            let snapshot = state.to_snapshot_json()?;
            let initial_frame = state.initial_replay_frame();
            let event_json = serde_json::to_string(&initial_frame.event)?;

            let transaction = self.connection.transaction()?;
            let inserted = transaction.execute(
                "
                INSERT OR IGNORE INTO matches (
                    id,
                    snapshot_json,
                    initial_snapshot_json,
                    mode,
                    created_at,
                    updated_at
                )
                VALUES (?1, ?2, ?2, 'solo', unixepoch(), unixepoch())
                ",
                params![id, snapshot],
            )?;

            if inserted == 1 {
                insert_replay_frame(&transaction, &id, 0, &initial_frame, &event_json)?;
                transaction.commit()?;
                return Ok(StoredMatch { id, state });
            }
            transaction.commit()?;
        }

        let id = readable_match_id(99);
        let state = MatchState::new_with_player_wizard_type(player_wizard_type);
        let snapshot = state.to_snapshot_json()?;
        let initial_frame = state.initial_replay_frame();
        let event_json = serde_json::to_string(&initial_frame.event)?;
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "
            INSERT INTO matches (
                id,
                snapshot_json,
                initial_snapshot_json,
                mode,
                created_at,
                updated_at
            )
            VALUES (?1, ?2, ?2, 'solo', unixepoch(), unixepoch())
            ON CONFLICT(id) DO UPDATE SET
                snapshot_json = excluded.snapshot_json,
                initial_snapshot_json = excluded.initial_snapshot_json,
                mode = excluded.mode,
                updated_at = unixepoch()
            ",
            params![id, snapshot],
        )?;
        insert_replay_frame(&transaction, &id, 0, &initial_frame, &event_json)?;
        transaction.commit()?;
        Ok(StoredMatch { id, state })
    }

    pub fn create_shared_match(&mut self) -> Result<CreatedSharedMatch, MatchStoreError> {
        for attempt in 0..8 {
            let match_id = readable_match_id(attempt);
            let player_token = random_seat_token();
            let opponent_token = random_seat_token();
            let transaction = self.connection.transaction()?;
            let inserted = transaction.execute(
                "
                INSERT OR IGNORE INTO shared_matches (
                    match_id,
                    status,
                    created_at,
                    updated_at
                )
                VALUES (?1, 'setup', unixepoch(), unixepoch())
                ",
                params![match_id],
            )?;

            if inserted == 1 {
                insert_shared_seat(
                    &transaction,
                    &match_id,
                    Side::Player,
                    &player_token,
                    None,
                    false,
                )?;
                insert_shared_seat(
                    &transaction,
                    &match_id,
                    Side::Opponent,
                    &opponent_token,
                    None,
                    false,
                )?;
                transaction.commit()?;
                return Ok(CreatedSharedMatch {
                    match_id,
                    player_token,
                    opponent_token,
                });
            }

            transaction.commit()?;
        }

        Err(MatchStoreError::Sqlite(
            rusqlite::Error::ExecuteReturnedResults,
        ))
    }

    pub fn load_shared_match_for_seat(
        &self,
        id: &str,
        seat_token: &str,
    ) -> Result<Option<StoredSharedMatch>, MatchStoreError> {
        let row: Option<(String, String)> = self
            .connection
            .query_row(
                "
                SELECT match_id, status
                FROM shared_matches
                WHERE match_id = ?1
                ",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let Some((match_id, status)) = row else {
            return Ok(None);
        };

        let seats = self.load_shared_seats(&match_id)?;
        let Some(viewer_seat) = seats
            .iter()
            .find(|seat| seat.seat_token == seat_token)
            .cloned()
        else {
            return Ok(None);
        };
        let opposing_seat = seats
            .into_iter()
            .find(|seat| seat.side != viewer_seat.side)
            .expect("shared match should have an opposing seat");
        let state = self.load_match(&match_id)?.map(|stored| stored.state);

        Ok(Some(StoredSharedMatch {
            match_id,
            status: SharedMatchStatus::from_db(&status),
            viewer_seat,
            opposing_seat,
            state,
        }))
    }

    pub fn join_shared_match(
        &mut self,
        id: &str,
        seat_token: &str,
        wizard_type: WizardType,
    ) -> Result<Option<StoredSharedMatch>, MatchStoreError> {
        let Some(shared) = self.load_shared_match_for_seat(id, seat_token)? else {
            return Ok(None);
        };
        if shared.status != SharedMatchStatus::Setup {
            return Ok(Some(shared));
        }

        let transaction = self.connection.transaction()?;
        transaction.execute(
            "
            UPDATE match_seats
            SET wizard_type = ?3,
                joined_at = COALESCE(joined_at, unixepoch()),
                last_seen_at = unixepoch(),
                disconnected_at = NULL
            WHERE match_id = ?1 AND seat_token = ?2
            ",
            params![id, seat_token, wizard_type.to_db()],
        )?;

        if let Some((player_wizard_type, opponent_wizard_type)) =
            ready_shared_wizard_types(&transaction, id)?
        {
            let state =
                MatchState::new_shared_with_wizard_types(player_wizard_type, opponent_wizard_type);
            let snapshot = state.to_snapshot_json()?;
            let initial_frame = state.initial_replay_frame();
            let event_json = serde_json::to_string(&initial_frame.event)?;
            transaction.execute(
                "
                INSERT INTO matches (
                    id,
                    snapshot_json,
                    initial_snapshot_json,
                    mode,
                    created_at,
                    updated_at
                )
                VALUES (?1, ?2, ?2, 'shared', unixepoch(), unixepoch())
                ",
                params![id, snapshot],
            )?;
            insert_replay_frame(&transaction, id, 0, &initial_frame, &event_json)?;
            transaction.execute(
                "
                UPDATE shared_matches
                SET status = 'active',
                    updated_at = unixepoch()
                WHERE match_id = ?1
                ",
                params![id],
            )?;
        } else {
            transaction.execute(
                "
                UPDATE shared_matches
                SET updated_at = unixepoch()
                WHERE match_id = ?1
                ",
                params![id],
            )?;
        }

        transaction.commit()?;

        self.load_shared_match_for_seat(id, seat_token)
    }

    pub fn mark_shared_seat_seen(
        &mut self,
        id: &str,
        seat_token: &str,
    ) -> Result<(), MatchStoreError> {
        self.connection.execute(
            "
            UPDATE match_seats
            SET last_seen_at = unixepoch(),
                disconnected_at = NULL
            WHERE match_id = ?1 AND seat_token = ?2
            ",
            params![id, seat_token],
        )?;
        Ok(())
    }

    pub fn mark_shared_seat_disconnected(
        &mut self,
        id: &str,
        seat_token: &str,
    ) -> Result<(), MatchStoreError> {
        self.connection.execute(
            "
            UPDATE match_seats
            SET disconnected_at = COALESCE(disconnected_at, unixepoch())
            WHERE match_id = ?1 AND seat_token = ?2
            ",
            params![id, seat_token],
        )?;
        Ok(())
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

    pub fn next_action_index(&self, id: &str) -> Result<u32, MatchStoreError> {
        let next = self.connection.query_row(
            "
            SELECT COALESCE(MAX(action_index) + 1, 0)
            FROM match_actions
            WHERE match_id = ?1
            ",
            params![id],
            |row| row.get::<_, i64>(0),
        )?;

        Ok(next as u32)
    }

    pub fn save_action_and_replay_frames(
        &mut self,
        id: &str,
        action_index: u32,
        action: &MatchActionRequest,
        state: &MatchState,
        frames: &[RecordedReplayFrame],
    ) -> Result<(), MatchStoreError> {
        let request_json = serde_json::to_string(action)?;
        self.save_action_json_and_replay_frames(id, action_index, &request_json, state, frames)
    }

    pub fn save_custom_action_and_replay_frames(
        &mut self,
        id: &str,
        action_index: u32,
        request_json: &str,
        state: &MatchState,
        frames: &[RecordedReplayFrame],
    ) -> Result<(), MatchStoreError> {
        self.save_action_json_and_replay_frames(id, action_index, request_json, state, frames)
    }

    fn save_action_json_and_replay_frames(
        &mut self,
        id: &str,
        action_index: u32,
        request_json: &str,
        state: &MatchState,
        frames: &[RecordedReplayFrame],
    ) -> Result<(), MatchStoreError> {
        let snapshot = state.to_snapshot_json()?;
        let completed_at = if state.winner.is_some() {
            "completed_at = COALESCE(completed_at, unixepoch()),"
        } else {
            ""
        };
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "
            INSERT INTO match_actions (match_id, action_index, request_json, accepted_at)
            VALUES (?1, ?2, ?3, unixepoch())
            ",
            params![id, i64::from(action_index), request_json],
        )?;

        let next_frame_index = next_frame_index(&transaction, id)?;
        for (offset, frame) in frames.iter().enumerate() {
            let event_json = serde_json::to_string(&frame.event)?;
            insert_replay_frame(
                &transaction,
                id,
                next_frame_index + offset as u32,
                frame,
                &event_json,
            )?;
        }

        transaction.execute(
            &format!(
                "
                UPDATE matches
                SET snapshot_json = ?2,
                    {completed_at}
                    updated_at = unixepoch()
                WHERE id = ?1
                "
            ),
            params![id, snapshot],
        )?;
        transaction.commit()?;
        if state.winner.is_some() {
            self.connection.execute(
                "
                UPDATE shared_matches
                SET status = CASE status
                        WHEN 'forfeited' THEN 'forfeited'
                        ELSE 'completed'
                    END,
                    updated_at = unixepoch()
                WHERE match_id = ?1
                ",
                params![id],
            )?;
        }
        Ok(())
    }

    pub fn mark_shared_match_forfeited(
        &mut self,
        id: &str,
        winner: Side,
    ) -> Result<(), MatchStoreError> {
        self.connection.execute(
            "
            UPDATE shared_matches
            SET status = 'forfeited',
                forfeit_winner = ?2,
                updated_at = unixepoch()
            WHERE match_id = ?1
            ",
            params![id, winner.to_db()],
        )?;
        Ok(())
    }

    pub fn list_replayable_matches(&self) -> Result<Vec<StoredMatchSummary>, MatchStoreError> {
        let mut statement = self.connection.prepare(
            "
            SELECT
                matches.id,
                matches.snapshot_json,
                matches.created_at,
                matches.updated_at,
                COUNT(match_replay_frames.frame_index) AS frame_count
            FROM matches
            JOIN match_replay_frames ON match_replay_frames.match_id = matches.id
            LEFT JOIN shared_matches ON shared_matches.match_id = matches.id
            WHERE matches.initial_snapshot_json IS NOT NULL
                AND (
                    matches.mode = 'solo'
                    OR shared_matches.status IN ('completed', 'forfeited')
                )
            GROUP BY matches.id
            HAVING frame_count > 0
            ORDER BY matches.updated_at DESC
            ",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })?;

        let mut summaries = Vec::new();
        for row in rows {
            let (id, snapshot, created_at, updated_at, frame_count) = row?;
            let state = MatchState::from_snapshot_json(&snapshot)?;
            summaries.push(StoredMatchSummary {
                id,
                created_at,
                updated_at,
                frame_count: frame_count as usize,
                state,
            });
        }

        Ok(summaries)
    }

    pub fn load_replay(&self, id: &str) -> Result<Option<StoredReplay>, MatchStoreError> {
        let summary = self.load_replay_summary(id)?;
        let Some(summary) = summary else {
            return Ok(None);
        };

        let mut statement = self.connection.prepare(
            "
            SELECT frame_index, action_index, event_json, snapshot_json
            FROM match_replay_frames
            WHERE match_id = ?1
            ORDER BY frame_index ASC
            ",
        )?;
        let rows = statement.query_map(params![id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<i64>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?;

        let mut frames = Vec::new();
        for row in rows {
            let (frame_index, action_index, event_json, snapshot_json) = row?;
            let event = serde_json::from_str::<ReplayEvent>(&event_json)?;
            let state = MatchState::from_snapshot_json(&snapshot_json)?;
            frames.push(StoredReplayFrame {
                frame_index: frame_index as u32,
                action_index: action_index.map(|index| index as u32),
                event,
                state,
            });
        }

        if frames.is_empty() {
            return Ok(None);
        }

        Ok(Some(StoredReplay { summary, frames }))
    }

    fn load_replay_summary(&self, id: &str) -> Result<Option<StoredMatchSummary>, MatchStoreError> {
        let row: Option<(String, String, i64, i64, i64)> = self
            .connection
            .query_row(
                "
                SELECT
                    matches.id,
                    matches.snapshot_json,
                    matches.created_at,
                    matches.updated_at,
                    COUNT(match_replay_frames.frame_index) AS frame_count
                FROM matches
                LEFT JOIN match_replay_frames ON match_replay_frames.match_id = matches.id
                WHERE matches.id = ?1
                    AND matches.initial_snapshot_json IS NOT NULL
                GROUP BY matches.id
                HAVING frame_count > 0
                ",
                params![id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                    ))
                },
            )
            .optional()?;

        row.map(|(id, snapshot, created_at, updated_at, frame_count)| {
            MatchState::from_snapshot_json(&snapshot).map(|state| StoredMatchSummary {
                id,
                created_at,
                updated_at,
                frame_count: frame_count as usize,
                state,
            })
        })
        .transpose()
        .map_err(MatchStoreError::from)
    }

    fn load_shared_seats(&self, match_id: &str) -> Result<Vec<StoredSharedSeat>, MatchStoreError> {
        let mut statement = self.connection.prepare(
            "
            SELECT side, seat_token, wizard_type, joined_at, last_seen_at, disconnected_at
            FROM match_seats
            WHERE match_id = ?1
            ",
        )?;
        let rows = statement.query_map(params![match_id], |row| {
            let side = row.get::<_, String>(0)?;
            let wizard_type = row.get::<_, Option<String>>(2)?;
            Ok(StoredSharedSeat {
                side: side_from_db(&side).expect("stored side should be valid"),
                seat_token: row.get(1)?,
                wizard_type: wizard_type.as_deref().and_then(wizard_type_from_db),
                joined_at: row.get(3)?,
                disconnected_at: row.get(5)?,
            })
        })?;

        let mut seats = Vec::new();
        for row in rows {
            seats.push(row?);
        }
        Ok(seats)
    }
}

impl SharedMatchStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Setup => "setup",
            Self::Active => "active",
            Self::Completed => "completed",
            Self::Forfeited => "forfeited",
        }
    }

    fn from_db(value: &str) -> Self {
        match value {
            "setup" => Self::Setup,
            "active" => Self::Active,
            "completed" => Self::Completed,
            "forfeited" => Self::Forfeited,
            _ => Self::Setup,
        }
    }
}

impl Side {
    fn to_db(self) -> &'static str {
        match self {
            Self::Player => "player",
            Self::Opponent => "opponent",
        }
    }
}

impl WizardType {
    fn to_db(self) -> &'static str {
        match self {
            Self::Runekeeper => "runekeeper",
            Self::Pyromancer => "pyromancer",
            Self::Chronomancer => "chronomancer",
            Self::Warden => "warden",
            Self::Battlemage => "battlemage",
        }
    }
}

fn side_from_db(value: &str) -> Option<Side> {
    match value {
        "player" => Some(Side::Player),
        "opponent" => Some(Side::Opponent),
        _ => None,
    }
}

fn wizard_type_from_db(value: &str) -> Option<WizardType> {
    match value {
        "runekeeper" => Some(WizardType::Runekeeper),
        "pyromancer" => Some(WizardType::Pyromancer),
        "chronomancer" => Some(WizardType::Chronomancer),
        "warden" => Some(WizardType::Warden),
        "battlemage" => Some(WizardType::Battlemage),
        _ => None,
    }
}

fn insert_shared_seat(
    transaction: &Transaction<'_>,
    match_id: &str,
    side: Side,
    seat_token: &str,
    wizard_type: Option<WizardType>,
    joined: bool,
) -> Result<(), MatchStoreError> {
    let joined_expr = if joined { "unixepoch()" } else { "NULL" };
    transaction.execute(
        &format!(
            "
            INSERT INTO match_seats (
                match_id,
                side,
                seat_token,
                wizard_type,
                joined_at,
                last_seen_at
            )
            VALUES (?1, ?2, ?3, ?4, {joined_expr}, {joined_expr})
            "
        ),
        params![
            match_id,
            side.to_db(),
            seat_token,
            wizard_type.map(WizardType::to_db)
        ],
    )?;
    Ok(())
}

fn ready_shared_wizard_types(
    transaction: &Transaction<'_>,
    match_id: &str,
) -> Result<Option<(WizardType, WizardType)>, MatchStoreError> {
    let mut statement = transaction.prepare(
        "
        SELECT side, wizard_type, joined_at
        FROM match_seats
        WHERE match_id = ?1
        ",
    )?;
    let rows = statement.query_map(params![match_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, Option<i64>>(2)?,
        ))
    })?;

    let mut player_wizard_type = None;
    let mut opponent_wizard_type = None;
    for row in rows {
        let (side, wizard_type, joined_at) = row?;
        if joined_at.is_none() {
            continue;
        }
        let Some(wizard_type) = wizard_type.as_deref().and_then(wizard_type_from_db) else {
            continue;
        };
        match side_from_db(&side) {
            Some(Side::Player) => player_wizard_type = Some(wizard_type),
            Some(Side::Opponent) => opponent_wizard_type = Some(wizard_type),
            None => {}
        }
    }

    Ok(player_wizard_type.zip(opponent_wizard_type))
}

fn add_column_if_missing(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), MatchStoreError> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
    for existing in columns {
        if existing? == column {
            return Ok(());
        }
    }

    connection.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
        [],
    )?;
    Ok(())
}

fn next_frame_index(transaction: &Transaction<'_>, id: &str) -> Result<u32, MatchStoreError> {
    let next = transaction.query_row(
        "
        SELECT COALESCE(MAX(frame_index) + 1, 0)
        FROM match_replay_frames
        WHERE match_id = ?1
        ",
        params![id],
        |row| row.get::<_, i64>(0),
    )?;

    Ok(next as u32)
}

fn insert_replay_frame(
    transaction: &Transaction<'_>,
    id: &str,
    frame_index: u32,
    frame: &RecordedReplayFrame,
    event_json: &str,
) -> Result<(), MatchStoreError> {
    transaction.execute(
        "
        INSERT INTO match_replay_frames (
            match_id,
            frame_index,
            action_index,
            event_json,
            snapshot_json,
            created_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, unixepoch())
        ",
        params![
            id,
            i64::from(frame_index),
            frame.action_index.map(i64::from),
            event_json,
            frame.snapshot_json
        ],
    )?;
    Ok(())
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

fn random_seat_token() -> String {
    let mut bytes = [0_u8; 24];
    OsRng.fill_bytes(&mut bytes);
    let mut token = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        token.push_str(&format!("{byte:02x}"));
    }
    token
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
    fn legacy_matches_without_replay_metadata_are_excluded_from_replays() {
        let path = test_db_path("legacy");
        let store = SqliteMatchStore::new(&path).expect("store should open");
        let legacy_state = MatchState::new();
        let snapshot = legacy_state
            .to_snapshot_json()
            .expect("snapshot should serialize");
        store
            .connection
            .execute(
                "
                INSERT INTO matches (id, snapshot_json, created_at, updated_at)
                VALUES (?1, ?2, unixepoch(), unixepoch())
                ",
                params!["rl-legacy", snapshot],
            )
            .expect("legacy row should insert");

        assert!(
            store
                .list_replayable_matches()
                .expect("archive should load")
                .is_empty()
        );
        assert!(
            store
                .load_replay("rl-legacy")
                .expect("replay lookup should succeed")
                .is_none()
        );

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
