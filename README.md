# Card Board Hybrid

Rune Lanes is a small vertical slice for a card game / board game hybrid.

Players spend energy to play cards into one of three lanes on a five-column board. Units advance toward the opponent edge when the turn resolves, fight blockers in their path, and score damage when they break through.

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

