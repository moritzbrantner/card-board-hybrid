import { expect, test } from "@playwright/test";

const AUTH_TOKEN_STORAGE_KEY = "rune-lanes-auth-token";
const MATCH_ID = "solo-account-deck";
const SHARED_MATCH_ID = "shared-home-match";

test("AI deck selection remains visible with system and legal account deck recipes", async ({
  page,
}) => {
  const matchRequests = [];
  await page.addInitScript(
    ({ key }) => localStorage.setItem(key, "existing-token"),
    { key: AUTH_TOKEN_STORAGE_KEY },
  );
  await mockHomeApi(page, matchRequests);

  await page.goto("/");

  const aiDeckSelector = page.getByLabel("AI Deck");
  await expect(aiDeckSelector).toBeVisible();
  await expect(aiDeckSelector).toContainText("Balanced Starter");
  await expect(aiDeckSelector).toContainText("Tournament Legal");
  await expect(aiDeckSelector).toContainText("Default Legal");
  await expect(aiDeckSelector).not.toContainText("Needs More Basics");

  await aiDeckSelector.selectOption("account:101");
  await page.getByLabel("AI Wizard").selectOption("chronomancer");
  await page.getByRole("button", { name: "New Solo Match" }).click();

  await expect(page).toHaveURL(new RegExp(`/match/${MATCH_ID}$`));
  expect(matchRequests).toEqual([
    {
      wizardType: "runekeeper",
      playerDeckId: 102,
      aiOpponent: { source: "account", deckId: 101, wizardType: "chronomancer" },
    },
  ]);
});

test("signed-in players choose account deck recipes for solo match creation", async ({
  page,
}) => {
  const matchRequests = [];
  await page.addInitScript(
    ({ key }) => localStorage.setItem(key, "existing-token"),
    { key: AUTH_TOKEN_STORAGE_KEY },
  );
  await mockHomeApi(page, matchRequests);

  await page.goto("/");

  const deckSelector = page.getByLabel("Your Deck Recipe");
  await expect(deckSelector).toHaveValue("102");
  await expect(deckSelector).toContainText("Tournament Legal");
  await expect(deckSelector).toContainText("Needs More Basics");
  await expect(deckSelector).not.toContainText("Starter");
  await expect(deckSelector).not.toContainText("Balanced Starter");

  const draftOption = deckSelector.getByRole("option", { name: /Needs More Basics/ });
  await expect(draftOption).toHaveAttribute("disabled", "");
  await expect(draftOption).toContainText("Draft - cannot start a match");

  await deckSelector.selectOption("101");
  await page.getByLabel("Wizard type").getByRole("button", { name: /Pyromancer/ }).click();
  await page.getByRole("button", { name: /Spark Stone/ }).click();
  await page.getByRole("button", { name: "New Solo Match" }).click();

  await expect(page).toHaveURL(new RegExp(`/match/${MATCH_ID}$`));
  expect(matchRequests).toEqual([
    {
      wizardType: "pyromancer",
      playerDeckId: 101,
      aiOpponent: { source: "system", systemDeckId: "balanced-starter" },
      runeIds: ["spark-stone"],
    },
  ]);
});

test("signed-in players without legal deck recipes create solo matches through the hidden starter fallback", async ({
  page,
}) => {
  const matchRequests = [];
  await page.addInitScript(
    ({ key }) => localStorage.setItem(key, "existing-token"),
    { key: AUTH_TOKEN_STORAGE_KEY },
  );
  await mockHomeApi(page, matchRequests, {
    decks: [deckRecipe(103, "Needs More Basics", false, false)],
  });

  await page.goto("/");

  const deckSelector = page.getByLabel("Your Deck Recipe");
  await expect(deckSelector).toContainText("Needs More Basics");
  await expect(deckSelector).not.toContainText("Starter");
  await expect(deckSelector).not.toContainText("Balanced Starter");
  await expect(page.getByText("Create or repair a deck recipe before choosing a custom player deck.")).toBeVisible();
  await expect(
    page.getByLabel("Deck selection").getByRole("button", { name: "Decks" }),
  ).toBeVisible();

  await page.getByLabel("Wizard type").getByRole("button", { name: /Pyromancer/ }).click();
  await page.getByRole("button", { name: /Spark Stone/ }).click();
  await page.getByRole("button", { name: "New Solo Match" }).click();

  await expect(page).toHaveURL(new RegExp(`/match/${MATCH_ID}$`));
  expect(matchRequests).toEqual([
    {
      wizardType: "pyromancer",
      aiOpponent: { source: "system", systemDeckId: "balanced-starter" },
      runeIds: ["spark-stone"],
    },
  ]);
});

