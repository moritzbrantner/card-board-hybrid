use crate::deck_library::{ai_lab_system_decks, deck_from_counts};
use crate::match_session::{AiAdvanceOutcome, MatchState, Phase};

use super::*;

#[derive(Clone, Debug)]
pub(super) struct GameSpec {
    pub(super) candidate_policy_id: String,
    pub(super) player_policy_id: String,
    pub(super) opponent_policy_id: String,
    pub(super) player_deck_id: String,
    pub(super) opponent_deck_id: String,
    pub(super) candidate_side: Side,
    pub(super) seed: u64,
    pub(super) rule_preset_id: Option<String>,
}

#[derive(Clone, Debug)]
pub(super) struct SimulationGameResult {
    pub(super) spec: GameSpec,
    pub(super) outcome: GameOutcome,
    pub(super) action_count: u32,
    pub(super) frames: Vec<RecordedReplayFrame>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum GameOutcome {
    CandidateWin,
    BaselineWin,
    Draw,
    Timeout,
    IllegalAction(String),
}

pub(super) fn run_game(
    spec: &GameSpec,
    baseline_policy: &crate::match_session::SoloAiPolicy,
    candidate_policy: &crate::match_session::SoloAiPolicy,
    config: &SuiteConfigFile,
    max_actions: u32,
) -> Result<SimulationGameResult, AiLabError> {
    let player_deck = ai_lab_system_decks()
        .into_iter()
        .find(|deck| deck.id == spec.player_deck_id)
        .ok_or_else(|| AiLabError::Deck(format!("unknown deck {}", spec.player_deck_id)))?;
    let opponent_deck = ai_lab_system_decks()
        .into_iter()
        .find(|deck| deck.id == spec.opponent_deck_id)
        .ok_or_else(|| AiLabError::Deck(format!("unknown deck {}", spec.opponent_deck_id)))?;
    let player_cards = deck_from_counts(Side::Player, &player_deck.cards)
        .map_err(|error| AiLabError::Deck(error.to_string()))?;
    let opponent_cards = deck_from_counts(Side::Opponent, &opponent_deck.cards)
        .map_err(|error| AiLabError::Deck(error.to_string()))?;
    let mut game = MatchState::new_ai_lab_with_seed_and_decks(
        spec.seed,
        player_deck.hero_type,
        opponent_deck.hero_type,
        player_cards,
        opponent_cards,
    );
    if let Some(preset_id) = &spec.rule_preset_id {
        config.rule_preset(preset_id)?.apply(&mut game)?;
    }
    let mut frames = vec![game.initial_replay_frame()];
    let mut action_count = 0;
    while game.phase != Phase::MatchOver && action_count < max_actions {
        let side = if !game.action_stack.is_empty() {
            game.priority_side.ok_or_else(|| {
                AiLabError::Config("stack is pending without priority".to_string())
            })?
        } else {
            game.active_side
        };
        let policy = if side == spec.candidate_side {
            candidate_policy
        } else {
            baseline_policy
        };
        let mut action_frames = Vec::new();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            game.advance_ai_for_side_with_policy_strict(
                side,
                policy,
                &mut action_frames,
                Some(action_count),
            )
        }));
        match result {
            Ok(Ok(AiAdvanceOutcome::IllegalIntent { reason })) => {
                return Ok(SimulationGameResult {
                    spec: spec.clone(),
                    outcome: GameOutcome::IllegalAction(reason),
                    action_count,
                    frames,
                });
            }
            Ok(Ok(_)) => {
                frames.extend(action_frames);
                action_count += 1;
            }
            Ok(Err(error)) => {
                return Ok(SimulationGameResult {
                    spec: spec.clone(),
                    outcome: GameOutcome::IllegalAction(error.to_string()),
                    action_count,
                    frames,
                });
            }
            Err(_) => {
                return Ok(SimulationGameResult {
                    spec: spec.clone(),
                    outcome: GameOutcome::IllegalAction("AI action panicked".to_string()),
                    action_count,
                    frames,
                });
            }
        }
    }
    let outcome = match game.winner {
        Some(winner) if winner == spec.candidate_side => GameOutcome::CandidateWin,
        Some(_) => GameOutcome::BaselineWin,
        None if action_count >= max_actions => GameOutcome::Timeout,
        None => GameOutcome::Draw,
    };
    Ok(SimulationGameResult {
        spec: spec.clone(),
        outcome,
        action_count,
        frames,
    })
}
