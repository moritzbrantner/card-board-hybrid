import { expect, test } from "@playwright/test";

const AUTH_TOKEN_STORAGE_KEY = "rune-lanes-auth-token";
const BOARD_VISUAL_MODE_STORAGE_KEY = "rune-lanes-board-visual-mode";
const MATCH_CHROME_STORAGE_KEY = "rune-lanes-match-chrome-minimized";
const MATCH_ID = "shared-cursor";
const PLAYER_SEAT_TOKEN = "player-seat";
const OPPONENT_SEAT_TOKEN = "opponent-seat";

test("shared active matches use persistent full-screen collapsible chrome", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installSharedWebSocket(page);
  await page.addInitScript(
    ({ authKey, boardKey, chromeKey }) => {
      localStorage.removeItem(authKey);
      localStorage.setItem(boardKey, "3d");
      localStorage.removeItem(chromeKey);
    },
    {
      authKey: AUTH_TOKEN_STORAGE_KEY,
      boardKey: BOARD_VISUAL_MODE_STORAGE_KEY,
      chromeKey: MATCH_CHROME_STORAGE_KEY,
    },
  );
  await mockSharedApi(page, { signedIn: false });

  await page.goto(`/match/${MATCH_ID}/${PLAYER_SEAT_TOKEN}`);
  const board = page.getByRole("region", { name: "Hex board" });
  const boardBox = await board.boundingBox();
  expect(boardBox.width).toBeGreaterThanOrEqual(1276);
  expect(boardBox.height).toBeGreaterThanOrEqual(716);
  await expect.poll(() => hasPainted3dCanvas(page)).toBe(true);
  await expect(page.getByText("You", { exact: true })).toBeVisible();
  await expect(page.getByText("Opponent", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "End Turn" })).toBeVisible();

  await page.getByRole("button", { name: "Minimize match chrome" }).click();
  await expect(page.getByRole("button", { name: "Restore match chrome" })).toBeVisible();
  await expect(page.getByRole("button", { name: "End Turn" })).toBeVisible();
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), MATCH_CHROME_STORAGE_KEY))
    .toBe("true");

  await page.reload();
  await expect(page.getByRole("button", { name: "Restore match chrome" })).toBeVisible();
  await expect(page.getByRole("button", { name: "End Turn" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 700 });
  await page.reload();
  const mobileBoardBox = await board.boundingBox();
  expect(mobileBoardBox.width).toBeGreaterThanOrEqual(386);
  expect(mobileBoardBox.height).toBeGreaterThanOrEqual(696);
  await expect(page.getByLabel("Hand", { exact: true })).toBeVisible();
});

