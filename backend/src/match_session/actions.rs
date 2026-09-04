use crate::rules_kernel::GameCommand;

use super::{MatchError, MatchState, Phase, RecordedReplayFrame, Side};

impl MatchState {
    /// Execute a player-facing game command while preserving the existing replay
    /// contract. Movement, attack, and phase transitions are owned here; command
    /// families not migrated yet deliberately delegate to the legacy dispatcher.
    pub(crate) fn apply_game_command_recording_for_side(
        &mut self,
        side: Side,
        command: GameCommand,
        action_index: u32,
    ) -> Result<Vec<RecordedReplayFrame>, MatchError> {
        if self.phase == Phase::MatchOver {
            return Err(MatchError::MatchOver);
        }

        let mut frames = Vec::new();
        match command {
            GameCommand::MovePiece { piece_id, to } => {
                self.require_turn_action_side(side)?;
                self.require_phase(Phase::Movement)?;
                self.move_piece_for_side(side, &piece_id, to, &mut frames, Some(action_index))?;
            }
            GameCommand::Attack {
                attacker_id,
                target_id,
            } => {
                self.require_turn_action_side(side)?;
                self.require_phase(Phase::Attack)?;
                self.attack_for_side(
                    side,
                    &attacker_id,
                    &target_id,
                    &mut frames,
                    Some(action_index),
                )?;
            }
            GameCommand::FinishMovement => {
                self.require_turn_action_side(side)?;
                self.start_attack_phase_for_side(side, &mut frames, Some(action_index))?;
            }
            GameCommand::FinishAttacks => {
                self.require_turn_action_side(side)?;
                self.start_card_play_for_side(side, &mut frames, Some(action_index))?;
            }
            legacy_command => {
                return self.apply_action_recording_for_side(
                    side,
                    legacy_command.into(),
                    action_index,
                );
            }
        }

        Ok(frames)
    }
}
