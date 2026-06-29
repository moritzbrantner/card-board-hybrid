# Card Board Hybrid

Rune Lanes is a small vertical slice for a card game / board game hybrid.

Players control wizards on a radius-3 hex arena. Cards cost mana and wizard action points to summon units or cast spells; units then spend their own action points to move across adjacent hexes and attack neighboring enemies.

## Stack

- Rust backend with Axum
- React frontend with Vite and TypeScript
- Bun for frontend package scripts

## Run

Install frontend dependencies:

```sh
bun install
```

Start the backend:

```sh
bun run dev:backend
```

Start the frontend in another shell:

```sh
bun run dev:frontend
```

The frontend proxies `/api` to `http://localhost:4000`.

## Checks

```sh
bun run test
```
