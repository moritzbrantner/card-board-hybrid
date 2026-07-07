// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDecks, loadProfileMatches, loadProgression } from "../api";
import type {
  AuthUser,
  DeckListResponse,
  DeckRecipeSummary,
  MatchArchiveResponse,
  MatchSummary,
  ProgressionResponse,
  HeroType,
} from "../types";
import { DashboardPage } from "./DashboardPage";

vi.mock("../api", () => ({
  loadDecks: vi.fn(),
  loadProfileMatches: vi.fn(),
  loadProgression: vi.fn(),
}));

vi.mock("../HeroPreview3D", () => ({
  HeroPreview3D: ({ label }: { label: string }) => <div>{label} 3D preview</div>,
}));

afterEach(() => cleanup());

beforeEach(() => {
  vi.mocked(loadDecks).mockResolvedValue(deckResponse([deckRecipe(101, "Default Legal", "runekeeper", true)]));
  vi.mocked(loadProgression).mockResolvedValue(progressionResponse());
  vi.mocked(loadProfileMatches).mockResolvedValue(matchArchiveResponse([matchSummary()]));
});

describe("DashboardPage", () => {
  it("shows the default legal deck's Hero preview on the signed-in dashboard", async () => {
    renderDashboard();

    const featuredDeck = await screen.findByRole("region", { name: "Featured configured deck recipe" });

    expect(within(featuredDeck).getByText("Default Legal")).toBeInTheDocument();
    expect(within(featuredDeck).getByText("Runekeeper 3D preview")).toBeInTheDocument();
    expect(within(featuredDeck).getByText("Legal")).toBeInTheDocument();
  });

  it("falls back to the first legal deck when the default deck is a draft", async () => {
    vi.mocked(loadDecks).mockResolvedValue(
      deckResponse([
        deckRecipe(101, "Draft Default", "runekeeper", true, false),
        deckRecipe(102, "Tournament Legal", "pyromancer", false),
      ]),
    );

    renderDashboard();

    const featuredDeck = await screen.findByRole("region", { name: "Featured configured deck recipe" });

    expect(within(featuredDeck).getByText("Tournament Legal")).toBeInTheDocument();
    expect(within(featuredDeck).getByText("Pyromancer 3D preview")).toBeInTheDocument();
    expect(within(featuredDeck).queryByText("Draft Default")).not.toBeInTheDocument();
  });

  it("shows an empty featured deck state when no legal deck recipe exists", async () => {
    vi.mocked(loadDecks).mockResolvedValue(
      deckResponse([deckRecipe(101, "Draft Default", "runekeeper", true, false)]),
    );
    const onNavigate = vi.fn();

    renderDashboard({ onNavigate });

    const featuredDeck = await screen.findByRole("region", { name: "Featured configured deck recipe" });
    fireEvent.click(within(featuredDeck).getByRole("button", { name: "Open Decks" }));

    expect(within(featuredDeck).getByText("No legal configured deck recipe")).toBeInTheDocument();
    expect(onNavigate).toHaveBeenCalledWith("/decks");
  });

  it("routes from featured dashboard actions to Play, Decks, and Profile", async () => {
    const onNavigate = vi.fn();
    const { container } = renderDashboard({ onNavigate });

    await screen.findByRole("region", { name: "Featured configured deck recipe" });
    const featuredDashboard = container.querySelector(".dashboard-featured");
    if (!featuredDashboard) {
      throw new Error("Expected featured dashboard section to render");
    }

    fireEvent.click(within(featuredDashboard as HTMLElement).getByRole("button", { name: "Play" }));
    fireEvent.click(within(featuredDashboard as HTMLElement).getAllByRole("button", { name: /Decks|Manage Deck Recipe/ })[0]);
    fireEvent.click(within(featuredDashboard as HTMLElement).getByRole("button", { name: "Profile" }));

    expect(onNavigate).toHaveBeenCalledWith("/play");
    expect(onNavigate).toHaveBeenCalledWith("/decks");
    expect(onNavigate).toHaveBeenCalledWith("/profile");
  });

  it("keeps recent match and open-match-by-ID dashboard workflows", async () => {
    const onNavigate = vi.fn();

    renderDashboard({ onNavigate });

    expect(await screen.findByText("rl-recent-1")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Open Match by ID"), { target: { value: "rl-manual-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("/match/rl-manual-2"));
  });
});

function renderDashboard({
  currentUser = authUser(),
  onNavigate = vi.fn(),
  onSignOut = vi.fn(),
}: {
  currentUser?: AuthUser;
  onNavigate?: (to: string) => void;
  onSignOut?: () => void;
} = {}) {
  return render(
    <DashboardPage currentUser={currentUser} onNavigate={onNavigate} onSignOut={onSignOut} />,
  );
}

function authUser(): AuthUser {
  return {
    id: 1,
    handle: "player-one",
    email: "player@example.com",
    displayName: "Player One",
    avatar: {
      symbol: "star",
      color: "#58b7a1",
    },
    preferredHeroType: "runekeeper",
    boardVisualMode: "3d",
    progressionSummary: {
      totalXp: 120,
      level: 2,
      currentLevelXp: 100,
      nextLevelXp: 250,
      xpIntoLevel: 20,
      xpToNextLevel: 130,
      runeSlots: 1,
    },
  };
}

function deckResponse(decks: DeckRecipeSummary[]): DeckListResponse {
  return {
    rules: {
      maxDecksPerAccount: 30,
      minCards: 30,
      basicCopyLimit: 5,
      advancedCopyLimit: 4,
      rareCopyLimit: 3,
      advancedTotalLimit: 12,
      rareTotalLimit: 6,
    },
    decks,
  };
}

function deckRecipe(
  id: number,
  name: string,
  heroType: HeroType,
  isDefault: boolean,
  legal = true,
): DeckRecipeSummary {
  return {
    id,
    name,
    isDefault,
    heroType,
    runeIds: legal ? ["spark-stone"] : [],
    cards: [],
    legality: {
      legal,
      totalCards: legal ? 30 : 12,
      basicCards: legal ? 30 : 12,
      advancedCards: 0,
      rareCards: 0,
      messages: legal ? [] : ["Deck recipe needs 30 cards."],
    },
    createdAt: 1,
    updatedAt: 2,
  };
}

function progressionResponse(): ProgressionResponse {
  return {
    account: {
      totalXp: 120,
      level: 2,
      currentLevelXp: 100,
      nextLevelXp: 250,
      xpIntoLevel: 20,
      xpToNextLevel: 130,
      runeSlots: 1,
    },
    runes: [
      {
        id: "spark-stone",
        name: "Spark Stone",
        text: "Start with a brighter spark.",
        unlockLevel: 1,
        unlocked: true,
      },
    ],
    heroes: [
      {
        heroType: "runekeeper",
        xp: 40,
        level: 1,
        currentLevelXp: 0,
        nextLevelXp: 100,
        xpIntoLevel: 40,
        xpToNextLevel: 60,
        totalSkillPoints: 0,
        spentSkillPoints: 0,
        availableSkillPoints: 0,
        unlockedSkillIds: [],
      },
    ],
    skillTrees: [],
    loadouts: [],
    heroAppearances: [],
  };
}

function matchArchiveResponse(matches: MatchSummary[]): MatchArchiveResponse {
  return { matches };
}

function matchSummary(): MatchSummary {
  return {
    matchId: "rl-recent-1",
    mode: "solo",
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_400,
    round: 3,
    phase: "planning",
    winner: null,
    frameCount: 12,
  };
}
