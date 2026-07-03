import { expect, test } from "@playwright/test";

const MATCH_ID = "e2e-3d-board";
const BOARD_VISUAL_MODE_STORAGE_KEY = "rune-lanes-board-visual-mode";

test("moves and attacks through the 3D board", async ({ page }) => {
  await useStoredBoardVisualMode(page, "3d");
  let match = playableMatch({
    playerWizard: { q: 0, r: 1 },
    opponentWizard: { q: 1, r: 1 },
  });
  const actions = [];

  await mockMatchApi(page, async (action) => {
    actions.push(action);
    if (action.type === "movePiece") {
      match = playableMatch({
        playerWizard: action.to,
        opponentWizard: { q: 1, r: 1 },
      });
    }

    if (action.type === "attack") {
      match = playableMatch({
        playerWizard: { q: 0, r: 1 },
        opponentWizard: { q: 1, r: 1 },
      });
    }

    return matchResponse(match);
  }, () => match);

  await page.goto(`/match/${MATCH_ID}`);
  await expect(page.locator('section[data-board-renderer="3d"]')).toBeVisible();

  await tile(page, "q 0, r 1, occupied by your wizard").click();
  await expect(tile(page, "q 0, r 0, empty hex")).toHaveAttribute("data-legal", "true");
  await tile(page, "q 0, r 0, empty hex").click();
  await expect.poll(() => actions).toEqual(
    expect.arrayContaining([
      {
        type: "movePiece",
        pieceId: "player-wizard",
        to: { q: 0, r: 0 },
      },
    ]),
  );

  actions.length = 0;
  match = playableMatch({
    playerWizard: { q: 0, r: 1 },
    opponentWizard: { q: 1, r: 1 },
  });
  await page.reload();
  await tile(page, "q 0, r 1, occupied by your wizard").click();
  await expect(tile(page, "q 1, r 1, occupied by the opponent's wizard")).toHaveAttribute(
    "data-legal",
    "true",
  );
  await tile(page, "q 1, r 1, occupied by the opponent's wizard").click();

  await expect.poll(() => actions).toEqual(
    expect.arrayContaining([
      {
        type: "attack",
        attackerId: "player-wizard",
        targetId: "opponent-wizard",
      },
    ]),
  );
});

test("plays unit and spell card targets through the 3D board", async ({ page }) => {
  await useStoredBoardVisualMode(page, "3d");
  let match = playableMatch({
    playerWizard: { q: 0, r: 1 },
    opponentWizard: { q: 1, r: 1 },
    hand: [emberSquire(), sparkJolt()],
  });
  const actions = [];

  await mockMatchApi(page, async (action) => {
    actions.push(action);
    if (action.type === "playCard" && action.cardId === "ember-squire-card") {
      match = playableMatch({
        playerWizard: { q: 0, r: 1 },
        opponentWizard: { q: 1, r: 1 },
        hand: [sparkJolt()],
        units: [ashScout({ q: 0, r: 0 })],
      });
    }

    return matchResponse(match);
  }, () => match);

  await page.goto(`/match/${MATCH_ID}`);
  await page.getByRole("button", { name: /Ember Squire/ }).click();
  await expect(tile(page, "q 0, r 0, empty hex")).toHaveAttribute("data-legal", "true");
  await tile(page, "q 0, r 0, empty hex").click();
  await expect.poll(() => actions).toEqual(
    expect.arrayContaining([
      {
        type: "playCard",
        cardId: "ember-squire-card",
        target: { type: "hex", coord: { q: 0, r: 0 } },
      },
    ]),
  );

  await page.getByRole("button", { name: /Spark Jolt/ }).click();
  await expect(tile(page, "q 1, r 1, occupied by the opponent's wizard")).toHaveAttribute(
    "data-legal",
    "true",
  );
  await tile(page, "q 1, r 1, occupied by the opponent's wizard").click();
  await expect.poll(() => actions).toEqual(
    expect.arrayContaining([
      {
        type: "playCard",
        cardId: "spark-jolt-card",
        target: { type: "piece", pieceId: "opponent-wizard" },
      },
    ]),
  );
});

