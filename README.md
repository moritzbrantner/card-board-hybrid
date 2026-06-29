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
bun run ci:local
```

`bun install` configures Git to run `.githooks/pre-push`, which executes the
same local CI script before a push reaches GitHub. If GitHub Actions cannot run
because of a billing or spending limit, a passing `bun run ci:local` is the
project's local signal that the shared CI workflow would have passed.
