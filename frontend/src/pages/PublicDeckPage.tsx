import { House } from "lucide-react";
import { useEffect, useState } from "react";
import { loadCatalog, loadPublicDeck } from "../api";
import type { AccountProps, CatalogLoadState } from "../appTypes";
import { AccountActions, ShellMessage } from "../components/common";
import { wizardTypeLabel } from "../labels";
import type { DeckRules, PublicDeckRecipeResponse } from "../types";
import { DeckVisualCardGrid } from "./decks/DeckVisualCardGrid";
import { deckStats, deckVisualCards } from "./decks/deckDesignerModel";

type PublicDeckLoadState =
  | { status: "loading" }
  | { status: "ready"; response: PublicDeckRecipeResponse }
  | { status: "error"; message: string };

export function PublicDeckPage({
  handle,
  deckId,
  currentUser,
  onNavigate,
  onSignOut,
}: AccountProps & {
  handle: string;
  deckId: number;
}) {
  const [deckLoadState, setDeckLoadState] = useState<PublicDeckLoadState>({ status: "loading" });
  const [catalogLoadState, setCatalogLoadState] = useState<CatalogLoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setDeckLoadState({ status: "loading" });
    setCatalogLoadState({ status: "loading" });

    loadPublicDeck(handle, deckId)
      .then((response) => {
        if (!cancelled) {
          setDeckLoadState({ status: "ready", response });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDeckLoadState({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load deck recipe",
          });
        }
      });

    loadCatalog()
      .then((response) => {
        if (!cancelled) {
          setCatalogLoadState({ status: "ready", cards: response.cards });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCatalogLoadState({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load catalog",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [handle, deckId]);

  if (deckLoadState.status === "loading" || catalogLoadState.status === "loading") {
    return <ShellMessage title="Deck recipe" message="Loading deck recipe" />;
  }

  if (deckLoadState.status === "error") {
    return <ShellMessage title="Deck recipe" message={deckLoadState.message} />;
  }

  if (catalogLoadState.status === "error") {
    return <ShellMessage title="Deck recipe" message={catalogLoadState.message} />;
  }

  const { owner, deck } = deckLoadState.response;
  const rules = publicDeckRulesFallback(deck.legality.totalCards);
  const visualCards = deckVisualCards(catalogLoadState.cards, deck.cards, rules);
  const stats = deckStats(deck.legality, rules, deck.wizardType, deck.runeIds, null);

  return (
    <main className="app-shell deck-shell">
      <section className="public-deck-layout" aria-label="Public deck recipe">
        <header className="top-bar catalog-header deck-page-header">
          <div>
            <p className="eyebrow">Deck recipe #{deck.id}</p>
            <h1>{deck.name}</h1>
          </div>
          <div className="actions">
            <AccountActions currentUser={currentUser} onNavigate={onNavigate} onSignOut={onSignOut} />
            <button className="icon-button" type="button" onClick={() => onNavigate("/")} title="Match picker">
              <House size={18} />
            </button>
          </div>
        </header>

        <section className="public-deck-summary" aria-label="Deck summary">
          <div className="public-owner">
            <span className={`profile-avatar ${owner.avatar.color}`}>{owner.avatar.symbol.slice(0, 2)}</span>
            <div>
              <span>Shared by @{owner.handle}</span>
              <strong>{owner.displayName}</strong>
            </div>
          </div>
          <div className="deck-stat-grid">
            <DetailStat label="Status" value={stats.statusLabel} />
            <DetailStat label="Wizard" value={wizardTypeLabel(deck.wizardType)} />
            <DetailStat label="Cards" value={`${deck.legality.totalCards}`} />
            <DetailStat label="Runes" value={stats.runeNames.join(", ") || "None"} />
          </div>
          {stats.messages.length > 0 ? (
            <ul className="deck-message-list">
              {stats.messages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="public-deck-cards" aria-label="Deck cards">
          <div className="deck-panel-heading">
            <div>
              <p className="eyebrow">{deck.legality.legal ? "Legal deck" : "Draft deck"}</p>
              <h2>Cards</h2>
            </div>
            <span>{deck.legality.totalCards}</span>
          </div>
          <DeckVisualCardGrid
            cards={visualCards}
            readOnly
            emptyTitle="No visible Cards"
            emptyMessage="This deck recipe has no catalog-backed Cards to display."
          />
        </section>
      </section>
    </main>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="detail-stat">
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function publicDeckRulesFallback(totalCards: number): DeckRules {
  return {
    maxDecksPerAccount: 30,
    minCards: Math.max(30, totalCards),
    basicCopyLimit: 5,
    advancedCopyLimit: 4,
    rareCopyLimit: 3,
    advancedTotalLimit: 20,
    rareTotalLimit: 12,
  };
}
