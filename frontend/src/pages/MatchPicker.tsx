import { Layers, Plus, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  createMatch,
  createSharedMatch,
  loadDecks,
  loadProgression,
  loadSystemDecks,
  saveWizardRuneLoadout,
  updateDeck,
} from "../api";
import type { AccountProps, DeckLoadState, ProgressionLoadState, SystemDeckLoadState } from "../appTypes";
import { TopNav } from "../components/common";
import { LoadoutCard, RuneSelector } from "../components/loadoutControls";
import {
  accountDeckToLoadout,
  aiSelectionFromValue,
  systemDeckToLoadout,
  type HomeLoadout,
} from "../deckHelpers";
import { defaultRuneIdsForWizard, wizardTypeLabel } from "../labels";
import type { ProgressionResponse, WizardType } from "../types";
import { WIZARD_OPTIONS } from "../wizards";

export function MatchPicker({
  onNavigate,
  currentUser,
  onSignOut,
}: {
  onNavigate: (to: string) => void;
} & AccountProps) {
  const [matchId, setMatchId] = useState("");
  const [deckLoadState, setDeckLoadState] = useState<DeckLoadState | null>(
    currentUser ? { status: "loading" } : null,
  );
  const [systemDeckLoadState, setSystemDeckLoadState] = useState<SystemDeckLoadState>({
    status: "loading",
  });
  const [progressionLoadState, setProgressionLoadState] = useState<ProgressionLoadState | null>(
    currentUser ? { status: "loading" } : null,
  );
  const [selectedLoadoutId, setSelectedLoadoutId] = useState("system:balanced-starter");
  const [selectedAiDeck, setSelectedAiDeck] = useState<string>("system:balanced-starter");
  const [selectedAiWizardType, setSelectedAiWizardType] = useState<WizardType>("runekeeper");
  const [selectedRuneIds, setSelectedRuneIds] = useState<string[]>([]);
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
      setProgressionLoadState(null);
      setSelectedLoadoutId("system:balanced-starter");
      setSelectedRuneIds([]);
      return;
    }
    setDeckLoadState({ status: "loading" });
    loadDecks()
      .then((response) => {
        setDeckLoadState({ status: "ready", response });
        const defaultDeck = response.decks.find((deck) => deck.isDefault && deck.legality.legal);
        const selectedDeck = response.decks.find(
          (deck) => deck.legality.legal && `account:${deck.id}` === selectedLoadoutId,
        );
        const firstLegalDeck = response.decks.find((deck) => deck.legality.legal);
        const fallbackDeck = selectedLoadoutId.startsWith("account:")
          ? selectedDeck ?? defaultDeck ?? firstLegalDeck ?? null
          : defaultDeck ?? null;
        if (fallbackDeck) {
          setSelectedLoadoutId(`account:${fallbackDeck.id}`);
          setSelectedRuneIds(fallbackDeck.runeIds);
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
        if (!selectedLoadoutId.startsWith("account:")) {
          const selectedSystemDeck = systemDeckLoadState.status === "ready"
            ? systemDeckLoadState.response.decks.find((deck) => `system:${deck.id}` === selectedLoadoutId)
            : null;
          setSelectedRuneIds(
            defaultRuneIdsForWizard(
              progression,
              selectedSystemDeck?.wizardType ?? currentUser.preferredWizardType,
            ),
          );
        }
      })
      .catch((error: unknown) =>
        setProgressionLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load progression",
        }),
      );
  }, [currentUser]);

  const systemDecks =
    systemDeckLoadState.status === "ready" ? systemDeckLoadState.response.decks : [];
  const accountDecks = deckLoadState?.status === "ready" ? deckLoadState.response.decks : [];
  const legalAccountDecks = accountDecks.filter((deck) => deck.legality.legal);
  const loadouts = useMemo(
    () => [
      ...systemDecks.map(systemDeckToLoadout),
      ...accountDecks.map(accountDeckToLoadout),
    ],
    [systemDecks, accountDecks],
  );
  const selectedLoadout =
    loadouts.find((loadout) => loadout.id === selectedLoadoutId) ??
    loadouts[0] ??
    null;
  const selectedAiDeckIsAccount = selectedAiDeck.startsWith("account:");

  useEffect(() => {
    if (!selectedLoadout && loadouts[0]) {
      setSelectedLoadoutId(loadouts[0].id);
      setSelectedRuneIds(loadouts[0].runeIds);
      return;
    }
    if (!selectedLoadout) {
      return;
    }
    setSelectedRuneIds(
      runeIdsForHomeLoadout(
        selectedLoadout,
        progressionLoadState?.status === "ready" ? progressionLoadState.progression : null,
      ),
    );
  }, [selectedLoadout?.id, loadouts.length, progressionLoadState?.status]);

  async function handleCreateMatch() {
    if (!selectedLoadout) {
      setNotice("Choose a loadout.");
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const aiOpponent = aiSelectionFromValue(selectedAiDeck, selectedAiWizardType);
      const created = await createMatch({
        wizardType: selectedLoadout.wizardType,
        playerDeck: selectedLoadout.deckChoice,
        ...(aiOpponent ? { aiOpponent } : {}),
        ...(selectedRuneIds.length > 0 ? { runeIds: selectedRuneIds } : {}),
      });
      onNavigate(`/match/${created.matchId}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create match");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateSharedMatch() {
    if (!selectedLoadout) {
      setNotice("Choose a loadout.");
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const created = await createSharedMatch(selectedLoadout.wizardType);
      sessionStorage.setItem(
        `rune-lanes-invite:${created.matchId}`,
        `${window.location.origin}${created.inviteSeatUrl}`,
      );
      sessionStorage.setItem(`rune-lanes-wizard:${created.matchId}`, selectedLoadout.wizardType);
      sessionStorage.setItem(`rune-lanes-runes:${created.matchId}`, JSON.stringify(selectedRuneIds));
      sessionStorage.setItem(
        `rune-lanes-deck-choice:${created.matchId}`,
        JSON.stringify(selectedLoadout.deckChoice),
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

  async function handleSelectLoadout(loadout: HomeLoadout) {
    setSelectedLoadoutId(loadout.id);
    setSelectedRuneIds(
      runeIdsForHomeLoadout(
        loadout,
        progressionLoadState?.status === "ready" ? progressionLoadState.progression : null,
      ),
    );
    setNotice(null);
  }

  async function handleRuneChange(runeIds: string[]) {
    if (!selectedLoadout || progressionLoadState?.status !== "ready") {
      return;
    }
    setSelectedRuneIds(runeIds);
    try {
      if (selectedLoadout.kind === "system") {
        const updated = await saveWizardRuneLoadout(selectedLoadout.wizardType, runeIds);
        setProgressionLoadState({ status: "ready", progression: updated });
        setNotice(null);
        return;
      }

      if (!selectedLoadout.deck) {
        return;
      }
      const updatedDeck = await updateDeck(
        selectedLoadout.deck.id,
        selectedLoadout.deck.name,
        selectedLoadout.deck.cards,
        selectedLoadout.deck.isDefault,
        { wizardType: selectedLoadout.deck.wizardType, runeIds },
      );
      setDeckLoadState((current) => {
        if (current?.status !== "ready") {
          return current;
        }
        return {
          status: "ready",
          response: {
            ...current.response,
            decks: current.response.decks.map((deck) =>
              deck.id === updatedDeck.id ? updatedDeck : deck,
            ),
          },
        };
      });
      setNotice(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save rune loadout");
    }
  }

  return (
    <main className="app-shell home-shell">
      <TopNav currentUser={currentUser} onNavigate={onNavigate} onSignOut={onSignOut} />
      <section className="home-layout" aria-label="Match loadout selector">
        <header className="home-heading">
          <p className="eyebrow">Rune Lanes</p>
          <h1>Choose Your Loadout</h1>
        </header>

        <section className="loadout-stage" aria-label="Preconfigured loadouts">
          <div className="loadout-section-heading">
            <div>
              <span>Preconfigured</span>
              <strong>System loadouts</strong>
            </div>
          </div>
          <div className="loadout-grid">
            {systemDeckLoadState.status === "loading" ? (
              <p className="notice">Loading system loadouts</p>
            ) : null}
            {systemDecks.map((deck) => {
              const loadout = systemDeckToLoadout(deck);
              return (
                <LoadoutCard
                  key={loadout.id}
                  loadout={loadout}
                  selected={selectedLoadout?.id === loadout.id}
                  progression={progressionLoadState?.status === "ready" ? progressionLoadState.progression : null}
                  onSelect={handleSelectLoadout}
                  busy={busy}
                />
              );
            })}
          </div>
        </section>

        {currentUser ? (
          <section className="loadout-stage" aria-label="Custom deck loadouts">
            <div className="loadout-section-heading">
              <div>
                <span>Custom</span>
                <strong>Your deck recipes</strong>
              </div>
              <button className="secondary-link" type="button" onClick={() => onNavigate("/decks")}>
                <Layers size={18} />
                Manage
              </button>
            </div>
            <div className="loadout-grid">
              {deckLoadState?.status === "loading" ? <p className="notice">Loading deck library</p> : null}
              {accountDecks.map((deck) => {
                const loadout = accountDeckToLoadout(deck);
                return (
                  <LoadoutCard
                    key={loadout.id}
                    loadout={loadout}
                    selected={selectedLoadout?.id === loadout.id}
                    progression={progressionLoadState?.status === "ready" ? progressionLoadState.progression : null}
                    onSelect={handleSelectLoadout}
                    busy={busy}
                  />
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="home-setup-panel" aria-label="Match setup">
          {selectedLoadout ? (
            <div className="selected-loadout-summary">
              <span>Selected</span>
              <strong>{selectedLoadout.name}</strong>
              <small>{wizardTypeLabel(selectedLoadout.wizardType)} · {selectedLoadout.cardCount} cards</small>
            </div>
          ) : null}
          {progressionLoadState?.status === "ready" && selectedLoadout ? (
            <RuneSelector
              progression={progressionLoadState.progression}
              wizardType={selectedLoadout.wizardType}
              selectedRuneIds={selectedRuneIds}
              onChange={(runeIds) => void handleRuneChange(runeIds)}
            />
          ) : null}
          {!currentUser ? (
            <p className="notice">Sign in to equip runes, use custom deck recipes, and earn mastery.</p>
          ) : null}
          {progressionLoadState?.status === "error" ? (
            <p className="notice">{progressionLoadState.message}</p>
          ) : null}
          {deckLoadState?.status === "error" ? <p className="notice">{deckLoadState.message}</p> : null}
          {systemDeckLoadState.status === "error" ? (
            <p className="notice">{systemDeckLoadState.message}</p>
          ) : null}
          <div className="setup-deck-selectors" aria-label="AI opponent selection">
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
          </div>
        </section>

        <div className="picker-actions home-actions">
          <button
            className="primary-button"
            type="button"
            onClick={() => void handleCreateMatch()}
            disabled={busy || !selectedLoadout}
          >
            <Plus size={18} />
            New Solo Match
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => void handleCreateSharedMatch()}
            disabled={busy || !selectedLoadout}
          >
            <Users size={18} />
            New Multiplayer Match
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

function runeIdsForHomeLoadout(loadout: HomeLoadout, progression: ProgressionResponse | null) {
  if (loadout.kind === "system" && progression) {
    return defaultRuneIdsForWizard(progression, loadout.wizardType);
  }
  return loadout.runeIds;
}
