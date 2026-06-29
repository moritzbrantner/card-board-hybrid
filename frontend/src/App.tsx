import {
  Activity,
  Archive,
  Footprints,
  Heart,
  Layers,
  LibraryBig,
  Play,
  Plus,
  RotateCcw,
  Shield,
  Sparkles,
  Sword,
  WandSparkles,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { attack, createMatch, endTurn, loadMatch, movePiece, playCard } from "./api";
import type {
  Card,
  HexCoord,
  HexTile,
  MatchParticipantState,
  MatchState,
  Side,
  Unit,
  Wizard,
} from "./types";
import type { FormEvent, ReactNode } from "react";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; match: MatchState }
  | { status: "error"; message: string };

type Selection =
  | { type: "card"; cardId: string }
  | { type: "piece"; pieceId: string }
  | null;

type BoardPiece =
  | (Wizard & { pieceType: "wizard"; name: string })
  | (Unit & { pieceType: "unit"; hp?: never; maxHp?: never });

export function App() {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const handlePopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigate(to: string) {
    window.history.pushState(null, "", to);
    setPath(window.location.pathname);
  }

  if (path === "/" || path === "") {
    return <MatchPicker onNavigate={navigate} />;
  }

  const matchRoute = matchRouteFromPath(path);
  if (matchRoute) {
    return <MatchPage key={matchRoute} matchId={matchRoute} onNavigate={navigate} />;
  }

  return (
    <ShellMessage
      title="Rune Lanes"
      message="Route not found"
      actions={
        <button className="primary-button" type="button" onClick={() => navigate("/")}>
          Open match picker
        </button>
      }
    />
  );
}

