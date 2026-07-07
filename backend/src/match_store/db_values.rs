use crate::match_session::{HeroType, Side};

use super::{SharedMatchFormat, SharedMatchStatus};

impl SharedMatchStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Setup => "setup",
            Self::Active => "active",
            Self::Completed => "completed",
            Self::Forfeited => "forfeited",
        }
    }

    pub(super) fn from_db(value: &str) -> Self {
        match value {
            "setup" => Self::Setup,
            "active" => Self::Active,
            "completed" => Self::Completed,
            "forfeited" => Self::Forfeited,
            _ => Self::Setup,
        }
    }
}

impl SharedMatchFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Duel => "duel",
            Self::TwoVTwo => "twoVTwo",
        }
    }

    pub(super) fn from_db(value: &str) -> Self {
        match value {
            "twoVTwo" => Self::TwoVTwo,
            _ => Self::Duel,
        }
    }
}

impl Side {
    pub(super) fn to_db(self) -> &'static str {
        match self {
            Self::Player => "player",
            Self::Opponent => "opponent",
            Self::PlayerTwo => "playerTwo",
            Self::OpponentTwo => "opponentTwo",
        }
    }
}

impl HeroType {
    pub(super) fn to_db(self) -> &'static str {
        match self {
            Self::Runekeeper => "runekeeper",
            Self::Pyromancer => "pyromancer",
            Self::Chronomancer => "chronomancer",
            Self::Warden => "warden",
            Self::Battlemage => "battlemage",
            Self::Barbarian => "barbarian",
            Self::Archer => "archer",
            Self::Builder => "builder",
        }
    }
}

pub(super) fn side_from_db(value: &str) -> Option<Side> {
    match value {
        "player" => Some(Side::Player),
        "opponent" => Some(Side::Opponent),
        "playerTwo" => Some(Side::PlayerTwo),
        "opponentTwo" => Some(Side::OpponentTwo),
        _ => None,
    }
}

pub(super) fn hero_type_from_db(value: &str) -> Option<HeroType> {
    match value {
        "runekeeper" => Some(HeroType::Runekeeper),
        "pyromancer" => Some(HeroType::Pyromancer),
        "chronomancer" => Some(HeroType::Chronomancer),
        "warden" => Some(HeroType::Warden),
        "battlemage" => Some(HeroType::Battlemage),
        "barbarian" => Some(HeroType::Barbarian),
        "archer" => Some(HeroType::Archer),
        "builder" => Some(HeroType::Builder),
        _ => None,
    }
}
