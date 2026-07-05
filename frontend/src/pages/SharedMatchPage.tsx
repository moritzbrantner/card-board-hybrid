import { Archive, Copy, Eye, EyeOff, House, Layers, Play, Sword, Users, Wifi, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import {
  activateItem,
  joinSharedMatch,
  loadCatalog,
  loadDecks,
  loadProgression,
  loadSharedMatch,
  loadSystemDecks,
  sharedMatchWebSocketUrl,
  updateDeck,
} from "../api";
import type {
  AccountPreferenceProps,
  BoardUnit,
  DeckLoadState,
  ProgressionLoadState,
  Selection,
  SharedLoadState,
  SystemDeckLoadState,
  UnitContextMenu,
} from "../appTypes";
import { createBoardAnimationCue, type BoardAnimationCue } from "../boardAnimations";
import {
  boardCursorConfirmIntent,
  hideBoardCursor,
  initialBoardCursorCoord,
  isBoardCursorDirectionCommand,
  moveBoardCursorCoord,
  type BoardCursorSelection,
  type BoardCursorState,
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
import { LobbySeatStatus, RuneSelector, HeroPicker } from "../components/loadoutControls";
import { deckChoiceFromValue, deckChoiceValue } from "../deckHelpers";
import {
  defaultRuneIdsForHero,
  isHeroType,
  parseDeckChoice,
  parseRuneIds,
  sideLabel,
  heroOptionByType,
} from "../labels";
import {
  buildingAt,
  cardFanStyle,
  cardTargetForTile,
  handCountForSide,
  handForSide,
  isLegalAttack,
  isLegalMove,
  isPlayableCard,
  opponentSideOf,
  participantBySide,
  pieceAt,
  pieceById,
  tileAt,
} from "../matchBoardHelpers";
import { createMatchVisualCatalog } from "../matchVisualIdentity";
import type { HotkeyHandlers } from "../hotkeyRuntime";
import type {
  BuildingEffect,
  Card,
  CatalogCard,
  HexTile,
  MatchActionRequest,
  MatchState,
  SharedClientMessage,
  SharedServerMessage,
  Side,
  HeroType,
} from "../types";
import { HERO_OPTIONS } from "../heroes";

export function SharedMatchPage({
  matchId,
  seatToken,
  onNavigate,
  currentUser,
  onSignOut,
  allowSignOut,
  loginNextPath,
  visualPreferences,
}: {
  matchId: string;
  seatToken: string;
  onNavigate: (to: string) => void;
} & AccountPreferenceProps) {
  const boardVisualMode = visualPreferences.preferences.boardVisualMode;
  const [loadState, setLoadState] = useState<SharedLoadState>({ status: "loading" });
  const [catalogCards, setCatalogCards] = useState<CatalogCard[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [focusedUnitPieceId, setFocusedUnitPieceId] = useState<string | null>(null);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [playedCardId, setPlayedCardId] = useState<string | null>(null);
  const [unitModalPieceId, setUnitModalPieceId] = useState<string | null>(null);
  const [unitContextMenu, setUnitContextMenu] = useState<UnitContextMenu>(null);
  const [boardCursor, setBoardCursor] = useState<BoardCursorState>({
    coord: null,
    visible: false,
  });
  const [selectedHeroType, setSelectedHeroType] = useState<HeroType>(() => {
    const stored = sessionStorage.getItem(`rune-lanes-hero:${matchId}`);
    return isHeroType(stored) ? stored : (currentUser?.preferredHeroType ?? "runekeeper");
  });
  const [deckLoadState, setDeckLoadState] = useState<DeckLoadState | null>(
    currentUser ? { status: "loading" } : null,
  );
  const [systemDeckLoadState, setSystemDeckLoadState] = useState<SystemDeckLoadState>({
    status: "loading",
  });
  const [progressionLoadState, setProgressionLoadState] = useState<ProgressionLoadState | null>(
    currentUser ? { status: "loading" } : null,
  );
  const [selectedDeckId, setSelectedDeckId] = useState<string>(() => {
    const stored = sessionStorage.getItem(`rune-lanes-deck-choice:${matchId}`);
    return deckChoiceValue(parseDeckChoice(stored));
  });
  const [selectedRuneIds, setSelectedRuneIds] = useState<string[]>(() => {
    const stored = sessionStorage.getItem(`rune-lanes-runes:${matchId}`);
    return stored ? parseRuneIds(stored) : [];
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [boardAnimation, setBoardAnimation] = useState<BoardAnimationCue | null>(null);
  const [matchChromeMinimized, setMatchChromeMinimized] = useMatchChromeMinimized();
  const socketRef = useRef<WebSocket | null>(null);
  const latestSharedMatchRef = useRef<MatchState | null>(null);
  const animationSequenceRef = useRef(0);
  const reducedMotion = visualPreferences.effectiveMotion === "reduced";

  useEffect(() => {
    setLoadState({ status: "loading" });
    setSelection(null);
    setFocusedUnitPieceId(null);
    setDraggedCardId(null);
    setPlayedCardId(null);
    setNotice(null);
    setBoardAnimation(null);
    setBoardCursor({ coord: null, visible: false });
    latestSharedMatchRef.current = null;
    loadSharedMatch(matchId, seatToken)
      .then((shared) => {
        latestSharedMatchRef.current = shared.matchState;
        setLoadState({ status: "ready", shared });
      })
      .catch((error: unknown) =>
        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load shared match",
        }),
      );
  }, [matchId, seatToken]);

  useEffect(() => {
    loadCatalog()
      .then((response) => setCatalogCards(response.cards))
      .catch(() => setCatalogCards([]));
  }, []);

  useEffect(() => {
    loadSystemDecks()
      .then((response) => setSystemDeckLoadState({ status: "ready", response }))
      .catch((error: unknown) =>
        setSystemDeckLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load system decks",
        }),
      );
  }, []);

  const visualCatalog = useMemo(
    () => createMatchVisualCatalog(catalogCards),
    [catalogCards],
  );

  useEffect(() => {
    if (!currentUser) {
      setDeckLoadState(null);
      setProgressionLoadState(null);
      setSelectedDeckId("starter");
      setSelectedRuneIds([]);
      return;
    }
    setDeckLoadState({ status: "loading" });
    loadDecks()
      .then((response) => {
        setDeckLoadState({ status: "ready", response });
        const defaultDeck = response.decks.find((deck) => deck.isDefault && deck.legality.legal);
        if (defaultDeck) {
          setSelectedDeckId(String(defaultDeck.id));
        }
      })
      .catch((error: unknown) =>
        setDeckLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load decks",
        }),
      );
    setProgressionLoadState({ status: "loading" });
    loadProgression()
      .then((progression) => {
        setProgressionLoadState({ status: "ready", progression });
        setSelectedRuneIds((current) =>
          current.length > 0 ? current : defaultRuneIdsForHero(progression, selectedHeroType),
        );
      })
      .catch((error: unknown) =>
        setProgressionLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load progression",
        }),
      );
  }, [currentUser]);

  useEffect(() => {
    if (progressionLoadState?.status === "ready") {
      const stored = sessionStorage.getItem(`rune-lanes-runes:${matchId}`);
      setSelectedRuneIds(
        stored ? parseRuneIds(stored) : defaultRuneIdsForHero(progressionLoadState.progression, selectedHeroType),
      );
    }
  }, [selectedHeroType, progressionLoadState?.status, matchId]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const socket = new WebSocket(sharedMatchWebSocketUrl(matchId, seatToken));
    socketRef.current = socket;

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data as string) as SharedServerMessage;
      if (
        message.type === "snapshot" ||
        message.type === "presenceChanged" ||
        message.type === "actionAccepted"
      ) {
        if (message.type === "actionAccepted" && message.payload.matchState) {
          setBoardAnimation(
            createBoardAnimationCue({
              previous: latestSharedMatchRef.current,
              next: message.payload.matchState,
              sequence: ++animationSequenceRef.current,
              reducedMotion,
            }),
          );
        }
        latestSharedMatchRef.current = message.payload.matchState;
        setLoadState({ status: "ready", shared: message.payload });
        setBusy(false);
        if (message.type === "actionAccepted") {
          setSelection(null);
          setFocusedUnitPieceId(null);
          setDraggedCardId(null);
          setPlayedCardId(null);
          setUnitModalPieceId(null);
          setUnitContextMenu(null);
        }
      } else if (message.type === "actionRejected") {
        setPlayedCardId(null);
        setNotice(message.message);
        setBusy(false);
      } else if (message.type === "error") {
        setPlayedCardId(null);
        setNotice(message.message);
        setBusy(false);
      }
    });

    socket.addEventListener("close", () => {
      if (socketRef.current === socket) {
        setNotice("Live connection closed. Reload the page to reconnect.");
      }
    });

    const heartbeat = window.setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        const message: SharedClientMessage = { type: "heartbeat" };
        socket.send(JSON.stringify(message));
      }
    }, 15_000);

    return () => {
      window.clearInterval(heartbeat);
      socketRef.current = null;
      socket.close();
    };
  }, [matchId, seatToken, reducedMotion]);

  const shared = loadState.status === "ready" ? loadState.shared : null;
  const match = shared?.matchState ?? null;
  const viewerSide = shared?.viewerSide ?? "player";
  const isActiveViewer = Boolean(match && shared?.activeSide === viewerSide);
  const hasPendingStack = Boolean(match && match.actionStack.length > 0);
  const isPriorityViewer = Boolean(match && match.prioritySide === viewerSide);
  const canAct = Boolean(match && (hasPendingStack ? isPriorityViewer : isActiveViewer));

  useEffect(() => {
    if (shared?.status === "setup" && shared.viewerHeroType) {
      setSelectedHeroType(shared.viewerHeroType);
    }
  }, [shared?.status, shared?.viewerHeroType]);

  const selectedCard = useMemo(() => {
    if (!match || selection?.type !== "card") {
      return null;
    }

    return handForSide(match, viewerSide).find((card) => card.id === selection.cardId) ?? null;
  }, [match, selection, viewerSide]);

  const selectedPiece = useMemo(() => {
    if (!match || selection?.type !== "piece") {
      return null;
    }

    return pieceById(match, selection.pieceId);
  }, [match, selection]);

  const modalUnit = useMemo(() => {
    if (!match || unitModalPieceId === null) {
      return null;
    }

    const piece = pieceById(match, unitModalPieceId);
    return piece?.pieceType === "unit" ? piece : null;
  }, [match, unitModalPieceId]);

  const modalUnitVisualIdentity = useMemo(
    () => (modalUnit ? visualCatalog.unit(modalUnit) : null),
    [modalUnit, visualCatalog],
  );

  const contextMenuUnit = useMemo(() => {
    if (!match || unitContextMenu === null) {
      return null;
    }

    const piece = pieceById(match, unitContextMenu.pieceId);
    return piece?.pieceType === "unit" ? piece : null;
  }, [match, unitContextMenu]);

  const focusedUnit = useMemo(() => {
    if (!match || focusedUnitPieceId === null) {
      return null;
    }

    const piece = pieceById(match, focusedUnitPieceId);
    return piece?.pieceType === "unit" ? piece : null;
  }, [match, focusedUnitPieceId]);

  useEffect(() => {
    if (!match || boardCursor.coord) {
      return;
    }

    setBoardCursor({ coord: initialBoardCursorCoord(match, viewerSide), visible: false });
  }, [boardCursor.coord, match, viewerSide]);

  function sendSharedAction(action: MatchActionRequest) {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setNotice("Live connection is not ready.");
      return;
    }

    setBusy(true);
    setNotice(null);
    const message: SharedClientMessage = {
      type: "action",
      requestId: crypto.randomUUID(),
      action,
    };
    socket.send(JSON.stringify(message));
  }

  const sharedHotkeyHandlers = useMemo<HotkeyHandlers>(
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
      cursorNorthwest: () => moveSharedKeyboardCursor("cursorNorthwest"),
      cursorNortheast: () => moveSharedKeyboardCursor("cursorNortheast"),
      cursorEast: () => moveSharedKeyboardCursor("cursorEast"),
      cursorWest: () => moveSharedKeyboardCursor("cursorWest"),
      cursorSouthwest: () => moveSharedKeyboardCursor("cursorSouthwest"),
      cursorSoutheast: () => moveSharedKeyboardCursor("cursorSoutheast"),
      confirm: () => {
        if (!match || busy || match.phase === "matchOver" || !canAct) {
          return false;
        }

        const coord = boardCursor.coord ?? initialBoardCursorCoord(match, viewerSide);
        const tile = tileAt(match, coord);
        if (!tile) {
          return false;
        }

        const piece = pieceAt(match, coord);
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
        if (!match || busy || match.phase === "matchOver" || !isActiveViewer || hasPendingStack) {
          return false;
        }

        sendSharedAction({ type: "endTurn" });
        return true;
      },
      passPriority: () => {
        if (!match || busy || match.phase === "matchOver" || !hasPendingStack || !isPriorityViewer) {
          return false;
        }

        sendSharedAction({ type: "passPriority" });
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
      canAct,
      contextMenuUnit,
      draggedCardId,
      focusedUnit,
      hasPendingStack,
      isActiveViewer,
      isPriorityViewer,
      match,
      playedCardId,
      selectedPiece,
      selection,
      unitContextMenu,
      unitModalPieceId,
    ],
  );
  useHotkeyHandlers(visualPreferences.preferences.hotkeys, sharedHotkeyHandlers);

  function moveSharedKeyboardCursor(commandId: Parameters<typeof moveBoardCursorCoord>[1]) {
    if (
      !isBoardCursorDirectionCommand(commandId) ||
      !match ||
      busy ||
      match.phase === "matchOver"
    ) {
      return false;
    }

    const radius = match.board.radius;
    const currentCoord = boardCursor.coord ?? initialBoardCursorCoord(match, viewerSide);
    const coord = moveBoardCursorCoord(currentCoord, commandId, radius);
    const piece = pieceAt(match, coord);
    setBoardCursor({ coord, visible: true });
    setFocusedUnitPieceId(piece?.pieceType === "unit" ? piece.id : null);
    setUnitContextMenu(null);
    setNotice(null);
    return true;
  }

  function claimForfeit() {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setNotice("Live connection is not ready.");
      return;
    }

    setBusy(true);
    setNotice(null);
    const message: SharedClientMessage = {
      type: "claimForfeit",
      requestId: crypto.randomUUID(),
    };
    socket.send(JSON.stringify(message));
  }

  async function handleJoinSharedMatch() {
    setBusy(true);
    setNotice(null);
    try {
      const joined = await joinSharedMatch(
        matchId,
        seatToken,
        selectedHeroType,
        selectedDeckId === "starter" || selectedDeckId.startsWith("system:")
          ? undefined
          : Number(selectedDeckId),
        selectedRuneIds,
        deckChoiceFromValue(selectedDeckId),
      );
      sessionStorage.setItem(`rune-lanes-hero:${matchId}`, selectedHeroType);
      sessionStorage.setItem(`rune-lanes-runes:${matchId}`, JSON.stringify(selectedRuneIds));
      sessionStorage.setItem(
        `rune-lanes-deck-choice:${matchId}`,
        JSON.stringify(deckChoiceFromValue(selectedDeckId)),
      );
      setLoadState({ status: "ready", shared: joined });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not join match");
    } finally {
      setBusy(false);
    }
  }

  function handleSelectLobbyHero(heroType: HeroType) {
    setSelectedHeroType(heroType);
    sessionStorage.setItem(`rune-lanes-hero:${matchId}`, heroType);
    sessionStorage.removeItem(`rune-lanes-runes:${matchId}`);
  }

  function handleTileClick(tile: HexTile) {
    if (!match || busy || match.phase === "matchOver" || !canAct) {
      return;
    }

    setUnitContextMenu(null);
    const piece = pieceAt(match, tile.coord);
    setFocusedUnitPieceId(piece?.pieceType === "unit" ? piece.id : null);

    if (selectedCard) {
      const target = cardTargetForTile(match, viewerSide, selectedCard, tile);
      if (target) {
        setPlayedCardId(selectedCard.id);
        sendSharedAction({ type: "playCard", cardId: selectedCard.id, target });
      } else {
        setNotice("That card cannot target this hex.");
      }
      return;
    }

    if (selectedPiece) {
      if (!piece && isLegalMove(match, viewerSide, selectedPiece, tile.coord)) {
        sendSharedAction({ type: "movePiece", pieceId: selectedPiece.id, to: tile.coord });
        return;
      }
      if (piece && isLegalAttack(match, viewerSide, selectedPiece, piece)) {
        sendSharedAction({ type: "attack", attackerId: selectedPiece.id, targetId: piece.id });
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
      sendSharedAction({ type: "activateBuilding", buildingId: building.id });
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
    if (!match || busy || match.phase === "matchOver" || !canAct) {
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
    sendSharedAction({ type: "playCard", cardId: card.id, target });
  }

  function handleUnitContextMenu(unit: BoardUnit, position: { x: number; y: number }) {
    if (!match || busy || match.phase === "matchOver") {
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
    sendSharedAction({ type: "activateItem", unitId: unit.id, itemId });
  }

  function handleActivateUnitBuilding(buildingId: string) {
    setUnitContextMenu(null);
    sendSharedAction({ type: "activateBuilding", buildingId });
  }

  if (loadState.status === "loading") {
    return <ShellMessage title={`Match ${matchId}`} message="Loading multiplayer match" />;
  }

  if (loadState.status === "error") {
    return (
      <ShellMessage
        title={`Match ${matchId}`}
        message={loadState.message}
        actions={
          <button className="primary-button" type="button" onClick={() => onNavigate("/play")}>
            Open play
          </button>
        }
      />
    );
  }

  if (!shared) {
    return <ShellMessage title={`Match ${matchId}`} message="Shared match unavailable" />;
  }

  if (!match) {
    const inviteUrl =
      sessionStorage.getItem(`rune-lanes-invite:${matchId}`) ??
      "Invite link unavailable after reload.";
    const hasUnsavedHeroChoice = shared.viewerHeroType !== selectedHeroType;
    const savedHero = shared.viewerHeroType ? heroOptionByType(shared.viewerHeroType) : null;
    const opponentHero = shared.opponentHeroType
      ? heroOptionByType(shared.opponentHeroType)
      : null;
    const legalDecks =
      deckLoadState?.status === "ready"
        ? deckLoadState.response.decks.filter((deck) => deck.legality.legal)
        : [];
    const systemDecks =
      systemDeckLoadState.status === "ready" ? systemDeckLoadState.response.decks : [];
    const lobbyActionLabel = shared.viewerReady
      ? hasUnsavedHeroChoice
        ? "Update Hero"
        : "Ready"
      : viewerSide === "player"
        ? "Ready"
        : "Join Lobby";
    return (
      <main className="app-shell picker-shell">
        <section className="match-picker" aria-label="Shared match setup">
          <header className="picker-header">
            <div>
              <p className="eyebrow">Rune Lanes Multiplayer</p>
              <h1>Lobby</h1>
              <p className="match-id">Match {matchId}</p>
            </div>
            <AccountActions
              currentUser={currentUser}
              onNavigate={onNavigate}
              onSignOut={onSignOut}
              allowSignOut={allowSignOut}
              loginNextPath={loginNextPath}
            />
          </header>
          {viewerSide === "player" ? (
            <div className="share-panel">
              <span>Invite Link</span>
              <strong>{inviteUrl}</strong>
              <button
                className="primary-button"
                type="button"
                onClick={() => void navigator.clipboard?.writeText(inviteUrl)}
              >
                <Copy size={18} />
                Copy
              </button>
            </div>
          ) : null}
          <HeroPicker
            selectedHeroType={selectedHeroType}
            busy={busy}
            onSelect={handleSelectLobbyHero}
          />
          <section className="setup-deck-selectors" aria-label="Shared deck selection">
            <label>
              Your Deck
              <select
                value={selectedDeckId}
                onChange={(event) => setSelectedDeckId(event.target.value)}
                disabled={busy || systemDeckLoadState.status === "loading"}
              >
                <option value="starter">Starter</option>
                {systemDecks.map((deck) => (
                  <option key={deck.id} value={`system:${deck.id}`}>
                    {deck.name}
                  </option>
                ))}
                {legalDecks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name}
                  </option>
                ))}
              </select>
            </label>
            {deckLoadState?.status === "error" ? <p className="notice">{deckLoadState.message}</p> : null}
            {systemDeckLoadState.status === "error" ? (
              <p className="notice">{systemDeckLoadState.message}</p>
            ) : null}
          </section>
          {progressionLoadState?.status === "ready" ? (
            <RuneSelector
              progression={progressionLoadState.progression}
              heroType={selectedHeroType}
              selectedRuneIds={selectedRuneIds}
              onChange={setSelectedRuneIds}
            />
          ) : null}
          {progressionLoadState?.status === "error" ? (
            <p className="notice">{progressionLoadState.message}</p>
          ) : null}
          <div className="lobby-status-grid" aria-label="Lobby status">
            <LobbySeatStatus
              label="You"
              ready={shared.viewerReady}
              heroName={savedHero?.name ?? null}
            />
            <LobbySeatStatus
              label="Opponent"
              ready={shared.opponentReady}
              heroName={opponentHero?.name ?? null}
            />
          </div>
          <button
            className="primary-button"
            type="button"
            onClick={() => void handleJoinSharedMatch()}
            disabled={busy}
          >
            <Users size={18} />
            {lobbyActionLabel}
          </button>
          <p className="notice">
            {shared.viewerReady
              ? "Waiting for both players to be ready."
              : "Choose a hero to enter the lobby."}
          </p>
          {notice ? <p className="notice">{notice}</p> : null}
        </section>
      </main>
    );
  }

  const canClaimForfeit =
    shared.canClaimForfeitAt !== null &&
    now >= shared.canClaimForfeitAt &&
    match.phase !== "matchOver";
  const enemySide = opponentSideOf(viewerSide);
  const viewerHand = handForSide(match, viewerSide);
  const phaseLabel =
    match.phase === "matchOver"
      ? `${sideLabel(match.winner)} wins`
      : hasPendingStack
        ? `${sideLabel(match.prioritySide)} priority`
        : isActiveViewer
          ? "Your turn"
          : "Waiting";

  return (
    <main className={`app-shell match-app-shell ${matchChromeMinimized ? "match-chrome-minimized" : ""}`}>
      <section className="table match-table">
        <header className="top-bar match-chrome">
          <div>
            <p className="eyebrow">Rune Lanes Multiplayer</p>
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
              onClick={() => onNavigate("/")}
              title="Dashboard"
            >
              <House size={18} />
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
          {canClaimForfeit ? (
            <button className="primary-button" type="button" onClick={claimForfeit} disabled={busy}>
              <Sword size={18} />
              Claim Forfeit
            </button>
          ) : null}
          <button
            className="primary-button"
            type="button"
            onClick={() => sendSharedAction({ type: "endTurn" })}
            disabled={busy || match.phase === "matchOver" || !isActiveViewer || hasPendingStack}
          >
            <Play size={18} />
            End Turn
          </button>
          {hasPendingStack ? (
            <button
              className="primary-button"
              type="button"
              onClick={() => sendSharedAction({ type: "passPriority" })}
              disabled={busy || match.phase === "matchOver" || !isPriorityViewer}
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
              <Wifi size={16} />
              {phaseLabel}
            </div>
          </div>
          <Board
            match={match}
            animation={boardAnimation}
            boardVisualMode={boardVisualMode}
            viewerSide={viewerSide}
            visualCatalog={visualCatalog}
            selectedCard={selectedCard}
            selectedPiece={selectedPiece}
            focusedCoord={boardCursor.visible ? boardCursor.coord : null}
            disabled={busy || match.phase === "matchOver" || !canAct}
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
                  disabled={busy || !canAct || !isPlayableCard(match, viewerSide, card)}
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
                count={participantBySide(match, viewerSide).deckCount}
                status="Remaining"
              />
              <PileDisplay
                icon={<Archive size={19} />}
                label="Discard"
                count={participantBySide(match, viewerSide).discardCount}
                status={
                  participantBySide(match, viewerSide).discardCount === 0 ? "Empty" : "In pile"
                }
              />
            </section>
          </div>
          <aside className="log" aria-label="Match log">
            {notice ? <p className="notice">{notice}</p> : null}
            {!shared.opponentConnected && match.phase !== "matchOver" ? (
              <p>Opponent disconnected.</p>
            ) : null}
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
            canAct &&
            match.actionStack.length === 0 &&
            match.activeSide === viewerSide &&
            contextMenuUnit.side === viewerSide
          }
          onActivateItem={(itemId) => handleActivateUnitItem(contextMenuUnit, itemId)}
          building={buildingAt(match, contextMenuUnit.position)}
          canActivateBuilding={
            canAct &&
            match.actionStack.length === 0 &&
            match.activeSide === viewerSide &&
            contextMenuUnit.side === viewerSide
          }
          onActivateBuilding={handleActivateUnitBuilding}
        />
      ) : null}
    </main>
  );
}

function buildingEffectIsActivated(effect: BuildingEffect) {
  return (
    effect.type === "activatedDamageLine" ||
    effect.type === "activatedHeal" ||
    effect.type === "activatedStatBonus"
  );
}
