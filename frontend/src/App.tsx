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
  Play,
  Plus,
  RotateCcw,
  Search,
  Shield,
  Sparkles,
  Sword,
  Users,
  WandSparkles,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  attack,
  createMatch,
  createSharedMatch,
  endTurn,
  joinSharedMatch,
  loadCatalog,
  loadMatch,
  loadMatches,
  loadReplay,
  loadSharedMatch,
  movePiece,
  playCard,
  sharedMatchWebSocketUrl,
} from "./api";
import type {
  Card,
  CatalogCard,
  HexCoord,
  HexTile,
  MatchReplayResponse,
  MatchActionRequest,
  MatchSummary,
  MatchParticipantState,
  MatchState,
  Rarity,
  ReplayEvent,
  SharedClientMessage,
  SharedMatchResponse,
  SharedServerMessage,
  Side,
  Unit,
  Wizard,
  WizardType,
  ActionTarget,
} from "./types";
import type {
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
type CatalogUnitCard = CatalogCard & {
  kind: Extract<CatalogCard["kind"], { type: "unit" }>;
};

type WizardOption = {
  id: WizardType;
  name: string;
  role: string;
  hp: number;
  attack: number;
  ap: number;
  text: string;
  token: string;
};

const WIZARD_OPTIONS = [
  {
    id: "runekeeper",
    name: "Runekeeper",
    role: "Balanced",
    hp: 20,
    attack: 1,
    ap: 3,
    text: "Steady stats for flexible card play.",
    token: "Run",
  },
  {
    id: "pyromancer",
    name: "Pyromancer",
    role: "Aggressive",
    hp: 18,
    attack: 2,
    ap: 3,
    text: "Higher melee damage with a smaller health pool.",
    token: "Pyr",
  },
  {
    id: "chronomancer",
    name: "Chronomancer",
    role: "Mobile",
    hp: 16,
    attack: 1,
    ap: 4,
    text: "Extra action point for repositioning and summons.",
    token: "Chr",
  },
  {
    id: "warden",
    name: "Warden",
    role: "Defensive",
    hp: 24,
    attack: 1,
    ap: 2,
    text: "Durable but slower across the board.",
    token: "War",
  },
  {
    id: "battlemage",
    name: "Battlemage",
    role: "Bruiser",
    hp: 20,
    attack: 2,
    ap: 2,
    text: "Tougher frontline duelist with fewer actions.",
    token: "Bat",
  },
] as const satisfies readonly WizardOption[];

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

  if (path.replace(/\/+$/, "") === "/catalog") {
    return <CatalogPage onNavigate={navigate} />;
  }

  if (path.replace(/\/+$/, "") === "/matches") {
    return <MatchArchivePage onNavigate={navigate} />;
  }

  const replayRoute = replayRouteFromPath(path);
  if (replayRoute) {
    return <ReplayPage key={replayRoute} matchId={replayRoute} onNavigate={navigate} />;
  }

  const sharedMatchRoute = sharedMatchRouteFromPath(path);
  if (sharedMatchRoute) {
    return (
      <SharedMatchPage
        key={`${sharedMatchRoute.matchId}:${sharedMatchRoute.seatToken}`}
        matchId={sharedMatchRoute.matchId}
        seatToken={sharedMatchRoute.seatToken}
        onNavigate={navigate}
      />
    );
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
              <DetailStat label="Effect" value={spellEffectLabel(card)} />
            </>
          )}
        </div>
        <p className="detail-rules">{card.text}</p>
      </div>
    </aside>
  );
}

