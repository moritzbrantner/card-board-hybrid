import {
  Activity,
  Archive,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Footprints,
  Heart,
  History,
  House,
  Layers,
  LibraryBig,
  LogIn,
  LogOut,
  Play,
  Plus,
  RotateCcw,
  Search,
  Shield,
  Sparkles,
  Sword,
  Users,
  UserPlus,
  WandSparkles,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  attack,
  advanceAi,
  createMatch,
  createSharedMatch,
  createDeck,
  deleteDeck,
  duplicateDeck,
  endTurn,
  joinSharedMatch,
  loadCurrentAccount,
  loadCatalog,
  loadDecks,
  loadMatch,
  loadMatches,
  loadReplay,
  loadSharedMatch,
  loadSystemDecks,
  loginAccount,
  logoutAccount,
  movePiece,
  passPriority,
  playCard,
  previewDeckLegality,
  registerAccount,
  sharedMatchWebSocketUrl,
  updateDeck,
  updateProfile,
} from "./api";
import {
  effectiveBoardVisualMode,
  saveLocalBoardVisualMode,
} from "./boardVisualMode";
import { Board3DRenderer, type Board3DTileInteraction } from "./Board3D";
import {
  canCreateWebGLContext,
  isBoardRendererInteractive,
  selectBoardRenderer,
} from "./boardRenderer";
import { ProfilePage } from "./profile";
import { clearAuthToken, getAuthToken, saveAuthToken } from "./session";
import { WIZARD_OPTIONS } from "./wizards";
import { LIVE_AI_FRAME_DELAY_MS, liveAiPlaybackFrames } from "./livePlayback";
import {
  createMatchVisualCatalog,
  type CardVisualIdentity,
  type MatchVisualCatalog,
  type UnitVisualIdentity,
  type WizardVisualIdentity,
} from "./matchVisualIdentity";
import type {
  AuthSessionResponse,
  AuthUser,
  Card,
  CatalogCard,
  DeckCardCount,
  DeckLegality,
  DeckListResponse,
  DeckRules,
  DeckRecipeSummary,
  HexCoord,
  HexTile,
  MatchReplayResponse,
  MatchResponse,
  MatchActionRequest,
  MatchSummary,
  MatchParticipantState,
  MatchState,
  Rarity,
  ReplayEvent,
  SoloAiOpponentSelection,
  SharedClientMessage,
  SharedMatchResponse,
  SharedServerMessage,
  Side,
  StackItem,
  SystemDeckRecipe,
  SystemDeckListResponse,
  Unit,
  Wizard,
  WizardType,
  ActionTarget,
  BoardVisualMode,
} from "./types";
import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  FormEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; match: MatchState }
  | { status: "error"; message: string };

type CatalogLoadState =
  | { status: "loading" }
  | { status: "ready"; cards: CatalogCard[] }
  | { status: "error"; message: string };

type DeckLoadState =
  | { status: "loading" }
  | { status: "ready"; response: DeckListResponse }
  | { status: "error"; message: string };

type SystemDeckLoadState =
  | { status: "loading" }
  | { status: "ready"; response: SystemDeckListResponse }
  | { status: "error"; message: string };

type MatchArchiveLoadState =
  | { status: "loading" }
  | { status: "ready"; matches: MatchSummary[] }
  | { status: "error"; message: string };

type ReplayLoadState =
  | { status: "loading" }
  | { status: "ready"; replay: MatchReplayResponse }
  | { status: "error"; message: string };

type SharedLoadState =
  | { status: "loading" }
  | { status: "ready"; shared: SharedMatchResponse }
  | { status: "error"; message: string };

type AuthState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; user: AuthUser };

type Selection =
  | { type: "card"; cardId: string }
  | { type: "piece"; pieceId: string }
  | null;

type UnitContextMenu =
  | {
      pieceId: string;
      x: number;
      y: number;
    }
  | null;

type BoardWizard = Wizard & { pieceType: "wizard"; name: string };
type BoardUnit = Unit & { pieceType: "unit"; hp?: never; maxHp?: never };
type BoardPiece = BoardWizard | BoardUnit;

const EMPTY_MATCH_VISUAL_CATALOG = createMatchVisualCatalog([]);

type AccountProps = {
  currentUser: AuthUser | null;
  onSignOut: () => void;
  onNavigate: (to: string) => void;
};

type BoardVisualModeProps = {
  boardVisualMode: BoardVisualMode;
  onBoardVisualModeChange: (mode: BoardVisualMode) => Promise<void>;
};

type AccountPreferenceProps = AccountProps & {
  onCurrentUserUpdated: (user: AuthUser) => void;
};

function currentRoutePath() {
  return `${window.location.pathname}${window.location.search}`;
}

function routeFromPath(path: string) {
  const url = new URL(path, window.location.origin);
  return {
    pathname: url.pathname,
    searchParams: url.searchParams,
  };
}

export function safeAuthNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/profile";
  }

  try {
    const nextUrl = new URL(value, window.location.origin);
    if (nextUrl.origin !== window.location.origin) {
      return "/profile";
    }

    const normalizedNextPath = nextUrl.pathname.replace(/\/+$/, "");
    if (normalizedNextPath === "/login" || normalizedNextPath === "/register") {
      return "/profile";
    }

    return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  } catch {
    return "/profile";
  }
}

function authRouteLink(mode: "register" | "login", nextPath: string) {
  const path = mode === "register" ? "/register" : "/login";
  return nextPath === "/profile" ? path : `${path}?next=${encodeURIComponent(nextPath)}`;
}

function protectedLoginRoute(nextPath: string) {
  return `/login?next=${encodeURIComponent(nextPath)}`;
}

function useBoardVisualModePreference(
  currentUser: AuthUser | null,
  onCurrentUserUpdated: (user: AuthUser) => void,
) {
  const [boardVisualMode, setBoardVisualModeState] = useState<BoardVisualMode>(() =>
    effectiveBoardVisualMode(currentUser),
  );

  useEffect(() => {
    setBoardVisualModeState(effectiveBoardVisualMode(currentUser));
  }, [currentUser?.id, currentUser?.boardVisualMode]);

  async function setBoardVisualMode(mode: BoardVisualMode) {
    setBoardVisualModeState(mode);

    if (!currentUser) {
      saveLocalBoardVisualMode(mode);
      return;
    }

    const updated = await updateProfile(
      currentUser.displayName,
      currentUser.avatar,
      currentUser.preferredWizardType,
      mode,
    );
    onCurrentUserUpdated(updated);
    setBoardVisualModeState(updated.boardVisualMode);
  }

  return [boardVisualMode, setBoardVisualMode] as const;
}

