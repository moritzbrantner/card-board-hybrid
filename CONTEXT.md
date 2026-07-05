# Rune Lanes

Rune Lanes is a card/board game hybrid about heroes summoning units and casting spells on a shared hex arena.

## Language

**Hero**:
The player's avatar on the board. A hero is both the source of card play and the defeat condition.
_Avoid_: wizard, commander, base

**Unit**:
A card-created board piece with attack, armor, and unit action points.
_Avoid_: creature, minion, troop

**Unit armor**:
A Unit's renewable durability. Damage lowers current Unit armor; at the beginning of its owner's turn, surviving damaged Units refresh to their max armor.
_Avoid_: health, hero armor, shield

**Spell**:
A card that creates an immediate effect from the caster hero instead of creating a unit.
_Avoid_: tactic

**Card interaction**:
Playing a Card and resolving its card-created effect through the match rules, including target legality, stack entry, and Unit, Spell, or Item effect logic.
_Avoid_: card handler, play-card plumbing

**Mana**:
The resource spent to play cards. A side refreshes Mana from its Hero and occupied Mana sources at the beginning of that side's turn, while unspent Mana remains available for reactions until that side's next turn begins.
_Avoid_: energy

**Mana source**:
A board hex marker that grants Mana to the side occupying it at the beginning of that side's turn.
_Avoid_: mana tile, controlled hex

**Building**:
A neutral, permanent board feature on a hex. A Building may grant an effect to the occupying side, project an aura, or be activated by its occupying Hero or Unit.
_Avoid_: structure, owned building

**Building card**:
A Card that creates a Building on an adjacent empty hex.
_Avoid_: building spell, structure card

**Building activation**:
Spending 1 action point from a Hero or Unit occupying a Building to use that Building's activated effect.
_Avoid_: building trigger, tower action

**Hero shield**:
A persistent damage buffer on a Hero, created by shield-granting buffs and consumed before Hero HP.
_Avoid_: hero armor, temporary health

**Hero action points**:
The hero's per-turn action budget for moving, attacking, and playing cards.
_Avoid_: hero movement counter

**Unit action points**:
A unit's per-turn action budget for moving and attacking.
_Avoid_: movement counter

**Hex**:
One tile on the arena, addressed by its position on the hex grid.
_Avoid_: cell, square

**Adjacent**:
The relationship between two neighboring hexes that share an edge.
_Avoid_: bordering tile

**Attack range**:
The maximum hex distance at which a Hero or Unit can attack an enemy piece. Range 1 means adjacent combat.
_Avoid_: reach, weapon range

**Hero passive**:
A built-in Hero identity rule active in a match without spending cards, runes, or skill points.
_Avoid_: base skill, innate perk

**Radius-3 arena**:
The 37-hex board used by the first hex version of Rune Lanes.
_Avoid_: lane board

**Starter deck**:
The system-provided legal deck recipe copied to new accounts and used by anonymous or default play.
_Avoid_: beginner deck

**Deck recipe**:
A saved list of card-template counts used to create a shuffled match deck.
_Avoid_: deck, pile

**Configured deck recipe**:
An account-owned deck recipe with a saved Hero and rune loadout for use as a match loadout.
_Avoid_: deck settings, deck profile

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

**Match loadout**:
The pre-match choice for one side, combining a Hero, a deck recipe or system deck recipe, and a rune loadout.
_Avoid_: build, preset

**Player dashboard**:
The root account-oriented surface that summarizes player status and routes into play, deck, profile, and match-history workflows.
_Avoid_: match picker, landing page

**Solo match**:
A match where one human controls Player and the backend AI controls Opponent.
_Avoid_: offline match

**Solo AI policy**:
The backend-owned decision policy that chooses the Opponent's next intent during a Solo match.
_Avoid_: bot logic, enemy AI, opponent automation

**Shared match**:
A human-vs-human match reached through two private seat links.
_Avoid_: online match, lobby match

**Account**:
A sign-in identity used for profile settings and owned match history.
_Avoid_: seat

**Account preferences**:
Account-synced controls and presentation preferences such as theme, motion, animation speed, board scale, and hotkey bindings. Account preferences affect the signed-in player's client experience only; they do not change Profile identity, Hero progression, match rules, replay data, or private Seat link semantics.
_Avoid_: profile settings, hero settings, match settings

**Profile**:
The player-facing account presentation, including display name, generated avatar, and owned match history.
_Avoid_: public player page

**Account experience**:
Total progression earned by a signed-in account from completed matches.
_Avoid_: player score, account points

**Account level**:
A derived profile level from account experience, used for broad account progression such as generic rune unlocks.
_Avoid_: rank

**Hero mastery**:
Hero-specific experience earned by completing matches with that hero.
_Avoid_: class level, hero rank

**Skill point**:
A hero-specific point earned from hero mastery levels and spent in that hero's skill tree.
_Avoid_: talent point

**Skill tree**:
A per-hero set of unlockable passive skills.
_Avoid_: talent tree

**Skill**:
A hero-specific passive upgrade unlocked with skill points.
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
The player-facing presentation that makes a Card, Unit, or Hero recognizable across match surfaces, including art, labels, colors, rarity treatment, token portrait, and unknown fallback.
_Avoid_: skin, cosmetic data, asset lookup

**Board visual mode**:
A player presentation preference that chooses between the complete 2D board and the enhanced 3D board. It is stored on the account profile or locally for anonymous and seat-link play, and never changes match state, replay data, legality, or shared-match protocol semantics.
_Avoid_: board state, match mode, rules mode

**Board model asset**:
A presentation-only 3D asset used by Board visual mode to render a Hero or Unit. It is not match state, replay data, card rules, or catalog legality.
_Avoid_: model, skin, piece data

**Procedural miniature**:
A code-generated 3D fallback representation for a Hero or Unit when no Board model asset is configured or when that asset cannot load.
_Avoid_: marker, placeholder, token

**Seat**:
One side-specific player slot in a shared match, either Player or Opponent.
_Avoid_: account, user

**Seat link**:
A private URL that grants access to exactly one seat in a shared match.
_Avoid_: public match link

**Match setup**:
The pre-game state where the creator has chosen a hero and the invitee has not joined or has not chosen theirs.
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

**Match scenario**:
An authored local-development starting match state loaded into the Rust rules engine to exercise a specific interaction or board condition. A match scenario creates a normal playable match instance, but is not a player-facing mode, replay format, deck recipe, or production feature.
_Avoid_: fixture, sandbox match, test deck

**Tutorial mode**:
A player-facing guided learning flow made from scripted tutorial scenes. Tutorial mode teaches mechanics without creating a persisted match, replay, archive entry, or progression.
_Avoid_: onboarding match, practice match, match scenario

**Tutorial scene**:
An authored client-side board, hand, stack, and objective state used by Tutorial mode to demonstrate one or more mechanics.
_Avoid_: fixture, dev scenario, sandbox match

**Tutorial step**:
One teaching beat inside a tutorial scene, consisting of a paused concept introduction, highlighted elements, and an expected interaction that can advance the tutorial.
_Avoid_: tooltip, prompt
