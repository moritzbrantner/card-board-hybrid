# Worker Context Pack: issue #6

Repository: moritzbrantner/card-board-hybrid
Parent PRD: #4 https://github.com/moritzbrantner/card-board-hybrid/issues/4
Slice issue: #6 https://github.com/moritzbrantner/card-board-hybrid/issues/6
Concurrency group: game-screen-card-piles

## Goal

Make the radius-3 arena visually larger and keep it as the center of the main game screen without changing the board model or game rules. The completed slice should preserve all 37 hexes, keep wizard and unit tokens contained and readable, preserve legal target and selected-piece highlights, and keep the hand, opponent information, and game log reachable on desktop and narrow screens.

This is a presentation and layout slice only. Do not change radius, coordinates, adjacency, movement, attacks, targeting, action points, card costs, deck composition, or draw rules.

## Acceptance Criteria

- [ ] The radius-3 arena is visibly larger than the pre-slice implementation on a desktop viewport.
- [ ] The board still renders exactly 37 hexes for the radius-3 arena.
- [ ] Wizard and unit tokens remain fully contained inside their hexes on the larger board.
- [ ] Legal card targets, legal moves, legal attacks, and selected pieces remain visually distinguishable on the larger board.
- [ ] Hover and disabled states continue to work on board hexes.
- [ ] The board remains horizontally reachable on narrow screens, including when it is wider than the viewport.
- [ ] The larger board fits on desktop without hiding the hand, opponent information, or game log.
- [ ] The larger board remains inspectable during game over.
- [ ] The implementation does not change the radius-3 board model, board coordinates, adjacency rules, card targeting rules, movement rules, attack rules, or action point rules.

## Expected Write Scope

- `frontend/src/App.tsx`
- `frontend/src/styles.css`
- Frontend verification or test files only if the repository already has a suitable pattern

## Verification

None

## Required Reading

- AGENTS.md

## Blockers

None

## Recent Relevant Comments

None

## Notes

Keep implementation limited to this slice. Read more files only when the pack and required docs are insufficient.
