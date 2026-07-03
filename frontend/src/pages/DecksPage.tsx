import { Copy, House, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createDeck,
  deleteDeck,
  duplicateDeck,
  loadCatalog,
  loadDecks,
  loadProgression,
  previewDeckLegality,
  updateDeck,
} from "../api";
import type { AccountProps, CatalogLoadState, DeckLoadState, ProgressionLoadState } from "../appTypes";
import { AccountActions, ShellMessage } from "../components/common";
import { RuneSelector } from "../components/loadoutControls";
import {
  cardsFromCounts,
  copyLimitForRarity,
  countsFromCards,
  rarityLabel,
  skillNamesForWizard,
} from "../deckHelpers";
import { defaultRuneIdsForWizard } from "../labels";
import type { AuthUser, CatalogCard, DeckLegality, DeckRecipeSummary, Rarity, WizardType } from "../types";
import { WIZARD_OPTIONS } from "../wizards";

export function DecksPage({ currentUser, onNavigate, onSignOut }: AccountProps & { currentUser: AuthUser }) {
  const [deckLoadState, setDeckLoadState] = useState<DeckLoadState>({ status: "loading" });
  const [catalogLoadState, setCatalogLoadState] = useState<CatalogLoadState>({ status: "loading" });
  const [selectedDeckId, setSelectedDeckId] = useState<number | null>(null);
  const [deckName, setDeckName] = useState("");
  const [cardCounts, setCardCounts] = useState<Record<string, number>>({});
  const [previewLegality, setPreviewLegality] = useState<DeckLegality | null>(null);
  const [defaultDeck, setDefaultDeck] = useState(false);
  const [selectedWizardType, setSelectedWizardType] = useState<WizardType>(
    currentUser.preferredWizardType,
  );
  const [selectedRuneIds, setSelectedRuneIds] = useState<string[]>([]);
  const [progressionLoadState, setProgressionLoadState] = useState<ProgressionLoadState>({
    status: "loading",
  });
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
    loadProgression()
      .then((progression) => setProgressionLoadState({ status: "ready", progression }))
      .catch((error: unknown) =>
        setProgressionLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load progression",
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
    setSelectedWizardType(deck?.wizardType ?? currentUser.preferredWizardType);
    setSelectedRuneIds(deck?.runeIds ?? []);
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
      const saved = await updateDeck(selectedDeckId, deckName, localCards, defaultDeck, {
        wizardType: selectedWizardType,
        runeIds: selectedRuneIds,
      });
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

  if (
    deckLoadState.status === "loading" ||
    catalogLoadState.status === "loading" ||
    progressionLoadState.status === "loading"
  ) {
    return <ShellMessage title="Decks" message="Loading deck library" />;
  }

  if (deckLoadState.status === "error") {
    return <ShellMessage title="Decks" message={deckLoadState.message} />;
  }

  if (catalogLoadState.status === "error") {
    return <ShellMessage title="Decks" message={catalogLoadState.message} />;
  }

  if (progressionLoadState.status === "error") {
    return <ShellMessage title="Decks" message={progressionLoadState.message} />;
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

          <section className="deck-config-panel" aria-label="Wizard configuration">
            <div className="preferred-wizard-control">
              <span>Wizard</span>
              <select
                value={selectedWizardType}
                onChange={(event) => {
                  const wizardType = event.target.value as WizardType;
                  setSelectedWizardType(wizardType);
                  setSelectedRuneIds(defaultRuneIdsForWizard(progressionLoadState.progression, wizardType));
                }}
              >
                {WIZARD_OPTIONS.map((wizard) => (
                  <option key={wizard.id} value={wizard.id}>
                    {wizard.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="deck-config-skills">
              <span>Active Skills</span>
              <strong>
                {skillNamesForWizard(progressionLoadState.progression, selectedWizardType).join(", ") ||
                  "Base skill only"}
              </strong>
            </div>
            <RuneSelector
              progression={progressionLoadState.progression}
              wizardType={selectedWizardType}
              selectedRuneIds={selectedRuneIds}
              onChange={setSelectedRuneIds}
            />
          </section>

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

export function DeckLegalityPanel({ legality }: { legality: DeckLegality }) {
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
