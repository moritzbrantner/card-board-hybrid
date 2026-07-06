# Client-Scripted Tutorial Scenes

Rune Lanes tutorial mode uses client-authored tutorial scenes rather than persisted backend matches or development match scenarios. The tutorial is a teaching surface, not an authoritative match: it may render board, card, stack, and HUD states and apply narrow scripted transitions, but it does not create replay data, award progression, enter the match archive, or validate full match legality. This keeps tutorial tile demos lightweight while preserving the existing boundary that production match rules remain backend-owned.
