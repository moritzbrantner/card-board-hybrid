import { expect, test } from "@playwright/test";

const AUTH_TOKEN_STORAGE_KEY = "rune-lanes-auth-token";

test("signed-out players visiting settings are redirected to login with next", async ({ page }) => {
  await mockSettingsApi(page);

  await page.goto("/settings");

  await expect(page).toHaveURL(/\/login\?/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/settings");
  await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
});

test("settings load, save, apply, and persist visual preferences", async ({ page }) => {
  let preferences = defaultPreferences();
  const savedPayloads = [];
  await page.addInitScript(
    ({ key }) => localStorage.setItem(key, "existing-token"),
    { key: AUTH_TOKEN_STORAGE_KEY },
  );
  await mockSettingsApi(page, {
    loadPreferences: () => preferences,
    savePreferences: (payload) => {
      savedPayloads.push(payload);
      preferences = { ...payload, updatedAt: 99 };
      return preferences;
    },
  });

  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByLabel("Theme")).toHaveValue("system");

  await page.getByLabel("Theme").selectOption("highContrast");
  await page.getByLabel("Motion").selectOption("reduced");
  await page.getByLabel("Animation speed").selectOption("fast");
  await page.getByLabel("Board scale").selectOption("large");
  await page.getByRole("button", { name: "Save Settings" }).click();

  await expect(page.getByText("Settings saved.")).toBeVisible();
  expect(savedPayloads).toHaveLength(1);
  expect(savedPayloads[0]).toMatchObject({
    theme: "highContrast",
    motion: "reduced",
    animationSpeed: "fast",
    boardScale: "large",
  });
  expect(savedPayloads[0].hotkeys).toHaveLength(15);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme")))
    .toBe("highContrast");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-motion")))
    .toBe("reduced");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-animation-speed")))
    .toBe("fast");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-board-scale")))
    .toBe("large");

  await page.reload();

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByLabel("Theme")).toHaveValue("highContrast");
  await expect(page.getByLabel("Motion")).toHaveValue("reduced");
  await expect(page.getByLabel("Animation speed")).toHaveValue("fast");
  await expect(page.getByLabel("Board scale")).toHaveValue("large");
});

async function mockSettingsApi(page, handlers = {}) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/api/auth/me") {
      await route.fulfill({ json: authUser() });
      return;
    }

    if (url.pathname === "/api/preferences" && request.method() === "GET") {
      await route.fulfill({ json: handlers.loadPreferences?.() ?? defaultPreferences() });
      return;
    }

    if (url.pathname === "/api/preferences" && request.method() === "PATCH") {
      const payload = request.postDataJSON();
      await route.fulfill({
        json: handlers.savePreferences?.(payload) ?? { ...payload, updatedAt: 99 },
      });
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
      { commandId: "openSettings", binding: "," },
      { commandId: "openCatalog", binding: "C" },
      { commandId: "openDecks", binding: "K" },
      { commandId: "openMatchArchive", binding: "M" },
    ],
    updatedAt: null,
  };
}