test("signed-in shared seat links apply saved settings to cursor play", async ({ page }) => {
  await installSharedWebSocket(page);
  await page.addInitScript(
    ({ authKey, boardKey }) => {
      localStorage.setItem(authKey, "existing-token");
      localStorage.setItem(boardKey, "2d");
    },
    { authKey: AUTH_TOKEN_STORAGE_KEY, boardKey: BOARD_VISUAL_MODE_STORAGE_KEY },
  );
  await mockSharedApi(page, { signedIn: true, preferences: savedPreferences() });

  const preferencesLoaded = page.waitForResponse((response) =>
    response.url().endsWith("/api/preferences"),
  );
  await page.goto(`/match/${MATCH_ID}/${PLAYER_SEAT_TOKEN}`);
  await preferencesLoaded;

  await expect(page.getByRole("heading", { name: "Round 1" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-board-scale")))
    .toBe("large");
  await blurActiveElement(page);

  await page.keyboard.press("Enter");
  await page.keyboard.press("q");
  await page.waitForTimeout(150);
  await expect(
    page.locator('.hex-tile.keyboard-focused[aria-label="q 0, r 2, empty hex"]'),
  ).toHaveCount(0);

  await page.keyboard.press("u");
  await expect(
    page.locator('.hex-tile.keyboard-focused[aria-label="q 0, r 2, empty hex"]'),
  ).toBeVisible();

  await page.keyboard.press("Enter");
  await expect.poll(() => sharedActions(page)).toEqual([
    { type: "movePiece", pieceId: "player-hero", to: { q: 0, r: 2 } },
  ]);
});

test("signed-out settings save local board mode for shared seat links", async ({
  page,
}) => {
  await installSharedWebSocket(page);
  await page.addInitScript(
    ({ authKey, boardKey }) => {
      localStorage.removeItem(authKey);
      if (localStorage.getItem(boardKey) === null) {
        localStorage.setItem(boardKey, "3d");
      }
    },
    { authKey: AUTH_TOKEN_STORAGE_KEY, boardKey: BOARD_VISUAL_MODE_STORAGE_KEY },
  );
  const apiRequests = [];
  await mockSharedApi(page, { signedIn: false, apiRequests });

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByLabel("Board visual mode")).toHaveValue("3d");

  await page.getByLabel("Board visual mode").selectOption("2d");
  await page.getByRole("button", { name: "Save Settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();

  await page.goto(`/match/${MATCH_ID}/${PLAYER_SEAT_TOKEN}`);
  await expect(page.getByRole("heading", { name: "Round 1" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Board visual mode" })).toHaveCount(0);
  await expect(page.locator("[data-board-visual-mode='2d']")).toBeVisible();
  await blurActiveElement(page);

  await page.keyboard.press("Enter");
  await page.keyboard.press("q");
  await expect(
    page.locator('.hex-tile.keyboard-focused[aria-label="q 0, r 2, empty hex"]'),
  ).toBeVisible();
  await page.keyboard.press("Enter");

  await expect.poll(() => sharedActions(page)).toEqual([
    { type: "movePiece", pieceId: "player-hero", to: { q: 0, r: 2 } },
  ]);
  expect(apiRequests).not.toContain("/api/preferences");
});

test("shared cursor initializes to the opponent seat Hero and does not confirm off-turn", async ({
  page,
}) => {
  await installSharedWebSocket(page);
  await page.addInitScript(
    ({ authKey, boardKey }) => {
      localStorage.removeItem(authKey);
      localStorage.setItem(boardKey, "2d");
    },
    { authKey: AUTH_TOKEN_STORAGE_KEY, boardKey: BOARD_VISUAL_MODE_STORAGE_KEY },
  );
  await mockSharedApi(page, { signedIn: false });

  await page.goto(`/match/${MATCH_ID}/${OPPONENT_SEAT_TOKEN}`);
  await expect(page.getByRole("heading", { name: "Round 1" })).toBeVisible();
  await blurActiveElement(page);

  await page.keyboard.press("q");
  await expect(
    page.locator('.hex-tile.keyboard-focused[aria-label="q 0, r -3, occupied by your hero"]'),
  ).toBeVisible();

  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  await expect.poll(() => sharedActions(page)).toEqual([]);
});

async function installSharedWebSocket(page) {
  await page.addInitScript(() => {
    window.__sharedWsMessages = [];

    class FakeWebSocket extends EventTarget {
      static OPEN = 1;
      static CLOSED = 3;

      readyState = FakeWebSocket.OPEN;

      constructor(url) {
        super();
        this.url = url;
        window.__sharedWsUrl = url;
        window.setTimeout(() => this.dispatchEvent(new Event("open")), 0);
      }

      close() {
        this.readyState = FakeWebSocket.CLOSED;
        this.dispatchEvent(new Event("close"));
      }

      send(rawMessage) {
        window.__sharedWsMessages.push(JSON.parse(rawMessage));
      }
    }

    window.WebSocket = FakeWebSocket;
  });
}

async function mockSharedApi(page, { signedIn, preferences = defaultPreferences(), apiRequests = [] }) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    apiRequests.push(url.pathname);

    if (url.pathname === "/api/auth/me") {
      if (signedIn) {
        await route.fulfill({ json: authUser() });
      } else {
        await route.fulfill({ status: 401, json: { message: "Not signed in" } });
      }
      return;
    }

    if (url.pathname === "/api/preferences") {
      await route.fulfill({ json: preferences });
      return;
    }

    if (url.pathname === "/api/catalog/cards") {
      await route.fulfill({ json: { cards: [] } });
      return;
    }

    if (url.pathname === "/api/decks") {
      await route.fulfill({ json: { rules: deckRules(), decks: [] } });
      return;
    }

    if (url.pathname === "/api/system-decks") {
      await route.fulfill({ json: { rules: deckRules(), decks: [systemDeck()] } });
      return;
    }

    if (url.pathname === "/api/progression") {
      await route.fulfill({ json: progression() });
      return;
    }

    const sharedMatch = sharedMatchFromPath(url.pathname);
    if (sharedMatch && request.method() === "GET") {
      await route.fulfill({ json: sharedMatchResponse(sharedMatch.viewerSide) });
      return;
    }

    await route.fulfill({ status: 404, json: { message: "Not found" } });
  });
}

function sharedMatchFromPath(pathname) {
  const playerPath = `/api/shared-matches/${MATCH_ID}/seats/${PLAYER_SEAT_TOKEN}`;
  const opponentPath = `/api/shared-matches/${MATCH_ID}/seats/${OPPONENT_SEAT_TOKEN}`;
  if (pathname === playerPath) {
    return { viewerSide: "player" };
  }
  if (pathname === opponentPath) {
    return { viewerSide: "opponent" };
  }
  return null;
}

async function blurActiveElement(page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
}

async function sharedActions(page) {
  return page.evaluate(() =>
    window.__sharedWsMessages
      .filter((message) => message.type === "action")
      .map((message) => message.action),
  );
}

async function hasPainted3dCanvas(page) {
  return page.locator(".board-3d-shell canvas").evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement) || canvas.width === 0 || canvas.height === 0) {
      return false;
    }

    const blankCanvas = document.createElement("canvas");
    blankCanvas.width = canvas.width;
    blankCanvas.height = canvas.height;
    return canvas.toDataURL("image/png") !== blankCanvas.toDataURL("image/png");
  });
}

