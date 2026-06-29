import {
  Activity,
  Footprints,
  Heart,
  Play,
  RotateCcw,
  Shield,
  Sparkles,
  Sword,
  WandSparkles,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { attack, endTurn, getGame, movePiece, newGame, playCard } from "./api";
import type { Card, GameState, HexCoord, HexTile, Side, Unit, Wizard } from "./types";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; game: GameState }
  | { status: "error"; message: string };

type Selection =
  | { type: "card"; cardId: string }
  | { type: "piece"; pieceId: string }
  | null;

type BoardPiece =
  | (Wizard & { pieceType: "wizard"; name: string })
  | (Unit & { pieceType: "unit"; hp?: never; maxHp?: never });

export function App() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [selection, setSelection] = useState<Selection>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    getGame()
      .then((game) => setLoadState({ status: "ready", game }))
      .catch((error: unknown) =>
        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load game",
        }),
      );
  }, []);

  const selectedCard = useMemo(() => {
    if (loadState.status !== "ready" || selection?.type !== "card") {
      return null;
    }

    return loadState.game.player.hand.find((card) => card.id === selection.cardId) ?? null;
  }, [loadState, selection]);

  const selectedPiece = useMemo(() => {
    if (loadState.status !== "ready" || selection?.type !== "piece") {
      return null;
    }

    return pieceById(loadState.game, selection.pieceId);
  }, [loadState, selection]);

  async function runAction(action: () => Promise<GameState>) {
    setBusy(true);
    setNotice(null);

    try {
      const game = await action();
      setLoadState({ status: "ready", game });
      setSelection(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (loadState.status === "loading") {
    return <ShellMessage title="Rune Lanes" message="Loading board" />;
  }

  if (loadState.status === "error") {
    return <ShellMessage title="Rune Lanes" message={loadState.message} />;
  }

  const { game } = loadState;

  function handleTileClick(tile: HexTile) {
    if (busy || game.phase === "gameOver") {
      return;
    }

    const piece = pieceAt(game, tile.coord);

    if (selectedCard) {
      if (isLegalCardTarget(game, selectedCard, tile.coord, piece)) {
        const target =
          selectedCard.kind.type === "unit"
            ? { type: "hex" as const, coord: tile.coord }
            : { type: "piece" as const, pieceId: piece?.id ?? "" };
        void runAction(() => playCard(selectedCard.id, target));
      } else {
        setNotice("That card cannot target this hex.");
      }
      return;
    }

    if (selectedPiece) {
      if (!piece && isLegalMove(game, selectedPiece, tile.coord)) {
        void runAction(() => movePiece(selectedPiece.id, tile.coord));
        return;
      }
      if (piece && isLegalAttack(selectedPiece, piece)) {
        void runAction(() => attack(selectedPiece.id, piece.id));
        return;
      }
    }

    if (piece?.side === "player") {
      setSelection({ type: "piece", pieceId: piece.id });
      setNotice(null);
      return;
    }

    setSelection(null);
  }

  return (
    <main className="app-shell">
      <section className="table">
        <header className="top-bar">
          <div>
            <p className="eyebrow">Rune Lanes</p>
            <h1>Round {game.round}</h1>
          </div>
          <div className="actions">
            <button
              className="icon-button"
              type="button"
              onClick={() => void runAction(newGame)}
              disabled={busy}
              title="New game"
            >
              <RotateCcw size={18} />
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() => void runAction(endTurn)}
              disabled={busy || game.phase === "gameOver"}
            >
              <Play size={18} />
              End Turn
            </button>
          </div>
        </header>

        <section className="score-row" aria-label="Score">
          <PlayerBadge player={game.player} />
          <div className="phase-pill">
            <Activity size={16} />
            {game.phase === "gameOver" ? `${sideLabel(game.winner)} wins` : "Planning"}
          </div>
          <PlayerBadge player={game.opponent} />
        </section>

        <Board
          game={game}
          selectedCard={selectedCard}
          selectedPiece={selectedPiece}
          disabled={busy || game.phase === "gameOver"}
          onTileClick={handleTileClick}
        />

        <section className="hand-and-log">
          <div className="hand" aria-label="Hand">
            {game.player.hand.map((card) => (
              <CardButton
                key={card.id}
                card={card}
                selected={selection?.type === "card" && card.id === selection.cardId}
                disabled={busy || !isPlayableCard(game, card)}
                onClick={() => {
                  setSelection(
                    selection?.type === "card" && card.id === selection.cardId
                      ? null
                      : { type: "card", cardId: card.id },
                  );
                  setNotice(null);
                }}
              />
            ))}
          </div>
          <aside className="log" aria-label="Game log">
            {notice ? <p className="notice">{notice}</p> : null}
            {game.log.map((entry, index) => (
              <p key={`${entry}-${index}`}>{entry}</p>
            ))}
          </aside>
        </section>
      </section>
    </main>
  );
}

function ShellMessage({ title, message }: { title: string; message: string }) {
  return (
    <main className="app-shell centered">
      <div className="shell-message">
        <p className="eyebrow">{title}</p>
        <h1>{message}</h1>
      </div>
    </main>
  );
}

function PlayerBadge({ player }: { player: GameState["player"] }) {
  return (
    <div className={`player-badge ${player.side}`}>
      <strong>{sideLabel(player.side)}</strong>
      <span>
        <Heart size={16} />
        {player.wizard.hp}/{player.wizard.maxHp}
      </span>
      <span>
        <Zap size={16} />
        {player.wizard.apRemaining}/{player.wizard.maxAp}
      </span>
      <span>
        <Sparkles size={16} />
        {player.mana}/{player.maxMana}
      </span>
    </div>
  );
}

function Board({
  game,
  selectedCard,
  selectedPiece,
  disabled,
  onTileClick,
}: {
  game: GameState;
  selectedCard: Card | null;
  selectedPiece: BoardPiece | null;
  disabled: boolean;
  onTileClick: (tile: HexTile) => void;
}) {
  const rows = groupTilesByRow(game.board.tiles);

  return (
    <section className="board" aria-label="Hex board">
      <div className="hex-board">
        {rows.map((row) => (
          <div className="hex-row" key={row.r}>
            {row.tiles.map((tile) => {
              const piece = pieceAt(game, tile.coord);
              const isLegal =
                !disabled &&
                ((selectedCard && isLegalCardTarget(game, selectedCard, tile.coord, piece)) ||
                  (selectedPiece &&
                    ((!piece && isLegalMove(game, selectedPiece, tile.coord)) ||
                      (piece && isLegalAttack(selectedPiece, piece)))));
              const isSelected = piece?.id === selectedPiece?.id;

              return (
                <button
                  key={coordKey(tile.coord)}
                  className={`hex-tile ${isLegal ? "legal" : ""} ${isSelected ? "selected-piece" : ""}`}
                  type="button"
                  disabled={disabled}
                  onClick={() => onTileClick(tile)}
                  title={`q ${tile.coord.q}, r ${tile.coord.r}`}
                >
                  {piece ? <PieceToken piece={piece} /> : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

function PieceToken({ piece }: { piece: BoardPiece }) {
  return (
    <span className={`piece-token ${piece.side} ${piece.pieceType}`}>
      <strong>{piece.pieceType === "wizard" ? "Wiz" : piece.name.slice(0, 3)}</strong>
      <span>
        <Sword size={11} />
        {piece.attack}
      </span>
      {piece.pieceType === "wizard" ? (
        <span>
          <Heart size={11} />
          {piece.hp}
        </span>
      ) : (
        <span>
          <Shield size={11} />
          {piece.armor}
        </span>
      )}
      <span>
        <Footprints size={11} />
        {piece.apRemaining}
      </span>
    </span>
  );
}

function CardButton({
  card,
  selected,
  disabled,
  onClick,
}: {
  card: Card;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const stats =
    card.kind.type === "unit"
      ? `${card.kind.attack}/${card.kind.armor} ap ${card.kind.maxAp}`
      : `${card.kind.effect.type} rng ${card.kind.range}`;

  return (
    <button
      className={`card-button ${selected ? "selected" : ""} ${card.rarity}`}
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="card-cost">{card.cost}</span>
      <strong>{card.name}</strong>
      <span className="card-stats">
        <WandSparkles size={13} />
        {card.rarity} · {stats}
      </span>
      <span className="card-text">{card.text}</span>
    </button>
  );
}

function groupTilesByRow(tiles: HexTile[]) {
  const rows = new Map<number, HexTile[]>();
  for (const tile of tiles) {
    rows.set(tile.coord.r, [...(rows.get(tile.coord.r) ?? []), tile]);
  }

  return [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([r, rowTiles]) => ({
      r,
      tiles: rowTiles.sort((a, b) => a.coord.q - b.coord.q),
    }));
}

function pieceAt(game: GameState, coord: HexCoord): BoardPiece | null {
  if (sameCoord(game.player.wizard.position, coord)) {
    return { ...game.player.wizard, pieceType: "wizard", name: "Wizard" };
  }
  if (sameCoord(game.opponent.wizard.position, coord)) {
    return { ...game.opponent.wizard, pieceType: "wizard", name: "Wizard" };
  }

  const unit = game.board.units.find((candidate) => sameCoord(candidate.position, coord));
  return unit ? { ...unit, pieceType: "unit" } : null;
}

function pieceById(game: GameState, pieceId: string): BoardPiece | null {
  if (game.player.wizard.id === pieceId) {
    return { ...game.player.wizard, pieceType: "wizard", name: "Wizard" };
  }
  if (game.opponent.wizard.id === pieceId) {
    return { ...game.opponent.wizard, pieceType: "wizard", name: "Wizard" };
  }

  const unit = game.board.units.find((candidate) => candidate.id === pieceId);
  return unit ? { ...unit, pieceType: "unit" } : null;
}

function isPlayableCard(game: GameState, card: Card) {
  return (
    game.phase !== "gameOver" &&
    game.player.mana >= card.cost &&
    game.player.wizard.apRemaining > 0
  );
}

function isLegalCardTarget(
  game: GameState,
  card: Card,
  coord: HexCoord,
  piece: BoardPiece | null,
) {
  if (!isPlayableCard(game, card)) {
    return false;
  }

  if (card.kind.type === "unit") {
    return !piece && distance(game.player.wizard.position, coord) === 1;
  }

  if (!piece || distance(game.player.wizard.position, piece.position) > card.kind.range) {
    return false;
  }

  switch (card.kind.effect.type) {
    case "heal":
      return piece.side === "player";
    case "buff":
      return piece.side === "player" && piece.pieceType === "unit";
    case "damage":
      return piece.side === "opponent";
  }
}

function isLegalMove(game: GameState, piece: BoardPiece, coord: HexCoord) {
  return (
    piece.side === "player" &&
    piece.apRemaining > 0 &&
    distance(piece.position, coord) === 1 &&
    !pieceAt(game, coord)
  );
}

function isLegalAttack(attacker: BoardPiece, target: BoardPiece) {
  return (
    attacker.side === "player" &&
    target.side === "opponent" &&
    attacker.apRemaining > 0 &&
    !attacker.hasAttacked &&
    distance(attacker.position, target.position) === 1
  );
}

function distance(a: HexCoord, b: HexCoord) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = -a.q - a.r - (-b.q - b.r);
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
}

function sameCoord(a: HexCoord, b: HexCoord) {
  return a.q === b.q && a.r === b.r;
}

function coordKey(coord: HexCoord) {
  return `${coord.q}:${coord.r}`;
}

function sideLabel(side: Side | null) {
  if (side === "player") {
    return "You";
  }
  if (side === "opponent") {
    return "Opponent";
  }
  return "Nobody";
}
