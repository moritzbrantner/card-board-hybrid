use std::collections::HashSet;
use std::error::Error;
use std::fmt;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::match_session::{
    MatchProgressionEffects, MatchProgressionLoadout, MatchState, Side, WizardType,
};

const COMPLETION_XP: i64 = 100;
const WIN_BONUS_XP: i64 = 50;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressionSummary {
    pub total_xp: i64,
    pub level: u32,
    pub current_level_xp: i64,
    pub next_level_xp: i64,
    pub xp_into_level: i64,
    pub xp_to_next_level: i64,
    pub rune_slots: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressionResponse {
    pub account: ProgressionSummary,
    pub runes: Vec<RuneDefinition>,
    pub wizards: Vec<WizardProgression>,
    pub skill_trees: Vec<WizardSkillTree>,
    pub loadouts: Vec<SavedRuneLoadout>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuneDefinition {
    pub id: &'static str,
    pub name: &'static str,
    pub text: &'static str,
    pub unlock_level: u32,
    pub unlocked: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WizardProgression {
    pub wizard_type: WizardType,
    pub xp: i64,
    pub level: u32,
    pub current_level_xp: i64,
    pub next_level_xp: i64,
    pub xp_into_level: i64,
    pub xp_to_next_level: i64,
    pub total_skill_points: usize,
    pub spent_skill_points: usize,
    pub available_skill_points: usize,
    pub unlocked_skill_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WizardSkillTree {
    pub wizard_type: WizardType,
    pub nodes: Vec<SkillNodeDefinition>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillNodeDefinition {
    pub id: &'static str,
    pub name: &'static str,
    pub text: &'static str,
    pub root: bool,
    pub prerequisite_id: Option<&'static str>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRuneLoadout {
    pub wizard_type: WizardType,
    pub rune_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRuneLoadoutRequest {
    pub rune_ids: Vec<String>,
}

pub struct ProgressionModule<'a> {
    connection: &'a mut Connection,
}

#[derive(Debug)]
pub enum ProgressionError {
    Sqlite(rusqlite::Error),
    Snapshot(serde_json::Error),
    UnknownRune(String),
    LockedRune(String),
    DuplicateRune(String),
    TooManyRunes { requested: usize, allowed: usize },
    UnknownSkill(String),
    SkillAlreadyUnlocked(String),
    SkillPrerequisiteMissing(String),
    NotEnoughSkillPoints,
}

impl fmt::Display for ProgressionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sqlite(error) => write!(f, "could not access progression database: {error}"),
            Self::Snapshot(error) => {
                write!(f, "could not read persisted progression snapshot: {error}")
            }
            Self::UnknownRune(rune_id) => write!(f, "Unknown rune: {rune_id}"),
            Self::LockedRune(rune_id) => write!(f, "Rune is not unlocked: {rune_id}"),
            Self::DuplicateRune(rune_id) => write!(f, "Rune may only be equipped once: {rune_id}"),
            Self::TooManyRunes { requested, allowed } => {
                write!(
                    f,
                    "Too many runes selected: requested {requested}, allowed {allowed}"
                )
            }
            Self::UnknownSkill(node_id) => write!(f, "Unknown skill: {node_id}"),
            Self::SkillAlreadyUnlocked(node_id) => {
                write!(f, "Skill is already unlocked: {node_id}")
            }
            Self::SkillPrerequisiteMissing(node_id) => {
                write!(f, "Skill prerequisite is not unlocked: {node_id}")
            }
            Self::NotEnoughSkillPoints => write!(f, "Not enough skill points."),
        }
    }
}

impl Error for ProgressionError {}

impl From<rusqlite::Error> for ProgressionError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

impl From<serde_json::Error> for ProgressionError {
    fn from(error: serde_json::Error) -> Self {
        Self::Snapshot(error)
    }
}

impl<'a> ProgressionModule<'a> {
    pub fn new(connection: &'a mut Connection) -> Self {
        Self { connection }
    }

    pub fn load_for_user(&mut self, user_id: i64) -> Result<ProgressionResponse, ProgressionError> {
        let total_xp = self.total_xp(user_id)?;
        let account = summary_for_xp(total_xp);
        let runes = rune_definitions()
            .into_iter()
            .map(|rune| RuneDefinition {
                unlocked: account.level >= rune.unlock_level,
                ..rune
            })
            .collect();
        let mut wizards = Vec::new();
        for wizard_type in wizard_types() {
            wizards.push(self.wizard_progression(user_id, wizard_type)?);
        }
        Ok(ProgressionResponse {
            account,
            runes,
            wizards,
            skill_trees: skill_trees(),
            loadouts: self.load_saved_loadouts(user_id)?,
        })
    }

    pub fn progression_summary(
        &self,
        user_id: i64,
    ) -> Result<ProgressionSummary, ProgressionError> {
        self.total_xp(user_id).map(summary_for_xp)
    }

    pub fn unlock_skill(
        &mut self,
        user_id: i64,
        wizard_type: WizardType,
        node_id: &str,
    ) -> Result<ProgressionResponse, ProgressionError> {
        let Some(node) = skill_node(wizard_type, node_id) else {
            return Err(ProgressionError::UnknownSkill(node_id.to_string()));
        };
        if node.root {
            return Err(ProgressionError::SkillAlreadyUnlocked(node_id.to_string()));
        }
        let progression = self.wizard_progression(user_id, wizard_type)?;
        if progression
            .unlocked_skill_ids
            .iter()
            .any(|unlocked| unlocked == node_id)
        {
            return Err(ProgressionError::SkillAlreadyUnlocked(node_id.to_string()));
        }
        if progression.available_skill_points == 0 {
            return Err(ProgressionError::NotEnoughSkillPoints);
        }
        if let Some(prerequisite_id) = node.prerequisite_id {
            let prerequisite_unlocked = prerequisite_id == root_skill_id(wizard_type)
                || progression
                    .unlocked_skill_ids
                    .iter()
                    .any(|unlocked| unlocked == prerequisite_id);
            if !prerequisite_unlocked {
                return Err(ProgressionError::SkillPrerequisiteMissing(
                    prerequisite_id.to_string(),
                ));
            }
        }

        self.connection.execute(
            "
            INSERT INTO wizard_skill_unlocks (user_id, wizard_type, node_id, unlocked_at)
            VALUES (?1, ?2, ?3, unixepoch())
            ",
            params![user_id, wizard_type_to_db(wizard_type), node_id],
        )?;
        self.load_for_user(user_id)
    }

    pub fn respec_wizard(
        &mut self,
        user_id: i64,
        wizard_type: WizardType,
    ) -> Result<ProgressionResponse, ProgressionError> {
        self.connection.execute(
            "
            DELETE FROM wizard_skill_unlocks
            WHERE user_id = ?1 AND wizard_type = ?2
            ",
            params![user_id, wizard_type_to_db(wizard_type)],
        )?;
        self.load_for_user(user_id)
    }

    pub fn save_rune_loadout(
        &mut self,
        user_id: i64,
        wizard_type: WizardType,
        request: SaveRuneLoadoutRequest,
    ) -> Result<ProgressionResponse, ProgressionError> {
        self.validate_rune_ids(user_id, &request.rune_ids)?;
        let rune_ids_json = serde_json::to_string(&request.rune_ids)?;
        self.connection.execute(
            "
            INSERT INTO wizard_rune_loadouts (user_id, wizard_type, rune_ids_json, updated_at)
            VALUES (?1, ?2, ?3, unixepoch())
            ON CONFLICT(user_id, wizard_type) DO UPDATE SET
                rune_ids_json = excluded.rune_ids_json,
                updated_at = unixepoch()
            ",
            params![user_id, wizard_type_to_db(wizard_type), rune_ids_json],
        )?;
        self.load_for_user(user_id)
    }

    pub fn match_loadout(
        &mut self,
        user_id: Option<i64>,
        wizard_type: WizardType,
        requested_rune_ids: Option<Vec<String>>,
    ) -> Result<MatchProgressionLoadout, ProgressionError> {
        let Some(user_id) = user_id else {
            return Ok(MatchProgressionLoadout::default());
        };
        let rune_ids = match requested_rune_ids {
            Some(rune_ids) => rune_ids,
            None => self
                .saved_rune_ids(user_id, wizard_type)?
                .unwrap_or_default(),
        };
        self.validate_rune_ids(user_id, &rune_ids)?;
        let skill_ids = self.active_skill_ids(user_id, wizard_type)?;
        Ok(MatchProgressionLoadout {
            rune_ids: rune_ids.clone(),
            skill_ids: skill_ids.clone(),
            effects: effects_for(&rune_ids, &skill_ids),
        })
    }

    fn total_xp(&self, user_id: i64) -> Result<i64, ProgressionError> {
        self.connection
            .query_row(
                "SELECT total_xp FROM users WHERE id = ?1",
                params![user_id],
                |row| row.get(0),
            )
            .map_err(ProgressionError::from)
    }

    fn wizard_progression(
        &self,
        user_id: i64,
        wizard_type: WizardType,
    ) -> Result<WizardProgression, ProgressionError> {
        let xp = self.wizard_xp(user_id, wizard_type)?;
        let level_summary = summary_for_xp(xp);
        let unlocked_skill_ids = self.unlocked_skill_ids(user_id, wizard_type)?;
        let spent_skill_points = unlocked_skill_ids.len();
        let total_skill_points = level_summary.level.saturating_sub(1) as usize;
        let available_skill_points = total_skill_points.saturating_sub(spent_skill_points);
        Ok(WizardProgression {
            wizard_type,
            xp,
            level: level_summary.level,
            current_level_xp: level_summary.current_level_xp,
            next_level_xp: level_summary.next_level_xp,
            xp_into_level: level_summary.xp_into_level,
            xp_to_next_level: level_summary.xp_to_next_level,
            total_skill_points,
            spent_skill_points,
            available_skill_points,
            unlocked_skill_ids,
        })
    }

    fn wizard_xp(&self, user_id: i64, wizard_type: WizardType) -> Result<i64, ProgressionError> {
        self.connection
            .query_row(
                "
                SELECT xp
                FROM wizard_mastery
                WHERE user_id = ?1 AND wizard_type = ?2
                ",
                params![user_id, wizard_type_to_db(wizard_type)],
                |row| row.get(0),
            )
            .optional()
            .map(|xp| xp.unwrap_or(0))
            .map_err(ProgressionError::from)
    }

    fn unlocked_skill_ids(
        &self,
        user_id: i64,
        wizard_type: WizardType,
    ) -> Result<Vec<String>, ProgressionError> {
        let mut statement = self.connection.prepare(
            "
            SELECT node_id
            FROM wizard_skill_unlocks
            WHERE user_id = ?1 AND wizard_type = ?2
            ORDER BY unlocked_at ASC, node_id ASC
            ",
        )?;
        let rows = statement
            .query_map(params![user_id, wizard_type_to_db(wizard_type)], |row| {
                row.get::<_, String>(0)
            })?;
        let mut node_ids = Vec::new();
        for row in rows {
            node_ids.push(row?);
        }
        Ok(node_ids)
    }

    fn active_skill_ids(
        &self,
        user_id: i64,
        wizard_type: WizardType,
    ) -> Result<Vec<String>, ProgressionError> {
        let mut skill_ids = vec![root_skill_id(wizard_type).to_string()];
        skill_ids.extend(self.unlocked_skill_ids(user_id, wizard_type)?);
        Ok(skill_ids)
    }

    fn load_saved_loadouts(&self, user_id: i64) -> Result<Vec<SavedRuneLoadout>, ProgressionError> {
        let mut loadouts = Vec::new();
        for wizard_type in wizard_types() {
            loadouts.push(SavedRuneLoadout {
                wizard_type,
                rune_ids: self
                    .saved_rune_ids(user_id, wizard_type)?
                    .unwrap_or_default(),
            });
        }
        Ok(loadouts)
    }

    fn saved_rune_ids(
        &self,
        user_id: i64,
        wizard_type: WizardType,
    ) -> Result<Option<Vec<String>>, ProgressionError> {
        let rune_ids_json: Option<String> = self
            .connection
            .query_row(
                "
                SELECT rune_ids_json
                FROM wizard_rune_loadouts
                WHERE user_id = ?1 AND wizard_type = ?2
                ",
                params![user_id, wizard_type_to_db(wizard_type)],
                |row| row.get(0),
            )
            .optional()?;

        rune_ids_json
            .as_deref()
            .map(serde_json::from_str)
            .transpose()
            .map_err(ProgressionError::from)
    }

    fn validate_rune_ids(&self, user_id: i64, rune_ids: &[String]) -> Result<(), ProgressionError> {
        let allowed = self.progression_summary(user_id)?.rune_slots;
        if rune_ids.len() > allowed {
            return Err(ProgressionError::TooManyRunes {
                requested: rune_ids.len(),
                allowed,
            });
        }

        let level = self.progression_summary(user_id)?.level;
        let mut seen = HashSet::new();
        for rune_id in rune_ids {
            let Some(rune) = rune_definition(rune_id) else {
                return Err(ProgressionError::UnknownRune(rune_id.clone()));
            };
            if !seen.insert(rune_id) {
                return Err(ProgressionError::DuplicateRune(rune_id.clone()));
            }
            if level < rune.unlock_level {
                return Err(ProgressionError::LockedRune(rune_id.clone()));
            }
        }
        Ok(())
    }
}

pub fn migrate(connection: &Connection) -> Result<(), ProgressionError> {
    add_column_if_missing(
        connection,
        "users",
        "total_xp",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS match_xp_awards (
            match_id TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            account_xp INTEGER NOT NULL,
            wizard_type TEXT NOT NULL,
            wizard_xp INTEGER NOT NULL,
            won INTEGER NOT NULL,
            awarded_at INTEGER NOT NULL,
            PRIMARY KEY (match_id, user_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS wizard_mastery (
            user_id INTEGER NOT NULL,
            wizard_type TEXT NOT NULL,
            xp INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, wizard_type),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS wizard_skill_unlocks (
            user_id INTEGER NOT NULL,
            wizard_type TEXT NOT NULL,
            node_id TEXT NOT NULL,
            unlocked_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, wizard_type, node_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS wizard_rune_loadouts (
            user_id INTEGER NOT NULL,
            wizard_type TEXT NOT NULL,
            rune_ids_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, wizard_type),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        ",
    )?;
    Ok(())
}

pub fn award_completed_match(
    connection: &mut Connection,
    match_id: &str,
) -> Result<(), ProgressionError> {
    let row: Option<(String, Option<i64>, String)> = connection
        .query_row(
            "
            SELECT snapshot_json, owner_user_id, mode
            FROM matches
            WHERE id = ?1
            ",
            params![match_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let Some((snapshot_json, owner_user_id, mode)) = row else {
        return Ok(());
    };
    let match_state = MatchState::from_snapshot_json(&snapshot_json)?;
    let Some(winner) = match_state.winner else {
        return Ok(());
    };

    let participants = if mode == "shared" {
        shared_participants(connection, match_id, &match_state)?
    } else {
        owner_user_id
            .map(|user_id| {
                vec![AwardParticipant {
                    user_id,
                    side: Side::Player,
                    wizard_type: match_state.player.wizard.wizard_type,
                }]
            })
            .unwrap_or_default()
    };

    for participant in participants {
        let won = participant.side == winner;
        let xp = COMPLETION_XP + if won { WIN_BONUS_XP } else { 0 };
        let inserted = connection.execute(
            "
            INSERT OR IGNORE INTO match_xp_awards (
                match_id,
                user_id,
                account_xp,
                wizard_type,
                wizard_xp,
                won,
                awarded_at
            )
            VALUES (?1, ?2, ?3, ?4, ?3, ?5, unixepoch())
            ",
            params![
                match_id,
                participant.user_id,
                xp,
                wizard_type_to_db(participant.wizard_type),
                won
            ],
        )?;
        if inserted == 0 {
            continue;
        }
        connection.execute(
            "
            UPDATE users
            SET total_xp = total_xp + ?2
            WHERE id = ?1
            ",
            params![participant.user_id, xp],
        )?;
        connection.execute(
            "
            INSERT INTO wizard_mastery (user_id, wizard_type, xp)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(user_id, wizard_type) DO UPDATE SET
                xp = wizard_mastery.xp + excluded.xp
            ",
            params![
                participant.user_id,
                wizard_type_to_db(participant.wizard_type),
                xp
            ],
        )?;
    }

    Ok(())
}

pub fn summary_for_xp(total_xp: i64) -> ProgressionSummary {
    let total_xp = total_xp.max(0);
    let mut level = 1_u32;
    loop {
        let next_level_xp = cumulative_xp_for_level(level + 1);
        if total_xp < next_level_xp {
            let current_level_xp = cumulative_xp_for_level(level);
            return ProgressionSummary {
                total_xp,
                level,
                current_level_xp,
                next_level_xp,
                xp_into_level: total_xp - current_level_xp,
                xp_to_next_level: next_level_xp - total_xp,
                rune_slots: rune_slots_for_level(level),
            };
        }
        level += 1;
    }
}

fn cumulative_xp_for_level(level: u32) -> i64 {
    let completed_steps = i64::from(level.saturating_sub(1));
    completed_steps * (completed_steps + 1) / 2 * 100
}

fn rune_slots_for_level(level: u32) -> usize {
    if level >= 10 { 2 } else { 1 }
}

fn rune_definitions() -> Vec<RuneDefinition> {
    vec![
        RuneDefinition {
            id: "vitality",
            name: "Vitality Rune",
            text: "Wizard starts with +2 max HP.",
            unlock_level: 2,
            unlocked: false,
        },
        RuneDefinition {
            id: "force",
            name: "Force Rune",
            text: "Wizard starts with +1 attack.",
            unlock_level: 4,
            unlocked: false,
        },
        RuneDefinition {
            id: "foresight",
            name: "Foresight Rune",
            text: "Draw +1 opening hand card.",
            unlock_level: 6,
            unlocked: false,
        },
        RuneDefinition {
            id: "wellspring",
            name: "Wellspring Rune",
            text: "Gain +1 mana from controlled hexes.",
            unlock_level: 8,
            unlocked: false,
        },
        RuneDefinition {
            id: "bulwark",
            name: "Bulwark Rune",
            text: "Summoned units enter with +1 armor.",
            unlock_level: 12,
            unlocked: false,
        },
    ]
}

fn rune_definition(rune_id: &str) -> Option<RuneDefinition> {
    rune_definitions()
        .into_iter()
        .find(|rune| rune.id == rune_id)
}

fn effects_for(rune_ids: &[String], skill_ids: &[String]) -> MatchProgressionEffects {
    let mut effects = MatchProgressionEffects::default();
    for rune_id in rune_ids {
        apply_effect_for_id(&mut effects, rune_id);
    }
    for skill_id in skill_ids {
        apply_effect_for_id(&mut effects, skill_id);
    }
    effects
}

fn apply_effect_for_id(effects: &mut MatchProgressionEffects, id: &str) {
    match id {
        "vitality" => effects.max_hp_delta += 2,
        "force" => effects.attack_delta += 1,
        "foresight" => effects.opening_hand_delta += 1,
        "wellspring" => effects.mana_delta += 1,
        "bulwark" => effects.summoned_unit_armor_delta += 1,
        "runekeeper-steady-glyph" => effects.max_hp_delta += 1,
        "runekeeper-channel-stone" => effects.mana_delta += 1,
        "runekeeper-warding-script" => effects.first_summoned_unit_armor_delta += 1,
        "runekeeper-archive-spark" => effects.opening_hand_delta += 1,
        "pyromancer-heated-focus" => effects.attack_delta += 1,
        "pyromancer-kindling-reserve" => effects.mana_delta += 1,
        "pyromancer-scorching-script" => effects.spell_damage_delta += 1,
        "pyromancer-glass-flame" => {
            effects.opening_hand_delta += 1;
            effects.max_hp_delta -= 1;
        }
        "chronomancer-quick-step" => effects.max_ap_delta += 1,
        "chronomancer-stored-moment" => effects.mana_delta += 1,
        "chronomancer-early-loop" => effects.opening_hand_delta += 1,
        "chronomancer-temporal-guard" => effects.max_hp_delta += 1,
        "warden-stone-skin" => effects.max_hp_delta += 2,
        "warden-guard-drill" => effects.summoned_unit_armor_delta += 1,
        "warden-anchored-stance" => {
            effects.max_hp_delta += 1;
            effects.mana_delta += 1;
        }
        "warden-shield-line" => effects.first_summoned_unit_armor_delta += 1,
        "battlemage-weapon-drill" => effects.attack_delta += 1,
        "battlemage-iron-focus" => effects.max_hp_delta += 1,
        "battlemage-battle-rhythm" => effects.mana_delta += 1,
        "battlemage-frontline-command" => effects.summoned_unit_armor_delta += 1,
        _ => {}
    }
}

fn skill_trees() -> Vec<WizardSkillTree> {
    wizard_types()
        .into_iter()
        .map(|wizard_type| WizardSkillTree {
            wizard_type,
            nodes: skill_nodes(wizard_type),
        })
        .collect()
}

fn skill_node(wizard_type: WizardType, node_id: &str) -> Option<SkillNodeDefinition> {
    skill_nodes(wizard_type)
        .into_iter()
        .find(|node| node.id == node_id)
}

fn root_skill_id(wizard_type: WizardType) -> &'static str {
    match wizard_type {
        WizardType::Runekeeper => "runekeeper-runic-balance",
        WizardType::Pyromancer => "pyromancer-ember-path",
        WizardType::Chronomancer => "chronomancer-time-thread",
        WizardType::Warden => "warden-stone-oath",
        WizardType::Battlemage => "battlemage-duelist-oath",
    }
}

fn skill_nodes(wizard_type: WizardType) -> Vec<SkillNodeDefinition> {
    match wizard_type {
        WizardType::Runekeeper => vec![
            skill(
                "runekeeper-runic-balance",
                "Runic Balance",
                "The root of Runekeeper mastery.",
                true,
                None,
            ),
            skill(
                "runekeeper-steady-glyph",
                "Steady Glyph",
                "Wizard starts with +1 max HP.",
                false,
                Some("runekeeper-runic-balance"),
            ),
            skill(
                "runekeeper-channel-stone",
                "Channel Stone",
                "Gain +1 mana from controlled hexes.",
                false,
                Some("runekeeper-runic-balance"),
            ),
            skill(
                "runekeeper-warding-script",
                "Warding Script",
                "First summoned unit each match enters with +1 armor.",
                false,
                Some("runekeeper-steady-glyph"),
            ),
            skill(
                "runekeeper-archive-spark",
                "Archive Spark",
                "Draw +1 opening hand card.",
                false,
                Some("runekeeper-channel-stone"),
            ),
        ],
        WizardType::Pyromancer => vec![
            skill(
                "pyromancer-ember-path",
                "Ember Path",
                "The root of Pyromancer mastery.",
                true,
                None,
            ),
            skill(
                "pyromancer-heated-focus",
                "Heated Focus",
                "Wizard starts with +1 attack.",
                false,
                Some("pyromancer-ember-path"),
            ),
            skill(
                "pyromancer-kindling-reserve",
                "Kindling Reserve",
                "Gain +1 mana from controlled hexes.",
                false,
                Some("pyromancer-ember-path"),
            ),
            skill(
                "pyromancer-scorching-script",
                "Scorching Script",
                "Damaging spells deal +1 damage.",
                false,
                Some("pyromancer-heated-focus"),
            ),
            skill(
                "pyromancer-glass-flame",
                "Glass Flame",
                "Draw +1 opening hand card and start with -1 max HP.",
                false,
                Some("pyromancer-kindling-reserve"),
            ),
        ],
        WizardType::Chronomancer => vec![
            skill(
                "chronomancer-time-thread",
                "Time Thread",
                "The root of Chronomancer mastery.",
                true,
                None,
            ),
            skill(
                "chronomancer-quick-step",
                "Quick Step",
                "Wizard starts with +1 max AP.",
                false,
                Some("chronomancer-time-thread"),
            ),
            skill(
                "chronomancer-stored-moment",
                "Stored Moment",
                "Gain +1 mana from controlled hexes.",
                false,
                Some("chronomancer-time-thread"),
            ),
            skill(
                "chronomancer-early-loop",
                "Early Loop",
                "Draw +1 opening hand card.",
                false,
                Some("chronomancer-quick-step"),
            ),
            skill(
                "chronomancer-temporal-guard",
                "Temporal Guard",
                "Wizard starts with +1 max HP.",
                false,
                Some("chronomancer-stored-moment"),
            ),
        ],
        WizardType::Warden => vec![
            skill(
                "warden-stone-oath",
                "Stone Oath",
                "The root of Warden mastery.",
                true,
                None,
            ),
            skill(
                "warden-stone-skin",
                "Stone Skin",
                "Wizard starts with +2 max HP.",
                false,
                Some("warden-stone-oath"),
            ),
            skill(
                "warden-guard-drill",
                "Guard Drill",
                "Summoned units enter with +1 armor.",
                false,
                Some("warden-stone-oath"),
            ),
            skill(
                "warden-anchored-stance",
                "Anchored Stance",
                "Wizard starts with +1 max HP and gains +1 mana from controlled hexes.",
                false,
                Some("warden-stone-skin"),
            ),
            skill(
                "warden-shield-line",
                "Shield Line",
                "First summoned unit each match enters with +1 armor.",
                false,
                Some("warden-guard-drill"),
            ),
        ],
        WizardType::Battlemage => vec![
            skill(
                "battlemage-duelist-oath",
                "Duelist Oath",
                "The root of Battlemage mastery.",
                true,
                None,
            ),
            skill(
                "battlemage-weapon-drill",
                "Weapon Drill",
                "Wizard starts with +1 attack.",
                false,
                Some("battlemage-duelist-oath"),
            ),
            skill(
                "battlemage-iron-focus",
                "Iron Focus",
                "Wizard starts with +1 max HP.",
                false,
                Some("battlemage-duelist-oath"),
            ),
            skill(
                "battlemage-battle-rhythm",
                "Battle Rhythm",
                "Gain +1 mana from controlled hexes.",
                false,
                Some("battlemage-weapon-drill"),
            ),
            skill(
                "battlemage-frontline-command",
                "Frontline Command",
                "Summoned units enter with +1 armor.",
                false,
                Some("battlemage-iron-focus"),
            ),
        ],
    }
}

fn skill(
    id: &'static str,
    name: &'static str,
    text: &'static str,
    root: bool,
    prerequisite_id: Option<&'static str>,
) -> SkillNodeDefinition {
    SkillNodeDefinition {
        id,
        name,
        text,
        root,
        prerequisite_id,
    }
}

struct AwardParticipant {
    user_id: i64,
    side: Side,
    wizard_type: WizardType,
}

fn shared_participants(
    connection: &Connection,
    match_id: &str,
    match_state: &MatchState,
) -> Result<Vec<AwardParticipant>, ProgressionError> {
    let mut statement = connection.prepare(
        "
        SELECT side, participant_user_id
        FROM match_seats
        WHERE match_id = ?1 AND participant_user_id IS NOT NULL
        ",
    )?;
    let rows = statement.query_map(params![match_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    let mut participants = Vec::new();
    for row in rows {
        let (side, user_id) = row?;
        let Some(side) = side_from_db(&side) else {
            continue;
        };
        let wizard_type = match side {
            Side::Player => match_state.player.wizard.wizard_type,
            Side::Opponent => match_state.opponent.wizard.wizard_type,
        };
        participants.push(AwardParticipant {
            user_id,
            side,
            wizard_type,
        });
    }
    Ok(participants)
}

fn side_from_db(value: &str) -> Option<Side> {
    match value {
        "player" => Some(Side::Player),
        "opponent" => Some(Side::Opponent),
        _ => None,
    }
}

fn wizard_types() -> Vec<WizardType> {
    vec![
        WizardType::Runekeeper,
        WizardType::Pyromancer,
        WizardType::Chronomancer,
        WizardType::Warden,
        WizardType::Battlemage,
    ]
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

fn add_column_if_missing(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), ProgressionError> {
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

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;
    use crate::identity;
    use crate::match_store::SqliteMatchStore;

    #[test]
    fn account_level_uses_fast_early_curve() {
        assert_eq!(summary_for_xp(0).level, 1);
        assert_eq!(summary_for_xp(100).level, 2);
        assert_eq!(summary_for_xp(299).level, 2);
        assert_eq!(summary_for_xp(300).level, 3);
        assert_eq!(summary_for_xp(4_500).level, 10);
        assert_eq!(summary_for_xp(4_500).rune_slots, 2);
    }

    #[test]
    fn match_loadout_rejects_locked_and_duplicate_runes() {
        let mut connection = Connection::open_in_memory().expect("in-memory database should open");
        identity::migrate(&connection).expect("identity schema should migrate");
        migrate(&connection).expect("progression schema should migrate");
        insert_user(&connection, 1, 0);

        let mut progression = ProgressionModule::new(&mut connection);
        let locked = progression.match_loadout(
            Some(1),
            WizardType::Runekeeper,
            Some(vec!["vitality".to_string()]),
        );
        assert!(matches!(locked, Err(ProgressionError::LockedRune(_))));

        insert_user(&connection, 2, 10_000);
        let mut progression = ProgressionModule::new(&mut connection);
        let duplicate = progression.match_loadout(
            Some(2),
            WizardType::Runekeeper,
            Some(vec!["vitality".to_string(), "vitality".to_string()]),
        );
        assert!(matches!(duplicate, Err(ProgressionError::DuplicateRune(_))));
    }

    #[test]
    fn skill_unlock_spends_wizard_mastery_points_and_respec_restores_them() {
        let mut connection = Connection::open_in_memory().expect("in-memory database should open");
        identity::migrate(&connection).expect("identity schema should migrate");
        migrate(&connection).expect("progression schema should migrate");
        insert_user(&connection, 1, 0);
        connection
            .execute(
                "INSERT INTO wizard_mastery (user_id, wizard_type, xp) VALUES (1, 'pyromancer', 300)",
                [],
            )
            .expect("wizard mastery should insert");

        let mut progression = ProgressionModule::new(&mut connection);
        let response = progression
            .unlock_skill(1, WizardType::Pyromancer, "pyromancer-heated-focus")
            .expect("skill should unlock");
        let pyromancer = response
            .wizards
            .iter()
            .find(|wizard| wizard.wizard_type == WizardType::Pyromancer)
            .expect("pyromancer progression should be present");
        assert_eq!(pyromancer.available_skill_points, 1);
        assert!(
            pyromancer
                .unlocked_skill_ids
                .iter()
                .any(|node_id| node_id == "pyromancer-heated-focus")
        );

        let response = progression
            .respec_wizard(1, WizardType::Pyromancer)
            .expect("respec should succeed");
        let pyromancer = response
            .wizards
            .iter()
            .find(|wizard| wizard.wizard_type == WizardType::Pyromancer)
            .expect("pyromancer progression should be present");
        assert_eq!(pyromancer.available_skill_points, 2);
        assert!(pyromancer.unlocked_skill_ids.is_empty());
    }

    #[test]
    fn completed_match_awards_account_and_wizard_xp_once() {
        let path = test_db_path("progression-award");
        let mut store = SqliteMatchStore::new(&path).expect("store should open");
        store
            .connection_mut()
            .execute(
                "
                INSERT INTO users (id, email, email_normalized, password_hash, display_name)
                VALUES (1, 'xp@example.com', 'xp@example.com', 'hash', 'XP')
                ",
                [],
            )
            .expect("user should insert");
        let mut stored = store
            .create_match_for_user(WizardType::Pyromancer, Some(1))
            .expect("match should create");
        let frames = stored.state.forfeit_recording(Side::Player, 0);
        store
            .save_custom_action_and_replay_frames(
                &stored.id,
                0,
                r#"{"type":"testForfeit"}"#,
                &stored.state,
                &frames,
            )
            .expect("completed match should save");
        award_completed_match(store.connection_mut(), &stored.id)
            .expect("second award attempt should be idempotent");

        let total_xp: i64 = store
            .connection_mut()
            .query_row("SELECT total_xp FROM users WHERE id = 1", [], |row| {
                row.get(0)
            })
            .expect("total xp should load");
        let wizard_xp: i64 = store
            .connection_mut()
            .query_row(
                "SELECT xp FROM wizard_mastery WHERE user_id = 1 AND wizard_type = 'pyromancer'",
                [],
                |row| row.get(0),
            )
            .expect("wizard xp should load");
        let award_count: i64 = store
            .connection_mut()
            .query_row("SELECT COUNT(*) FROM match_xp_awards", [], |row| row.get(0))
            .expect("award count should load");

        assert_eq!(total_xp, 150);
        assert_eq!(wizard_xp, 150);
        assert_eq!(award_count, 1);

        let _ = std::fs::remove_file(path);
    }

    fn insert_user(connection: &Connection, user_id: i64, total_xp: i64) {
        connection
            .execute(
                "
                INSERT INTO users (
                    id,
                    email,
                    email_normalized,
                    password_hash,
                    display_name,
                    total_xp
                )
                VALUES (?1, ?2, ?2, 'hash', ?3, ?4)
                ",
                params![
                    user_id,
                    format!("user-{user_id}@example.com"),
                    format!("User {user_id}"),
                    total_xp
                ],
            )
            .expect("user should insert");
    }

    fn test_db_path(name: &str) -> PathBuf {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("rune-lanes-{name}-{millis}.sqlite3"))
    }
}
