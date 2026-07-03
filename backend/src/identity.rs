use std::error::Error;
use std::fmt;

use argon2::Argon2;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use rand::RngCore;
use rand::rngs::OsRng;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::match_session::WizardType;

#[derive(Clone, Debug)]
pub struct AccountProfile {
    pub id: i64,
    pub email: String,
    pub display_name: String,
    pub avatar: GeneratedAvatar,
    pub preferred_wizard_type: WizardType,
    pub board_visual_mode: BoardVisualMode,
    pub total_xp: i64,
}

#[derive(Clone, Debug)]
pub struct GeneratedAvatar {
    pub symbol: String,
    pub color: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub enum BoardVisualMode {
    #[serde(rename = "2d")]
    TwoD,
    #[serde(rename = "3d")]
    ThreeD,
}

#[derive(Clone, Debug)]
pub struct CreatedAuthSession {
    pub token: String,
    pub profile: AccountProfile,
}

pub struct IdentityModule<'a> {
    connection: &'a mut Connection,
}

type LoginProfileRow = (i64, String, String, String, String, String, String, String, i64);

#[derive(Debug)]
pub enum IdentityError {
    Sqlite(rusqlite::Error),
    PasswordHash(argon2::password_hash::Error),
}

impl fmt::Display for IdentityError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sqlite(error) => write!(f, "could not access account database: {error}"),
            Self::PasswordHash(error) => {
                write!(f, "could not process password credentials: {error}")
            }
        }
    }
}

impl Error for IdentityError {}

impl From<rusqlite::Error> for IdentityError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

impl From<argon2::password_hash::Error> for IdentityError {
    fn from(error: argon2::password_hash::Error) -> Self {
        Self::PasswordHash(error)
    }
}

impl<'a> IdentityModule<'a> {
    pub fn new(connection: &'a mut Connection) -> Self {
        Self { connection }
    }

    pub fn register(
        &mut self,
        email: &str,
        normalized_email: &str,
        password: &str,
    ) -> Result<Option<CreatedAuthSession>, IdentityError> {
        let password_hash = hash_password(password)?;
        let avatar = generated_avatar_for_email(normalized_email);
        let inserted = self.connection.execute(
            "
            INSERT OR IGNORE INTO users (
                email,
                email_normalized,
                password_hash,
                display_name,
                avatar_symbol,
                avatar_color,
                preferred_wizard_type,
                board_visual_mode,
                created_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, unixepoch())
            ",
            params![
                email,
                normalized_email,
                password_hash,
                default_display_name(email),
                avatar.symbol,
                avatar.color,
                wizard_type_to_db(WizardType::default()),
                board_visual_mode_to_db(BoardVisualMode::ThreeD)
            ],
        )?;

        if inserted == 0 {
            return Ok(None);
        }

        let profile = self
            .load_profile_by_normalized_email(normalized_email)?
            .expect("newly inserted account should load");
        self.create_session(profile).map(Some)
    }

