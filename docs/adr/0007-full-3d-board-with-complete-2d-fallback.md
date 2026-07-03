# Full 3D Board With Complete 2D Fallback

Rune Lanes will offer Board visual mode as a player presentation preference with `2d` and `3d` choices. The 3D choice uses one full React Three Fiber board surface for the radius-3 arena, pieces, legal highlights, and board interactions. The existing DOM board remains the complete 2D implementation for play, replay, shared matches, accessibility, unsupported browsers, and player preference.

Board visual mode is not match state. It must not affect rules, replay frames, persisted match records, or shared-match protocol semantics. A player can switch presentation while the same authoritative match state and legality functions continue to drive actions.

The full-board 3D surface was chosen over per-token canvases or a decorative overlay because it keeps spatial presentation coherent: camera, board geometry, piece positions, and interaction targets share one renderer. Cards remain 2D in this decision, so the board enhancement does not force card rendering, deck data, or card interaction changes into the 3D layer.

The complete 2D fallback is required because WebGL can be unavailable, disabled, blocked by browser performance caveats, or unsuitable for reduced-motion and low-capability devices. Startup failure falls back to 2D with a non-blocking status notice. Missing or failed 3D model assets fall back to board markers first, and the 2D board remains available if the renderer itself cannot continue.

The first 3D board keeps a fixed tactical camera and practical renderer guardrails for the current radius-3 arena. Mobile, reduced-motion, and lower-capability first-time visitors default to 2D until they explicitly choose otherwise; explicit account or local preferences still win.