test("anonymous players create solo matches without account deck controls or visible starter fallback", async ({
  page,
}) => {
  const matchRequests = [];
  await mockHomeApi(page, matchRequests, { signedIn: false });

  await page.goto("/");

  await expect(page.getByLabel("Your Deck Recipe")).toHaveCount(0);
  await expect(page.getByText("Sign in to use your deck recipes")).toHaveCount(0);
  await expect(page.getByText("No account deck recipes")).toHaveCount(0);

  await page.getByLabel("Wizard type").getByRole("button", { name: /Chronomancer/ }).click();
  await page.getByRole("button", { name: "New Solo Match" }).click();

  await expect(page).toHaveURL(new RegExp(`/match/${MATCH_ID}$`));
  expect(matchRequests).toEqual([
    {
      wizardType: "chronomancer",
      aiOpponent: { source: "system", systemDeckId: "balanced-starter" },
    },
  ]);
});

test("home screen creates a shared match from the multiplayer action", async ({ page }) => {
  const matchRequests = [];
  const sharedMatchRequests = [];
  await page.addInitScript(
    ({ key }) => localStorage.setItem(key, "existing-token"),
    { key: AUTH_TOKEN_STORAGE_KEY },
  );
  await mockHomeApi(page, matchRequests, { sharedMatchRequests });

  await page.goto("/");

  await page.getByLabel("Wizard type").getByRole("button", { name: /Chronomancer/ }).click();
  await page.getByRole("button", { name: /Spark Stone/ }).click();
  await page.getByRole("button", { name: "New Multiplayer Match" }).click();

  await expect(page).toHaveURL(new RegExp(`/match/${SHARED_MATCH_ID}/player-seat$`));
  expect(sharedMatchRequests).toEqual([{ wizardType: "chronomancer" }]);
  expect(matchRequests).toEqual([]);
  expect(
    await page.evaluate((matchId) => sessionStorage.getItem(`rune-lanes-wizard:${matchId}`), SHARED_MATCH_ID),
  ).toBe("chronomancer");
  expect(
    await page.evaluate((matchId) => sessionStorage.getItem(`rune-lanes-runes:${matchId}`), SHARED_MATCH_ID),
  ).toBe(JSON.stringify(["spark-stone"]));
});

async function mockHomeApi(page, matchRequests, options = {}) {
  const signedIn = options.signedIn ?? true;
  const sharedMatchRequests = options.sharedMatchRequests ?? [];
  const decks =
    "decks" in options
      ? options.decks
      : [
          deckRecipe(101, "Tournament Legal", false, true),
          deckRecipe(102, "Default Legal", true, true),
          deckRecipe(103, "Needs More Basics", false, false),
        ];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/api/auth/me") {
      if (signedIn) {
        await route.fulfill({ json: authUser() });
      } else {
        await route.fulfill({ status: 401, json: { message: "Not authenticated" } });
      }
      return;
    }

    if (url.pathname === "/api/preferences") {
      await route.fulfill({ json: preferences() });
      return;
    }

    if (url.pathname === "/api/decks") {
      if (!signedIn) {
        await route.fulfill({ status: 401, json: { message: "Not authenticated" } });
        return;
      }
      await route.fulfill({
        json: {
          rules: deckRules(),
          decks,
        },
      });
      return;
    }

    if (url.pathname === "/api/system-decks") {
      await route.fulfill({
        json: { rules: deckRules(), decks: [systemDeck()] },
      });
      return;
    }

    if (url.pathname === "/api/progression") {
      if (!signedIn) {
        await route.fulfill({ status: 401, json: { message: "Not authenticated" } });
        return;
      }
      await route.fulfill({ json: progression() });
      return;
    }

    if (url.pathname === "/api/matches" && request.method() === "POST") {
      matchRequests.push(JSON.parse(request.postData() ?? "{}"));
      await route.fulfill({ json: matchResponse(playableMatch()) });
      return;
    }

    if (url.pathname === "/api/shared-matches" && request.method() === "POST") {
      sharedMatchRequests.push(JSON.parse(request.postData() ?? "{}"));
      await route.fulfill({
        json: {
          matchId: SHARED_MATCH_ID,
          mode: "shared",
          status: "setup",
          viewerSide: "player",
          playerSeatUrl: `/match/${SHARED_MATCH_ID}/player-seat`,
          inviteSeatUrl: `/match/${SHARED_MATCH_ID}/opponent-seat`,
        },
      });
      return;
    }

    if (url.pathname === `/api/matches/${MATCH_ID}` && request.method() === "GET") {
      await route.fulfill({ json: matchResponse(playableMatch()) });
      return;
    }

    if (url.pathname === "/api/profile/matches" || url.pathname === "/api/matches") {
      await route.fulfill({ json: { matches: [] } });
      return;
    }

    if (url.pathname === "/api/catalog/cards") {
      await route.fulfill({ json: { cards: [] } });
      return;
    }

    await route.fulfill({ status: 404, json: { message: "Not found" } });
  });
}