    pub fn login(
        &mut self,
        normalized_email: &str,
        password: &str,
    ) -> Result<Option<CreatedAuthSession>, IdentityError> {
        let row: Option<LoginProfileRow> = self
            .connection
            .query_row(
                "
                SELECT id, email, password_hash, display_name, avatar_symbol, avatar_color, preferred_wizard_type, board_visual_mode, total_xp
                FROM users
                WHERE email_normalized = ?1
                ",
                params![normalized_email],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                        row.get(8)?,
                    ))
                },
            )
            .optional()?;

        let Some((
            id,
            email,
            password_hash,
            display_name,
            avatar_symbol,
            avatar_color,
            preferred_wizard_type,
            board_visual_mode,
            total_xp,
        )) = row
        else {
            return Ok(None);
        };

        if !password_matches(password, &password_hash) {
            return Ok(None);
        }

        self.create_session(AccountProfile {
            id,
            email,
            display_name,
            avatar: GeneratedAvatar {
                symbol: avatar_symbol,
                color: avatar_color,
            },
            preferred_wizard_type: wizard_type_from_db(&preferred_wizard_type),
            board_visual_mode: board_visual_mode_from_db(&board_visual_mode),
            total_xp,
        })
        .map(Some)
    }

    pub fn current_profile(
        &self,
        session_token: &str,
    ) -> Result<Option<AccountProfile>, IdentityError> {
        self.connection
            .query_row(
                "
                SELECT users.id, users.email, users.display_name, users.avatar_symbol, users.avatar_color, users.preferred_wizard_type, users.board_visual_mode, users.total_xp
                FROM auth_sessions
                JOIN users ON users.id = auth_sessions.user_id
                WHERE auth_sessions.token = ?1
                    AND auth_sessions.expires_at > unixepoch()
                ",
                params![session_token],
                |row| {
                    Ok(AccountProfile {
                        id: row.get(0)?,
                        email: row.get(1)?,
                        display_name: row.get(2)?,
                        avatar: GeneratedAvatar {
                            symbol: row.get(3)?,
                            color: row.get(4)?,
                        },
                        preferred_wizard_type: wizard_type_from_db(&row.get::<_, String>(5)?),
                        board_visual_mode: board_visual_mode_from_db(&row.get::<_, String>(6)?),
                        total_xp: row.get(7)?,
                    })
                },
            )
            .optional()
            .map_err(IdentityError::from)
    }

    pub fn update_profile(
        &mut self,
        user_id: i64,
        display_name: &str,
        avatar: GeneratedAvatar,
        preferred_wizard_type: WizardType,
        board_visual_mode: BoardVisualMode,
    ) -> Result<Option<AccountProfile>, IdentityError> {
        self.connection.execute(
            "
            UPDATE users
            SET display_name = ?2,
                avatar_symbol = ?3,
                avatar_color = ?4,
                preferred_wizard_type = ?5,
                board_visual_mode = ?6
            WHERE id = ?1
            ",
            params![
                user_id,
                display_name,
                avatar.symbol,
                avatar.color,
                wizard_type_to_db(preferred_wizard_type),
                board_visual_mode_to_db(board_visual_mode)
            ],
        )?;
        self.load_profile_by_id(user_id)
    }

    pub fn logout(&mut self, session_token: &str) -> Result<(), IdentityError> {
        self.connection.execute(
            "DELETE FROM auth_sessions WHERE token = ?1",
            params![session_token],
        )?;
        Ok(())
    }

    fn create_session(
        &mut self,
        profile: AccountProfile,
    ) -> Result<CreatedAuthSession, IdentityError> {
        let token = random_auth_token();
        self.connection.execute(
            "
            INSERT INTO auth_sessions (
                token,
                user_id,
                created_at,
                expires_at
            )
            VALUES (?1, ?2, unixepoch(), unixepoch() + 2592000)
            ",
            params![token, profile.id],
        )?;

        Ok(CreatedAuthSession { token, profile })
    }

    fn load_profile_by_normalized_email(
        &self,
        normalized_email: &str,
    ) -> Result<Option<AccountProfile>, IdentityError> {
        self.connection
            .query_row(
                "
                SELECT id, email, display_name, avatar_symbol, avatar_color, preferred_wizard_type, board_visual_mode, total_xp
                FROM users
                WHERE email_normalized = ?1
                ",
                params![normalized_email],
                |row| {
                    Ok(AccountProfile {
                        id: row.get(0)?,
                        email: row.get(1)?,
                        display_name: row.get(2)?,
                        avatar: GeneratedAvatar {
                            symbol: row.get(3)?,
                            color: row.get(4)?,
                        },
                        preferred_wizard_type: wizard_type_from_db(&row.get::<_, String>(5)?),
                        board_visual_mode: board_visual_mode_from_db(&row.get::<_, String>(6)?),
                        total_xp: row.get(7)?,
                    })
                },
            )
            .optional()
            .map_err(IdentityError::from)
    }

    fn load_profile_by_id(&self, user_id: i64) -> Result<Option<AccountProfile>, IdentityError> {
        self.connection
            .query_row(
                "
                SELECT id, email, display_name, avatar_symbol, avatar_color, preferred_wizard_type, board_visual_mode, total_xp
                FROM users
                WHERE id = ?1
                ",
                params![user_id],
                |row| {
                    Ok(AccountProfile {
                        id: row.get(0)?,
                        email: row.get(1)?,
                        display_name: row.get(2)?,
                        avatar: GeneratedAvatar {
                            symbol: row.get(3)?,
                            color: row.get(4)?,
                        },
                        preferred_wizard_type: wizard_type_from_db(&row.get::<_, String>(5)?),
                        board_visual_mode: board_visual_mode_from_db(&row.get::<_, String>(6)?),
                        total_xp: row.get(7)?,
                    })
                },
            )
            .optional()
            .map_err(IdentityError::from)
    }
}

