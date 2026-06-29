import { Activity, Heart, Play, RotateCcw, Shield, Sparkles, Sword } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getGame, newGame, playCard, resolveTurn } from "./api";
import type { Card, GameState, Lane, Side, Unit } from "./types";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; game: GameState }
  | { status: "error"; message: string };

export function App() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
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
    if (loadState.status !== "ready") {
      return null;
    }

    return loadState.game.player.hand.find((card) => card.id === selectedCardId) ?? null;
  }, [loadState, selectedCardId]);

  async function runAction(action: () => Promise<GameState>) {
    setBusy(true);
    setNotice(null);

    try {
      const game = await action();
      setLoadState({ status: "ready", game });
      setSelectedCardId(null);
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

  return (
    <main className="app-shell">
      <section className="table">
        <header className="top-bar">
          <div>
            <p className="eyebrow">Rune Lanes</p>
            <h1>Turn {game.turn}</h1>
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
              onClick={() => void runAction(resolveTurn)}
              disabled={busy || game.phase === "gameOver"}
            >
              <Play size={18} />
              Resolve
            </button>
          </div>
        </header>

        <section className="score-row" aria-label="Score">
          <PlayerBadge side="player" health={game.player.health} energy={game.player.energy} maxEnergy={game.player.maxEnergy} />
          <div className="phase-pill">
            <Activity size={16} />
            {game.phase === "gameOver" ? `${sideLabel(game.winner)} wins` : "Planning"}
          </div>
          <PlayerBadge
            side="opponent"
            health={game.opponent.health}
            energy={game.opponent.energy}
            maxEnergy={game.opponent.maxEnergy}
          />
        </section>

        <Board
          lanes={game.lanes}
          selectedCard={selectedCard}
          disabled={busy || game.phase === "gameOver"}
          onLaneClick={(lane) => {
            if (selectedCard) {
              void runAction(() => playCard(selectedCard.id, lane));
            }
          }}
        />

        <section className="hand-and-log">
          <div className="hand" aria-label="Hand">
            {game.player.hand.map((card) => (
              <CardButton
                key={card.id}
                card={card}
                selected={card.id === selectedCardId}
                disabled={busy || card.cost > game.player.energy || game.phase === "gameOver"}
                onClick={() => setSelectedCardId(card.id === selectedCardId ? null : card.id)}
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

function PlayerBadge({
  side,
  health,
  energy,
  maxEnergy,
}: {
  side: Side;
  health: number;
  energy: number;
  maxEnergy: number;
}) {
  return (
    <div className={`player-badge ${side}`}>
      <strong>{sideLabel(side)}</strong>
      <span>
        <Heart size={16} />
        {health}
      </span>
      <span>
        <Sparkles size={16} />
        {energy}/{maxEnergy}
      </span>
    </div>
  );
}

function Board({
  lanes,
  selectedCard,
  disabled,
  onLaneClick,
}: {
  lanes: Lane[];
  selectedCard: Card | null;
  disabled: boolean;
  onLaneClick: (lane: number) => void;
}) {
  return (
    <section className="board" aria-label="Board">
      {lanes.map((lane) => (
        <button
          key={lane.index}
          className="lane"
          type="button"
          disabled={disabled || !selectedCard}
          onClick={() => onLaneClick(lane.index)}
          title={selectedCard ? `Play ${selectedCard.name} to lane ${lane.index + 1}` : `Lane ${lane.index + 1}`}
        >
          <span className="lane-label">Lane {lane.index + 1}</span>
          <span className="cells">
            {lane.cells.map((unit, cellIndex) => (
              <span key={cellIndex} className="cell">
                {unit ? <UnitToken unit={unit} /> : null}
              </span>
            ))}
          </span>
        </button>
      ))}
    </section>
  );
}

function UnitToken({ unit }: { unit: Unit }) {
  return (
    <span className={`unit-token ${unit.side}`}>
      <strong>{unit.name.slice(0, 2)}</strong>
      <span>
        <Sword size={12} />
        {unit.attack}
      </span>
      <span>
        <Shield size={12} />
        {unit.armor}
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
      ? `${card.kind.attack}/${card.kind.armor} mv ${card.kind.movement}`
      : "tactic";

  return (
    <button
      className={`card-button ${selected ? "selected" : ""}`}
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="card-cost">{card.cost}</span>
      <strong>{card.name}</strong>
      <span className="card-stats">{stats}</span>
      <span className="card-text">{card.text}</span>
    </button>
  );
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

