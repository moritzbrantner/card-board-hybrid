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

test("register submits credentials to the existing registration API", async ({ page }) => {
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

    if (url.pathname === "/api/profile/matches") {
      await route.fulfill({ json: { matches: [] } });
      return;
    }

    if (url.pathname === "/api/decks") {
      await route.fulfill({ json: { rules: deckRules(), decks: [] } });
      return;
    }

    if (url.pathname === "/api/system-decks") {
      await route.fulfill({ json: { rules: deckRules(), decks: [] } });
      return;
    }

    await route.fulfill({ status: 404, json: { message: "Not found" } });
  });
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
    email,
    displayName: "Rune Player",
    avatar: { symbol: "spark", color: "emerald" },
    preferredWizardType: "runekeeper",
    boardVisualMode: "2d",
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
