import { expect, test } from "@playwright/test";

const AUTH_TOKEN_STORAGE_KEY = "rune-lanes-auth-token";

test("signed-out players reach the login route from the visible Sign In action", async ({
  page,
}) => {
  await mockAuthApi(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
});

test("login submits credentials to the existing login API and opens a safe next path", async ({
  page,
}) => {
  const authRequests = [];
  await mockAuthApi(page, authRequests);

  await page.goto("/login?next=%2Fdecks");
  await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();

  await page.getByLabel("Email").fill("player@local.dev");
  await page.getByLabel("Password").fill("pw");
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page).toHaveURL(/\/decks$/);
  expect(authRequests).toEqual(["/api/auth/login"]);
});

for (const protectedPath of ["/profile", "/decks", "/matches"]) {
  test(`signed-out players visiting ${protectedPath} are redirected to login with next`, async ({
    page,
  }) => {
    await mockAuthApi(page);

    await page.goto(protectedPath);

    await expect(page).toHaveURL(/\/login\?/);
    expect(new URL(page.url()).searchParams.get("next")).toBe(protectedPath);
    await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
  });
}

for (const nextPath of ["/profile", "/settings", "/decks", "/matches"]) {
  test(`successful login from ${nextPath} lands on the requested protected route`, async ({
    page,
  }) => {
    await mockAuthApi(page);

    await page.goto(`/login?next=${encodeURIComponent(nextPath)}`);
    await page.getByLabel("Email").fill("player@local.dev");
    await page.getByLabel("Password").fill("pw");
    await page.getByRole("button", { name: "Sign In" }).click();

    await expect(page).toHaveURL(new RegExp(`${nextPath}$`));
  });
}

test("successful login with no safe next lands on profile", async ({ page }) => {
  await mockAuthApi(page);

  await page.goto("/login");
  await page.getByLabel("Email").fill("player@local.dev");
  await page.getByLabel("Password").fill("pw");
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page).toHaveURL(/\/profile$/);
});

test("/login/ behaves like the canonical login route", async ({
  page,
}) => {
  const authRequests = [];
  await mockAuthApi(page, authRequests);

  await page.goto("/login/?next=%2Fdecks");
  await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
  await page.getByLabel("Email").fill("player@local.dev");
  await page.getByLabel("Password").fill("pw");
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page).toHaveURL(/\/decks$/);
  expect(authRequests).toEqual(["/api/auth/login"]);
});

test("/register/ behaves like the canonical register route", async ({
  page,
}) => {
  const authRequests = [];
  await mockAuthApi(page, authRequests);

  await page.goto("/register/?next=%2Fmatches");
  await expect(page.getByRole("heading", { name: "Create Account" })).toBeVisible();
  await page.getByLabel("Email").fill("new-player@local.dev");
  await page.getByLabel("Password").fill("pw");
  await page.getByRole("button", { name: "Create Account" }).click();

  await expect(page).toHaveURL(/\/matches$/);
  expect(authRequests).toEqual(["/api/auth/register"]);
});

test("register submits credentials to the existing registration API and opens profile by default", async ({ page }) => {
  const authRequests = [];
  await mockAuthApi(page, authRequests);

  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Create Account" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Account" })).toBeVisible();

  await page.getByLabel("Email").fill("new-player@local.dev");
  await page.getByLabel("Password").fill("pw");
  await page.getByRole("button", { name: "Create Account" }).click();

  await expect(page).toHaveURL(/\/profile$/);
  expect(authRequests).toEqual(["/api/auth/register"]);
});

test("successful registration creates a session and opens a safe next path", async ({ page }) => {
  const authRequests = [];
  await mockAuthApi(page, authRequests);

  await page.goto("/register?next=%2Fmatches");
  await page.getByLabel("Email").fill("new-player@local.dev");
  await page.getByLabel("Password").fill("pw");
  await page.getByRole("button", { name: "Create Account" }).click();

  await expect(page).toHaveURL(/\/matches$/);
  expect(authRequests).toEqual(["/api/auth/register"]);
});