function MatchPicker({ onNavigate }: { onNavigate: (to: string) => void }) {
  const [matchId, setMatchId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleCreateMatch() {
    setBusy(true);
    setNotice(null);
    try {
      const created = await createMatch();
      onNavigate(`/match/${created.matchId}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create match");
    } finally {
      setBusy(false);
    }
  }

  function handleOpenMatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = matchId.trim();
    if (!normalized) {
      setNotice("Enter a match ID.");
      return;
    }
    onNavigate(`/match/${encodeURIComponent(normalized)}`);
  }

  return (
    <main className="app-shell picker-shell">
      <section className="match-picker" aria-label="Match picker">
        <div>
          <p className="eyebrow">Rune Lanes</p>
          <h1>Open a Match</h1>
        </div>
        <div className="picker-actions">
          <button
            className="primary-button"
            type="button"
            onClick={() => void handleCreateMatch()}
            disabled={busy}
          >
            <Plus size={18} />
            New Match
          </button>
          <a className="secondary-link" href="/catalog/">
            <LibraryBig size={18} />
            Card Catalog
          </a>
        </div>
        <form className="open-match-form" onSubmit={handleOpenMatch}>
          <label htmlFor="match-id">Open Match by ID</label>
          <div>
            <input
              id="match-id"
              value={matchId}
              onChange={(event) => setMatchId(event.target.value)}
              placeholder="rl-lx5n2w"
              autoComplete="off"
            />
            <button className="primary-button" type="submit">
              Open
            </button>
          </div>
        </form>
        {notice ? <p className="notice">{notice}</p> : null}
      </section>
    </main>
  );
}

function MatchPage({
  matchId,
  onNavigate,
}: {
  matchId: string;
  onNavigate: (to: string) => void;
}) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [selection, setSelection] = useState<Selection>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setLoadState({ status: "loading" });
    setSelection(null);
    setNotice(null);
    loadMatch(matchId)
      .then((response) => setLoadState({ status: "ready", match: response.matchState }))
      .catch((error: unknown) =>
        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load match",
        }),
      );
  }, [matchId]);

  const selectedCard = useMemo(() => {
    if (loadState.status !== "ready" || selection?.type !== "card") {
      return null;
    }

    return loadState.match.player.hand.find((card) => card.id === selection.cardId) ?? null;
  }, [loadState, selection]);

  const selectedPiece = useMemo(() => {
    if (loadState.status !== "ready" || selection?.type !== "piece") {
      return null;
    }

    return pieceById(loadState.match, selection.pieceId);
  }, [loadState, selection]);

  async function runAction(action: () => Promise<MatchState>) {
    setBusy(true);
    setNotice(null);

    try {
      const match = await action();
      setLoadState({ status: "ready", match });
      setSelection(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateSeparateMatch() {
    setBusy(true);
    setNotice(null);
    try {
      const created = await createMatch();
      onNavigate(`/match/${created.matchId}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create match");
    } finally {
      setBusy(false);
    }
  }

  if (loadState.status === "loading") {
    return <ShellMessage title={`Match ${matchId}`} message="Loading board" />;
  }

  if (loadState.status === "error") {
    return (
      <ShellMessage
        title={`Match ${matchId}`}
        message={loadState.message}
        actions={
          <>
            <button className="primary-button" type="button" onClick={() => onNavigate("/")}>
              Open another
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => void handleCreateSeparateMatch()}
              title="New match"
            >
              <Plus size={18} />
            </button>
          </>
        }
      />
    );
  }

  const { match } = loadState;

  function handleTileClick(tile: HexTile) {
    if (busy || match.phase === "matchOver") {
      return;
    }

    const piece = pieceAt(match, tile.coord);

    if (selectedCard) {
      if (isLegalCardTarget(match, selectedCard, tile.coord, piece)) {
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
      if (!piece && isLegalMove(match, selectedPiece, tile.coord)) {
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
            <h1>Round {match.round}</h1>
            <p className="match-id">Match {matchId}</p>
          </div>
          <div className="actions">
            <button
              className="icon-button"
              type="button"
              onClick={() => void handleCreateSeparateMatch()}
              disabled={busy}
              title="New match"
            >
              <RotateCcw size={18} />
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() => void runAction(endTurn)}
              disabled={busy || match.phase === "matchOver"}
            >
              <Play size={18} />
              End Turn
            </button>
          </div>
        </header>

        <section className="score-row" aria-label="Score">
          <PlayerBadge player={match.player} />
          <div className="phase-pill">
            <Activity size={16} />
            {match.phase === "matchOver" ? `${sideLabel(match.winner)} wins` : "Planning"}
          </div>
          <PlayerBadge player={match.opponent} />
        </section>

        <Board
          match={match}
          selectedCard={selectedCard}
          selectedPiece={selectedPiece}
          disabled={busy || match.phase === "matchOver"}
          onTileClick={handleTileClick}
        />

        <section className="hand-and-log">
          <div className="player-zone">
            <section className="pile-row" aria-label="Player card piles">
              <PileDisplay
                icon={<Layers size={19} />}
                label="Deck"
                count={match.player.deckCount}
                status="Remaining"
              />
              <PileDisplay
                icon={<Archive size={19} />}
                label="Discard"
                count={match.player.discardCount}
                status={match.player.discardCount === 0 ? "Empty" : "In pile"}
              />
            </section>
            <div className="hand" aria-label="Hand">
              {match.player.hand.map((card) => (
                <CardButton
                  key={card.id}
                  card={card}
                  selected={selection?.type === "card" && card.id === selection.cardId}
                  disabled={busy || !isPlayableCard(match, card)}
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
          </div>
          <aside className="log" aria-label="Match log">
            {notice ? <p className="notice">{notice}</p> : null}
            {match.log.map((entry, index) => (
              <p key={`${entry}-${index}`}>{entry}</p>
            ))}
          </aside>
        </section>
      </section>
    </main>
  );
}

function PileDisplay({
  icon,
  label,
  count,
  status,
}: {
  icon: ReactNode;
  label: string;
  count: number;
  status: string;
}) {
  return (
    <div className="pile-display">
      <span className="pile-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="pile-label">{label}</span>
      <strong>{count}</strong>
      <span className="pile-status">{status}</span>
    </div>
  );
}

function ShellMessage({
  title,
  message,
  actions,
}: {
  title: string;
  message: string;
  actions?: ReactNode;
}) {
  return (
    <main className="app-shell centered">
      <div className="shell-message">
        <p className="eyebrow">{title}</p>
        <h1>{message}</h1>
        {actions ? <div className="actions shell-actions">{actions}</div> : null}
      </div>
    </main>
  );
}

function matchRouteFromPath(path: string) {
  const normalized = path.replace(/\/+$/, "");
  const match = normalized.match(/^\/match\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function PlayerBadge({ player }: { player: MatchParticipantState }) {
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
  match,
  selectedCard,
  selectedPiece,
  disabled,
  onTileClick,
}: {
  match: MatchState;
  selectedCard: Card | null;
  selectedPiece: BoardPiece | null;
  disabled: boolean;
  onTileClick: (tile: HexTile) => void;
}) {
  const rows = groupTilesByRow(match.board.tiles);

  return (
    <section className="board" aria-label="Hex board">
      <div className="hex-board">
        {rows.map((row) => (
          <div className="hex-row" key={row.r}>
            {row.tiles.map((tile) => {
              const piece = pieceAt(match, tile.coord);
              const isLegal =
                !disabled &&
                ((selectedCard && isLegalCardTarget(match, selectedCard, tile.coord, piece)) ||
                  (selectedPiece &&
                    ((!piece && isLegalMove(match, selectedPiece, tile.coord)) ||
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

function pieceAt(match: MatchState, coord: HexCoord): BoardPiece | null {
  if (sameCoord(match.player.wizard.position, coord)) {
    return { ...match.player.wizard, pieceType: "wizard", name: "Wizard" };
  }
  if (sameCoord(match.opponent.wizard.position, coord)) {
    return { ...match.opponent.wizard, pieceType: "wizard", name: "Wizard" };
  }

  const unit = match.board.units.find((candidate) => sameCoord(candidate.position, coord));
  return unit ? { ...unit, pieceType: "unit" } : null;
}

function pieceById(match: MatchState, pieceId: string): BoardPiece | null {
  if (match.player.wizard.id === pieceId) {
    return { ...match.player.wizard, pieceType: "wizard", name: "Wizard" };
  }
  if (match.opponent.wizard.id === pieceId) {
    return { ...match.opponent.wizard, pieceType: "wizard", name: "Wizard" };
  }

  const unit = match.board.units.find((candidate) => candidate.id === pieceId);
  return unit ? { ...unit, pieceType: "unit" } : null;
}

function isPlayableCard(match: MatchState, card: Card) {
  return (
    match.phase !== "matchOver" &&
    match.player.mana >= card.cost &&
    match.player.wizard.apRemaining > 0
  );
}

function isLegalCardTarget(
  match: MatchState,
  card: Card,
  coord: HexCoord,
  piece: BoardPiece | null,
) {
  if (!isPlayableCard(match, card)) {
    return false;
  }

  if (card.kind.type === "unit") {
    return !piece && distance(match.player.wizard.position, coord) === 1;
  }

  if (!piece || distance(match.player.wizard.position, piece.position) > card.kind.range) {
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

function isLegalMove(match: MatchState, piece: BoardPiece, coord: HexCoord) {
  return (
    piece.side === "player" &&
    piece.apRemaining > 0 &&
    distance(piece.position, coord) === 1 &&
    !pieceAt(match, coord)
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