test("respects disabled state, context menus, visible counts, and replay read-only in 3D mode", async ({
  page,
}) => {
  await useStoredBoardVisualMode(page, "3d");
  let match = playableMatch({
    phase: "matchOver",
    playerWizard: { q: 0, r: 1 },
    opponentWizard: { q: 1, r: 1 },
    units: [ashScout({ q: 0, r: 0 })],
  });
  const actions = [];

  await mockMatchApi(page, async (action) => {
    actions.push(action);
    return matchResponse(match);
  }, () => match);

  await page.goto(`/match/${MATCH_ID}`);
  await expect(tile(page, "q 0, r 1, occupied by your wizard")).toBeDisabled();
  await tile(page, "q 0, r 1, occupied by your wizard").click({ force: true });
  expect(actions).toEqual([]);

  match = playableMatch({
    playerWizard: { q: 0, r: 1 },
    opponentWizard: { q: 1, r: 1 },
    units: [ashScout({ q: 0, r: 0 })],
  });
  await page.reload();
  await expect(tile(page, "q 0, r 0, occupied by your unit")).toContainText("1/2 AP 2");
  await tile(page, "q 0, r 0, occupied by your unit").click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Ash Scout actions" })).toBeVisible();

  await mockReplayApi(page, match);
  await page.goto(`/matches/${MATCH_ID}/replay`);
  await expect(page.locator('section[data-board-renderer="3d"]')).toBeVisible();
  await expect(tile(page, "q 0, r 1, occupied by your wizard")).toHaveAttribute("tabindex", "-1");
  await tile(page, "q 0, r 1, occupied by your wizard").click({ force: true });
  expect(actions).toEqual([]);
});

test("persists Board visual mode switches locally", async ({ page }) => {
  await useStoredBoardVisualMode(page, "3d");
  const match = playableMatch({
    playerWizard: { q: 0, r: 1 },
    opponentWizard: { q: 1, r: 1 },
  });

  await mockMatchApi(page, async () => matchResponse(match), () => match);

  await page.goto(`/match/${MATCH_ID}`);
  await page.getByRole("button", { name: "2D" }).click();
  await expect(page.locator('section[data-board-renderer="2d"]')).toBeVisible();
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), BOARD_VISUAL_MODE_STORAGE_KEY))
    .toBe("2d");

  await page.reload();
  await expect(page.locator('section[data-board-renderer="2d"]')).toBeVisible();
});

test("falls back to playable 2D when WebGL cannot start", async ({ page }) => {
  await useStoredBoardVisualMode(page, "3d");
  await page.addInitScript(() => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function patchedGetContext(type, ...args) {
      if (String(type).includes("webgl")) {
        return null;
      }

      return originalGetContext.call(this, type, ...args);
    };
  });

  let match = playableMatch({
    playerWizard: { q: 0, r: 1 },
    opponentWizard: { q: 1, r: 1 },
  });
  const actions = [];

  await mockMatchApi(page, async (action) => {
    actions.push(action);
    if (action.type === "movePiece") {
      match = playableMatch({
        playerWizard: action.to,
        opponentWizard: { q: 1, r: 1 },
      });
    }

    return matchResponse(match);
  }, () => match);

  await page.goto(`/match/${MATCH_ID}`);
  await expect(page.locator('section[data-board-renderer="2d"]')).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "3D board unavailable, using 2D." })).toBeVisible();

  await tile(page, "q 0, r 1, occupied by your wizard").click();
  await expect(tile(page, "q 0, r 0, empty hex")).toHaveClass(/legal/);
  await tile(page, "q 0, r 0, empty hex").click();
  await expect.poll(() => actions).toEqual(
    expect.arrayContaining([
      {
        type: "movePiece",
        pieceId: "player-wizard",
        to: { q: 0, r: 0 },
      },
    ]),
  );
});

test("keeps reduced-motion first-time visitors on the 2D board", async ({ page }) => {
  await page.addInitScript(({ key }) => {
    localStorage.removeItem(key);
    window.matchMedia = (query) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    });
  }, { key: BOARD_VISUAL_MODE_STORAGE_KEY });
  const match = playableMatch({
    playerWizard: { q: 0, r: 1 },
    opponentWizard: { q: 1, r: 1 },
  });

  await mockMatchApi(page, async () => matchResponse(match), () => match);

  await page.goto(`/match/${MATCH_ID}`);
  await expect(page.locator('section[data-board-renderer="2d"]')).toBeVisible();
  await expect(page.locator(".piece-token[class*='piece-anim-']")).toHaveCount(0);
});

test("shows marker fallback notice when configured 3D models fail to load", async ({ page }) => {
  await useStoredBoardVisualMode(page, "3d");
  const match = playableMatch({
    playerWizard: { q: 0, r: 1 },
    opponentWizard: { q: 1, r: 1 },
  });

  await mockMatchApi(page, async () => matchResponse(match), () => match);

  await page.goto(`/match/${MATCH_ID}`);
  await expect(page.locator('section[data-board-renderer="3d"]')).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "fallback markers are shown" })).toBeVisible();
  await expect(tile(page, "q 0, r 1, occupied by your wizard")).toBeVisible();
});

