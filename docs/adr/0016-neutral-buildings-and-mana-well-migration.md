# Neutral Buildings and Mana Well Migration

Rune Lanes represents stationary board features as neutral Buildings. A Building sits on a hex, can be occupied by either side, and may provide turn-start, aura, or activated effects to the occupying side. Mana Well is now the first Building effect rather than a special card kind or board list.

Old match snapshots and replay frames may still contain `manaSources`. The rules engine converts those legacy coordinates into Mana Well Buildings when snapshots are restored, and frontend helpers continue to read legacy `manaSources` as Mana Well markers.

This keeps one model for stationary board features without introducing ownership, capture, destructibility, or separate piece combat rules. The alternatives were to keep Mana Well as a special `ManaSource`, make Buildings owned or capturable, or make Buildings destructible immediately; all of those add more long-term rules surface than the first Building pass needs.
