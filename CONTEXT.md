# Rune Lanes

Rune Lanes is a card/board game hybrid about wizards summoning units and casting spells on a shared hex arena.

## Language

**Wizard**:
The player's avatar on the board. A wizard is both the source of card play and the defeat condition.
_Avoid_: hero, commander, base

**Unit**:
A card-created board piece with attack, armor, and unit action points.
_Avoid_: creature, minion, troop

**Spell**:
A card that creates an immediate effect from the caster wizard instead of creating a unit.
_Avoid_: tactic

**Card interaction**:
Playing a Card and resolving its card-created effect through the match rules, including target legality, stack entry, and Unit, Spell, or Item effect logic.
_Avoid_: card handler, play-card plumbing

**Mana**:
The per-turn resource spent to play cards, set from the tiles that side controls at the beginning of that side's turn.
_Avoid_: energy

**Wizard action points**:
The wizard's per-turn action budget for moving, attacking, and playing cards.
_Avoid_: wizard movement counter

**Unit action points**:
A unit's per-turn action budget for moving and attacking.
_Avoid_: movement counter

**Hex**:
One tile on the arena, addressed by its position on the hex grid.
_Avoid_: cell, square

**Adjacent**:
The relationship between two neighboring hexes that share an edge.
_Avoid_: bordering tile

**Radius-3 arena**:
The 37-hex board used by the first hex version of Rune Lanes.
_Avoid_: lane board

**Starter deck**:
The system-provided legal deck recipe copied to new accounts and used by anonymous or default play.
_Avoid_: beginner deck

**Deck recipe**:
A saved list of card-template counts used to create a shuffled match deck.
_Avoid_: deck, pile

**Deck library**:
The set of named deck recipes owned by an account.
_Avoid_: collection

**Legal deck recipe**:
A deck recipe that satisfies Rune Lanes deck-building rules and can be used to start a match.
_Avoid_: valid deck

**Draft deck recipe**:
A saved deck recipe that does not currently satisfy deck-building rules.
_Avoid_: invalid deck

**System deck recipe**:
A predefined legal recipe shipped by Rune Lanes, used for starter/default play and AI opponent choices.
_Avoid_: AI-only deck

**Solo match**:
A match where one human controls Player and the backend AI controls Opponent.
_Avoid_: offline match

**Shared match**:
A human-vs-human match reached through two private seat links.
_Avoid_: online match, lobby match

**Account**:
A sign-in identity used for profile settings and owned match history.
_Avoid_: seat

**Account preferences**:
Account-synced controls and presentation preferences such as theme, motion, animation speed, board scale, and hotkey bindings. Account preferences affect the signed-in player's client experience only; they do not change Profile identity, Wizard progression, match rules, replay data, or private Seat link semantics.
_Avoid_: profile settings, wizard settings, match settings

**Profile**:
The player-facing account presentation, including display name, generated avatar, and owned match history.
_Avoid_: public player page

**Account experience**:
Total progression earned by a signed-in account from completed matches.
_Avoid_: player score, account points

**Account level**:
A derived profile level from account experience, used for broad account progression such as generic rune unlocks.
_Avoid_: rank

**Wizard mastery**:
Wizard-specific experience earned by completing matches with that wizard.
_Avoid_: class level, wizard rank

**Skill point**:
A wizard-specific point earned from wizard mastery levels and spent in that wizard's skill tree.
_Avoid_: talent point

**Skill tree**:
A per-wizard set of unlockable passive skills.
_Avoid_: talent tree

**Skill**:
A wizard-specific passive upgrade unlocked with skill points.
_Avoid_: talent, perk

**Rune**:
A generic pre-match loadout modifier unlocked by account level and equipped before a match.
_Avoid_: skill, card rune

**Rune loadout**:
The selected runes frozen into a match for one side.
_Avoid_: build, rune page

**Generated avatar**:
A profile avatar made from persisted symbol and color choices, not uploaded media.
_Avoid_: avatar upload

**Visual identity**:
The player-facing presentation that makes a Card, Unit, or Wizard recognizable across match surfaces, including art, labels, colors, rarity treatment, token portrait, and unknown fallback.
_Avoid_: skin, cosmetic data, asset lookup

**Board visual mode**:
A player presentation preference that chooses between the complete 2D board and the enhanced 3D board. It is stored on the account profile or locally for anonymous and seat-link play, and never changes match state, replay data, legality, or shared-match protocol semantics.
_Avoid_: board state, match mode, rules mode

**Seat**:
One side-specific player slot in a shared match, either Player or Opponent.
_Avoid_: account, user

**Seat link**:
A private URL that grants access to exactly one seat in a shared match.
_Avoid_: public match link

**Match setup**:
The pre-game state where the creator has chosen a wizard and the invitee has not joined or has not chosen theirs.
_Avoid_: lobby

**Active side**:
The side whose turn may submit match actions.
_Avoid_: current user

**Forfeit**:
A match-ending claim available after the opposing seat has been disconnected for at least two minutes.
_Avoid_: surrender

**Basic card**:
A starter deck card with many copies in the deck.
_Avoid_: common card

**Advanced card**:
A starter deck card with fewer copies than a basic card and more copies than a rare card.
_Avoid_: uncommon card

**Rare card**:
A starter deck card with only one copy in the deck.
_Avoid_: legendary card

**Match archive**:
The list of replay-capable matches stored by the backend.
_Avoid_: match picker, database browser

**Replay event**:
A durable record of one meaningful match occurrence, such as a turn start, draw, card play, movement, attack, unit destruction, or match end.
_Avoid_: text log line

**Replay frame**:
The match state captured immediately after a replay event.
_Avoid_: screenshot, animation frame

**Replay visibility**:
The rule that decides whether hidden card information is redacted or revealed in replay responses.
_Avoid_: debug mode