function tile(page, name) {
  return page.getByRole("button", { name });
}

async function useStoredBoardVisualMode(page, mode) {
  await page.addInitScript(
    ({ key, mode }) => {
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, mode);
      }
    },
    { key: BOARD_VISUAL_MODE_STORAGE_KEY, mode },
  );
}

async function mockMatchApi(page, handleAction, currentMatch) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/api/auth/me") {
      await route.fulfill({ status: 401, json: { message: "Signed out" } });
      return;
    }

    if (url.pathname === "/api/catalog/cards") {
      await route.fulfill({ json: { cards: [catalogCard(emberSquire()), catalogCard(sparkJolt())] } });
      return;
    }

    if (url.pathname === `/api/matches/${MATCH_ID}` && request.method() === "GET") {
      await route.fulfill({ json: matchResponse(currentMatch()) });
      return;
    }

    if (url.pathname === `/api/matches/${MATCH_ID}/actions` && request.method() === "POST") {
      const action = JSON.parse(request.postData() ?? "{}");
      await route.fulfill({ json: await handleAction(action) });
      return;
    }

    await route.fulfill({ status: 404, json: { message: "Not found" } });
  });
}

async function mockReplayApi(page, match) {
  await page.unroute("**/api/**");
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/api/auth/me") {
      await route.fulfill({ status: 401, json: { message: "Signed out" } });
      return;
    }

    if (url.pathname === `/api/matches/${MATCH_ID}/replay` && request.method() === "GET") {
      await route.fulfill({
        json: {
          matchId: MATCH_ID,
          visibility: "public",
          summary: {
            matchId: MATCH_ID,
            createdAt: 0,
            updatedAt: 0,
            round: 1,
            phase: "planning",
            winner: null,
            frameCount: 1,
          },
          frames: [{ frameIndex: 0, actionIndex: null, event: { type: "matchCreated" }, matchState: match }],
        },
      });
      return;
    }

    await route.fulfill({ status: 404, json: { message: "Not found" } });
  });
}

function matchResponse(matchState) {
  return {
    matchId: MATCH_ID,
    matchState,
    replayFrames: [],
  };
}

function playableMatch({
  activeSide = "player",
  phase = "planning",
  playerWizard,
  opponentWizard,
  hand = [],
  units = [],
}) {
  return {
    mode: "solo",
    round: 1,
    phase,
    activeSide,
    prioritySide: null,
    player: {
      side: "player",
      mana: 5,
      maxMana: 5,
      wizard: {
        id: "player-wizard",
        side: "player",
        wizardType: "runekeeper",
        hp: 20,
        maxHp: 20,
        attack: 1,
        position: playerWizard,
        apRemaining: activeSide === "player" ? 3 : 0,
        maxAp: 3,
        hasAttacked: false,
      },
      hand,
      handCount: hand.length,
      deckCount: 40,
      discardCount: 0,
    },
    opponent: {
      side: "opponent",
      mana: 5,
      maxMana: 5,
      wizard: {
        id: "opponent-wizard",
        side: "opponent",
        wizardType: "pyromancer",
        hp: 20,
        maxHp: 20,
        attack: 1,
        position: opponentWizard,
        apRemaining: activeSide === "opponent" ? 3 : 0,
        maxAp: 3,
        hasAttacked: false,
      },
      handCount: 0,
      deckCount: 40,
      discardCount: 0,
    },
    board: {
      radius: 3,
      tiles: radiusThreeTiles(),
      units,
    },
    actionStack: [],
    log: [],
    winner: phase === "matchOver" ? "opponent" : null,
  };
}

function emberSquire() {
  return {
    id: "ember-squire-card",
    templateId: "ember-squire",
    name: "Ember Squire",
    rarity: "basic",
    cost: 1,
    text: "Summon a unit.",
    kind: { type: "unit", attack: 1, armor: 2, maxAp: 2 },
  };
}

function sparkJolt() {
  return {
    id: "spark-jolt-card",
    templateId: "spark-jolt",
    name: "Spark Jolt",
    rarity: "basic",
    cost: 1,
    text: "Deal 1 damage.",
    kind: { type: "spell", range: 2, priority: 1, effect: { type: "damage", amount: 1 } },
  };
}

function ashScout(position) {
  return {
    id: "ash-scout",
    side: "player",
    name: "Ash Scout",
    templateId: "ember-squire",
    attack: 1,
    armor: 2,
    maxArmor: 2,
    position,
    apRemaining: 2,
    maxAp: 2,
    hasAttacked: false,
  };
}

function catalogCard(card) {
  return {
    ...card,
    copyCount: 1,
    artKey: card.templateId,
    artPath: "",
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
