use std::collections::{HashMap, HashSet};
use std::error::Error;
use std::fmt;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PreferenceTheme {
    System,
    Dark,
    Light,
    HighContrast,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MotionPreference {
    System,
    Reduced,
    Full,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AnimationSpeed {
    Slow,
    Normal,
    Fast,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BoardScale {
    Compact,
    Normal,
    Large,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyBinding {
    pub command_id: String,
    pub binding: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountPreferences {
    pub theme: PreferenceTheme,
    pub motion: MotionPreference,
    pub animation_speed: AnimationSpeed,
    pub board_scale: BoardScale,
    pub hotkeys: Vec<HotkeyBinding>,
    pub updated_at: Option<i64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePreferencesRequest {
    pub theme: PreferenceTheme,
    pub motion: MotionPreference,
    pub animation_speed: AnimationSpeed,
    pub board_scale: BoardScale,
    pub hotkeys: Vec<HotkeyBinding>,
}

#[derive(Debug)]
pub enum PreferencesError {
    Sqlite(rusqlite::Error),
    Json(serde_json::Error),
    Validation(String),
}

impl fmt::Display for PreferencesError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sqlite(error) => write!(f, "could not access account preferences: {error}"),
            Self::Json(error) => write!(f, "could not parse account preferences: {error}"),
            Self::Validation(message) => write!(f, "{message}"),
        }
    }
}

impl Error for PreferencesError {}

impl From<rusqlite::Error> for PreferencesError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

impl From<serde_json::Error> for PreferencesError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

pub struct PreferencesModule<'a> {
    connection: &'a mut Connection,
}

impl<'a> PreferencesModule<'a> {
    pub fn new(connection: &'a mut Connection) -> Self {
        Self { connection }
    }

    pub fn load_for_user(&self, user_id: i64) -> Result<AccountPreferences, PreferencesError> {
        let stored: Option<StoredPreferencesRow> = self
            .connection
            .query_row(
                "
                SELECT theme, motion, animation_speed, board_scale, hotkeys_json, updated_at
                FROM account_preferences
                WHERE user_id = ?1
                ",
                params![user_id],
                |row| {
                    Ok(StoredPreferencesRow {
                        theme: row.get(0)?,
                        motion: row.get(1)?,
                        animation_speed: row.get(2)?,
                        board_scale: row.get(3)?,
                        hotkeys_json: row.get(4)?,
                        updated_at: row.get(5)?,
                    })
                },
            )
            .optional()?;

        let Some(stored) = stored else {
            return Ok(default_preferences(None));
        };

        let stored_hotkeys: Vec<HotkeyBinding> = serde_json::from_str(&stored.hotkeys_json)?;
        Ok(AccountPreferences {
            theme: theme_from_db(&stored.theme),
            motion: motion_from_db(&stored.motion),
            animation_speed: animation_speed_from_db(&stored.animation_speed),
            board_scale: board_scale_from_db(&stored.board_scale),
            hotkeys: merge_hotkeys_with_defaults(stored_hotkeys),
            updated_at: Some(stored.updated_at),
        })
    }

    pub fn update_for_user(
        &mut self,
        user_id: i64,
        request: UpdatePreferencesRequest,
    ) -> Result<AccountPreferences, PreferencesError> {
        let normalized_hotkeys = validate_and_normalize_hotkeys(request.hotkeys)?;
        let hotkeys_json = serde_json::to_string(&normalized_hotkeys)?;

        self.connection.execute(
            "
            INSERT INTO account_preferences (
                user_id,
                theme,
                motion,
                animation_speed,
                board_scale,
                hotkeys_json,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, unixepoch())
            ON CONFLICT(user_id) DO UPDATE SET
                theme = excluded.theme,
                motion = excluded.motion,
                animation_speed = excluded.animation_speed,
                board_scale = excluded.board_scale,
                hotkeys_json = excluded.hotkeys_json,
                updated_at = excluded.updated_at
            ",
            params![
                user_id,
                theme_to_db(&request.theme),
                motion_to_db(&request.motion),
                animation_speed_to_db(&request.animation_speed),
                board_scale_to_db(&request.board_scale),
                hotkeys_json
            ],
        )?;

        self.load_for_user(user_id)
    }
}

struct StoredPreferencesRow {
    theme: String,
    motion: String,
    animation_speed: String,
    board_scale: String,
    hotkeys_json: String,
    updated_at: i64,
}

pub fn migrate(connection: &Connection) -> Result<(), PreferencesError> {
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS account_preferences (
            user_id INTEGER PRIMARY KEY NOT NULL,
            theme TEXT NOT NULL DEFAULT 'system',
            motion TEXT NOT NULL DEFAULT 'system',
            animation_speed TEXT NOT NULL DEFAULT 'normal',
            board_scale TEXT NOT NULL DEFAULT 'normal',
            hotkeys_json TEXT NOT NULL DEFAULT '[]',
            updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        ",
    )?;
    Ok(())
}

pub fn default_preferences(updated_at: Option<i64>) -> AccountPreferences {
    AccountPreferences {
        theme: PreferenceTheme::System,
        motion: MotionPreference::System,
        animation_speed: AnimationSpeed::Normal,
        board_scale: BoardScale::Normal,
        hotkeys: default_hotkeys(),
        updated_at,
    }
}

fn default_hotkeys() -> Vec<HotkeyBinding> {
    hotkey_command_registry()
        .into_iter()
        .map(|command| HotkeyBinding {
            command_id: command.command_id.to_string(),
            binding: command.default_binding.to_string(),
        })
        .collect()
}

fn hotkey_command_registry() -> Vec<HotkeyCommand> {
    vec![
        HotkeyCommand::new("cursorNorthwest", "Q"),
        HotkeyCommand::new("cursorNortheast", "W"),
        HotkeyCommand::new("cursorEast", "E"),
        HotkeyCommand::new("cursorWest", "A"),
        HotkeyCommand::new("cursorSouthwest", "S"),
        HotkeyCommand::new("cursorSoutheast", "D"),
        HotkeyCommand::new("confirm", "Enter"),
        HotkeyCommand::new("cancel", "Escape"),
        HotkeyCommand::new("endTurn", "T"),
        HotkeyCommand::new("passPriority", "P"),
        HotkeyCommand::new("openCardInfo", "I"),
        HotkeyCommand::new("openSettings", ","),
        HotkeyCommand::new("openCatalog", "C"),
        HotkeyCommand::new("openDecks", "K"),
        HotkeyCommand::new("openMatchArchive", "M"),
    ]
}

fn merge_hotkeys_with_defaults(stored_hotkeys: Vec<HotkeyBinding>) -> Vec<HotkeyBinding> {
    let registry = hotkey_command_registry();
    let default_binding_owners: HashMap<String, &str> = registry
        .iter()
        .map(|command| {
            (
                command.default_binding.to_ascii_lowercase(),
                command.command_id,
            )
        })
        .collect();
    let mut seen_stored_bindings = HashSet::new();
    let mut stored_by_command = HashMap::new();

    for hotkey in stored_hotkeys {
        let Ok(binding) = normalize_binding(&hotkey.binding) else {
            continue;
        };
        if !command_exists(&hotkey.command_id) || !binding_is_safe(&hotkey.command_id, &binding) {
            continue;
        }
        let normalized_binding = binding.to_ascii_lowercase();
        if default_binding_owners
            .get(&normalized_binding)
            .is_some_and(|owner| *owner != hotkey.command_id)
        {
            continue;
        }
        if !seen_stored_bindings.insert(normalized_binding) {
            continue;
        }
        stored_by_command.insert(hotkey.command_id, binding);
    }

    registry
        .into_iter()
        .map(|command| HotkeyBinding {
            command_id: command.command_id.to_string(),
            binding: stored_by_command
                .get(command.command_id)
                .cloned()
                .unwrap_or_else(|| command.default_binding.to_string()),
        })
        .collect()
}

fn validate_and_normalize_hotkeys(
    hotkeys: Vec<HotkeyBinding>,
) -> Result<Vec<HotkeyBinding>, PreferencesError> {
    let registry = hotkey_command_registry();
    let known_commands: HashSet<&str> = registry.iter().map(|command| command.command_id).collect();

    let mut seen_commands = HashSet::new();
    let mut seen_bindings = HashSet::new();
    let mut normalized = Vec::with_capacity(hotkeys.len());

    for hotkey in hotkeys {
        if !known_commands.contains(hotkey.command_id.as_str()) {
            return Err(PreferencesError::Validation(format!(
                "Unknown hotkey command: {}",
                hotkey.command_id
            )));
        }
        if !seen_commands.insert(hotkey.command_id.clone()) {
            return Err(PreferencesError::Validation(format!(
                "Duplicate hotkey command: {}",
                hotkey.command_id
            )));
        }

        let binding = normalize_binding(&hotkey.binding)?;
        if !binding_is_safe(&hotkey.command_id, &binding) {
            return Err(PreferencesError::Validation(format!(
                "{binding} is reserved and cannot be assigned to {}.",
                hotkey.command_id
            )));
        }
        if !seen_bindings.insert(binding.to_ascii_lowercase()) {
            return Err(PreferencesError::Validation(format!(
                "Duplicate hotkey binding: {binding}"
            )));
        }

        normalized.push(HotkeyBinding {
            command_id: hotkey.command_id,
            binding,
        });
    }

    if normalized.len() != registry.len() {
        return Err(PreferencesError::Validation(
            "Provide one binding for every hotkey command.".to_string(),
        ));
    }

    normalized.sort_by_key(|hotkey| command_order(&hotkey.command_id));
    Ok(normalized)
}

fn normalize_binding(binding: &str) -> Result<String, PreferencesError> {
    let trimmed = binding.trim();
    if trimmed.is_empty() {
        return Err(PreferencesError::Validation(
            "Hotkey bindings cannot be empty.".to_string(),
        ));
    }
    if trimmed.chars().any(char::is_whitespace) {
        return Err(PreferencesError::Validation(format!(
            "Malformed hotkey binding: {trimmed}"
        )));
    }

    let normalized = match trimmed.to_ascii_lowercase().as_str() {
        "enter" => "Enter".to_string(),
        "escape" | "esc" => "Escape".to_string(),
        value if value.chars().count() == 1 => value.to_ascii_uppercase(),
        _ => {
            return Err(PreferencesError::Validation(format!(
                "Malformed hotkey binding: {trimmed}"
            )));
        }
    };
    Ok(normalized)
}

fn binding_is_safe(command_id: &str, binding: &str) -> bool {
    match binding {
        "Escape" => command_id == "cancel",
        "Enter" => command_id == "confirm",
        "Tab" | "Backspace" | "Delete" | " " => false,
        _ => true,
    }
}

fn command_exists(command_id: &str) -> bool {
    hotkey_command_registry()
        .iter()
        .any(|command| command.command_id == command_id)
}

fn command_order(command_id: &str) -> usize {
    hotkey_command_registry()
        .iter()
        .position(|command| command.command_id == command_id)
        .unwrap_or(usize::MAX)
}

#[derive(Clone, Copy)]
struct HotkeyCommand {
    command_id: &'static str,
    default_binding: &'static str,
}

impl HotkeyCommand {
    fn new(command_id: &'static str, default_binding: &'static str) -> Self {
        Self {
            command_id,
            default_binding,
        }
    }
}

fn theme_to_db(theme: &PreferenceTheme) -> &'static str {
    match theme {
        PreferenceTheme::System => "system",
        PreferenceTheme::Dark => "dark",
        PreferenceTheme::Light => "light",
        PreferenceTheme::HighContrast => "highContrast",
    }
}

fn theme_from_db(value: &str) -> PreferenceTheme {
    match value {
        "dark" => PreferenceTheme::Dark,
        "light" => PreferenceTheme::Light,
        "highContrast" => PreferenceTheme::HighContrast,
        _ => PreferenceTheme::System,
    }
}

fn motion_to_db(motion: &MotionPreference) -> &'static str {
    match motion {
        MotionPreference::System => "system",
        MotionPreference::Reduced => "reduced",
        MotionPreference::Full => "full",
    }
}

fn motion_from_db(value: &str) -> MotionPreference {
    match value {
        "reduced" => MotionPreference::Reduced,
        "full" => MotionPreference::Full,
        _ => MotionPreference::System,
    }
}

fn animation_speed_to_db(speed: &AnimationSpeed) -> &'static str {
    match speed {
        AnimationSpeed::Slow => "slow",
        AnimationSpeed::Normal => "normal",
        AnimationSpeed::Fast => "fast",
    }
}

fn animation_speed_from_db(value: &str) -> AnimationSpeed {
    match value {
        "slow" => AnimationSpeed::Slow,
        "fast" => AnimationSpeed::Fast,
        _ => AnimationSpeed::Normal,
    }
}

fn board_scale_to_db(scale: &BoardScale) -> &'static str {
    match scale {
        BoardScale::Compact => "compact",
        BoardScale::Normal => "normal",
        BoardScale::Large => "large",
    }
}

fn board_scale_from_db(value: &str) -> BoardScale {
    match value {
        "compact" => BoardScale::Compact,
        "large" => BoardScale::Large,
        _ => BoardScale::Normal,
    }
}