pub fn migrate(connection: &Connection) -> Result<(), IdentityError> {
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            email_normalized TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            display_name TEXT NOT NULL DEFAULT '',
            avatar_symbol TEXT NOT NULL DEFAULT 'sparkles',
            avatar_color TEXT NOT NULL DEFAULT 'emerald',
            preferred_wizard_type TEXT NOT NULL DEFAULT 'runekeeper',
            board_visual_mode TEXT NOT NULL DEFAULT '3d',
            total_xp INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE TABLE IF NOT EXISTS auth_sessions (
            token TEXT PRIMARY KEY NOT NULL,
            user_id INTEGER NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            expires_at INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx
            ON auth_sessions(user_id);
        ",
    )?;
    add_column_if_missing(
        connection,
        "users",
        "display_name",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    add_column_if_missing(
        connection,
        "users",
        "avatar_symbol",
        "TEXT NOT NULL DEFAULT 'sparkles'",
    )?;
    add_column_if_missing(
        connection,
        "users",
        "avatar_color",
        "TEXT NOT NULL DEFAULT 'emerald'",
    )?;
    add_column_if_missing(
        connection,
        "users",
        "preferred_wizard_type",
        "TEXT NOT NULL DEFAULT 'runekeeper'",
    )?;
    add_column_if_missing(
        connection,
        "users",
        "board_visual_mode",
        "TEXT NOT NULL DEFAULT '3d'",
    )?;
    add_column_if_missing(
        connection,
        "users",
        "total_xp",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    connection.execute(
        "
        UPDATE users
        SET display_name = substr(email, 1, instr(email, '@') - 1)
        WHERE display_name = ''
            AND instr(email, '@') > 1
        ",
        [],
    )?;
    Ok(())
}

pub fn normalized_email(email: &str) -> Option<(String, String)> {
    let trimmed = email.trim();
    if trimmed.is_empty() || !trimmed.contains('@') {
        return None;
    }
    let normalized = trimmed.to_ascii_lowercase();
    Some((trimmed.to_string(), normalized))
}

fn default_display_name(email: &str) -> String {
    let name = email.split('@').next().unwrap_or("Player").trim();
    if name.is_empty() {
        "Player".to_string()
    } else {
        name.to_string()
    }
}

fn generated_avatar_for_email(normalized_email: &str) -> GeneratedAvatar {
    const SYMBOLS: [&str; 6] = ["sparkles", "shield", "sword", "wand", "rune", "flame"];
    const COLORS: [&str; 6] = ["emerald", "indigo", "rose", "amber", "sky", "slate"];
    let sum = normalized_email
        .bytes()
        .fold(0usize, |total, byte| total.wrapping_add(byte as usize));
    GeneratedAvatar {
        symbol: SYMBOLS[sum % SYMBOLS.len()].to_string(),
        color: COLORS[(sum / SYMBOLS.len()) % COLORS.len()].to_string(),
    }
}

fn wizard_type_to_db(wizard_type: WizardType) -> &'static str {
    match wizard_type {
        WizardType::Runekeeper => "runekeeper",
        WizardType::Pyromancer => "pyromancer",
        WizardType::Chronomancer => "chronomancer",
        WizardType::Warden => "warden",
        WizardType::Battlemage => "battlemage",
    }
}

fn wizard_type_from_db(value: &str) -> WizardType {
    match value {
        "pyromancer" => WizardType::Pyromancer,
        "chronomancer" => WizardType::Chronomancer,
        "warden" => WizardType::Warden,
        "battlemage" => WizardType::Battlemage,
        _ => WizardType::Runekeeper,
    }
}

fn board_visual_mode_to_db(mode: BoardVisualMode) -> &'static str {
    match mode {
        BoardVisualMode::TwoD => "2d",
        BoardVisualMode::ThreeD => "3d",
    }
}

fn board_visual_mode_from_db(value: &str) -> BoardVisualMode {
    match value {
        "2d" => BoardVisualMode::TwoD,
        _ => BoardVisualMode::ThreeD,
    }
}

fn add_column_if_missing(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), IdentityError> {
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

fn hash_password(password: &str) -> Result<String, IdentityError> {
    let salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)?
        .to_string();
    Ok(password_hash)
}

fn password_matches(password: &str, password_hash: &str) -> bool {
    let Ok(parsed_hash) = PasswordHash::new(password_hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok()
}

fn random_auth_token() -> String {
    random_hex_token(32)
}

fn random_hex_token(byte_count: usize) -> String {
    let mut bytes = vec![0_u8; byte_count];
    OsRng.fill_bytes(&mut bytes);
    bytes
        .into_iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