function DetailStat({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="detail-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

function MatchPicker({ onNavigate }: { onNavigate: (to: string) => void }) {
  const [matchId, setMatchId] = useState("");
  const [selectedWizardType, setSelectedWizardType] = useState<WizardType>("runekeeper");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleCreateMatch() {
    setBusy(true);
    setNotice(null);
    try {
      const created = await createMatch(selectedWizardType);
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

  return (
    <main className="app-shell picker-shell">
      <section className="match-picker" aria-label="Match picker">
        <div>
          <p className="eyebrow">Rune Lanes</p>
          <h1>Choose Your Wizard</h1>
        </div>
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

function MatchArchivePage({ onNavigate }: { onNavigate: (to: string) => void }) {
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

function MatchPage({
  matchId,
  onNavigate,
}: {
  matchId: string;
  onNavigate: (to: string) => void;
}) {
  const viewerSide: Side = "player";
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

  const modalUnitCard = useMemo(() => {
    if (!modalUnit) {
      return null;
    }

    return findUnitCatalogCard(catalogCards, modalUnit);
  }, [catalogCards, modalUnit]);

  const contextMenuUnit = useMemo(() => {
    if (loadState.status !== "ready" || unitContextMenu === null) {
      return null;
    }

    const piece = pieceById(loadState.match, unitContextMenu.pieceId);
    return piece?.pieceType === "unit" ? piece : null;
  }, [loadState, unitContextMenu]);

  async function runAction(action: () => Promise<MatchState>) {
    setBusy(true);
    setNotice(null);

    try {
      const match = await action();
      setLoadState({ status: "ready", match });
      setSelection(null);
      setDraggedCardId(null);
      setUnitModalPieceId(null);
      setUnitContextMenu(null);
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
      if (piece && isLegalAttack(viewerSide, selectedPiece, piece)) {
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
              onClick={() => void runAction(() => endTurn(matchId))}
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

        <section className="battlefield">
          <Board
            match={match}
            viewerSide="player"
            selectedCard={selectedCard}
            selectedPiece={selectedPiece}
            disabled={busy || match.phase === "matchOver"}
            onTileClick={handleTileClick}
            onTileDrop={handleCardDrop}
            onUnitContextMenu={handleUnitContextMenu}
          />
          <div className="hand-overlay">
            <div className="hand" aria-label="Hand">
              {handForSide(match, viewerSide).map((card) => (
                <CardButton
                  key={card.id}
                  card={card}
                  selected={selection?.type === "card" && card.id === selection.cardId}
                  dragging={draggedCardId === card.id}
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
            {match.log.map((entry, index) => (
              <p key={`${entry}-${index}`}>{entry}</p>
            ))}
          </aside>
        </section>
      </section>
      {modalUnit ? (
        <UnitCardModal
          unit={modalUnit}
          card={modalUnitCard}
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
}: {
  matchId: string;
  seatToken: string;
  onNavigate: (to: string) => void;
}) {
  const [loadState, setLoadState] = useState<SharedLoadState>({ status: "loading" });
  const [catalogCards, setCatalogCards] = useState<CatalogCard[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [unitModalPieceId, setUnitModalPieceId] = useState<string | null>(null);
  const [unitContextMenu, setUnitContextMenu] = useState<UnitContextMenu>(null);
  const [selectedWizardType, setSelectedWizardType] = useState<WizardType>("runekeeper");
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

  const modalUnitCard = useMemo(() => {
    if (!modalUnit) {
      return null;
    }

    return findUnitCatalogCard(catalogCards, modalUnit);
  }, [catalogCards, modalUnit]);

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
      const joined = await joinSharedMatch(matchId, seatToken, selectedWizardType);
      setLoadState({ status: "ready", shared: joined });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not join match");
    } finally {
      setBusy(false);
    }
  }

  function handleTileClick(tile: HexTile) {
    if (!match || busy || match.phase === "matchOver" || !isActiveViewer) {
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
      if (piece && isLegalAttack(viewerSide, selectedPiece, piece)) {
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
    if (!match || busy || match.phase === "matchOver" || !isActiveViewer) {
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
    return (
      <main className="app-shell picker-shell">
        <section className="match-picker" aria-label="Shared match setup">
          <div>
            <p className="eyebrow">Rune Lanes Multiplayer</p>
            <h1>{viewerSide === "player" ? "Invite Player" : "Choose Your Wizard"}</h1>
            <p className="match-id">Match {matchId}</p>
          </div>
          {viewerSide === "player" ? (
            <>
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
              <p className="notice">Waiting for the invited player to choose a wizard.</p>
            </>
          ) : (
            <>
              <WizardPicker
                selectedWizardType={selectedWizardType}
                busy={busy}
                onSelect={setSelectedWizardType}
              />
              <button
                className="primary-button"
                type="button"
                onClick={() => void handleJoinSharedMatch()}
                disabled={busy}
              >
                <Users size={18} />
                Join Match
              </button>
            </>
          )}
          {notice ? <p className="notice">{notice}</p> : null}
        </section>
      </main>
    );
  }

  const canClaimForfeit =
    shared.canClaimForfeitAt !== null &&
    now >= shared.canClaimForfeitAt &&
    match.phase !== "matchOver";

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
              disabled={busy || match.phase === "matchOver" || !isActiveViewer}
            >
              <Play size={18} />
              End Turn
            </button>
          </div>
        </header>

        <section className="score-row" aria-label="Score">
          <PlayerBadge player={match.player} />
          <div className="phase-pill">
            <Wifi size={16} />
            {match.phase === "matchOver"
              ? `${sideLabel(match.winner)} wins`
              : isActiveViewer
                ? "Your turn"
                : "Waiting"}
          </div>
          <PlayerBadge player={match.opponent} />
        </section>

        <section className="battlefield">
          <Board
            match={match}
            viewerSide={viewerSide}
            selectedCard={selectedCard}
            selectedPiece={selectedPiece}
            disabled={busy || match.phase === "matchOver" || !isActiveViewer}
            onTileClick={handleTileClick}
            onTileDrop={handleCardDrop}
            onUnitContextMenu={handleUnitContextMenu}
          />
          <div className="hand-overlay">
            <div className="hand" aria-label="Hand">
              {handForSide(match, viewerSide).map((card) => (
                <CardButton
                  key={card.id}
                  card={card}
                  selected={selection?.type === "card" && card.id === selection.cardId}
                  dragging={draggedCardId === card.id}
                  disabled={busy || !isActiveViewer || !isPlayableCard(match, viewerSide, card)}
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
          card={modalUnitCard}
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
}: {
  matchId: string;
  onNavigate: (to: string) => void;
}) {
  const [loadState, setLoadState] = useState<ReplayLoadState>({ status: "loading" });
  const [frameIndex, setFrameIndex] = useState(0);

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
          viewerSide="player"
          selectedCard={null}
          selectedPiece={null}
          disabled={false}
          readOnly
        />

        <section className="replay-inspector" aria-label="Replay timeline">
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
  card,
  onClose,
}: {
  unit: BoardUnit;
  card: CatalogCard | null;
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

  const unitCard = isCatalogUnitCard(card) ? card : null;

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
        className={`unit-modal ${unitCard?.rarity ?? "basic"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unit-modal-title"
      >
        <button className="icon-button modal-close" type="button" onClick={onClose} title="Close">
          <X size={18} />
        </button>
        {unitCard ? (
          <img src={unitCard.artPath} alt="" />
        ) : (
          <div className="unit-modal-art-placeholder" aria-hidden="true">
            <Sword size={46} />
          </div>
        )}
        <div className="unit-modal-body">
          <div>
            <p className="eyebrow">
              {unit.side === "player" ? "Your" : "Opponent"} unit
              {unitCard ? ` · ${unitCard.rarity}` : ""}
            </p>
            <h2 id="unit-modal-title">{unitCard?.name ?? unit.name}</h2>
          </div>

          <div className="detail-stat-row">
            {unitCard ? (
              <>
                <DetailStat label="Cost" value={unitCard.cost} />
                <DetailStat label="Base Attack" value={unitCard.kind.attack} />
                <DetailStat label="Base Armor" value={unitCard.kind.armor} />
                <DetailStat label="Base AP" value={unitCard.kind.maxAp} />
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
            {unitCard?.text ?? "This unit came from an older match without saved card metadata."}
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

function Board({
  match,
  viewerSide,
  selectedCard,
  selectedPiece,
  disabled,
  readOnly = false,
  onTileClick,
  onTileDrop,
  onUnitContextMenu,
}: {
  match: MatchState;
  viewerSide: Side;
  selectedCard: Card | null;
  selectedPiece: BoardPiece | null;
  disabled: boolean;
  readOnly?: boolean;
  onTileClick?: (tile: HexTile) => void;
  onTileDrop?: (tile: HexTile, cardId: string) => void;
  onUnitContextMenu?: (unit: BoardUnit, position: { x: number; y: number }) => void;
}) {
  const columns = groupTilesByColumn(match.board.tiles);

  return (
    <section className={`board ${readOnly ? "read-only" : ""}`} aria-label="Hex board">
      <div className="hex-board">
        {columns.map((column) => (
          <div className="hex-column" key={column.q}>
            {column.tiles.map((tile) => {
              const piece = pieceAt(match, tile.coord);
              const isLegal =
                !readOnly &&
                !disabled &&
                ((selectedCard &&
                  isLegalCardTarget(match, viewerSide, selectedCard, tile.coord, piece)) ||
                  (selectedPiece &&
                    ((!piece && isLegalMove(match, viewerSide, selectedPiece, tile.coord)) ||
                      (piece && isLegalAttack(viewerSide, selectedPiece, piece)))));
              const isSelected = piece?.id === selectedPiece?.id;

              return (
                <button
                  key={coordKey(tile.coord)}
                  className={`hex-tile ${isLegal ? "legal" : ""} ${isSelected ? "selected-piece" : ""}`}
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
    <span className={`piece-token ${piece.side} ${piece.pieceType}`} title={piece.name}>
      <strong>
        {piece.pieceType === "wizard"
          ? wizardTokenLabel(piece.wizardType)
          : piece.name.slice(0, 3)}
      </strong>
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
  dragging = false,
  disabled,
  onClick,
  onDragStart,
  onDragEnd,
}: {
  card: Card;
  selected: boolean;
  dragging?: boolean;
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
      onClick={onClick}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
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

function findUnitCatalogCard(cards: CatalogCard[], unit: BoardUnit) {
  return (
    cards.find((card) => card.templateId === unit.templateId && card.kind.type === "unit") ??
    cards.find((card) => card.name === unit.name && card.kind.type === "unit") ??
    null
  );
}

function isCatalogUnitCard(card: CatalogCard | null): card is CatalogUnitCard {
  return card?.kind.type === "unit";
}

function participantBySide(match: MatchState, side: Side): MatchParticipantState {
  return side === "player" ? match.player : match.opponent;
}

function handForSide(match: MatchState, side: Side): Card[] {
  return participantBySide(match, side).hand ?? [];
}

function isPlayableCard(match: MatchState, viewerSide: Side, card: Card) {
  const participant = participantBySide(match, viewerSide);
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
    match.activeSide === viewerSide &&
    piece.side === viewerSide &&
    piece.apRemaining > 0 &&
    distance(piece.position, coord) === 1 &&
    !pieceAt(match, coord)
  );
}

function isLegalAttack(viewerSide: Side, attacker: BoardPiece, target: BoardPiece) {
  return (
    attacker.side === viewerSide &&
    target.side !== viewerSide &&
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

function kindSummary(card: Card | CatalogCard) {
  if (card.kind.type === "unit") {
    return `${card.kind.attack}/${card.kind.armor} ap ${card.kind.maxAp}`;
  }

  return `${spellEffectLabel(card)} rng ${card.kind.range}`;
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

function wizardTypeLabel(wizardType: WizardType) {
  return wizardOptionByType(wizardType).name;
}

function wizardTokenLabel(wizardType: WizardType) {
  return wizardOptionByType(wizardType).token;
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