test("login and register links preserve a safe next parameter", async ({ page }) => {
  await mockAuthApi(page);

  await page.goto("/login?next=%2Fmatches%3Fview%3Drecent");
  await page.getByRole("link", { name: "Create a new account" }).click();

  await expect(page).toHaveURL(/\/register\?/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/matches?view=recent");
  await expect(page.getByRole("heading", { name: "Create Account" })).toBeVisible();

  await page.getByRole("link", { name: "I already have an account" }).click();

  await expect(page).toHaveURL(/\/login\?/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/matches?view=recent");
  await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
});

test("absolute URL next values fall back to profile after login", async ({ page }) => {
  await mockAuthApi(page);

  await page.goto("/login?next=https%3A%2F%2Fevil.test%2Fsteal");
  await page.getByLabel("Email").fill("player@local.dev");
  await page.getByLabel("Password").fill("pw");
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page).toHaveURL(/\/profile$/);
});

test("protocol-relative next values fall back to profile after registration", async ({ page }) => {
  await mockAuthApi(page);

  await page.goto("/register?next=%2F%2Fevil.test%2Fsteal");
  await page.getByLabel("Email").fill("new-player@local.dev");
  await page.getByLabel("Password").fill("pw");
  await page.getByRole("button", { name: "Create Account" }).click();

  await expect(page).toHaveURL(/\/profile$/);
});

test("signed-in visits to auth routes redirect to profile or a safe next path", async ({
  page,
}) => {
  await page.addInitScript(
    ({ key }) => localStorage.setItem(key, "existing-token"),
    { key: AUTH_TOKEN_STORAGE_KEY },
  );
  await mockAuthApi(page);

  await page.goto("/login?next=%2Fdecks");
  await expect(page).toHaveURL(/\/decks$/);

  await page.goto("/register?next=https%3A%2F%2Fevil.test%2Fsteal");
  await expect(page).toHaveURL(/\/profile$/);
});

test("signing out clears the session and returns to the public match picker", async ({ page }) => {
  const authRequests = [];
  await page.addInitScript(
    ({ key }) => localStorage.setItem(key, "existing-token"),
    { key: AUTH_TOKEN_STORAGE_KEY },
  );
  await mockAuthApi(page, authRequests);

  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
  await expect(page.getByTitle("Sign out")).toHaveCount(0);

  await page.getByRole("button", { name: /Account menu for Rune Player/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Choose Your Loadout" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), AUTH_TOKEN_STORAGE_KEY))
    .toBeNull();
  expect(authRequests).toEqual(["/api/auth/logout"]);
});

test("signed-in home account menu opens profile, settings, and sign out actions", async ({ page }) => {
  await page.addInitScript(
    ({ key }) => localStorage.setItem(key, "existing-token"),
    { key: AUTH_TOKEN_STORAGE_KEY },
  );
  await mockAuthApi(page);

  await page.goto("/");

  const accountMenu = page.getByRole("button", { name: /Account menu for Rune Player/ });
  await expect(accountMenu).toBeVisible();
  await expect(page.getByText("Rune Player")).toBeVisible();
  await expect(page.getByText("Lv. 1")).toBeVisible();

  await accountMenu.click();
  await expect(page.getByRole("menuitem", { name: "Profile" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();

  await page.getByRole("menuitem", { name: "Profile" }).click();
  await expect(page).toHaveURL(/\/profile$/);

  await page.getByRole("button", { name: /Account menu for Rune Player/ }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
});

test("profile and settings mark the current account menu item disabled", async ({ page }) => {
  await page.addInitScript(
    ({ key }) => localStorage.setItem(key, "existing-token"),
    { key: AUTH_TOKEN_STORAGE_KEY },
  );
  await mockAuthApi(page);

  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();

  await page.getByRole("button", { name: /Account menu for Rune Player/ }).click();
  await expect(page.getByRole("menuitem", { name: "Profile" })).toBeDisabled();
  await expect(page.getByRole("menuitem", { name: "Settings" })).toBeEnabled();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeEnabled();

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  await page.getByRole("button", { name: /Account menu for Rune Player/ }).click();
  await expect(page.getByRole("menuitem", { name: "Profile" })).toBeEnabled();
  await expect(page.getByRole("menuitem", { name: "Settings" })).toBeDisabled();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeEnabled();
});

test("match-related account menu omits sign out for signed-in players", async ({ page }) => {
  await page.addInitScript(
    ({ key }) => localStorage.setItem(key, "existing-token"),
    { key: AUTH_TOKEN_STORAGE_KEY },
  );
  await mockAuthApi(page);

  await page.goto("/match/menu-match");
  await expect(page.getByRole("heading", { name: "Round 1" })).toBeVisible();

  await page.getByRole("button", { name: /Account menu for Rune Player/ }).click();
  await expect(page.getByRole("menuitem", { name: "Profile" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toHaveCount(0);
});

test("signed-out match sign in returns to the same match route", async ({ page }) => {
  const authRequests = [];
  await mockAuthApi(page, authRequests);

  await page.goto("/match/menu-match");
  await expect(page.getByRole("heading", { name: "Round 1" })).toBeVisible();

  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/login\?/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/match/menu-match");

  await page.getByLabel("Email").fill("player@local.dev");
  await page.getByLabel("Password").fill("pw");
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page).toHaveURL(/\/match\/menu-match$/);
  await expect(page.getByRole("heading", { name: "Round 1" })).toBeVisible();
  expect(authRequests).toEqual(["/api/auth/login"]);
});

test("protected route redirects replace the protected URL in browser history", async ({ page }) => {
  await mockAuthApi(page);

  for (const protectedPath of ["/profile", "/decks", "/matches"]) {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Choose Your Loadout" })).toBeVisible();

    await page.goto(protectedPath);

    await expect(page).toHaveURL(/\/login\?/);
    expect(new URL(page.url()).searchParams.get("next")).toBe(protectedPath);

    await page.goBack();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Choose Your Loadout" })).toBeVisible();
  }
});

for (const { path, heading } of [
  { path: "/", heading: "Choose Your Loadout" },
  { path: "/catalog", heading: "Card Catalog" },
  { path: "/settings", heading: "Settings" },
  { path: "/@rune-player/decks/10", heading: "Arcane Draft" },
]) {
  test(`signed-out players can open public route ${path}`, async ({ page }) => {
    await mockAuthApi(page);

    await page.goto(path);

    await expect(page).toHaveURL(new RegExp(`${path === "/" ? "/" : path}$`));
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  });
}

for (const { path, message } of [
  { path: "/match/public-solo", message: "Missing test match" },
  { path: "/match/public-shared/seat-token", message: "Missing shared match" },
  { path: "/matches/public-replay/replay", message: "Missing test replay" },
]) {
  test(`signed-out players can open public route ${path} without auth redirect`, async ({
    page,
  }) => {
    if (path.includes("public-shared")) {
      await page.addInitScript(() => {
        class FakeWebSocket extends EventTarget {
          readyState = 3;

          close() {}

          send() {}
        }

        window.WebSocket = FakeWebSocket;
      });
    }

    await mockAuthApi(page);

    await page.goto(path);

    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole("heading", { name: message })).toBeVisible();
  });
}

async function mockAuthApi(page, authRequests = []) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/api/auth/login" && request.method() === "POST") {
      authRequests.push(url.pathname);
      await route.fulfill({ json: authSession("player@local.dev") });
      return;
    }

    if (url.pathname === "/api/auth/register" && request.method() === "POST") {
      authRequests.push(url.pathname);
      await route.fulfill({ json: authSession("new-player@local.dev") });
      return;
    }

    if (url.pathname === "/api/auth/me" && request.method() === "GET") {
      await route.fulfill({ json: authUser("player@local.dev") });
      return;
    }

    if (url.pathname === "/api/auth/logout" && request.method() === "POST") {
      authRequests.push(url.pathname);
      await route.fulfill({ json: { message: "Signed out" } });
      return;
    }

    if (url.pathname === "/api/profile/matches") {
      await route.fulfill({ json: { matches: [] } });
      return;
    }

    if (url.pathname === "/api/progression") {
      await route.fulfill({ json: progression() });
      return;
    }

    if (url.pathname === "/api/preferences" && request.method() === "GET") {
      await route.fulfill({ json: preferences() });
      return;
    }

    if (url.pathname === "/api/preferences" && request.method() === "PATCH") {
      await route.fulfill({ json: { ...request.postDataJSON(), updatedAt: 20 } });
      return;
    }

    if (url.pathname === "/api/matches" && request.method() === "GET") {
      await route.fulfill({ json: { matches: [] } });
      return;
    }

    if (url.pathname === "/api/matches/menu-match" && request.method() === "GET") {
      await route.fulfill({ json: matchResponse("menu-match", playableMatch()) });
      return;
    }

    if (url.pathname === "/api/matches/public-solo" && request.method() === "GET") {
      await route.fulfill({ status: 404, json: { message: "Missing test match" } });
      return;
    }

    if (
      url.pathname === "/api/shared-matches/public-shared/seats/seat-token" &&
      request.method() === "GET"
    ) {
      await route.fulfill({ status: 404, json: { message: "Missing shared match" } });
      return;
    }

    if (url.pathname === "/api/matches/public-replay/replay" && request.method() === "GET") {
      await route.fulfill({ status: 404, json: { message: "Missing test replay" } });
      return;
    }

    if (url.pathname === "/api/catalog/cards") {
      await route.fulfill({ json: { cards: [] } });
      return;
    }

    if (url.pathname === "/api/users/rune-player/decks/10") {
      await route.fulfill({
        json: {
          owner: {
            id: 1,
            handle: "rune-player",
            displayName: "Rune Player",
            avatar: { symbol: "spark", color: "emerald" },
          },
          deck: {
            id: 10,
            name: "Arcane Draft",
            isDefault: false,
            wizardType: "runekeeper",
            runeIds: [],
            cards: [],
            legality: {
              legal: false,
              totalCards: 0,
              basicCards: 0,
              advancedCards: 0,
              rareCards: 0,
              messages: ["Deck recipe needs at least 30 cards."],
            },
            createdAt: 1,
            updatedAt: 1,
          },
        },
      });
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

    await route.fulfill({ status: 404, json: { message: "Not found" } });
  });
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

function authSession(email) {
  return {
    token: "session-token",
    user: authUser(email),
  };
}

function authUser(email) {
  return {
    id: 1,
    handle: "rune-player",
    email,
    displayName: "Rune Player",
    avatar: { symbol: "spark", color: "emerald" },
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

function progression() {
  return {
    account: authUser("player@local.dev").progressionSummary,
    wizards: [],
    runes: [],
    skillTrees: [],
    loadouts: [
      { wizardType: "runekeeper", runeIds: [] },
      { wizardType: "pyromancer", runeIds: [] },
    ],
  };
}

function deckRules() {
  return {
    maxDecksPerAccount: 12,
    minCards: 30,
    basicCopyLimit: 4,
    advancedCopyLimit: 3,
    rareCopyLimit: 2,
    advancedTotalLimit: 12,
    rareTotalLimit: 6,
  };
}

function matchResponse(matchId, matchState) {
  return { matchId, matchState, replayFrames: [] };
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
      wizardType: side === "player" ? "runekeeper" : "pyromancer",
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
