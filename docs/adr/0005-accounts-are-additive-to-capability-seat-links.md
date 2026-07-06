# Accounts Are Additive To Capability Seat Links

Rune Lanes adds accounts for profile settings and owned match history while
preserving private seat links as the way shared matches grant play access.

An account is not a seat. A seat link remains a private capability: anyone with
the link can open that seat, choose a hero, view that side's hidden
information, and submit that side's match actions. Signing in is not required
for shared match play.

Accounts own solo matches created while signed in. Accounts can also own the
creator history for shared matches they create while signed in, but joining a
shared match by seat link does not attach that seat to the account in this
version.

This revises ADR-0004's no-users constraint without changing its seat-link
security model. The account module supports profile and history features around
the game; the match rules engine still deals in sides, seats, heroes, units,
cards, and replay visibility rather than account identity.
