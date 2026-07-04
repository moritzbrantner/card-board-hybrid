# Frontend Board Model Assets

Rune Lanes keeps Board model asset metadata in the frontend presentation layer rather than the backend catalog or match state. The 3D board resolves Board model assets and procedural miniatures from Hero or Unit visual identity, so real `.glb` files can be added later without changing rules, replay frames, shared-match payloads, deck recipes, or card APIs. This preserves the existing Board visual mode boundary: 3D rendering is presentation-only and falls back independently from authoritative match data.
