import { Activity, Archive, Eye, EyeOff, Layers, Play, Plus, RotateCcw, Trophy, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import {
  activateBuilding,
  activateItem,
  advanceAi,
  attack,
  createMatch,
  endTurn,
  loadCatalog,
  loadMatch,
  movePiece,
  passPriority,
  playCard,
} from "../api";
import type { AccountPreferenceProps, BoardUnit, LoadState, Selection, UnitContextMenu } from "../appTypes";
import { createBoardAnimationCue, type BoardAnimationCue } from "../boardAnimations";
import {
  boardCursorConfirmIntent,
  hideBoardCursor,
  initialBoardCursorCoord,
  isBoardCursorDirectionCommand,
  moveBoardCursorCoord,
  type BoardCursorSelection,
} from "../boardCursor";
import { useHotkeyHandlers, useMatchChromeMinimized } from "../appHooks";
import {
  Board,
  CardButton,
  OpponentHandDisplay,
  PileDisplay,
  PlayerBadge,
  StackDisplay,
  UnitCardModal,
  UnitContextMenuView,
} from "../components/board";
import { AccountActions, ShellMessage } from "../components/common";
import { sideLabel } from "../labels";
import { liveAiPlaybackFrames } from "../livePlayback";
import {
  buildingEffectIsActivated,
  cardFanStyle,
  buildingAt,
  cardTargetForTile,
  delay,
  handCountForSide,
  handForSide,
  hasPlayablePriorityResponse,
  isLegalAttack,
  isLegalMove,
  isPlayableCard,
  latestReplayEvent,
  opponentSideOf,
  participantBySide,
  pieceAt,
  pieceById,
  tileAt,
} from "../matchBoardHelpers";
import { createMatchVisualCatalog } from "../matchVisualIdentity";
import type { HotkeyHandlers } from "../hotkeyRuntime";
import type {
  Card,
  CatalogCard,
  HexCoord,
  HexTile,
  MatchResponse,
  MatchState,
  ReplayEvent,
  Side,
} from "../types";

export function MatchPage({
  matchId,
  onNavigate,
  currentUser,
  onSignOut,
  allowSignOut,
  loginNextPath,
  visualPreferences,
}: {
  matchId: string;
  onNavigate: (to: string) => void;
} & AccountPreferenceProps) {
  const viewerSide: Side = "player";
  const boardVisualMode = visualPreferences.preferences.boardVisualMode;
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [catalogCards, setCatalogCards] = useState<CatalogCard[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [boardCursor, setBoardCursor] = useState<{ coord: HexCoord | null; visible: boolean }>({
    coord: null,
    visible: false,
  });
  const [focusedUnitPieceId, setFocusedUnitPieceId] = useState<string | null>(null);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [playedCardId, setPlayedCardId] = useState<string | null>(null);
  const [unitModalPieceId, setUnitModalPieceId] = useState<string | null>(null);
  const [unitContextMenu, setUnitContextMenu] = useState<UnitContextMenu>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [boardAnimation, setBoardAnimation] = useState<BoardAnimationCue | null>(null);
  const [matchChromeMinimized, setMatchChromeMinimized] = useMatchChromeMinimized();
  const animationSequenceRef = useRef(0);
  const reducedMotion = visualPreferences.effectiveMotion === "reduced";

  useEffect(() => {
    setLoadState({ status: "loading" });
    setSelection(null);
    setBoardCursor({ coord: null, visible: false });
    setFocusedUnitPieceId(null);
    setDraggedCardId(null);
    setPlayedCardId(null);
    setUnitContextMenu(null);
    setUnitModalPieceId(null);
    setNotice(null);
    setBoardAnimation(null);
    loadMatch(matchId)
      .then((response) => setLoadState({ status: "ready", match: response.matchState }))
      .catch((error: unknown) =>
        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load match",
        }),
      );
  }, [matchId]);

  useEffect(() => {
    loadCatalog()
      .then((response) => setCatalogCards(response.cards))
      .catch(() => setCatalogCards([]));
  }, []);

  const visualCatalog = useMemo(
    () => createMatchVisualCatalog(catalogCards),
    [catalogCards],
  );
  const readyMatch = loadState.status === "ready" ? loadState.match : null;
  const playerHasPriorityResponse = useMemo(
    () => (readyMatch ? hasPlayablePriorityResponse(readyMatch, viewerSide) : false),
    [readyMatch, viewerSide],
  );

  const selectedCard = useMemo(() => {
    if (loadState.status !== "ready" || selection?.type !== "card") {
      return null;
    }

    return handForSide(loadState.match, viewerSide).find((card) => card.id === selection.cardId) ?? null;
  }, [loadState, selection]);

  const selectedPiece = useMemo(() => {
    if (loadState.status !== "ready" || selection?.type !== "piece") {
      return null;
    }

    return pieceById(loadState.match, selection.pieceId);
  }, [loadState, selection]);

  const modalUnit = useMemo(() => {
    if (loadState.status !== "ready" || unitModalPieceId === null) {
      return null;
    }

    const piece = pieceById(loadState.match, unitModalPieceId);
    return piece?.pieceType === "unit" ? piece : null;
  }, [loadState, unitModalPieceId]);

  const modalUnitVisualIdentity = useMemo(
    () => (modalUnit ? visualCatalog.unit(modalUnit) : null),
    [modalUnit, visualCatalog],
  );

  const contextMenuUnit = useMemo(() => {
    if (loadState.status !== "ready" || unitContextMenu === null) {
      return null;
    }

    const piece = pieceById(loadState.match, unitContextMenu.pieceId);
    return piece?.pieceType === "unit" ? piece : null;
  }, [loadState, unitContextMenu]);

  const focusedUnit = useMemo(() => {
    if (loadState.status !== "ready" || focusedUnitPieceId === null) {
      return null;
    }

    const piece = pieceById(loadState.match, focusedUnitPieceId);
    return piece?.pieceType === "unit" ? piece : null;
  }, [loadState, focusedUnitPieceId]);

  useEffect(() => {
    if (!readyMatch || boardCursor.coord) {
      return;
    }

    setBoardCursor({ coord: initialBoardCursorCoord(readyMatch, viewerSide), visible: false });
  }, [boardCursor.coord, readyMatch, viewerSide]);

  async function runAction(action: () => Promise<MatchResponse>) {
    setBusy(true);
    setNotice(null);

    try {
      setSelection(null);
      setFocusedUnitPieceId(null);
      setDraggedCardId(null);
      setPlayedCardId(null);
      setUnitModalPieceId(null);
      setUnitContextMenu(null);
      const response = await action();
      await playLiveActionResponse(response);
    } catch (error) {
      setPlayedCardId(null);
      setNotice(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function playLiveActionResponse(response: MatchResponse) {
    const playbackFrames = liveAiPlaybackFrames(response.replayFrames ?? []);
    let previousMatch = loadState.status === "ready" ? loadState.match : null;

    function acceptMatch(nextMatch: MatchState, event?: ReplayEvent | null) {
      setLoadState({ status: "ready", match: nextMatch });
      setBoardAnimation(
        createBoardAnimationCue({
          previous: previousMatch,
          next: nextMatch,
          event,
          sequence: ++animationSequenceRef.current,
          reducedMotion,
        }),
      );
      previousMatch = nextMatch;
    }

    if (playbackFrames.length === 0) {
      acceptMatch(response.matchState, latestReplayEvent(response.replayFrames));
      return;
    }

    for (const frame of playbackFrames) {
      await delay(visualPreferences.liveAiDelayMs);
      acceptMatch(frame.matchState, frame.event);
    }

    setLoadState({ status: "ready", match: response.matchState });
  }

  useEffect(() => {
    if (!readyMatch || busy || readyMatch.phase === "matchOver") {
      return;
    }

    let action: (() => Promise<MatchResponse>) | null = null;
    if (readyMatch.actionStack.length > 0) {
      if (readyMatch.prioritySide === "player" && !playerHasPriorityResponse) {
        action = () => passPriority(matchId);
      } else if (readyMatch.prioritySide === "opponent") {
        action = () => advanceAi(matchId);
      }
    } else if (readyMatch.activeSide === "opponent") {
      action = () => advanceAi(matchId);
    }

    if (!action) {
      return;
    }

    const scheduledAction = action;
    const timeoutId = window.setTimeout(() => {
      void runAction(scheduledAction);
    }, visualPreferences.liveAiDelayMs);

    return () => window.clearTimeout(timeoutId);
  }, [readyMatch, busy, matchId, playerHasPriorityResponse, visualPreferences.liveAiDelayMs]);

  const matchHotkeyHandlers = useMemo<HotkeyHandlers>(
    () => ({
      cancel: () => {
        const hadContext =
          selection !== null ||
          boardCursor.visible ||
          draggedCardId !== null ||
          playedCardId !== null ||
          unitModalPieceId !== null ||
          unitContextMenu !== null;
        if (!hadContext) {
          return false;
        }

        setSelection(null);
        setBoardCursor(hideBoardCursor);
        setDraggedCardId(null);
        setPlayedCardId(null);
        setUnitModalPieceId(null);
        setUnitContextMenu(null);
        setNotice(null);
        return true;
      },
      cursorNorthwest: () => moveKeyboardCursor("cursorNorthwest"),
      cursorNortheast: () => moveKeyboardCursor("cursorNortheast"),
      cursorEast: () => moveKeyboardCursor("cursorEast"),
      cursorWest: () => moveKeyboardCursor("cursorWest"),
      cursorSouthwest: () => moveKeyboardCursor("cursorSouthwest"),
      cursorSoutheast: () => moveKeyboardCursor("cursorSoutheast"),
      confirm: () => {
        if (!readyMatch || busy || readyMatch.phase === "matchOver") {
          return false;
        }

        const coord = boardCursor.coord ?? initialBoardCursorCoord(readyMatch, viewerSide);
        const tile = tileAt(readyMatch, coord);
        if (!tile) {
          return false;
        }

        const piece = pieceAt(readyMatch, coord);
        const intent = boardCursorConfirmIntent({
          coord,
          selection: selection as BoardCursorSelection,
          focusedPiece: piece ? { id: piece.id, side: piece.side } : null,
          viewerSide,
        });

        setBoardCursor({ coord, visible: true });

        if (intent.type === "selectPiece") {
          setSelection({ type: "piece", pieceId: intent.pieceId });
          setFocusedUnitPieceId(piece?.pieceType === "unit" ? piece.id : null);
          setUnitContextMenu(null);
          setUnitModalPieceId(null);
          setNotice(null);
          return true;
        }

        if (intent.type === "targetHex") {
          handleTileClick(tile);
          return true;
        }

        return false;
      },
      endTurn: () => {
        if (
          !readyMatch ||
          busy ||
          readyMatch.phase === "matchOver" ||
          readyMatch.activeSide !== viewerSide ||
          readyMatch.actionStack.length > 0
        ) {
          return false;
        }

        void runAction(() => endTurn(matchId));
        return true;
      },
      passPriority: () => {
        if (
          !readyMatch ||
          busy ||
          readyMatch.phase === "matchOver" ||
          readyMatch.actionStack.length === 0 ||
          readyMatch.prioritySide !== viewerSide
        ) {
          return false;
        }

        void runAction(() => passPriority(matchId));
        return true;
      },
      openCardInfo: () => {
        const unit =
          contextMenuUnit ??
          (selectedPiece?.pieceType === "unit" ? selectedPiece : null) ??
          focusedUnit;
        if (!unit) {
          return false;
        }

        setUnitModalPieceId(unit.id);
        setUnitContextMenu(null);
        return true;
      },
    }),
    [
      busy,
      boardCursor,
      contextMenuUnit,
      draggedCardId,
      focusedUnit,
      matchId,
      playedCardId,
      readyMatch,
      selectedPiece,
      selection,
      unitContextMenu,
      unitModalPieceId,
    ],
  );
  useHotkeyHandlers(visualPreferences.preferences.hotkeys, matchHotkeyHandlers);

  function moveKeyboardCursor(commandId: Parameters<typeof moveBoardCursorCoord>[1]) {
    if (
      !isBoardCursorDirectionCommand(commandId) ||
      !readyMatch ||
      busy ||
      readyMatch.phase === "matchOver"
    ) {
      return false;
    }

    const radius = readyMatch.board.radius;
    const currentCoord = boardCursor.coord ?? initialBoardCursorCoord(readyMatch, viewerSide);
    const coord = moveBoardCursorCoord(currentCoord, commandId, radius);
    const piece = pieceAt(readyMatch, coord);
    setBoardCursor({ coord, visible: true });
    setFocusedUnitPieceId(piece?.pieceType === "unit" ? piece.id : null);
    setUnitContextMenu(null);
    setNotice(null);
    return true;
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
  const hasPendingStack = match.actionStack.length > 0;
  const isPlayerPriority = hasPendingStack && match.prioritySide === viewerSide;
  const canPassSoloPriority = isPlayerPriority && playerHasPriorityResponse;
  const phaseLabel =
    match.phase === "matchOver"
      ? `${sideLabel(match.winner)} wins`
      : hasPendingStack
        ? `${sideLabel(match.prioritySide)} priority`
        : match.activeSide === viewerSide
          ? "Your turn"
          : "AI thinking";
  const enemySide = opponentSideOf(viewerSide);
  const viewerHand = handForSide(match, viewerSide);

  function handleTileClick(tile: HexTile) {
    if (busy || match.phase === "matchOver") {
      return;
    }

    setUnitContextMenu(null);
    const piece = pieceAt(match, tile.coord);
    setFocusedUnitPieceId(piece?.pieceType === "unit" ? piece.id : null);

    if (selectedCard) {
      const target = cardTargetForTile(match, viewerSide, selectedCard, tile);
      if (target) {
        setPlayedCardId(selectedCard.id);
        void runAction(() => playCard(matchId, selectedCard.id, target));
      } else {
        setNotice("That card cannot target this hex.");
      }
      return;
    }

    if (selectedPiece) {
      if (!piece && isLegalMove(match, viewerSide, selectedPiece, tile.coord)) {
        void runAction(() => movePiece(matchId, selectedPiece.id, tile.coord));
        return;
      }
      if (piece && isLegalAttack(match, viewerSide, selectedPiece, piece)) {
        void runAction(() => attack(matchId, selectedPiece.id, piece.id));
        return;
      }
    }

    const building = buildingAt(match, tile.coord);
    if (
      !selectedPiece &&
      piece?.side === viewerSide &&
      building &&
      buildingEffectIsActivated(building.effect) &&
      !building.activatedThisTurn &&
      piece.apRemaining > 0 &&
      match.actionStack.length === 0 &&
      match.activeSide === viewerSide
    ) {
      void runAction(() => activateBuilding(matchId, building.id));
      return;
    }

    if (piece?.side === viewerSide) {
      setSelection({ type: "piece", pieceId: piece.id });
      setNotice(null);
      return;
    }

    setSelection(null);
    setUnitModalPieceId(null);
  }

  function handleCardDragStart(card: Card, event: ReactDragEvent<HTMLButtonElement>) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", card.id);
    setUnitContextMenu(null);
    setFocusedUnitPieceId(null);
    setSelection({ type: "card", cardId: card.id });
    setDraggedCardId(card.id);
    setUnitModalPieceId(null);
    setNotice(null);
  }

  function handleCardDrop(tile: HexTile, cardId: string) {
    if (busy || match.phase === "matchOver") {
      return;
    }

    const card = handForSide(match, viewerSide).find((candidate) => candidate.id === cardId);
    if (!card) {
      setNotice("That card is no longer in your hand.");
      setDraggedCardId(null);
      return;
    }

    const target = cardTargetForTile(match, viewerSide, card, tile);
    if (!target) {
      setNotice("That card cannot target this hex.");
      setDraggedCardId(null);
      return;
    }

    setDraggedCardId(null);
    setPlayedCardId(card.id);
    void runAction(() => playCard(matchId, card.id, target));
  }

  function handleUnitContextMenu(unit: BoardUnit, position: { x: number; y: number }) {
    if (busy || match.phase === "matchOver") {
      return;
    }

    setUnitContextMenu({
      pieceId: unit.id,
      x: position.x,
      y: position.y,
    });
    setFocusedUnitPieceId(unit.id);
  }

  function handleActivateUnitItem(unit: BoardUnit, itemId: string) {
    setUnitContextMenu(null);
    void runAction(() => activateItem(matchId, unit.id, itemId));
  }

  function handleActivateUnitBuilding(buildingId: string) {
    setUnitContextMenu(null);
    void runAction(() => activateBuilding(matchId, buildingId));
  }

  return (
    <main className={`app-shell match-app-shell ${matchChromeMinimized ? "match-chrome-minimized" : ""}`}>
      <section className="table match-table">
        <header className="top-bar match-chrome">
          <div>
            <p className="eyebrow">Rune Lanes</p>
            <h1>Round {match.round}</h1>
            <p className="match-id">Match {matchId}</p>
          </div>
          <div className="actions">
            <AccountActions
              currentUser={currentUser}
              onNavigate={onNavigate}
              onSignOut={onSignOut}
              allowSignOut={allowSignOut}
              loginNextPath={loginNextPath}
            />
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
              className="icon-button"
              type="button"
              onClick={() => setMatchChromeMinimized(true)}
              title="Minimize match chrome"
              aria-label="Minimize match chrome"
            >
              <EyeOff size={18} />
            </button>
          </div>
        </header>
        <button
          className="icon-button match-chrome-restore"
          type="button"
          onClick={() => setMatchChromeMinimized(false)}
          title="Restore match chrome"
          aria-label="Restore match chrome"
        >
          <Eye size={18} />
        </button>
        <div className="match-action-dock" aria-label="Match actions">
          <button
            className="primary-button"
            type="button"
            onClick={() => void runAction(() => endTurn(matchId))}
            disabled={
              busy ||
              match.phase === "matchOver" ||
              match.activeSide !== viewerSide ||
              hasPendingStack
            }
          >
            <Play size={18} />
            End Turn
          </button>
          {hasPendingStack ? (
            <button
              className="primary-button"
              type="button"
              onClick={() => void runAction(() => passPriority(matchId))}
              disabled={busy || match.phase === "matchOver" || !isPlayerPriority}
            >
              <Zap size={18} />
              Pass Priority
            </button>
          ) : null}
        </div>

        <section className="battlefield">
          <div className="battlefield-hud battlefield-hud-player">
            <PlayerBadge player={participantBySide(match, viewerSide)} />
          </div>
          <div className="battlefield-hud battlefield-hud-opponent">
            <PlayerBadge player={participantBySide(match, enemySide)} />
          </div>
          <div className="battlefield-hud battlefield-hud-hand">
            <OpponentHandDisplay count={handCountForSide(match, enemySide)} />
          </div>
          <div className="battlefield-hud battlefield-hud-phase">
            <div className="phase-pill">
              <Activity size={16} />
              {phaseLabel}
            </div>
          </div>
          <Board
            match={match}
            animation={boardAnimation}
            boardVisualMode={boardVisualMode}
            viewerSide="player"
            visualCatalog={visualCatalog}
            selectedCard={selectedCard}
            selectedPiece={selectedPiece}
            focusedCoord={boardCursor.visible ? boardCursor.coord : null}
            disabled={busy || match.phase === "matchOver"}
            onTileClick={handleTileClick}
            onTileDrop={handleCardDrop}
            onUnitContextMenu={handleUnitContextMenu}
            onFocusedUnitChange={setFocusedUnitPieceId}
          />
          <div className="hand-overlay">
            <div className="hand" aria-label="Hand">
              {viewerHand.map((card, index) => (
                <CardButton
                  key={card.id}
                  card={card}
                  visualIdentity={visualCatalog.card(card)}
                  selected={selection?.type === "card" && card.id === selection.cardId}
                  dragging={draggedCardId === card.id}
                  played={playedCardId === card.id}
                  style={cardFanStyle(index, viewerHand.length)}
                  disabled={busy || !isPlayableCard(match, viewerSide, card)}
                  onClick={() => {
                    setUnitContextMenu(null);
                    setFocusedUnitPieceId(null);
                    setSelection(
                      selection?.type === "card" && card.id === selection.cardId
                        ? null
                        : { type: "card", cardId: card.id },
                    );
                    setUnitModalPieceId(null);
                    setNotice(null);
                  }}
                  onDragStart={(event) => handleCardDragStart(card, event)}
                  onDragEnd={() => setDraggedCardId(null)}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="hand-and-log">
          <div className="player-zone">
            <StackDisplay stack={match.actionStack} prioritySide={match.prioritySide} />
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
          </div>
          <aside className="log" aria-label="Match log">
            {notice ? <p className="notice">{notice}</p> : null}
            {canPassSoloPriority ? <p>Play a response or pass priority.</p> : null}
            {match.log.map((entry, index) => (
              <p key={`${entry}-${index}`}>{entry}</p>
            ))}
          </aside>
        </section>
      </section>
      {modalUnit ? (
        <UnitCardModal
          unit={modalUnit}
          unitVisualIdentity={modalUnitVisualIdentity ?? visualCatalog.unit(modalUnit)}
          onClose={() => setUnitModalPieceId(null)}
        />
      ) : null}
      {unitContextMenu && contextMenuUnit ? (
        <UnitContextMenuView
          menu={unitContextMenu}
          unit={contextMenuUnit}
          onClose={() => setUnitContextMenu(null)}
          onOpenCardInfo={() => {
            setUnitModalPieceId(contextMenuUnit.id);
            setUnitContextMenu(null);
          }}
          canActivateItems={
            match.actionStack.length === 0 &&
            match.activeSide === viewerSide &&
            contextMenuUnit.side === viewerSide
          }
          onActivateItem={(itemId) => handleActivateUnitItem(contextMenuUnit, itemId)}
          building={buildingAt(match, contextMenuUnit.position)}
          canActivateBuilding={
            match.actionStack.length === 0 &&
            match.activeSide === viewerSide &&
            contextMenuUnit.side === viewerSide
          }
          onActivateBuilding={handleActivateUnitBuilding}
        />
      ) : null}
      {match.phase === "matchOver" ? (
        <MatchEndOverlay
          winner={match.winner}
          viewerSide={viewerSide}
          onOpenSummary={() => onNavigate(`/matches/${matchId}/summary`)}
        />
      ) : null}
    </main>
  );
}

function MatchEndOverlay({
  winner,
  viewerSide,
  onOpenSummary,
}: {
  winner: Side | null;
  viewerSide: Side;
  onOpenSummary: () => void;
}) {
  const result = winner === viewerSide ? "Victory" : "Defeat";
  const winnerLabel = winner ? `${sideLabel(winner)} wins` : "Match complete";

  return (
    <section className="match-end-overlay" role="dialog" aria-label="Match complete">
      <div className={`match-end-panel ${winner === viewerSide ? "victory" : "defeat"}`}>
        <span className="match-end-icon">
          <Trophy size={34} />
        </span>
        <p className="eyebrow">{winnerLabel}</p>
        <h2>{result}</h2>
        <button className="primary-button" type="button" onClick={onOpenSummary}>
          <Play size={18} />
          Match Summary
        </button>
      </div>
    </section>
  );
}