export function App() {
  const [path, setPath] = useState(() => currentRoutePath());
  const [authState, setAuthState] = useState<AuthState>(() =>
    getAuthToken() ? { status: "loading" } : { status: "signedOut" },
  );

  useEffect(() => {
    const handlePopState = () => setPath(currentRoutePath());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!getAuthToken()) {
      setAuthState({ status: "signedOut" });
      return;
    }

    let cancelled = false;
    loadCurrentAccount()
      .then((user) => {
        if (!cancelled) {
          setAuthState({ status: "signedIn", user });
        }
      })
      .catch(() => {
        clearAuthToken();
        if (!cancelled) {
          setAuthState({ status: "signedOut" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function navigate(to: string) {
    window.history.pushState(null, "", to);
    setPath(currentRoutePath());
  }

  function replaceRoute(to: string) {
    window.history.replaceState(null, "", to);
    setPath(currentRoutePath());
  }

  function handleAuthenticated(session: AuthSessionResponse, nextPath: string) {
    saveAuthToken(session.token);
    setAuthState({ status: "signedIn", user: session.user });
    navigate(nextPath);
  }

  async function handleSignOut() {
    try {
      await logoutAccount();
    } catch {
      // Local sign-out should still clear stale sessions if the server is unavailable.
    }
    clearAuthToken();
    setAuthState({ status: "signedOut" });
    navigate("/");
  }

  const { pathname, searchParams } = routeFromPath(path);
  const normalizedPath = pathname.replace(/\/+$/, "");
  const authNextPath = safeAuthNextPath(searchParams.get("next"));

  if (authState.status === "loading") {
    return <ShellMessage title="Rune Lanes" message="Checking account" />;
  }

  const currentUser = authState.status === "signedIn" ? authState.user : null;

  if (normalizedPath === "/login" || normalizedPath === "/register") {
    if (currentUser) {
      return <RouteRedirect to={authNextPath} onNavigate={replaceRoute} />;
    }

    return (
      <AuthPage
        mode={normalizedPath === "/register" ? "register" : "login"}
        nextPath={authNextPath}
        onNavigate={navigate}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  if (normalizedPath === "/catalog") {
    return <CatalogPage onNavigate={navigate} />;
  }

  if (normalizedPath === "/profile") {
    if (!currentUser) {
      return <RouteRedirect to={protectedLoginRoute("/profile")} onNavigate={replaceRoute} />;
    }

    return (
      <ProfilePage
        currentUser={currentUser}
        onNavigate={navigate}
        onProfileUpdated={(profile) => setAuthState({ status: "signedIn", user: profile })}
        onSignOut={handleSignOut}
      />
    );
  }

  if (normalizedPath === "/decks") {
    if (!currentUser) {
      return <RouteRedirect to={protectedLoginRoute("/decks")} onNavigate={replaceRoute} />;
    }

    return (
      <DecksPage
        currentUser={currentUser}
        onNavigate={navigate}
        onSignOut={handleSignOut}
      />
    );
  }

  if (path === "/" || path === "") {
    return <MatchPicker onNavigate={navigate} currentUser={currentUser} onSignOut={handleSignOut} />;
  }

  if (normalizedPath === "/matches") {
    if (!currentUser) {
      return <RouteRedirect to={protectedLoginRoute("/matches")} onNavigate={replaceRoute} />;
    }

    return (
      <MatchArchivePage
        onNavigate={navigate}
        currentUser={currentUser}
        onSignOut={handleSignOut}
      />
    );
  }

  const replayRoute = replayRouteFromPath(path);
  if (replayRoute) {
    return (
      <ReplayPage
        key={replayRoute}
        matchId={replayRoute}
        onNavigate={navigate}
        currentUser={currentUser}
        onSignOut={handleSignOut}
        onCurrentUserUpdated={(user) => setAuthState({ status: "signedIn", user })}
      />
    );
  }

  const sharedMatchRoute = sharedMatchRouteFromPath(path);
  if (sharedMatchRoute) {
    return (
      <SharedMatchPage
        key={`${sharedMatchRoute.matchId}:${sharedMatchRoute.seatToken}`}
        matchId={sharedMatchRoute.matchId}
        seatToken={sharedMatchRoute.seatToken}
        onNavigate={navigate}
        currentUser={currentUser}
        onSignOut={handleSignOut}
        onCurrentUserUpdated={(user) => setAuthState({ status: "signedIn", user })}
      />
    );
  }

  const matchRoute = matchRouteFromPath(path);
  if (matchRoute) {
    return (
      <MatchPage
        key={matchRoute}
        matchId={matchRoute}
        onNavigate={navigate}
        currentUser={currentUser}
        onSignOut={handleSignOut}
        onCurrentUserUpdated={(user) => setAuthState({ status: "signedIn", user })}
      />
    );
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

type KindFilter = "all" | "unit" | "spell";
type RarityFilter = "all" | Rarity;

function CatalogPage({ onNavigate }: { onNavigate: (to: string) => void }) {
  const [loadState, setLoadState] = useState<CatalogLoadState>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [rarityFilter, setRarityFilter] = useState<RarityFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    loadCatalog()
      .then((response) => setLoadState({ status: "ready", cards: response.cards }))
      .catch((error: unknown) =>
        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load catalog",
        }),
      );
  }, []);

  const filteredCards = useMemo(() => {
    if (loadState.status !== "ready") {
      return [];
    }

    const normalizedQuery = query.trim().toLocaleLowerCase();
    return loadState.cards.filter((card) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        card.name.toLocaleLowerCase().includes(normalizedQuery) ||
        card.text.toLocaleLowerCase().includes(normalizedQuery);
      const matchesKind = kindFilter === "all" || card.kind.type === kindFilter;
      const matchesRarity = rarityFilter === "all" || card.rarity === rarityFilter;
      return matchesQuery && matchesKind && matchesRarity;
    });
  }, [kindFilter, loadState, query, rarityFilter]);

  if (loadState.status === "loading") {
    return <ShellMessage title="Card Catalog" message="Loading cards" />;
  }

  if (loadState.status === "error") {
    return (
      <ShellMessage
        title="Card Catalog"
        message={loadState.message}
        actions={
          <button className="primary-button" type="button" onClick={() => onNavigate("/")}>
            Open match picker
          </button>
        }
      />
    );
  }

  const selectedCard =
    filteredCards.find((card) => card.id === selectedId) ??
    filteredCards[0] ??
    null;

  return (
    <main className="app-shell catalog-shell">
      <section className="catalog-layout" aria-label="Card catalog">
        <header className="top-bar catalog-header">
          <div>
            <p className="eyebrow">Rune Lanes</p>
            <h1>Card Catalog</h1>
          </div>
          <div className="actions">
            <button
              className="icon-button"
              type="button"
              onClick={() => onNavigate("/")}
              title="Match picker"
            >
              <House size={18} />
            </button>
          </div>
        </header>

        <section className="catalog-controls" aria-label="Catalog filters">
          <label className="catalog-search" htmlFor="catalog-search">
            <Search size={17} />
            <input
              id="catalog-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search cards"
              autoComplete="off"
            />
          </label>
          <SegmentedFilter
            label="Kind"
            value={kindFilter}
            options={[
              ["all", "All"],
              ["unit", "Units"],
              ["spell", "Spells"],
            ]}
            onChange={(value) => setKindFilter(value as KindFilter)}
          />
          <SegmentedFilter
            label="Rarity"
            value={rarityFilter}
            options={[
              ["all", "All"],
              ["basic", "Basic"],
              ["advanced", "Advanced"],
              ["rare", "Rare"],
            ]}
            onChange={(value) => setRarityFilter(value as RarityFilter)}
          />
        </section>

        <div className="catalog-content">
          <section className="catalog-grid" aria-label="Starter cards">
            {filteredCards.map((card) => (
              <CatalogCardButton
                key={card.id}
                card={card}
                selected={selectedCard?.id === card.id}
                onClick={() => setSelectedId(card.id)}
              />
            ))}
            {filteredCards.length === 0 ? <p className="empty-state">No cards found.</p> : null}
          </section>
          <CatalogDetail card={selectedCard} />
        </div>
      </section>
    </main>
  );
}

function SegmentedFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="segmented-filter">
      <legend>{label}</legend>
      <div>
        {options.map(([optionValue, optionLabel]) => (
          <button
            key={optionValue}
            className={value === optionValue ? "active" : ""}
            type="button"
            onClick={() => onChange(optionValue)}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function CatalogCardButton({
  card,
  selected,
  onClick,
}: {
  card: CatalogCard;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`catalog-card ${selected ? "selected" : ""} ${card.rarity}`}
      type="button"
      onClick={onClick}
    >
      <img src={card.artPath} alt="" loading="lazy" />
      <span className="card-cost">{card.cost}</span>
      <span className="catalog-card-body">
        <strong>{card.name}</strong>
        <span className="card-stats">
          <WandSparkles size={13} />
          {card.rarity} · {kindSummary(card)}
        </span>
        <span className="card-text">{card.text}</span>
        <span className="copy-count">{card.copyCount} in starter deck</span>
      </span>
    </button>
  );
}

function CatalogDetail({ card }: { card: CatalogCard | null }) {
  if (!card) {
    return <aside className="catalog-detail empty-state">No card selected.</aside>;
  }

  return (
    <aside className={`catalog-detail ${card.rarity}`} aria-label="Selected card">
      <img src={card.artPath} alt="" />
      <div className="catalog-detail-body">
        <div>
          <p className="eyebrow">{card.rarity} {card.kind.type}</p>
          <h2>{card.name}</h2>
        </div>
        <div className="detail-stat-row">
          <DetailStat label="Cost" value={card.cost} />
          <DetailStat label="Copies" value={card.copyCount} />
          {card.kind.type === "unit" ? (
            <>
              <DetailStat label="Attack" value={card.kind.attack} />
              <DetailStat label="Armor" value={card.kind.armor} />
              <DetailStat label="Unit AP" value={card.kind.maxAp} />
            </>
          ) : (
            <>
              <DetailStat label="Range" value={card.kind.range} />
              <DetailStat label="Priority" value={card.kind.priority} />
              <DetailStat label="Effect" value={spellEffectLabel(card)} />
            </>
          )}
        </div>
        <p className="detail-rules">{card.text}</p>
      </div>
    </aside>
  );
}

function DecksPage({ currentUser, onNavigate, onSignOut }: AccountProps & { currentUser: AuthUser }) {
  const [deckLoadState, setDeckLoadState] = useState<DeckLoadState>({ status: "loading" });
  const [catalogLoadState, setCatalogLoadState] = useState<CatalogLoadState>({ status: "loading" });
  const [selectedDeckId, setSelectedDeckId] = useState<number | null>(null);
  const [deckName, setDeckName] = useState("");
  const [cardCounts, setCardCounts] = useState<Record<string, number>>({});
  const [previewLegality, setPreviewLegality] = useState<DeckLegality | null>(null);
  const [defaultDeck, setDefaultDeck] = useState(false);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const legalityPreviewRequestRef = useRef(0);

  useEffect(() => {
    void reloadDecks();
    loadCatalog()
      .then((response) => setCatalogLoadState({ status: "ready", cards: response.cards }))
      .catch((error: unknown) =>
        setCatalogLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load catalog",
        }),
      );
  }, []);

  async function reloadDecks(nextSelectedId?: number) {
    setDeckLoadState({ status: "loading" });
    try {
      const response = await loadDecks();
      setDeckLoadState({ status: "ready", response });
      const nextDeck =
        response.decks.find((deck) => deck.id === nextSelectedId) ??
        response.decks.find((deck) => deck.id === selectedDeckId) ??
        response.decks[0] ??
        null;
      selectDeck(nextDeck);
    } catch (error) {
      setDeckLoadState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not load decks",
      });
    }
  }

  function selectDeck(deck: DeckRecipeSummary | null) {
    setSelectedDeckId(deck?.id ?? null);
    setDeckName(deck?.name ?? "New Deck");
    setDefaultDeck(deck?.isDefault ?? false);
    setCardCounts(countsFromCards(deck?.cards ?? []));
    setPreviewLegality(deck?.legality ?? null);
    setNotice(null);
  }

  const decks = deckLoadState.status === "ready" ? deckLoadState.response.decks : [];
  const rules = deckLoadState.status === "ready" ? deckLoadState.response.rules : null;
  const catalogCards = catalogLoadState.status === "ready" ? catalogLoadState.cards : [];
  const localCards = useMemo(() => cardsFromCounts(cardCounts), [cardCounts]);
  const filteredCards = catalogCards.filter((card) => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return (
      normalizedQuery.length === 0 ||
      card.name.toLocaleLowerCase().includes(normalizedQuery) ||
      card.text.toLocaleLowerCase().includes(normalizedQuery)
    );
  });

  useEffect(() => {
    if (!selectedDeckId) {
      return;
    }

    const requestId = ++legalityPreviewRequestRef.current;
    const timeout = window.setTimeout(() => {
      previewDeckLegality(localCards)
        .then((legality) => {
          if (legalityPreviewRequestRef.current === requestId) {
            setPreviewLegality(legality);
          }
        })
        .catch((error: unknown) => {
          if (legalityPreviewRequestRef.current === requestId) {
            setNotice(error instanceof Error ? error.message : "Could not preview deck legality");
          }
        });
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [localCards, selectedDeckId]);

  function adjustCount(card: CatalogCard, delta: number) {
    setCardCounts((current) => {
      const currentCount = current[card.templateId] ?? 0;
      const nextCount =
        delta > 0
          ? Math.min(currentCount + delta, copyLimitForRarity(card.rarity, rules))
          : Math.max(0, currentCount + delta);
      const next = { ...current };
      if (nextCount === 0) {
        delete next[card.templateId];
      } else {
        next[card.templateId] = nextCount;
      }
      return next;
    });
  }

  async function handleSave() {
    if (!selectedDeckId) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const saved = await updateDeck(selectedDeckId, deckName, localCards, defaultDeck);
      await reloadDecks(saved.id);
      setNotice("Deck saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save deck");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    if (decks.length >= (rules?.maxDecksPerAccount ?? 30)) {
      setNotice("Deck library limit reached.");
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const created = await createDeck("New Deck", [], false);
      await reloadDecks(created.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create deck");
    } finally {
      setBusy(false);
    }
  }

  async function handleDuplicate() {
    if (!selectedDeckId) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const created = await duplicateDeck(selectedDeckId);
      await reloadDecks(created.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not duplicate deck");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!selectedDeckId || decks.length <= 1) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await deleteDeck(selectedDeckId);
      await reloadDecks();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not delete deck");
    } finally {
      setBusy(false);
    }
  }

  if (deckLoadState.status === "loading" || catalogLoadState.status === "loading") {
    return <ShellMessage title="Decks" message="Loading deck library" />;
  }

  if (deckLoadState.status === "error") {
    return <ShellMessage title="Decks" message={deckLoadState.message} />;
  }

  if (catalogLoadState.status === "error") {
    return <ShellMessage title="Decks" message={catalogLoadState.message} />;
  }

  return (
    <main className="app-shell deck-shell">
      <section className="deck-layout" aria-label="Deck library">
        <header className="top-bar catalog-header">
          <div>
            <p className="eyebrow">Rune Lanes</p>
            <h1>Decks</h1>
          </div>
          <div className="actions">
            <AccountActions currentUser={currentUser} onNavigate={onNavigate} onSignOut={onSignOut} />
            <button className="icon-button" type="button" onClick={() => onNavigate("/")} title="Match picker">
              <House size={18} />
            </button>
          </div>
        </header>

        <aside className="deck-list" aria-label="Deck recipes">
          <button className="primary-button" type="button" onClick={() => void handleCreate()} disabled={busy}>
            <Plus size={18} />
            New Deck
          </button>
          {decks.map((deck) => (
            <button
              key={deck.id}
              className={`deck-list-item ${selectedDeckId === deck.id ? "selected" : ""}`}
              type="button"
              onClick={() => selectDeck(deck)}
            >
              <strong>{deck.name}</strong>
              <span>{deck.legality.legal ? "Legal" : "Draft"} · {deck.legality.totalCards} cards</span>
              {deck.isDefault ? <span>Default</span> : null}
            </button>
          ))}
        </aside>

        <section className="deck-editor" aria-label="Deck editor">
          <div className="deck-editor-header">
            <label>
              Name
              <input value={deckName} onChange={(event) => setDeckName(event.target.value)} />
            </label>
            <label className="deck-default-toggle">
              <input
                type="checkbox"
                checked={defaultDeck}
                onChange={(event) => setDefaultDeck(event.target.checked)}
              />
              Default
            </label>
            <button className="primary-button" type="button" onClick={() => void handleSave()} disabled={busy || !selectedDeckId}>
              Save
            </button>
            <button className="secondary-link" type="button" onClick={() => void handleDuplicate()} disabled={busy || !selectedDeckId}>
              <Copy size={18} />
              Duplicate
            </button>
            <button className="secondary-link" type="button" onClick={() => void handleDelete()} disabled={busy || !selectedDeckId || decks.length <= 1}>
              <X size={18} />
              Delete
            </button>
          </div>

          {previewLegality ? <DeckLegalityPanel legality={previewLegality} /> : null}
          {notice ? <p className="notice">{notice}</p> : null}

          <label className="catalog-search deck-search" htmlFor="deck-card-search">
            <Search size={17} />
            <input
              id="deck-card-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search cards"
              autoComplete="off"
            />
          </label>

          <div className="deck-builder-grid">
            {filteredCards.map((card) => {
              const count = cardCounts[card.templateId] ?? 0;
              const copyLimit = copyLimitForRarity(card.rarity, rules);
              const copyLimitReached = count >= copyLimit;

              return (
                <div key={card.id} className={`deck-card-row ${card.rarity}`}>
                  <div>
                    <strong>{card.name}</strong>
                    <span>{card.rarity} · {card.cost} mana</span>
                  </div>
                  <p>{card.text}</p>
                  <div className="deck-count-controls">
                    <button type="button" onClick={() => adjustCount(card, -1)} disabled={busy}>
                      -
                    </button>
                    <strong>{count}</strong>
                    <button
                      type="button"
                      onClick={() => adjustCount(card, 1)}
                      disabled={busy || copyLimitReached}
                      title={copyLimitReached ? `${rarityLabel(card.rarity)} copy limit reached` : undefined}
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </section>
    </main>
  );
}

function DeckLegalityPanel({ legality }: { legality: DeckLegality }) {
  return (
    <section className={`deck-legality ${legality.legal ? "legal" : "draft"}`} aria-label="Deck legality">
      <div>
        <strong>{legality.legal ? "Legal deck" : "Draft deck"}</strong>
        <span>
          {legality.totalCards} cards · {legality.basicCards} Basic · {legality.advancedCards} Advanced · {legality.rareCards} Rare
        </span>
      </div>
      {legality.messages.length > 0 ? (
        <ul>
          {legality.messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function countsFromCards(cards: DeckCardCount[]) {
  return Object.fromEntries(cards.map((card) => [card.templateId, card.count]));
}

function cardsFromCounts(counts: Record<string, number>): DeckCardCount[] {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([templateId, count]) => ({ templateId, count }));
}

function copyLimitForRarity(rarity: Rarity, rules: DeckRules | null) {
  switch (rarity) {
    case "basic":
      return rules?.basicCopyLimit ?? 5;
    case "advanced":
      return rules?.advancedCopyLimit ?? 4;
    case "rare":
      return rules?.rareCopyLimit ?? 3;
  }
}

function rarityLabel(rarity: Rarity) {
  switch (rarity) {
    case "basic":
      return "Basic";
    case "advanced":
      return "Advanced";
    case "rare":
      return "Rare";
  }
}

function aiSelectionFromValue(
  value: string,
  accountWizardType: WizardType,
): SoloAiOpponentSelection | null {
  if (value.startsWith("system:")) {
    return { source: "system", systemDeckId: value.slice("system:".length) };
  }
  if (value.startsWith("account:")) {
    const deckId = Number(value.slice("account:".length));
    return Number.isFinite(deckId)
      ? { source: "account", deckId, wizardType: accountWizardType }
      : null;
  }
  return null;
}

function DetailStat({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="detail-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

function AuthPage({
  mode,
  nextPath,
  onNavigate,
  onAuthenticated,
}: {
  mode: "register" | "login";
  nextPath: string;
  onNavigate: (to: string) => void;
  onAuthenticated: (session: AuthSessionResponse, nextPath: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const session =
        mode === "register"
          ? await registerAccount(email, password)
          : await loginAccount(email, password);
      onAuthenticated(session, nextPath);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not authenticate");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell picker-shell">
      <section className="match-picker auth-panel" aria-label="Account access">
        <div>
          <p className="eyebrow">Rune Lanes</p>
          <h1>{mode === "register" ? "Create Account" : "Sign In"}</h1>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
          <label htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            minLength={
              mode === "register" && !email.trim().toLocaleLowerCase().endsWith("@local.dev")
                ? 8
                : 1
            }
            required
          />
          <button className="primary-button" type="submit" disabled={busy}>
            {mode === "register" ? <UserPlus size={18} /> : <LogIn size={18} />}
            {mode === "register" ? "Create Account" : "Sign In"}
          </button>
        </form>
        <a
          className="secondary-link"
          href={authRouteLink(mode === "register" ? "login" : "register", nextPath)}
          onClick={(event) => {
            event.preventDefault();
            if (busy) {
              return;
            }
            setNotice(null);
            onNavigate(authRouteLink(mode === "register" ? "login" : "register", nextPath));
          }}
          aria-disabled={busy}
        >
          {mode === "register" ? "I already have an account" : "Create a new account"}
        </a>
        {notice ? <p className="notice">{notice}</p> : null}
      </section>
    </main>
  );
}

function RouteRedirect({ to, onNavigate }: { to: string; onNavigate: (to: string) => void }) {
  useEffect(() => {
    onNavigate(to);
  }, [onNavigate, to]);

  return <ShellMessage title="Rune Lanes" message="Opening account" />;
}

function AccountActions({ currentUser, onSignOut, onNavigate }: AccountProps) {
  if (!currentUser) {
    return (
      <div className="account-actions">
        <button className="secondary-link" type="button" onClick={() => onNavigate("/login")}>
          <LogIn size={18} />
          Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="account-actions">
      <button className="secondary-link" type="button" onClick={() => onNavigate("/profile")}>
        <span className={`profile-avatar ${currentUser.avatar.color}`}>
          {avatarSymbolLabel(currentUser.avatar.symbol)}
        </span>
        {currentUser.displayName}
      </button>
      <button className="icon-button" type="button" onClick={onSignOut} title="Sign out">
        <LogOut size={18} />
      </button>
    </div>
  );
}

function BoardVisualModeQuickControl({
  boardVisualMode,
  onBoardVisualModeChange,
  disabled = false,
}: BoardVisualModeProps & { disabled?: boolean }) {
  return (
    <fieldset className="board-visual-mode-quick" aria-label="Board visual mode">
      <button
        className={boardVisualMode === "2d" ? "active" : ""}
        type="button"
        onClick={() => void onBoardVisualModeChange("2d")}
        aria-pressed={boardVisualMode === "2d"}
        disabled={disabled}
        title="Use 2D board"
      >
        2D
      </button>
      <button
        className={boardVisualMode === "3d" ? "active" : ""}
        type="button"
        onClick={() => void onBoardVisualModeChange("3d")}
        aria-pressed={boardVisualMode === "3d"}
        disabled={disabled}
        title="Use 3D board"
      >
        3D
      </button>
    </fieldset>
  );
}

function MatchPicker({
  onNavigate,
  currentUser,
  onSignOut,
}: {
  onNavigate: (to: string) => void;
} & AccountProps) {
  const [matchId, setMatchId] = useState("");
  const [selectedWizardType, setSelectedWizardType] = useState<WizardType>(
    () => currentUser?.preferredWizardType ?? "runekeeper",
  );
  const [deckLoadState, setDeckLoadState] = useState<DeckLoadState | null>(
    currentUser ? { status: "loading" } : null,
  );
  const [systemDeckLoadState, setSystemDeckLoadState] = useState<SystemDeckLoadState>({
    status: "loading",
  });
  const [selectedPlayerDeckId, setSelectedPlayerDeckId] = useState<string>("starter");
  const [selectedAiDeck, setSelectedAiDeck] = useState<string>("system:balanced-starter");
  const [selectedAiWizardType, setSelectedAiWizardType] = useState<WizardType>("runekeeper");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    loadSystemDecks()
      .then((response) => {
        setSystemDeckLoadState({ status: "ready", response });
        if (!response.decks.some((deck) => `system:${deck.id}` === selectedAiDeck)) {
          setSelectedAiDeck(`system:${response.decks[0]?.id ?? "balanced-starter"}`);
        }
      })
      .catch((error: unknown) =>
        setSystemDeckLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load AI decks",
        }),
      );
  }, []);

  useEffect(() => {
    if (!currentUser) {
      setDeckLoadState(null);
      setSelectedPlayerDeckId("starter");
      return;
    }
    setDeckLoadState({ status: "loading" });
    loadDecks()
      .then((response) => {
        setDeckLoadState({ status: "ready", response });
        const defaultDeck = response.decks.find((deck) => deck.isDefault && deck.legality.legal);
        if (defaultDeck) {
          setSelectedPlayerDeckId(String(defaultDeck.id));
        }
      })
      .catch((error: unknown) =>
        setDeckLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load decks",
        }),
      );
  }, [currentUser]);

  async function handleCreateMatch() {
    setBusy(true);
    setNotice(null);
    try {
      const aiOpponent = aiSelectionFromValue(selectedAiDeck, selectedAiWizardType);
      const created = await createMatch({
        wizardType: selectedWizardType,
        ...(selectedPlayerDeckId !== "starter"
          ? { playerDeckId: Number(selectedPlayerDeckId) }
          : {}),
        ...(aiOpponent ? { aiOpponent } : {}),
      });
      onNavigate(`/match/${created.matchId}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create match");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateSharedMatch() {
    setBusy(true);
    setNotice(null);
    try {
      const created = await createSharedMatch(selectedWizardType);
      sessionStorage.setItem(
        `rune-lanes-invite:${created.matchId}`,
        `${window.location.origin}${created.inviteSeatUrl}`,
      );
      sessionStorage.setItem(`rune-lanes-wizard:${created.matchId}`, selectedWizardType);
      onNavigate(created.playerSeatUrl);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create multiplayer match");
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

  const legalAccountDecks =
    deckLoadState?.status === "ready"
      ? deckLoadState.response.decks.filter((deck) => deck.legality.legal)
      : [];
  const systemDecks =
    systemDeckLoadState.status === "ready" ? systemDeckLoadState.response.decks : [];
  const selectedAiDeckIsAccount = selectedAiDeck.startsWith("account:");

  return (
    <main className="app-shell picker-shell">
      <section className="match-picker" aria-label="Match picker">
        <header className="picker-header">
          <div>
            <p className="eyebrow">Rune Lanes</p>
            <h1>Choose Your Wizard</h1>
          </div>
          <AccountActions currentUser={currentUser} onNavigate={onNavigate} onSignOut={onSignOut} />
        </header>
        <fieldset className="wizard-picker" aria-label="Wizard type">
          <legend>Wizard Type</legend>
          <div className="wizard-options">
            {WIZARD_OPTIONS.map((wizard) => (
              <button
                key={wizard.id}
                className={`wizard-option ${selectedWizardType === wizard.id ? "selected" : ""}`}
                type="button"
                aria-pressed={selectedWizardType === wizard.id}
                onClick={() => setSelectedWizardType(wizard.id)}
                disabled={busy}
              >
                <span className="wizard-option-header">
                  <span>
                    <strong>{wizard.name}</strong>
                    <span>{wizard.role}</span>
                  </span>
                  <WandSparkles size={18} />
                </span>
                <span className="wizard-option-text">{wizard.text}</span>
                <span className="wizard-stat-row">
                  <span>
                    <Heart size={13} />
                    {wizard.hp}
                  </span>
                  <span>
                    <Sword size={13} />
                    {wizard.attack}
                  </span>
                  <span>
                    <Zap size={13} />
                    {wizard.ap}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </fieldset>
        <section className="setup-deck-selectors" aria-label="Deck selection">
          <label>
            Your Deck
            <select
              value={selectedPlayerDeckId}
              onChange={(event) => setSelectedPlayerDeckId(event.target.value)}
              disabled={busy || !currentUser || deckLoadState?.status === "loading"}
            >
              <option value="starter">Starter</option>
              {legalAccountDecks.map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {deck.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            AI Deck
            <select
              value={selectedAiDeck}
              onChange={(event) => setSelectedAiDeck(event.target.value)}
              disabled={busy || systemDeckLoadState.status === "loading"}
            >
              {systemDecks.map((deck) => (
                <option key={deck.id} value={`system:${deck.id}`}>
                  {deck.name}
                </option>
              ))}
              {legalAccountDecks.map((deck) => (
                <option key={deck.id} value={`account:${deck.id}`}>
                  {deck.name}
                </option>
              ))}
            </select>
          </label>
          {selectedAiDeckIsAccount ? (
            <label>
              AI Wizard
              <select
                value={selectedAiWizardType}
                onChange={(event) => setSelectedAiWizardType(event.target.value as WizardType)}
                disabled={busy}
              >
                {WIZARD_OPTIONS.map((wizard) => (
                  <option key={wizard.id} value={wizard.id}>
                    {wizard.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {deckLoadState?.status === "error" ? <p className="notice">{deckLoadState.message}</p> : null}
          {systemDeckLoadState.status === "error" ? (
            <p className="notice">{systemDeckLoadState.message}</p>
          ) : null}
        </section>
        <div className="picker-actions">
          <button
            className="primary-button"
            type="button"
            onClick={() => void handleCreateMatch()}
            disabled={busy}
          >
            <Plus size={18} />
            New Solo Match
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => void handleCreateSharedMatch()}
            disabled={busy}
          >
            <Users size={18} />
            New Multiplayer Match
          </button>
          <button className="secondary-link" type="button" onClick={() => onNavigate("/catalog/")}>
            <LibraryBig size={18} />
            Card Catalog
          </button>
          {currentUser ? (
            <button className="secondary-link" type="button" onClick={() => onNavigate("/decks")}>
              <Layers size={18} />
              Decks
            </button>
          ) : null}
          <button className="secondary-link" type="button" onClick={() => onNavigate("/matches")}>
            <History size={18} />
            Match Archive
          </button>
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

function MatchArchivePage({
  onNavigate,
  currentUser,
  onSignOut,
}: {
  onNavigate: (to: string) => void;
} & AccountProps) {
  const [loadState, setLoadState] = useState<MatchArchiveLoadState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    loadMatches()
      .then((response) => setLoadState({ status: "ready", matches: response.matches }))
      .catch((error: unknown) =>
        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load match archive",
        }),
      );
  }, []);

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

  if (loadState.status === "loading") {
    return <ShellMessage title="Match Archive" message="Loading matches" />;
  }

  if (loadState.status === "error") {
    return (
      <ShellMessage
        title="Match Archive"
        message={loadState.message}
        actions={
          <button className="primary-button" type="button" onClick={() => onNavigate("/")}>
            Open match picker
          </button>
        }
      />
    );
  }

  return (
    <main className="app-shell archive-shell">
      <section className="archive-layout" aria-label="Match archive">
        <header className="top-bar">
          <div>
            <p className="eyebrow">Rune Lanes</p>
            <h1>Match Archive</h1>
          </div>
          <div className="actions">
            <AccountActions currentUser={currentUser} onNavigate={onNavigate} onSignOut={onSignOut} />
            <button className="icon-button" type="button" onClick={() => onNavigate("/")} title="Match picker">
              <House size={18} />
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() => void handleCreateMatch()}
              disabled={busy}
            >
              <Plus size={18} />
              New Match
            </button>
          </div>
        </header>

        {loadState.matches.length === 0 ? (
          <section className="archive-empty">
            <p>No replayable matches yet.</p>
            <button
              className="primary-button"
              type="button"
              onClick={() => void handleCreateMatch()}
              disabled={busy}
            >
              <Plus size={18} />
              New Match
            </button>
          </section>
        ) : (
          <div className="match-list" role="list" aria-label="Replayable matches">
            {loadState.matches.map((match) => (
              <article className="match-row" role="listitem" key={match.matchId}>
                <div>
                  <strong>{match.matchId}</strong>
                  <span>{formatMatchStatus(match)}</span>
                </div>
                <div className="match-row-stat">
                  <span>Round</span>
                  <strong>{match.round}</strong>
                </div>
                <div className="match-row-stat">
                  <span>Frames</span>
                  <strong>{match.frameCount}</strong>
                </div>
                <div className="match-row-date">
                  <span>Updated</span>
                  <strong>{formatUnixTime(match.updatedAt)}</strong>
                </div>
                <div className="match-row-actions">
                  {match.phase !== "matchOver" ? (
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => onNavigate(`/match/${match.matchId}`)}
                      title="Continue match"
                    >
                      <Play size={18} />
                    </button>
                  ) : null}
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => onNavigate(`/matches/${match.matchId}/replay`)}
                  >
                    <History size={18} />
                    Replay
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
        {notice ? <p className="notice">{notice}</p> : null}
      </section>
    </main>
  );
}

function WizardPicker({
  selectedWizardType,
  busy,
  onSelect,
}: {
  selectedWizardType: WizardType;
  busy: boolean;
  onSelect: (wizardType: WizardType) => void;
}) {
  return (
    <fieldset className="wizard-picker" aria-label="Wizard type">
      <legend>Wizard Type</legend>
      <div className="wizard-options">
        {WIZARD_OPTIONS.map((wizard) => (
          <button
            key={wizard.id}
            className={`wizard-option ${selectedWizardType === wizard.id ? "selected" : ""}`}
            type="button"
            aria-pressed={selectedWizardType === wizard.id}
            onClick={() => onSelect(wizard.id)}
            disabled={busy}
          >
            <span className="wizard-option-header">
              <span>
                <strong>{wizard.name}</strong>
                <span>{wizard.role}</span>
              </span>
              <WandSparkles size={18} />
            </span>
            <span className="wizard-option-text">{wizard.text}</span>
            <span className="wizard-stat-row">
              <span>
                <Heart size={13} />
                {wizard.hp}
              </span>
              <span>
                <Sword size={13} />
                {wizard.attack}
              </span>
              <span>
                <Zap size={13} />
                {wizard.ap}
              </span>
            </span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function LobbySeatStatus({
  label,
  ready,
  wizardName,
}: {
  label: string;
  ready: boolean;
  wizardName: string | null;
}) {
  return (
    <div className={`lobby-seat-status ${ready ? "ready" : ""}`}>
      <span>{label}</span>
      <strong>{ready ? (wizardName ?? "Ready") : "Choosing"}</strong>
    </div>
  );
}

function MatchPage({
  matchId,
  onNavigate,
  currentUser,
  onSignOut,
  onCurrentUserUpdated,
}: {
  matchId: string;
  onNavigate: (to: string) => void;
} & AccountPreferenceProps) {
  const viewerSide: Side = "player";
  const [boardVisualMode, setBoardVisualMode] = useBoardVisualModePreference(
    currentUser,
    onCurrentUserUpdated,
  );
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [catalogCards, setCatalogCards] = useState<CatalogCard[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [unitModalPieceId, setUnitModalPieceId] = useState<string | null>(null);
  const [unitContextMenu, setUnitContextMenu] = useState<UnitContextMenu>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setLoadState({ status: "loading" });
    setSelection(null);
    setDraggedCardId(null);
    setUnitContextMenu(null);
    setUnitModalPieceId(null);
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

  async function runAction(action: () => Promise<MatchResponse>) {
    setBusy(true);
    setNotice(null);

    try {
      setSelection(null);
      setDraggedCardId(null);
      setUnitModalPieceId(null);
      setUnitContextMenu(null);
      const response = await action();
      await playLiveActionResponse(response);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function playLiveActionResponse(response: MatchResponse) {
    const playbackFrames = liveAiPlaybackFrames(response.replayFrames ?? []);

    if (playbackFrames.length === 0) {
      setLoadState({ status: "ready", match: response.matchState });
      return;
    }

    for (const frame of playbackFrames) {
      await delay(LIVE_AI_FRAME_DELAY_MS);
      setLoadState({ status: "ready", match: frame.matchState });
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
    }, 1000);

    return () => window.clearTimeout(timeoutId);
  }, [readyMatch, busy, matchId, playerHasPriorityResponse]);

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

    if (selectedCard) {
      const target = cardTargetForTile(match, viewerSide, selectedCard, tile);
      if (target) {
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
  }

  async function handleBoardVisualModeChange(mode: BoardVisualMode) {
    try {
      await setBoardVisualMode(mode);
      setNotice(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save board visual mode");
    }
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
            <AccountActions currentUser={currentUser} onNavigate={onNavigate} onSignOut={onSignOut} />
            <BoardVisualModeQuickControl
              boardVisualMode={boardVisualMode}
              onBoardVisualModeChange={handleBoardVisualModeChange}
              disabled={busy}
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
        </header>

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
            boardVisualMode={boardVisualMode}
            viewerSide="player"
            visualCatalog={visualCatalog}
            selectedCard={selectedCard}
            selectedPiece={selectedPiece}
            disabled={busy || match.phase === "matchOver"}
            onTileClick={handleTileClick}
            onTileDrop={handleCardDrop}
            onUnitContextMenu={handleUnitContextMenu}
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
                  style={cardFanStyle(index, viewerHand.length)}
                  disabled={busy || !isPlayableCard(match, viewerSide, card)}
                  onClick={() => {
                    setUnitContextMenu(null);
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
        />
      ) : null}
    </main>
  );
}

function SharedMatchPage({
  matchId,
  seatToken,
  onNavigate,
  currentUser,
  onSignOut,
  onCurrentUserUpdated,
}: {
  matchId: string;
  seatToken: string;
  onNavigate: (to: string) => void;
} & AccountPreferenceProps) {
  const [boardVisualMode, setBoardVisualMode] = useBoardVisualModePreference(
    currentUser,
    onCurrentUserUpdated,
  );
  const [loadState, setLoadState] = useState<SharedLoadState>({ status: "loading" });
  const [catalogCards, setCatalogCards] = useState<CatalogCard[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [unitModalPieceId, setUnitModalPieceId] = useState<string | null>(null);
  const [unitContextMenu, setUnitContextMenu] = useState<UnitContextMenu>(null);
  const [selectedWizardType, setSelectedWizardType] = useState<WizardType>(() => {
    const stored = sessionStorage.getItem(`rune-lanes-wizard:${matchId}`);
    return isWizardType(stored) ? stored : (currentUser?.preferredWizardType ?? "runekeeper");
  });
  const [deckLoadState, setDeckLoadState] = useState<DeckLoadState | null>(
    currentUser ? { status: "loading" } : null,
  );
  const [selectedDeckId, setSelectedDeckId] = useState<string>("starter");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    setLoadState({ status: "loading" });
    setSelection(null);
    setDraggedCardId(null);
    setNotice(null);
    loadSharedMatch(matchId, seatToken)
      .then((shared) => setLoadState({ status: "ready", shared }))
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

  const visualCatalog = useMemo(
    () => createMatchVisualCatalog(catalogCards),
    [catalogCards],
  );

  useEffect(() => {
    if (!currentUser) {
      setDeckLoadState(null);
      setSelectedDeckId("starter");
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
  }, [currentUser]);

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
        setLoadState({ status: "ready", shared: message.payload });
        setBusy(false);
        if (message.type === "actionAccepted") {
          setSelection(null);
          setDraggedCardId(null);
          setUnitModalPieceId(null);
          setUnitContextMenu(null);
        }
      } else if (message.type === "actionRejected") {
        setNotice(message.message);
        setBusy(false);
      } else if (message.type === "error") {
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
  }, [matchId, seatToken]);

  const shared = loadState.status === "ready" ? loadState.shared : null;
  const match = shared?.matchState ?? null;
  const viewerSide = shared?.viewerSide ?? "player";
  const isActiveViewer = Boolean(match && shared?.activeSide === viewerSide);
  const hasPendingStack = Boolean(match && match.actionStack.length > 0);
  const isPriorityViewer = Boolean(match && match.prioritySide === viewerSide);
  const canAct = Boolean(match && (hasPendingStack ? isPriorityViewer : isActiveViewer));

  useEffect(() => {
    if (shared?.status === "setup" && shared.viewerWizardType) {
      setSelectedWizardType(shared.viewerWizardType);
    }
  }, [shared?.status, shared?.viewerWizardType]);

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
        selectedWizardType,
        selectedDeckId === "starter" ? undefined : Number(selectedDeckId),
      );
      sessionStorage.setItem(`rune-lanes-wizard:${matchId}`, selectedWizardType);
      setLoadState({ status: "ready", shared: joined });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not join match");
    } finally {
      setBusy(false);
    }
  }

  function handleSelectLobbyWizard(wizardType: WizardType) {
    setSelectedWizardType(wizardType);
    sessionStorage.setItem(`rune-lanes-wizard:${matchId}`, wizardType);
  }

  function handleTileClick(tile: HexTile) {
    if (!match || busy || match.phase === "matchOver" || !canAct) {
      return;
    }

    setUnitContextMenu(null);
    const piece = pieceAt(match, tile.coord);

    if (selectedCard) {
      const target = cardTargetForTile(match, viewerSide, selectedCard, tile);
      if (target) {
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
  }

  async function handleBoardVisualModeChange(mode: BoardVisualMode) {
    try {
      await setBoardVisualMode(mode);
      setNotice(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save board visual mode");
    }
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
          <button className="primary-button" type="button" onClick={() => onNavigate("/")}>
            Open match picker
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
    const hasUnsavedWizardChoice = shared.viewerWizardType !== selectedWizardType;
    const savedWizard = shared.viewerWizardType ? wizardOptionByType(shared.viewerWizardType) : null;
    const opponentWizard = shared.opponentWizardType
      ? wizardOptionByType(shared.opponentWizardType)
      : null;
    const legalDecks =
      deckLoadState?.status === "ready"
        ? deckLoadState.response.decks.filter((deck) => deck.legality.legal)
        : [];
    const lobbyActionLabel = shared.viewerReady
      ? hasUnsavedWizardChoice
        ? "Update Wizard"
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
            <AccountActions currentUser={currentUser} onNavigate={onNavigate} onSignOut={onSignOut} />
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
          <WizardPicker
            selectedWizardType={selectedWizardType}
            busy={busy}
            onSelect={handleSelectLobbyWizard}
          />
          <section className="setup-deck-selectors" aria-label="Shared deck selection">
            <label>
              Your Deck
              <select
                value={selectedDeckId}
                onChange={(event) => setSelectedDeckId(event.target.value)}
                disabled={busy || !currentUser || deckLoadState?.status === "loading"}
              >
                <option value="starter">Starter</option>
                {legalDecks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name}
                  </option>
                ))}
              </select>
            </label>
            {deckLoadState?.status === "error" ? <p className="notice">{deckLoadState.message}</p> : null}
          </section>
          <div className="lobby-status-grid" aria-label="Lobby status">
            <LobbySeatStatus
              label="You"
              ready={shared.viewerReady}
              wizardName={savedWizard?.name ?? null}
            />
            <LobbySeatStatus
              label="Opponent"
              ready={shared.opponentReady}
              wizardName={opponentWizard?.name ?? null}
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
              : "Choose a wizard to enter the lobby."}
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
    <main className="app-shell">
      <section className="table">
        <header className="top-bar">
          <div>
            <p className="eyebrow">Rune Lanes Multiplayer</p>
            <h1>Round {match.round}</h1>
            <p className="match-id">Match {matchId}</p>
          </div>
          <div className="actions">
            <AccountActions currentUser={currentUser} onNavigate={onNavigate} onSignOut={onSignOut} />
            <BoardVisualModeQuickControl
              boardVisualMode={boardVisualMode}
              onBoardVisualModeChange={handleBoardVisualModeChange}
              disabled={busy}
            />
            <button
              className="icon-button"
              type="button"
              onClick={() => onNavigate("/")}
              title="Match picker"
            >
              <House size={18} />
            </button>
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
        </header>

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
            boardVisualMode={boardVisualMode}
            viewerSide={viewerSide}
            visualCatalog={visualCatalog}
            selectedCard={selectedCard}
            selectedPiece={selectedPiece}
            disabled={busy || match.phase === "matchOver" || !canAct}
            onTileClick={handleTileClick}
            onTileDrop={handleCardDrop}
            onUnitContextMenu={handleUnitContextMenu}
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
                  style={cardFanStyle(index, viewerHand.length)}
                  disabled={busy || !canAct || !isPlayableCard(match, viewerSide, card)}
                  onClick={() => {
                    setUnitContextMenu(null);
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
        />
      ) : null}
    </main>
  );
}

function ReplayPage({
  matchId,
  onNavigate,
  currentUser,
  onSignOut,
  onCurrentUserUpdated,
}: {
  matchId: string;
  onNavigate: (to: string) => void;
} & AccountPreferenceProps) {
  const [boardVisualMode, setBoardVisualMode] = useBoardVisualModePreference(
    currentUser,
    onCurrentUserUpdated,
  );
  const [loadState, setLoadState] = useState<ReplayLoadState>({ status: "loading" });
  const [frameIndex, setFrameIndex] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setLoadState({ status: "loading" });
    setFrameIndex(0);
    loadReplay(matchId)
      .then((response) => setLoadState({ status: "ready", replay: response }))
      .catch((error: unknown) =>
        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load replay",
        }),
      );
  }, [matchId]);

  if (loadState.status === "loading") {
    return <ShellMessage title={`Replay ${matchId}`} message="Loading replay" />;
  }

  if (loadState.status === "error") {
    return (
      <ShellMessage
        title={`Replay ${matchId}`}
        message={loadState.message}
        actions={
          <button className="primary-button" type="button" onClick={() => onNavigate("/matches")}>
            Match Archive
          </button>
        }
      />
    );
  }

  const { replay } = loadState;
  const frameCount = replay.frames.length;
  const clampedFrameIndex = Math.min(frameIndex, Math.max(frameCount - 1, 0));
  const frame = replay.frames[clampedFrameIndex];
  const match = frame.matchState;

  async function handleBoardVisualModeChange(mode: BoardVisualMode) {
    try {
      await setBoardVisualMode(mode);
      setNotice(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save board visual mode");
    }
  }

  return (
    <main className="app-shell replay-shell">
      <section className="table replay-table">
        <header className="top-bar">
          <div>
            <p className="eyebrow">Rune Lanes Replay</p>
            <h1>Round {match.round}</h1>
            <p className="match-id">Match {matchId}</p>
          </div>
          <div className="actions">
            <AccountActions currentUser={currentUser} onNavigate={onNavigate} onSignOut={onSignOut} />
            <BoardVisualModeQuickControl
              boardVisualMode={boardVisualMode}
              onBoardVisualModeChange={handleBoardVisualModeChange}
            />
            <button
              className="icon-button"
              type="button"
              onClick={() => onNavigate("/matches")}
              title="Match archive"
            >
              <History size={18} />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => onNavigate(`/match/${matchId}`)}
              title="Playable match"
            >
              <Play size={18} />
            </button>
          </div>
        </header>

        <section className="score-row" aria-label="Replay score">
          <PlayerBadge player={match.player} />
          <div className="phase-pill">
            {replay.visibility === "revealed" ? <Eye size={16} /> : <EyeOff size={16} />}
            {match.phase === "matchOver" ? `${sideLabel(match.winner)} wins` : "Planning"}
          </div>
          <PlayerBadge player={match.opponent} />
        </section>

        <Board
          match={match}
          boardVisualMode={boardVisualMode}
          viewerSide="player"
          selectedCard={null}
          selectedPiece={null}
          disabled={false}
          readOnly
        />

        <section className="replay-inspector" aria-label="Replay timeline">
          {notice ? <p className="notice">{notice}</p> : null}
          <div className="replay-controls">
            <button
              className="icon-button"
              type="button"
              onClick={() => setFrameIndex(Math.max(clampedFrameIndex - 1, 0))}
              disabled={clampedFrameIndex === 0}
              title="Previous frame"
            >
              <ChevronLeft size={18} />
            </button>
            <input
              type="range"
              min="0"
              max={Math.max(frameCount - 1, 0)}
              value={clampedFrameIndex}
              onChange={(event) => setFrameIndex(Number(event.target.value))}
              aria-label="Replay frame"
            />
            <button
              className="icon-button"
              type="button"
              onClick={() => setFrameIndex(Math.min(clampedFrameIndex + 1, frameCount - 1))}
              disabled={clampedFrameIndex >= frameCount - 1}
              title="Next frame"
            >
              <ChevronRight size={18} />
            </button>
            <span className="frame-count">
              {clampedFrameIndex + 1}/{frameCount}
            </span>
          </div>

          <aside className="event-detail" aria-label="Replay event">
            <p className="eyebrow">{eventSideLabel(frame.event)}</p>
            <h2>{eventTitle(frame.event)}</h2>
            <p>{eventDetail(frame.event)}</p>
          </aside>
        </section>
      </section>
    </main>
  );
}

function UnitContextMenuView({
  menu,
  unit,
  onClose,
  onOpenCardInfo,
}: {
  menu: Exclude<UnitContextMenu, null>;
  unit: BoardUnit;
  onClose: () => void;
  onOpenCardInfo: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    function handlePointerDown() {
      onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [onClose]);

  return (
    <div
      className="unit-context-menu"
      role="menu"
      aria-label={`${unit.name} actions`}
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button type="button" role="menuitem" onClick={onOpenCardInfo}>
        <LibraryBig size={15} />
        Card info
      </button>
    </div>
  );
}

function UnitCardModal({
  unit,
  unitVisualIdentity,
  onClose,
}: {
  unit: BoardUnit;
  unitVisualIdentity: UnitVisualIdentity;
  onClose: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className={`unit-modal ${unitVisualIdentity.rarity === "unknown" ? "basic unknown" : unitVisualIdentity.rarity}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unit-modal-title"
      >
        <button className="icon-button modal-close" type="button" onClick={onClose} title="Close">
          <X size={18} />
        </button>
        {unitVisualIdentity.portraitPath ? (
          <img src={unitVisualIdentity.portraitPath} alt={unitVisualIdentity.portraitAlt} />
        ) : (
          <div className="unit-modal-art-placeholder" aria-hidden="true">
            <span>{unitVisualIdentity.fallbackLabel}</span>
          </div>
        )}
        <div className="unit-modal-body">
          <div>
            <p className="eyebrow">
              {unit.side === "player" ? "Your" : "Opponent"} unit
              {unitVisualIdentity.rarity === "unknown" ? " · Card unknown" : ` · ${unitVisualIdentity.rarity}`}
            </p>
            <h2 id="unit-modal-title">{unitVisualIdentity.name}</h2>
          </div>

          <div className="detail-stat-row">
            {unitVisualIdentity.baseStats ? (
              <>
                <DetailStat label="Cost" value={unitVisualIdentity.baseStats.cost} />
                <DetailStat label="Base Attack" value={unitVisualIdentity.baseStats.attack} />
                <DetailStat label="Base Armor" value={unitVisualIdentity.baseStats.armor} />
                <DetailStat label="Base AP" value={unitVisualIdentity.baseStats.maxAp} />
              </>
            ) : (
              <DetailStat label="Card" value="Unknown" />
            )}
          </div>

          <div className="detail-stat-row live-stat-row">
            <DetailStat label="Attack" value={unit.attack} />
            <DetailStat label="Armor" value={`${unit.armor}/${unit.maxArmor}`} />
            <DetailStat label="AP" value={`${unit.apRemaining}/${unit.maxAp}`} />
            <DetailStat label="Attacked" value={unit.hasAttacked ? "Yes" : "No"} />
          </div>

          <p className="detail-rules">
            {unitVisualIdentity.baseStats?.text ??
              "This unit came from an older match without saved card metadata."}
          </p>
        </div>
      </section>
    </div>
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

function StackDisplay({
  stack,
  prioritySide,
}: {
  stack: StackItem[];
  prioritySide: Side | null;
}) {
  if (stack.length === 0) {
    return null;
  }

  return (
    <section className="stack-panel" aria-label="Pending stack">
      <div className="stack-panel-header">
        <span>Stack</span>
        <strong>{sideLabel(prioritySide)} priority</strong>
      </div>
      <ol>
        {[...stack].reverse().map((item) => (
          <li key={item.id}>
            <span>{stackItemTitle(item)}</span>
            <strong>Priority {item.priority}</strong>
          </li>
        ))}
      </ol>
    </section>
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

function replayRouteFromPath(path: string) {
  const normalized = path.replace(/\/+$/, "");
  const match = normalized.match(/^\/matches\/([^/]+)\/replay$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function sharedMatchRouteFromPath(path: string) {
  const normalized = path.replace(/\/+$/, "");
  const match = normalized.match(/^\/match\/([^/]+)\/([^/]+)$/);
  return match
    ? {
        matchId: decodeURIComponent(match[1]),
        seatToken: decodeURIComponent(match[2]),
      }
    : null;
}

function PlayerBadge({ player }: { player: MatchParticipantState }) {
  return (
    <div className={`player-badge ${player.side}`}>
      <strong>{sideLabel(player.side)}</strong>
      <span className="wizard-type-pill">
        <WandSparkles size={16} />
        {wizardTypeLabel(player.wizard.wizardType)}
      </span>
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

function OpponentHandDisplay({ count }: { count: number }) {
  const visibleBacks = Math.min(count, 7);

  return (
    <div className="opponent-hand-display" aria-label={`Enemy hand, ${count} cards`}>
      <span className="opponent-hand-label">Enemy hand</span>
      <div className="opponent-card-backs" aria-hidden="true">
        {Array.from({ length: visibleBacks }, (_, index) => (
          <span className="opponent-card-back" key={index} />
        ))}
      </div>
      <strong>{count}</strong>
    </div>
  );
}

function Board({
  match,
  boardVisualMode,
  viewerSide,
  visualCatalog = EMPTY_MATCH_VISUAL_CATALOG,
  selectedCard,
  selectedPiece,
  disabled,
  readOnly = false,
  onTileClick,
  onTileDrop,
  onUnitContextMenu,
}: {
  match: MatchState;
  boardVisualMode: BoardVisualMode;
  viewerSide: Side;
  visualCatalog?: MatchVisualCatalog;
  selectedCard: Card | null;
  selectedPiece: BoardPiece | null;
  disabled: boolean;
  readOnly?: boolean;
  onTileClick?: (tile: HexTile) => void;
  onTileDrop?: (tile: HexTile, cardId: string) => void;
  onUnitContextMenu?: (unit: BoardUnit, position: { x: number; y: number }) => void;
}) {
  const [webglFailed, setWebglFailed] = useState(
    () => boardVisualMode === "3d" && !canCreateWebGLContext(),
  );
  const [assetFailureCount, setAssetFailureCount] = useState(0);
  const webglUnavailable = boardVisualMode === "3d" && !canCreateWebGLContext();
  const renderer = selectBoardRenderer({
    requestedMode: boardVisualMode,
    webglFailed: webglFailed || webglUnavailable,
    readOnly,
  });
  const isInteractive = isBoardRendererInteractive({ renderer, readOnly, disabled });
  const columns = groupTilesByColumn(match.board.tiles);
  const pieces = piecesInMatch(match);
  const tileInteractions = match.board.tiles.map((tile): Board3DTileInteraction => {
    const piece = pieceAt(match, tile.coord);
    const isLegal =
      isInteractive &&
      ((selectedCard && isLegalCardTarget(match, viewerSide, selectedCard, tile.coord, piece)) ||
        (selectedPiece &&
          ((!piece && isLegalMove(match, viewerSide, selectedPiece, tile.coord)) ||
            (piece && isLegalAttack(match, viewerSide, selectedPiece, piece)))));
    const isSelected = piece?.id === selectedPiece?.id;

    return {
      coord: tile.coord,
      title: tileTitle(tile, piece, viewerSide),
      disabled: !isInteractive,
      isLegal: Boolean(isLegal),
      isSelected,
      hasPiece: Boolean(piece),
      pieceSide: piece?.side,
      pieceType: piece?.pieceType,
      pieceLabel: piece ? viewerSideShortLabel(piece.side, viewerSide) : undefined,
      pieceStatLabel: piece ? pieceStatLabel(piece) : undefined,
    };
  });

  useEffect(() => {
    if (boardVisualMode === "2d") {
      setWebglFailed(false);
      setAssetFailureCount(0);
      return;
    }

    if (!canCreateWebGLContext()) {
      setWebglFailed(true);
    }
  }, [boardVisualMode]);

  if (renderer === "3d") {
    return (
      <section
        className={`board board-visual-mode-${boardVisualMode} ${readOnly ? "read-only" : ""}`}
        data-board-visual-mode={boardVisualMode}
        data-board-renderer="3d"
        aria-label="Hex board"
      >
        {assetFailureCount > 0 ? (
          <div className="board-renderer-notice" role="status">
            Some 3D models are unavailable, so fallback markers are shown.
          </div>
        ) : null}
        <Board3DRenderer
          tiles={match.board.tiles}
          pieces={pieces}
          visualCatalog={visualCatalog}
          readOnly={readOnly}
          disabled={disabled}
          tileInteractions={tileInteractions}
          onTileClick={onTileClick}
          onTileDrop={onTileDrop}
          onTileContextMenu={(tile, event) => {
            const piece = pieceAt(match, tile.coord);
            if (piece?.pieceType !== "unit" || !onUnitContextMenu) {
              return;
            }

            onUnitContextMenu(piece, { x: event.clientX, y: event.clientY });
          }}
          onFatalRenderError={() => setWebglFailed(true)}
          onAssetFailure={() => setAssetFailureCount((count) => count + 1)}
        />
      </section>
    );
  }

  return (
    <section
      className={`board board-visual-mode-${boardVisualMode} ${readOnly ? "read-only" : ""}`}
      data-board-visual-mode={boardVisualMode}
      data-board-renderer="2d"
      aria-label="Hex board"
    >
      {webglFailed || webglUnavailable ? (
        <div className="board-renderer-notice" role="status">
          3D board unavailable, using 2D.
        </div>
      ) : null}
      <div className="hex-board">
        {columns.map((column) => (
          <div className="hex-column" key={column.q}>
            {column.tiles.map((tile) => {
              const piece = pieceAt(match, tile.coord);
              const interaction = tileInteractions.find(
                (candidate) => coordKey(candidate.coord) === coordKey(tile.coord),
              );
              const isLegal = interaction?.isLegal ?? false;
              const isSelected = piece?.id === selectedPiece?.id;
              const occupantClass = piece ? `occupied occupied-${piece.side}` : "";
              const title = tileTitle(tile, piece, viewerSide);

              return (
                <button
                  key={coordKey(tile.coord)}
                  className={`hex-tile ${occupantClass} ${isLegal ? "legal" : ""} ${isSelected ? "selected-piece" : ""}`}
                  type="button"
                  disabled={disabled && !readOnly}
                  tabIndex={readOnly ? -1 : undefined}
                  onClick={() => onTileClick?.(tile)}
                  onDragOver={(event: ReactDragEvent<HTMLButtonElement>) => {
                    if (readOnly || disabled || !selectedCard || !isLegal) {
                      return;
                    }

                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event: ReactDragEvent<HTMLButtonElement>) => {
                    if (readOnly || disabled || !onTileDrop) {
                      return;
                    }

                    event.preventDefault();
                    const cardId = event.dataTransfer.getData("text/plain");
                    if (cardId) {
                      onTileDrop(tile, cardId);
                    }
                  }}
                  onContextMenu={(event: ReactMouseEvent<HTMLButtonElement>) => {
                    if (readOnly || piece?.pieceType !== "unit" || !onUnitContextMenu) {
                      return;
                    }

                    event.preventDefault();
                    onUnitContextMenu(piece, { x: event.clientX, y: event.clientY });
                  }}
                  title={title}
                  aria-label={title}
                >
                  {piece ? (
                    <>
                      <span
                        className={`hex-occupant-marker ${piece.side}`}
                        aria-hidden="true"
                      >
                        {viewerSideShortLabel(piece.side, viewerSide)}
                      </span>
                      <PieceToken
                        piece={piece}
                        viewerSide={viewerSide}
                        visualCatalog={visualCatalog}
                      />
                    </>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

function PieceToken({
  piece,
  viewerSide,
  visualCatalog,
}: {
  piece: BoardPiece;
  viewerSide: Side;
  visualCatalog: MatchVisualCatalog;
}) {
  let visualIdentity: UnitVisualIdentity | WizardVisualIdentity;
  let accentClass: string;
  if (piece.pieceType === "wizard") {
    const wizardVisualIdentity = visualCatalog.wizard(piece);
    visualIdentity = wizardVisualIdentity;
    accentClass = wizardVisualIdentity.accentClass;
  } else {
    const unitVisualIdentity = visualCatalog.unit(piece);
    visualIdentity = unitVisualIdentity;
    accentClass = unitVisualIdentity.rarity;
  }
  const unknownClass = visualIdentity.status === "unknown" ? "unknown" : "";

  return (
    <span
      className={`piece-token portrait ${piece.side} ${piece.pieceType} ${accentClass} ${unknownClass}`}
      title={visualIdentity.name}
    >
      <span className={`piece-side-badge ${piece.side}`}>
        {viewerSideShortLabel(piece.side, viewerSide)}
      </span>
      <span className="piece-token-portrait" aria-hidden="true">
        {visualIdentity.portraitPath ? (
          <img src={visualIdentity.portraitPath} alt="" />
        ) : (
          <span>{visualIdentity.fallbackLabel}</span>
        )}
      </span>
      <strong>{visualIdentity.fallbackLabel}</strong>
      <span className="piece-token-stat-row">
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
    </span>
  );
}

function CardButton({
  card,
  visualIdentity,
  selected,
  dragging = false,
  style,
  disabled,
  onClick,
  onDragStart,
  onDragEnd,
}: {
  card: Card;
  visualIdentity: CardVisualIdentity;
  selected: boolean;
  dragging?: boolean;
  style?: CSSProperties;
  disabled: boolean;
  onClick: () => void;
  onDragStart?: (event: ReactDragEvent<HTMLButtonElement>) => void;
  onDragEnd?: () => void;
}) {
  return (
    <button
      className={`card-button ${selected ? "selected" : ""} ${dragging ? "dragging" : ""} ${card.rarity}`}
      type="button"
      disabled={disabled}
      draggable={!disabled}
      style={style}
      onClick={onClick}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {visualIdentity.artPath ? (
        <img className="card-button-art" src={visualIdentity.artPath} alt={visualIdentity.artAlt} />
      ) : null}
      <span className="card-cost">{card.cost}</span>
      <strong>{card.name}</strong>
      <span className="card-stats">
        <WandSparkles size={13} />
        {card.rarity} · {kindSummary(card)}
      </span>
      <span className="card-text">{card.text}</span>
    </button>
  );
}

function groupTilesByColumn(tiles: HexTile[]) {
  const columns = new Map<number, HexTile[]>();
  for (const tile of tiles) {
    columns.set(tile.coord.q, [...(columns.get(tile.coord.q) ?? []), tile]);
  }

  return [...columns.entries()]
    .sort(([a], [b]) => a - b)
    .map(([q, columnTiles]) => ({
      q,
      tiles: columnTiles.sort((a, b) => a.coord.r - b.coord.r),
    }));
}

function pieceAt(match: MatchState, coord: HexCoord): BoardPiece | null {
  if (sameCoord(match.player.wizard.position, coord)) {
    return {
      ...match.player.wizard,
      pieceType: "wizard",
      name: wizardTypeLabel(match.player.wizard.wizardType),
    };
  }
  if (sameCoord(match.opponent.wizard.position, coord)) {
    return {
      ...match.opponent.wizard,
      pieceType: "wizard",
      name: wizardTypeLabel(match.opponent.wizard.wizardType),
    };
  }

  const unit = match.board.units.find((candidate) => sameCoord(candidate.position, coord));
  return unit ? { ...unit, pieceType: "unit" } : null;
}

function tileTitle(tile: HexTile, piece: BoardPiece | null, viewerSide: Side) {
  const coordLabel = `q ${tile.coord.q}, r ${tile.coord.r}`;
  if (!piece) {
    return `${coordLabel}, empty hex`;
  }

  const owner = viewerSideLabel(piece.side, viewerSide);
  return `${coordLabel}, occupied by ${owner} ${piece.pieceType}`;
}

function pieceStatLabel(piece: BoardPiece) {
  if (piece.pieceType === "wizard") {
    return `${piece.attack}/${piece.hp} AP ${piece.apRemaining}`;
  }

  return `${piece.attack}/${piece.armor} AP ${piece.apRemaining}`;
}

function pieceById(match: MatchState, pieceId: string): BoardPiece | null {
  if (match.player.wizard.id === pieceId) {
    return {
      ...match.player.wizard,
      pieceType: "wizard",
      name: wizardTypeLabel(match.player.wizard.wizardType),
    };
  }
  if (match.opponent.wizard.id === pieceId) {
    return {
      ...match.opponent.wizard,
      pieceType: "wizard",
      name: wizardTypeLabel(match.opponent.wizard.wizardType),
    };
  }

  const unit = match.board.units.find((candidate) => candidate.id === pieceId);
  return unit ? { ...unit, pieceType: "unit" } : null;
}

function participantBySide(match: MatchState, side: Side): MatchParticipantState {
  return side === "player" ? match.player : match.opponent;
}

function opponentSideOf(side: Side): Side {
  return side === "player" ? "opponent" : "player";
}

function handForSide(match: MatchState, side: Side): Card[] {
  return participantBySide(match, side).hand ?? [];
}

function handCountForSide(match: MatchState, side: Side): number {
  return participantBySide(match, side).handCount;
}

type CardFanStyle = CSSProperties & {
  "--card-fan-rotation": string;
  "--card-fan-rise": string;
  "--card-fan-shift": string;
};

function cardFanStyle(index: number, total: number): CardFanStyle {
  const centerOffset = index - (total - 1) / 2;
  return {
    "--card-fan-rotation": `${centerOffset * 2.6}deg`,
    "--card-fan-rise": `${Math.abs(centerOffset) * -4}px`,
    "--card-fan-shift": `${centerOffset * 3}px`,
  };
}

function piecesInMatch(match: MatchState): BoardPiece[] {
  return [
    {
      ...match.player.wizard,
      pieceType: "wizard",
      name: wizardTypeLabel(match.player.wizard.wizardType),
    },
    {
      ...match.opponent.wizard,
      pieceType: "wizard",
      name: wizardTypeLabel(match.opponent.wizard.wizardType),
    },
    ...match.board.units.map((unit) => ({ ...unit, pieceType: "unit" as const })),
  ];
}

function hasPlayablePriorityResponse(match: MatchState, viewerSide: Side) {
  if (match.prioritySide !== viewerSide || match.actionStack.length === 0) {
    return false;
  }

  return handForSide(match, viewerSide).some(
    (card) =>
      card.kind.type === "spell" &&
      isPlayableCard(match, viewerSide, card) &&
      piecesInMatch(match).some((piece) =>
        isLegalCardTarget(match, viewerSide, card, piece.position, piece),
      ),
  );
}

function isPlayableCard(match: MatchState, viewerSide: Side, card: Card) {
  const participant = participantBySide(match, viewerSide);
  const pending = topStackItem(match);
  if (pending) {
    return (
      match.phase !== "matchOver" &&
      match.prioritySide === viewerSide &&
      card.kind.type === "spell" &&
      participant.mana >= card.cost &&
      participant.wizard.apRemaining > 0 &&
      card.kind.priority > pending.priority
    );
  }

  return (
    match.phase !== "matchOver" &&
    match.activeSide === viewerSide &&
    participant.mana >= card.cost &&
    participant.wizard.apRemaining > 0
  );
}

function cardTargetForTile(
  match: MatchState,
  viewerSide: Side,
  card: Card,
  tile: HexTile,
): ActionTarget | null {
  const piece = pieceAt(match, tile.coord);
  if (!isLegalCardTarget(match, viewerSide, card, tile.coord, piece)) {
    return null;
  }

  if (card.kind.type === "unit") {
    return { type: "hex", coord: tile.coord };
  }

  return piece ? { type: "piece", pieceId: piece.id } : null;
}

function isLegalCardTarget(
  match: MatchState,
  viewerSide: Side,
  card: Card,
  coord: HexCoord,
  piece: BoardPiece | null,
) {
  const participant = participantBySide(match, viewerSide);
  const opponentSide = viewerSide === "player" ? "opponent" : "player";
  if (!isPlayableCard(match, viewerSide, card)) {
    return false;
  }

  if (card.kind.type === "unit") {
    return !piece && distance(participant.wizard.position, coord) === 1;
  }

  if (!piece || distance(participant.wizard.position, piece.position) > card.kind.range) {
    return false;
  }

  switch (card.kind.effect.type) {
    case "heal":
      return piece.side === viewerSide;
    case "buff":
      return piece.side === viewerSide && piece.pieceType === "unit";
    case "damage":
      return piece.side === opponentSide;
  }
}

function isLegalMove(match: MatchState, viewerSide: Side, piece: BoardPiece, coord: HexCoord) {
  return (
    match.actionStack.length === 0 &&
    match.activeSide === viewerSide &&
    piece.side === viewerSide &&
    piece.apRemaining > 0 &&
    distance(piece.position, coord) === 1 &&
    !pieceAt(match, coord)
  );
}

function isLegalAttack(
  match: MatchState,
  viewerSide: Side,
  attacker: BoardPiece,
  target: BoardPiece,
) {
  return (
    match.actionStack.length === 0 &&
    match.activeSide === viewerSide &&
    attacker.side === viewerSide &&
    target.side !== viewerSide &&
    attacker.apRemaining > 0 &&
    !attacker.hasAttacked &&
    distance(attacker.position, target.position) === 1
  );
}

function topStackItem(match: MatchState) {
  return match.actionStack[match.actionStack.length - 1] ?? null;
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

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function coordKey(coord: HexCoord) {
  return `${coord.q}:${coord.r}`;
}

function kindSummary(card: Card | CatalogCard) {
  if (card.kind.type === "unit") {
    return `${card.kind.attack}/${card.kind.armor} ap ${card.kind.maxAp}`;
  }

  return `${spellEffectLabel(card)} rng ${card.kind.range} pri ${card.kind.priority}`;
}

function spellEffectLabel(card: Card | CatalogCard) {
  if (card.kind.type !== "spell") {
    return "unit";
  }

  switch (card.kind.effect.type) {
    case "heal":
      return `heal ${card.kind.effect.amount}`;
    case "buff":
      return `+${card.kind.effect.attack}/+${card.kind.effect.armor}`;
    case "damage":
      return `damage ${card.kind.effect.amount}`;
  }
}

function stackItemTitle(item: StackItem) {
  switch (item.action.type) {
    case "playUnit":
      return `${sideLabel(item.side)} summons ${item.action.card.name}`;
    case "castSpell":
      return `${sideLabel(item.side)} casts ${item.action.card.name}`;
    case "movePiece":
      return `${sideLabel(item.side)} moves ${item.action.pieceId}`;
    case "attack":
      return `${sideLabel(item.side)} attacks with ${item.action.attackerId}`;
  }
}

function formatMatchStatus(match: MatchSummary) {
  if (match.phase === "matchOver") {
    return `${sideLabel(match.winner)} wins`;
  }

  return "Planning";
}

function formatUnixTime(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value * 1000));
}

function eventSideLabel(event: ReplayEvent) {
  if ("side" in event) {
    return sideLabel(event.side);
  }
  if (event.type === "matchEnded") {
    return sideLabel(event.winner);
  }

  return "Match";
}

function eventTitle(event: ReplayEvent) {
  switch (event.type) {
    case "matchCreated":
      return "Match created";
    case "turnStarted":
      return "Turn started";
    case "turnEnded":
      return "Turn ended";
    case "roundStarted":
      return `Round ${event.round}`;
    case "cardDrawn":
      return event.card ? `${event.card.name} drawn` : "Hidden card drawn";
    case "cardPlayed":
      return `${event.card.name} played`;
    case "actionQueued":
      return "Action queued";
    case "unitSummoned":
      return `${event.name} summoned`;
    case "pieceMoved":
      return `${event.pieceId} moved`;
    case "pieceAttacked":
      return `${event.attackerId} attacked`;
    case "pieceHealed":
      return `${event.pieceId} healed`;
    case "pieceBuffed":
      return `${event.pieceId} buffed`;
    case "pieceDamaged":
      return `${event.pieceId} damaged`;
    case "unitDestroyed":
      return `${event.name} destroyed`;
    case "matchEnded":
      return `${sideLabel(event.winner)} wins`;
  }
}

function eventDetail(event: ReplayEvent) {
  switch (event.type) {
    case "matchCreated":
      return "The wizards enter the hex arena.";
    case "turnStarted":
      return `Round ${event.round} ${sideLabel(event.side).toLocaleLowerCase()} turn.`;
    case "turnEnded":
      return `Round ${event.round} ${sideLabel(event.side).toLocaleLowerCase()} turn ended.`;
    case "roundStarted":
      return `Round ${event.round} begins.`;
    case "cardDrawn":
      return event.card
        ? `${sideLabel(event.side)} drew ${event.card.name}.`
        : `${sideLabel(event.side)} drew a hidden card.`;
    case "cardPlayed":
      return `${sideLabel(event.side)} played ${event.card.name}.`;
    case "actionQueued":
      return `${stackItemTitle(event.item)} at priority ${event.item.priority}.`;
    case "unitSummoned":
      return `${sideLabel(event.side)} summoned ${event.name} at q ${event.position.q}, r ${event.position.r}.`;
    case "pieceMoved":
      return `${event.pieceId} moved from q ${event.from.q}, r ${event.from.r} to q ${event.to.q}, r ${event.to.r}.`;
    case "pieceAttacked":
      return `${event.attackerId} dealt ${event.damageToTarget}; counterdamage was ${event.counterDamageToAttacker}.`;
    case "pieceHealed":
      return `${event.pieceId} healed ${event.amount}.`;
    case "pieceBuffed":
      return `${event.pieceId} gained +${event.attackDelta}/+${event.armorDelta}.`;
    case "pieceDamaged":
      return `${event.pieceId} took ${event.amount} damage.`;
    case "unitDestroyed":
      return `${event.name} left the board.`;
    case "matchEnded":
      return `${sideLabel(event.winner)} won the match.`;
  }
}

function wizardOptionByType(wizardType: WizardType) {
  return WIZARD_OPTIONS.find((wizard) => wizard.id === wizardType) ?? WIZARD_OPTIONS[0];
}

function isWizardType(value: string | null): value is WizardType {
  return WIZARD_OPTIONS.some((wizard) => wizard.id === value);
}

function wizardTypeLabel(wizardType: WizardType) {
  return wizardOptionByType(wizardType).name;
}

function wizardTokenLabel(wizardType: WizardType) {
  return wizardOptionByType(wizardType).token;
}

function avatarSymbolLabel(symbol: string) {
  return symbol.slice(0, 1).toUpperCase();
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

function viewerSideLabel(side: Side, viewerSide: Side) {
  return side === viewerSide ? "your" : "the opponent's";
}

function viewerSideShortLabel(side: Side, viewerSide: Side) {
  return side === viewerSide ? "YOU" : "OPP";
}