function sharedMatchResponse(viewerSide = "player") {
  const matchState = playableMatch({ activeSide: "player" });
  return {
    matchId: MATCH_ID,
    mode: "shared",
    status: "active",
    viewerSide,
    viewerHeroType: viewerSide === "player" ? "runekeeper" : "pyromancer",
    opponentHeroType: viewerSide === "player" ? "pyromancer" : "runekeeper",
    viewerReady: true,
    opponentReady: true,
    activeSide: "player",
    opponentConnected: true,
    canClaimForfeitAt: null,
    matchState,
  };
}

function playableMatch({
  activeSide,
  actionStack = [],
  prioritySide = null,
  playerPosition = { q: 0, r: 3 },
  opponentPosition = { q: 0, r: -3 },
}) {
  return {
    mode: "shared",
    round: 1,
    phase: "planning",
    activeSide,
    prioritySide,
    player: participant("player", activeSide, playerPosition),
    opponent: participant("opponent", activeSide, opponentPosition),
    board: { radius: 3, tiles: radiusThreeTiles(), units: [], droppedItems: [] },
    actionStack,
    log: [],
    winner: null,
  };
}

function participant(side, activeSide, position) {
  return {
    side,
    mana: 5,
    maxMana: 5,
    hero: {
      id: `${side}-hero`,
      side,
      heroType: side === "player" ? "runekeeper" : "pyromancer",
      hp: 20,
      maxHp: 20,
      attack: 1,
      attackRange: 1,
      position,
      apRemaining: activeSide === side ? 3 : 0,
      maxAp: 3,
      hasAttacked: false,
    },
    hand: [],
    handCount: 0,
    deckCount: 40,
    discardCount: 0,
    progression: defaultProgression(),
  };
}

function savedPreferences() {
  return {
    ...defaultPreferences(),
    boardScale: "large",
    boardVisualMode: "2d",
    hotkeys: defaultPreferences().hotkeys.map((hotkey) =>
      hotkey.commandId === "cursorNorthwest" ? { ...hotkey, binding: "U" } : hotkey,
    ),
    updatedAt: 22,
  };
}

function defaultPreferences() {
  return {
    theme: "system",
    motion: "system",
    animationSpeed: "normal",
    boardScale: "normal",
    hotkeys: [
      { commandId: "cursorNorthwest", binding: "Q" },
      { commandId: "cursorNortheast", binding: "W" },
      { commandId: "cursorEast", binding: "E" },
      { commandId: "cursorWest", binding: "A" },
      { commandId: "cursorSouthwest", binding: "S" },
      { commandId: "cursorSoutheast", binding: "D" },
      { commandId: "confirm", binding: "Enter" },
      { commandId: "cancel", binding: "Escape" },
      { commandId: "endTurn", binding: "T" },
      { commandId: "passPriority", binding: "P" },
      { commandId: "openCardInfo", binding: "I" },
      { commandId: "openSettings", binding: "H" },
      { commandId: "openCatalog", binding: "C" },
      { commandId: "openDecks", binding: "K" },
      { commandId: "openMatchArchive", binding: "M" },
    ],
    updatedAt: 10,
  };
}

function authUser() {
  return {
    id: 1,
    handle: "rune-player",
    email: "player@local.dev",
    displayName: "Rune Player",
    avatar: { symbol: "sparkles", color: "emerald" },
    preferredHeroType: "runekeeper",
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

function systemDeck() {
  return {
    id: "balanced-starter",
    name: "Balanced Starter",
    heroType: "runekeeper",
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
      level: 1,
      currentLevelXp: 0,
      nextLevelXp: 100,
      xpIntoLevel: 0,
      xpToNextLevel: 100,
      runeSlots: 1,
    },
    runes: [],
    heroes: [],
    skillTrees: [],
    loadouts: [],
  };
}

function defaultProgression() {
  return {
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
