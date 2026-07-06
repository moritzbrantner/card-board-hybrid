import { BookOpen, History, Layers, Play, Sparkles, Swords, UserRound } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { loadDecks, loadProfileMatches, loadProgression } from "../api";
import type { AccountProps, DeckLoadState, MatchArchiveLoadState, ProgressionLoadState } from "../appTypes";
import { TopNav } from "../components/common";
import { HeroPreview3D } from "../HeroPreview3D";
import { formatMatchStatus, formatUnixTime, heroOptionByType } from "../labels";
import type { DeckRecipeSummary, MatchSummary, HeroType, ProgressionResponse } from "../types";

export function DashboardPage({
  currentUser,
  onNavigate,
  onSignOut,
}: AccountProps) {
  const [matchId, setMatchId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [progressionState, setProgressionState] = useState<ProgressionLoadState | null>(
    currentUser ? { status: "loading" } : null,
  );
  const [matchesState, setMatchesState] = useState<MatchArchiveLoadState | null>(
    currentUser ? { status: "loading" } : null,
  );
  const [deckState, setDeckState] = useState<DeckLoadState | null>(
    currentUser ? { status: "loading" } : null,
  );

  useEffect(() => {
    if (!currentUser) {
      setProgressionState(null);
      setMatchesState(null);
      setDeckState(null);
      return;
    }

    let cancelled = false;
    setProgressionState({ status: "loading" });
    setMatchesState({ status: "loading" });
    setDeckState({ status: "loading" });

    loadProgression()
      .then((progression) => {
        if (!cancelled) {
          setProgressionState({ status: "ready", progression });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setProgressionState({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load progression",
          });
        }
      });

    loadProfileMatches()
      .then((response) => {
        if (!cancelled) {
          setMatchesState({ status: "ready", matches: response.matches });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMatchesState({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load recent matches",
          });
        }
      });

    loadDecks()
      .then((response) => {
        if (!cancelled) {
          setDeckState({ status: "ready", response });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDeckState({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load deck library",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  function handleOpenMatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = matchId.trim();
    if (!normalized) {
      setNotice("Enter a match ID.");
      return;
    }
    onNavigate(`/match/${encodeURIComponent(normalized)}`);
  }

  const decks = deckState?.status === "ready" ? deckState.response.decks : [];
  const legalDecks = decks.filter((deck) => deck.legality.legal);
  const featuredDeck = legalDecks.find((deck) => deck.isDefault) ?? legalDecks[0] ?? null;
  const progression = progressionState?.status === "ready" ? progressionState.progression : null;
  const accountProgression = progression?.account ?? currentUser?.progressionSummary ?? null;

  return (
    <main className="app-shell dashboard-shell">
      <TopNav currentUser={currentUser} onNavigate={onNavigate} onSignOut={onSignOut} />
      <section className="dashboard-layout" aria-label="Player dashboard">
        {currentUser ? (
          <>
            <header className="dashboard-featured">
              <div className="dashboard-featured-copy">
                <p className="eyebrow">Rune Lanes</p>
                <h1>Player Dashboard</h1>
                <p>Welcome back, {currentUser.displayName}. Your next match starts from a legal configured deck recipe.</p>
                <div className="dashboard-hero-stat-strip" aria-label="Account summary">
                  {accountProgression ? (
                    <>
                      <DashboardHeroStat label="Level" value={accountProgression.level} />
                      <DashboardHeroStat label="Total XP" value={accountProgression.totalXp} />
                      <DashboardHeroStat label="Rune Slots" value={accountProgression.runeSlots} />
                    </>
                  ) : progressionState?.status === "loading" ? (
                    <p className="dashboard-featured-note">Loading account progression.</p>
                  ) : (
                    <p className="dashboard-featured-note">Account progression unavailable.</p>
                  )}
                </div>
                <div className="dashboard-hero-actions">
                  <button className="primary-button" type="button" onClick={() => onNavigate("/play")}>
                    <Play size={18} />
                    Play
                  </button>
                  <button className="secondary-link" type="button" onClick={() => onNavigate("/decks")}>
                    <Layers size={18} />
                    Decks
                  </button>
                  <button className="secondary-link" type="button" onClick={() => onNavigate("/profile")}>
                    <UserRound size={18} />
                    Profile
                  </button>
                </div>
              </div>
              {deckState?.status === "loading" ? (
                <div className="dashboard-featured-deck-status">
                  <strong>Loading configured deck recipe.</strong>
                  <span>Your featured Hero preview will appear here.</span>
                </div>
              ) : null}
              {deckState?.status === "error" ? (
                <div className="dashboard-featured-deck-status">
                  <strong>Deck library unavailable.</strong>
                  <span>{deckState.message}</span>
                </div>
              ) : null}
              {deckState?.status === "ready" && featuredDeck ? (
                <FeaturedDeckPanel deck={featuredDeck} progression={progression} onNavigate={onNavigate} />
              ) : null}
              {deckState?.status === "ready" && !featuredDeck ? (
                <FeaturedDeckEmptyState onNavigate={onNavigate} />
              ) : null}
            </header>

            <section className="dashboard-grid" aria-label="Account summary">
              <ProgressionSummaryCard progressionState={progressionState} />
              <PreferredHeroCard
                preferredHeroType={currentUser.preferredHeroType}
                progressionState={progressionState}
                onNavigate={onNavigate}
              />
              <DeckLibraryCard deckState={deckState} onNavigate={onNavigate} />
              <RecentMatchesCard matchesState={matchesState} onNavigate={onNavigate} />
            </section>
          </>
        ) : (
          <SignedOutDashboard onNavigate={onNavigate} />
        )}

        <form className="open-match-form dashboard-open-match" onSubmit={handleOpenMatch}>
          <label htmlFor="dashboard-match-id">Open Match by ID</label>
          <div>
            <input
              id="dashboard-match-id"
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

function FeaturedDeckPanel({
  deck,
  progression,
  onNavigate,
}: {
  deck: DeckRecipeSummary;
  progression: ProgressionResponse | null;
  onNavigate: (to: string) => void;
}) {
  const heroOption = heroOptionByType(deck.heroType);
  const runeNames = deck.runeIds.map(
    (runeId) => progression?.runes.find((rune) => rune.id === runeId)?.name ?? runeId,
  );
  const runeSummary =
    runeNames.length === 0
      ? "No runes equipped"
      : `${runeNames.length} rune${runeNames.length === 1 ? "" : "s"} equipped`;

  return (
    <section className="dashboard-featured-deck" aria-label="Featured configured deck recipe">
      <div className="dashboard-featured-model">
        <HeroPreview3D heroType={deck.heroType} label={heroOption.name} />
      </div>
      <div className="dashboard-featured-deck-body">
        <div className="dashboard-featured-deck-heading">
          <span>Featured Deck</span>
          <strong>{deck.name}</strong>
        </div>
        <div className="dashboard-featured-hero-line">
          <span>{heroOption.role}</span>
          <strong>{heroOption.name}</strong>
        </div>
        <div className="dashboard-featured-stats">
          <DashboardHeroStat label="Cards" value={deck.legality.totalCards} />
          <DashboardHeroStat label="Runes" value={runeNames.length} />
          <DashboardHeroStat label="Status" value="Legal" />
        </div>
        <p className="dashboard-featured-note" title={runeNames.join(", ")}>
          {runeSummary}
        </p>
        <button className="secondary-link" type="button" onClick={() => onNavigate("/decks")}>
          <Layers size={18} />
          Manage Deck Recipe
        </button>
      </div>
    </section>
  );
}

function FeaturedDeckEmptyState({ onNavigate }: { onNavigate: (to: string) => void }) {
  return (
    <section className="dashboard-featured-deck dashboard-featured-deck-empty" aria-label="Featured configured deck recipe">
      <div className="dashboard-featured-empty-copy">
        <strong>No legal configured deck recipe</strong>
        <span>Create or fix a deck recipe before using Basic Play.</span>
      </div>
      <button className="primary-button" type="button" onClick={() => onNavigate("/decks")}>
        <Layers size={18} />
        Open Decks
      </button>
    </section>
  );
}

function SignedOutDashboard({ onNavigate }: { onNavigate: (to: string) => void }) {
  return (
    <header className="dashboard-hero signed-out-dashboard">
      <div>
        <p className="eyebrow">Rune Lanes</p>
        <h1>Player Dashboard</h1>
        <p>Track your heroes, deck recipes, and match history after signing in, or jump straight into a match.</p>
      </div>
      <div className="dashboard-hero-actions">
        <button className="primary-button" type="button" onClick={() => onNavigate("/play")}>
          <Play size={18} />
          Play
        </button>
        <button className="secondary-link" type="button" onClick={() => onNavigate("/catalog/")}>
          <BookOpen size={18} />
          Catalog
        </button>
        <button className="secondary-link" type="button" onClick={() => onNavigate("/wiki")}>
          <BookOpen size={18} />
          Rules
        </button>
        <button className="secondary-link" type="button" onClick={() => onNavigate("/tutorial")}>
          <BookOpen size={18} />
          Tutorial
        </button>
        <button className="secondary-link" type="button" onClick={() => onNavigate("/register")}>
          <UserRound size={18} />
          Create Account
        </button>
      </div>
    </header>
  );
}

function DashboardHeroStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="dashboard-hero-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProgressionSummaryCard({
  progressionState,
}: {
  progressionState: ProgressionLoadState | null;
}) {
  const progression = progressionState?.status === "ready" ? progressionState.progression : null;
  const account = progression?.account;

  return (
    <article className="dashboard-panel">
      <div className="dashboard-panel-heading">
        <Sparkles size={18} />
        <h2>Account Progression</h2>
      </div>
      {progressionState?.status === "loading" ? <p className="empty-state">Loading progression.</p> : null}
      {progressionState?.status === "error" ? <p className="notice">{progressionState.message}</p> : null}
      {account ? (
        <>
          <div className="dashboard-stat-grid">
            <DashboardStat label="Level" value={account.level} />
            <DashboardStat label="Total XP" value={account.totalXp} />
            <DashboardStat label="Rune Slots" value={account.runeSlots} />
          </div>
          <DashboardProgressBar
            label={`Next level in ${account.xpToNextLevel} XP`}
            value={account.xpIntoLevel}
            max={account.nextLevelXp - account.currentLevelXp}
          />
        </>
      ) : null}
    </article>
  );
}

function PreferredHeroCard({
  preferredHeroType,
  progressionState,
  onNavigate,
}: {
  preferredHeroType: HeroType;
  progressionState: ProgressionLoadState | null;
  onNavigate: (to: string) => void;
}) {
  const heroOption = heroOptionByType(preferredHeroType);
  const heroProgression =
    progressionState?.status === "ready"
      ? progressionState.progression.heroes.find((hero) => hero.heroType === preferredHeroType)
      : null;

  return (
    <article className="dashboard-panel">
      <div className="dashboard-panel-heading">
        <Swords size={18} />
        <h2>Preferred Hero</h2>
      </div>
      <div className="dashboard-feature-row">
        <div>
          <span>{heroOption.role}</span>
          <strong>{heroOption.name}</strong>
        </div>
        <button className="secondary-link" type="button" onClick={() => onNavigate("/profile")}>
          Profile
        </button>
      </div>
      {progressionState?.status === "loading" ? <p className="empty-state">Loading mastery.</p> : null}
      {progressionState?.status === "error" ? <p className="notice">{progressionState.message}</p> : null}
      {heroProgression ? (
        <>
          <div className="dashboard-stat-grid">
            <DashboardStat label="Mastery" value={heroProgression.level} />
            <DashboardStat label="Skill Points" value={heroProgression.availableSkillPoints} />
            <DashboardStat label="Hero XP" value={heroProgression.xp} />
          </div>
          <DashboardProgressBar
            label={`Next mastery level in ${heroProgression.xpToNextLevel} XP`}
            value={heroProgression.xpIntoLevel}
            max={heroProgression.nextLevelXp - heroProgression.currentLevelXp}
          />
        </>
      ) : progressionState?.status === "ready" ? (
        <p className="empty-state">No mastery recorded yet.</p>
      ) : null}
    </article>
  );
}

function DeckLibraryCard({
  deckState,
  onNavigate,
}: {
  deckState: DeckLoadState | null;
  onNavigate: (to: string) => void;
}) {
  const decks = deckState?.status === "ready" ? deckState.response.decks : [];
  const legalDeckCount = decks.filter((deck) => deck.legality.legal).length;
  const draftDeckCount = decks.length - legalDeckCount;
  const defaultDeck = decks.find((deck) => deck.isDefault);

  return (
    <article className="dashboard-panel">
      <div className="dashboard-panel-heading">
        <Layers size={18} />
        <h2>Deck Library</h2>
      </div>
      {deckState?.status === "loading" ? <p className="empty-state">Loading deck library.</p> : null}
      {deckState?.status === "error" ? <p className="notice">{deckState.message}</p> : null}
      {deckState?.status === "ready" ? (
        <>
          <div className="dashboard-stat-grid">
            <DashboardStat label="Legal" value={legalDeckCount} />
            <DashboardStat label="Draft" value={draftDeckCount} />
            <DashboardStat label="Total" value={decks.length} />
          </div>
          <p className="dashboard-muted-line">
            Default: {defaultDeck ? defaultDeck.name : "No default deck recipe"}
          </p>
          <button className="primary-button" type="button" onClick={() => onNavigate("/decks")}>
            <Layers size={18} />
            Decks
          </button>
        </>
      ) : null}
    </article>
  );
}

function RecentMatchesCard({
  matchesState,
  onNavigate,
}: {
  matchesState: MatchArchiveLoadState | null;
  onNavigate: (to: string) => void;
}) {
  const recentMatches = useMemo(
    () => (matchesState?.status === "ready" ? matchesState.matches.slice(0, 3) : []),
    [matchesState],
  );

  return (
    <article className="dashboard-panel dashboard-panel-wide">
      <div className="dashboard-panel-heading">
        <History size={18} />
        <h2>Recent Matches</h2>
      </div>
      {matchesState?.status === "loading" ? <p className="empty-state">Loading recent matches.</p> : null}
      {matchesState?.status === "error" ? <p className="notice">{matchesState.message}</p> : null}
      {matchesState?.status === "ready" && recentMatches.length === 0 ? (
        <p className="empty-state">No owned matches yet.</p>
      ) : null}
      {recentMatches.length > 0 ? (
        <div className="dashboard-match-list" role="list" aria-label="Recent matches">
          {recentMatches.map((match) => (
            <RecentMatchRow key={match.matchId} match={match} onNavigate={onNavigate} />
          ))}
        </div>
      ) : null}
      <button className="primary-button" type="button" onClick={() => onNavigate("/matches")}>
        <History size={18} />
        Matches
      </button>
    </article>
  );
}

function RecentMatchRow({
  match,
  onNavigate,
}: {
  match: MatchSummary;
  onNavigate: (to: string) => void;
}) {
  return (
    <article className="dashboard-match-row" role="listitem">
      <div>
        <strong>{match.matchId}</strong>
        <span>{formatMatchStatus(match)} · Round {match.round} · {formatUnixTime(match.updatedAt)}</span>
      </div>
      <div className="dashboard-match-actions">
        {match.phase !== "matchOver" ? (
          <button className="secondary-link" type="button" onClick={() => onNavigate(`/match/${match.matchId}`)}>
            Continue
          </button>
        ) : null}
        <button className="primary-button" type="button" onClick={() => onNavigate(`/matches/${match.matchId}/summary`)}>
          Summary
        </button>
      </div>
    </article>
  );
}

function DashboardStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="dashboard-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DashboardProgressBar({ label, value, max }: { label: string; value: number; max: number }) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="progress-bar" aria-label={label}>
      <div>
        <span style={{ width: `${percent}%` }} />
      </div>
      <small>{label}</small>
    </div>
  );
}
