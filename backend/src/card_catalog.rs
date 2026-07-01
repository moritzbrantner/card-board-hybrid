use serde::Serialize;

use crate::deck_library::starter_recipe_count;
use crate::match_session::{Card, CardKind, Rarity, SpellEffect};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogCard {
    pub id: String,
    pub template_id: String,
    pub name: String,
    pub rarity: Rarity,
    pub cost: u8,
    pub text: String,
    pub kind: CardKind,
    pub copy_count: u8,
    pub art_key: String,
    pub art_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogResponse {
    pub cards: Vec<CatalogCard>,
}

pub fn starter_catalog() -> Vec<CatalogCard> {
    starter_card_templates()
        .into_iter()
        .map(|card| {
            let copy_count = starter_recipe_count(&card.template_id)
                .try_into()
                .expect("starter recipe counts should fit in u8");
            let art_key = card.template_id.clone();
            CatalogCard {
                id: card.template_id.clone(),
                template_id: card.template_id,
                name: card.name,
                rarity: card.rarity,
                cost: card.cost,
                text: card.text,
                kind: card.kind,
                copy_count,
                art_path: format!("/card-art/{art_key}.svg"),
                art_key,
            }
        })
        .collect()
}

pub fn starter_card_templates() -> Vec<Card> {
    vec![
        unit_card(
            "ember-squire",
            "Ember Squire",
            Rarity::Basic,
            1,
            "1 attack / 2 armor / 2 AP.",
            UnitStats {
                attack: 1,
                armor: 2,
                max_ap: 2,
            },
        ),
        unit_card(
            "swift-familiar",
            "Swift Familiar",
            Rarity::Basic,
            1,
            "1 attack / 1 armor / 3 AP.",
            UnitStats {
                attack: 1,
                armor: 1,
                max_ap: 3,
            },
        ),
        unit_card(
            "stoneguard",
            "Stoneguard",
            Rarity::Basic,
            2,
            "1 attack / 4 armor / 2 AP.",
            UnitStats {
                attack: 1,
                armor: 4,
                max_ap: 2,
            },
        ),
        unit_card(
            "rune-bruiser",
            "Rune Bruiser",
            Rarity::Basic,
            2,
            "2 attack / 2 armor / 2 AP.",
            UnitStats {
                attack: 2,
                armor: 2,
                max_ap: 2,
            },
        ),
        unit_card(
            "blade-dancer",
            "Blade Dancer",
            Rarity::Advanced,
            3,
            "2 attack / 2 armor / 3 AP.",
            UnitStats {
                attack: 2,
                armor: 2,
                max_ap: 3,
            },
        ),
        unit_card(
            "shield-adept",
            "Shield Adept",
            Rarity::Advanced,
            3,
            "1 attack / 5 armor / 2 AP.",
            UnitStats {
                attack: 1,
                armor: 5,
                max_ap: 2,
            },
        ),
        spell_card(
            "quick-salve",
            "Quick Salve",
            Rarity::Basic,
            1,
            "Priority 2. Range 2. Heal 2 to an allied unit or wizard.",
            2,
            2,
            SpellEffect::Heal { amount: 2 },
        ),
        spell_card(
            "spark-jolt",
            "Spark Jolt",
            Rarity::Basic,
            1,
            "Priority 3. Range 2. Deal 1 damage to an enemy unit or wizard.",
            2,
            3,
            SpellEffect::Damage { amount: 1 },
        ),
        spell_card(
            "warding-sigil",
            "Warding Sigil",
            Rarity::Basic,
            1,
            "Priority 2. Range 2. An allied unit gains +1 armor.",
            2,
            2,
            SpellEffect::Buff {
                attack: 0,
                armor: 1,
            },
        ),
        unit_card(
            "rune-runner",
            "Rune Runner",
            Rarity::Basic,
            2,
            "1 attack / 1 armor / 4 AP.",
            UnitStats {
                attack: 1,
                armor: 1,
                max_ap: 4,
            },
        ),
        unit_card(
            "ash-hound",
            "Ash Hound",
            Rarity::Basic,
            2,
            "2 attack / 1 armor / 3 AP.",
            UnitStats {
                attack: 2,
                armor: 1,
                max_ap: 3,
            },
        ),
        unit_card(
            "prism-initiate",
            "Prism Initiate",
            Rarity::Basic,
            1,
            "1 attack / 3 armor / 1 AP.",
            UnitStats {
                attack: 1,
                armor: 3,
                max_ap: 1,
            },
        ),
        spell_card(
            "mending-rune",
            "Mending Rune",
            Rarity::Advanced,
            2,
            "Priority 2. Range 2. Heal 3 to an allied unit or wizard.",
            2,
            2,
            SpellEffect::Heal { amount: 3 },
        ),
        spell_card(
            "war-chant",
            "War Chant",
            Rarity::Advanced,
            3,
            "Priority 1. Range 2. An allied unit gains +1 attack and +1 armor.",
            2,
            1,
            SpellEffect::Buff {
                attack: 1,
                armor: 1,
            },
        ),
        spell_card(
            "ember-lance",
            "Ember Lance",
            Rarity::Advanced,
            3,
            "Priority 3. Range 3. Deal 2 damage to an enemy unit or wizard.",
            3,
            3,
            SpellEffect::Damage { amount: 2 },
        ),
        spell_card(
            "arcane-parry",
            "Arcane Parry",
            Rarity::Advanced,
            2,
            "Priority 4. Range 2. An allied unit gains +2 armor.",
            2,
            4,
            SpellEffect::Buff {
                attack: 0,
                armor: 2,
            },
        ),
        unit_card(
            "flame-weaver",
            "Flame Weaver",
            Rarity::Advanced,
            4,
            "3 attack / 2 armor / 2 AP.",
            UnitStats {
                attack: 3,
                armor: 2,
                max_ap: 2,
            },
        ),
        spell_card(
            "bastion-rune",
            "Bastion Rune",
            Rarity::Advanced,
            4,
            "Priority 1. Range 2. An allied unit gains +4 armor.",
            2,
            1,
            SpellEffect::Buff {
                attack: 0,
                armor: 4,
            },
        ),
        spell_card(
            "temporal-bolt",
            "Temporal Bolt",
            Rarity::Advanced,
            3,
            "Priority 5. Range 2. Deal 2 damage to an enemy unit or wizard.",
            2,
            5,
            SpellEffect::Damage { amount: 2 },
        ),
        unit_card(
            "iron-colossus",
            "Iron Colossus",
            Rarity::Rare,
            6,
            "4 attack / 6 armor / 1 AP.",
            UnitStats {
                attack: 4,
                armor: 6,
                max_ap: 1,
            },
        ),
        spell_card(
            "starfire-bolt",
            "Starfire Bolt",
            Rarity::Rare,
            5,
            "Priority 3. Range 3. Deal 4 damage to an enemy unit or wizard.",
            3,
            3,
            SpellEffect::Damage { amount: 4 },
        ),
        spell_card(
            "eclipse-strike",
            "Eclipse Strike",
            Rarity::Rare,
            4,
            "Priority 5. Range 3. Deal 3 damage to an enemy unit or wizard.",
            3,
            5,
            SpellEffect::Damage { amount: 3 },
        ),
        unit_card(
            "phoenix-adept",
            "Phoenix Adept",
            Rarity::Rare,
            5,
            "3 attack / 3 armor / 3 AP.",
            UnitStats {
                attack: 3,
                armor: 3,
                max_ap: 3,
            },
        ),
        spell_card(
            "comet-spear",
            "Comet Spear",
            Rarity::Rare,
            6,
            "Priority 3. Range 3. Deal 5 damage to an enemy unit or wizard.",
            3,
            3,
            SpellEffect::Damage { amount: 5 },
        ),
    ]
}

pub fn card_template_by_id(template_id: &str) -> Option<Card> {
    starter_card_templates()
        .into_iter()
        .find(|card| card.template_id == template_id)
}

struct UnitStats {
    attack: i32,
    armor: i32,
    max_ap: u8,
}

fn unit_card(
    template_id: &str,
    name: &str,
    rarity: Rarity,
    cost: u8,
    text: &str,
    stats: UnitStats,
) -> Card {
    Card {
        id: template_id.to_string(),
        template_id: template_id.to_string(),
        name: name.to_string(),
        rarity,
        cost,
        text: text.to_string(),
        kind: CardKind::Unit {
            attack: stats.attack,
            armor: stats.armor,
            max_ap: stats.max_ap,
        },
    }
}

#[allow(
    clippy::too_many_arguments,
    reason = "card templates read clearly at call sites"
)]
fn spell_card(
    template_id: &str,
    name: &str,
    rarity: Rarity,
    cost: u8,
    text: &str,
    range: u8,
    priority: u8,
    effect: SpellEffect,
) -> Card {
    Card {
        id: template_id.to_string(),
        template_id: template_id.to_string(),
        name: name.to_string(),
        rarity,
        cost,
        text: text.to_string(),
        kind: CardKind::Spell {
            range,
            priority,
            effect,
        },
    }
}
