# Four Participant Shared Matches

Rune Lanes keeps Duel shared matches and adds 2v2 shared matches as a separate shared-match format. A 2v2 match has four private Seat links, four Participants, two Teams, individual alternating turns, and team victory when both opposing Participants are knocked out.

This keeps private Seat links as the access model instead of introducing a public lobby or account-bound matchmaking. A Seat remains a capability URL, but Seat is now separate from Team: two Seats may belong to the same Team while each Seat controls its own Hero, hand, Mana, deck, and Units.

The rules engine treats teammate pieces as friendly targets for healing and buffs, and enemy targets by Team rather than by exact Seat. Action authority remains Seat-specific: a Participant may spend only their own hand, Mana, Hero action points, and owned Units. Mana sources benefit the Participant whose piece occupies them.

Existing Duel shared matches remain supported. Their stored Player and Opponent data map to the primary Seats on each Team, while 2v2 matches add the second Team Seats and use a larger radius-4 arena.

Rejected alternatives:

- Co-controlled shared sides: smaller implementation, but it would not satisfy independent four-player play.
- Replacing all shared matches with 2v2: simpler UI, but it would break the existing Duel flow.
- Single public lobby link with seat claiming: more convenient, but it changes the current private capability-link security model.