function authUser() {
  return {
    id: 1,
    email: "player@local.dev",
    displayName: "Rune Player",
    avatar: { symbol: "sparkles", color: "emerald" },
    preferredWizardType: "runekeeper",
    boardVisualMode: "2d",
    progressionSummary: {
      totalXp: 0,
      level: 1,
      currentLevelXp: 0,
      nextLevelXp: 100,
      xpIntoLevel: 0,
      xpToNextLevel: 100,
      runeSlots: 1,
    },
  };
}

function preferences() {
  return {
    theme: "system",
    motion: "system",
    animationSpeed: "normal",
    boardScale: "normal",
    boardVisualMode: "2d",
    hotkeys: [],
    updatedAt: 10,
  };
}

function deckRules() {
  return {
    maxDecksPerAccount: 30,
    minCards: 30,
    basicCopyLimit: 99,
    advancedCopyLimit: 3,
    rareCopyLimit: 1,
    advancedTotalLimit: 10,
    rareTotalLimit: 4,
  };
}

function deckRecipe(id, name, isDefault, legal) {
  return {
    id,
    name,
    isDefault,
    cards: [],
    legality: {
      legal,
      totalCards: legal ? 30 : 12,
      basicCards: legal ? 30 : 12,
      advancedCards: 0,
      rareCards: 0,
      messages: legal ? [] : ["Add 18 more cards."],
    },
    createdAt: 10,
    updatedAt: 20,
  };
}

function systemDeck() {
  return {
    id: "balanced-starter",
    name: "Balanced Starter",
    wizardType: "runekeeper",
    cards: [],
    legality: {
      legal: true,
      totalCards: 30,
      basicCards: 30,
      advancedCards: 0,
      rareCards: 0,
      messages: [],
    },
  };
}

function progression() {
  return {
    account: {
      totalXp: 0,
      level: 2,
      currentLevelXp: 100,
      nextLevelXp: 250,
      xpIntoLevel: 10,
      xpToNextLevel: 140,
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
    wizards: [],
    skillTrees: [],
    loadouts: [
      { wizardType: "runekeeper", runeIds: [] },
      { wizardType: "pyromancer", runeIds: [] },
    ],
  };
}

function matchResponse(matchState) {
  return { matchId: MATCH_ID, matchState, replayFrames: [] };
}

function playableMatch() {
  return {
    mode: "solo",
    round: 1,
    phase: "planning",
    activeSide: "player",
    prioritySide: null,
    player: participant("player"),
    opponent: participant("opponent"),
    board: { radius: 3, tiles: radiusThreeTiles(), units: [], droppedItems: [] },
    actionStack: [],
    log: [],
    winner: null,
  };
}

function participant(side) {
  return {
    side,
    mana: 5,
    maxMana: 5,
    wizard: {
      id: `${side}-wizard`,
      side,
      wizardType: side === "player" ? "pyromancer" : "runekeeper",
      hp: 20,
      maxHp: 20,
      attack: 1,
      position: side === "player" ? { q: 0, r: 3 } : { q: 0, r: -3 },
      apRemaining: side === "player" ? 3 : 0,
      maxAp: 3,
      hasAttacked: false,
    },
    hand: [],
    handCount: 0,
    deckCount: 40,
    discardCount: 0,
    progression: {
      runeIds: [],
      skillIds: [],
      effects: {
        maxHpDelta: 0,
        attackDelta: 0,
        maxApDelta: 0,
        manaDelta: 0,
        openingHandDelta: 0,
        summonedUnitArmorDelta: 0,
        firstSummonedUnitArmorDelta: 0,
        spellDamageDelta: 0,
      },
    },
  };
}

function radiusThreeTiles() {
  const tiles = [];
  for (let q = -3; q <= 3; q += 1) {
    const minR = Math.max(-3, -q - 3);
    const maxR = Math.min(3, -q + 3);
    for (let r = minR; r <= maxR; r += 1) {
      tiles.push({ coord: { q, r } });
    }
  }
  return tiles;
}
